import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { OpenAPIV3 } from 'openapi-types';
import { pathParamNames } from '../path-params';
import type { ErrorMapping, Metadata, RawAPISchemas } from '../types';
import { describeParameters } from './describe-parameters';
import { jsonSchemasFromRoute } from './json-schemas-from-route';
import { createSchemaComponents } from './schema-components';
import {
    defaultStandardSchemaToJSONSchema,
    type StandardSchemaToJSONSchema,
    toOpenAPISchema
} from './to-openapi-schema';

const OWN_SCHEMA_VENDOR = '@domain-first/handlers-rest';

export type GenerateOpenAPIOptions = {
    document: Omit<OpenAPIV3.Document, 'paths' | 'openapi'>;
    /**
     * Segments every route is served under, e.g. `['api']` or `['api', 'v1']`.
     * Slashes are optional: `['/api/v1']` works the same.
     */
    apiRoutePrefix?: string[];
    /**
     * Converts schemas of libraries without Standard JSON Schema support.
     * Every schema goes through it, except the library's own ones
     * (e.g. of `invalidRequest()`). By default it is used as is.
     */
    standardSchemaToJSONSchema?: StandardSchemaToJSONSchema;
    outputFile?: {
        path: string;
        format?: (x: OpenAPIV3.Document) => string;
    };
};

/**
 * OpenAPI paths must start with "/" and use `{name}` for path parameters;
 * route segments come without slashes and use `:name`.
 */
const toOpenAPIPath = (segments: readonly string[]) =>
    `/${segments
        .flatMap((segment) => segment.split('/'))
        .filter((segment) => !!segment)
        .map((segment) =>
            segment.startsWith(':') ? `{${segment.slice(1)}}` : segment
        )
        .join('/')}`;

export const generateOpenAPI = (
    routes: { metadata: Metadata; _api_schemas: RawAPISchemas }[],
    options: GenerateOpenAPIOptions
): OpenAPIV3.Document => {
    const paths: OpenAPIV3.PathsObject = {};
    const convert =
        options.standardSchemaToJSONSchema ?? defaultStandardSchemaToJSONSchema;
    // own schemas are written by hand with JSON Schema, a converter
    // for the app's validation library may not understand them
    const toJSONSchema: StandardSchemaToJSONSchema = (schema) =>
        schema['~standard'].vendor === OWN_SCHEMA_VENDOR
            ? defaultStandardSchemaToJSONSchema(schema)
            : convert(schema);
    const components = createSchemaComponents();
    const schemaOf = (
        schema: Parameters<typeof toOpenAPISchema>[0],
        direction: 'input' | 'output',
        options?: { inlineRoot?: boolean }
    ) =>
        components.hoist(
            toOpenAPISchema(schema, direction),
            direction,
            options
        );
    // parameters are described property by property, their root stays
    const parametersOf = (
        schema: Parameters<typeof toOpenAPISchema>[0],
        target: Parameters<typeof describeParameters>[1]
    ) =>
        describeParameters(
            schemaOf(schema, 'input', { inlineRoot: true }),
            target
        );

    for (const route of routes) {
        const jsonSchemas = jsonSchemasFromRoute(route, {
            jsonSchemaObtainer: toJSONSchema
        });

        const successBodyResponse = jsonSchemas.responseBody
            ? {
                  [String(route.metadata.successStatusCode ?? 200)]: {
                      description:
                          route.metadata.successResponseDescription ?? 'OK',

                      content: {
                          'application/json': {
                              schema: schemaOf(
                                  jsonSchemas.responseBody,
                                  'output'
                              )
                          }
                      }
                  }
              }
            : {};

        const errorVariants = new Map<
            string,
            { descriptions: string[]; schemas: OpenAPIV3.SchemaObject[] }
        >();
        const addErrorVariant = (
            status: string | number,
            description: string | undefined,
            schema: OpenAPIV3.SchemaObject
        ) => {
            const variant = errorVariants.get(String(status)) ?? {
                descriptions: [],
                schemas: []
            };

            if (
                description !== undefined &&
                !variant.descriptions.includes(description)
            ) {
                variant.descriptions.push(description);
            }

            variant.schemas.push(schema);
            errorVariants.set(String(status), variant);
        };

        const errorSchema = (mapping: ErrorMapping): OpenAPIV3.SchemaObject => {
            const details =
                mapping.details &&
                toOpenAPISchema(toJSONSchema(mapping.details.schema), 'output');
            const {
                $defs,
                definitions,
                ...detailsSchema
            }: Record<string, any> = details ?? {};
            const body: OpenAPIV3.SchemaObject = {
                type: 'object',
                required:
                    mapping.message === undefined
                        ? ['code']
                        : ['code', 'message'],
                properties: {
                    code: { type: 'string', enum: [mapping.code] },
                    ...(mapping.message !== undefined && {
                        message: {
                            type: 'string',
                            ...(typeof mapping.message === 'string' && {
                                example: mapping.message
                            })
                        }
                    }),
                    // not required: details that fail validation are not sent
                    ...(details && { details: detailsSchema })
                }
            };
            const ownDefinitions = { ...definitions, ...$defs };
            const schema: Record<string, unknown> = mapping.schemaName
                ? {
                      $ref: `#/$defs/${mapping.schemaName}`,
                      $defs: { ...ownDefinitions, [mapping.schemaName]: body }
                  }
                : { ...body, $defs: ownDefinitions };

            // details definitions travel with the body, so one hoist
            // turns both into components
            return components.hoist(schema as OpenAPIV3.SchemaObject, 'output');
        };

        for (const mapping of route.metadata.errors ?? []) {
            addErrorVariant(
                mapping.status,
                mapping.description,
                errorSchema(mapping)
            );
        }

        const errorResponses = Object.fromEntries(
            [...errorVariants].map(([status, { descriptions, schemas }]) => [
                status,
                {
                    description:
                        descriptions.length > 0
                            ? descriptions.join('; ')
                            : 'Error response',
                    content: {
                        'application/json': {
                            schema:
                                schemas.length === 1
                                    ? schemas[0]!
                                    : { oneOf: schemas }
                        }
                    }
                }
            ])
        );

        const operation: OpenAPIV3.OperationObject = {
            ...(route.metadata.summary && {
                summary: route.metadata.summary
            }),

            ...(route.metadata.description && {
                description: route.metadata.description
            }),

            responses: {
                ...successBodyResponse,
                ...errorResponses
            }
        };

        if (jsonSchemas.requestQuery) {
            operation.parameters = parametersOf(
                jsonSchemas.requestQuery,
                'query'
            );
        }

        const routeParamNames = pathParamNames(route.metadata.route.path);

        if (routeParamNames.length > 0) {
            operation.parameters = (operation.parameters ?? []).concat(
                routeParamNames.map((name) => ({
                    name,
                    in: 'path',
                    required: true,
                    schema: { type: 'string' }
                }))
            );
        }

        if (jsonSchemas.requestCookies) {
            operation.parameters = (operation.parameters ?? []).concat(
                parametersOf(jsonSchemas.requestCookies, 'cookie')
            );
        }

        if (jsonSchemas.requestHeaders) {
            operation.parameters = (operation.parameters ?? []).concat(
                parametersOf(jsonSchemas.requestHeaders, 'header')
            );
        }

        if (jsonSchemas.requestBody) {
            operation.requestBody = {
                required: true,

                content: {
                    'application/json': {
                        schema: schemaOf(jsonSchemas.requestBody, 'input')
                    }
                }
            };
        }

        const path = toOpenAPIPath([
            ...(options.apiRoutePrefix ?? []),
            ...route.metadata.route.path
        ]);

        operation.tags = route.metadata.tags
            ? route.metadata.tags
            : [route.metadata.route.path[0]];

        paths[path] ??= {};

        paths[path]![route.metadata.route.method] = {
            ...operation,
            ...(route.metadata.openApiMetadata ?? {})
        };
    }

    const schemas = components.finalize(options.document.components?.schemas);

    const result: OpenAPIV3.Document = {
        openapi: '3.0.3',
        ...options.document,
        ...(Object.keys(schemas).length > 0 && {
            components: {
                ...options.document.components,
                schemas: { ...options.document.components?.schemas, ...schemas }
            }
        }),
        paths
    };

    if (options.outputFile) {
        try {
            const resolvedPath = path.resolve(
                process.cwd(),
                options.outputFile.path
            );
            const targetDir = path.dirname(resolvedPath);

            mkdirSync(targetDir, { recursive: true });

            const fileContent =
                options.outputFile.format?.(result) ??
                JSON.stringify(result, null, '\t');

            writeFileSync(resolvedPath, fileContent, 'utf-8');
        } catch (e: unknown) {
            console.error(
                `Error on openapi declaration file generating: ${e instanceof Error ? e.message : JSON.stringify(e)}`
            );
        }
    }

    return result;
};
