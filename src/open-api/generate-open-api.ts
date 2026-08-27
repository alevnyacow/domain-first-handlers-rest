import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { StandardJSONSchemaV1 } from '@standard-schema/spec';
import type { OpenAPIV3 } from 'openapi-types';
import type { Metadata, RawAPISchemas } from '../types';
import { describeParameters } from './describe-parameters';
import { jsonSchemasFromRoute } from './json-schemas-from-route';

export type GenerateOpenAPIOptions = {
    document: Omit<OpenAPIV3.Document, 'paths' | 'openapi'>;
    apiRoutePrefix?: string[];
    standardSchemaToJSONSchema?: (x: any) => StandardJSONSchemaV1;
    outputFile?: {
        path: string;
        format?: (x: OpenAPIV3.Document) => string;
    };
};

export const generateOpenAPI = (
    routes: { metadata: Metadata; _api_schemas: RawAPISchemas }[],
    options: GenerateOpenAPIOptions
): OpenAPIV3.Document => {
    const paths: OpenAPIV3.PathsObject = {};

    for (const route of routes) {
        const jsonSchemas = jsonSchemasFromRoute(route, {
            jsonSchemaObtainer: options.standardSchemaToJSONSchema ?? ((x) => x)
        });

        const successBodyResponse = jsonSchemas.responseBody
            ? {
                  [String(route.metadata.successStatusCode ?? 200)]: {
                      description:
                          route.metadata.successResponseDescription ?? 'OK',

                      content: {
                          'application/json': {
                              schema: jsonSchemas.responseBody[
                                  '~standard'
                              ].jsonSchema.output({
                                  target: 'openapi-3.0'
                              })
                          }
                      }
                  }
              }
            : {};

        const errorResponses = route.metadata.errorStatuses
            ? Object.fromEntries(
                  Object.entries(route.metadata.errorStatuses).map((x) => {
                      return [
                          x[0],
                          {
                              description: x[1].description ?? 'Error response',
                              content: {
                                  'application/json': {
                                      schema: {
                                          type: 'object' as const,
                                          required: ['name'],
                                          properties: {
                                              name: {
                                                  type: 'string' as const
                                              },
                                              message: {
                                                  type: 'string' as const,
                                                  nullable: true
                                              },
                                              details: {
                                                  type: 'object' as const,
                                                  nullable: true
                                              }
                                          }
                                      }
                                  }
                              }
                          }
                      ];
                  })
              )
            : {};

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
            const schema = jsonSchemas.requestQuery[
                '~standard'
            ].jsonSchema.input({
                target: 'openapi-3.0'
            });
            operation.parameters = describeParameters(schema, 'query');
        }

        if (jsonSchemas.requestCookies) {
            const schema = jsonSchemas.requestCookies[
                '~standard'
            ].jsonSchema.input({
                target: 'openapi-3.0'
            });
            operation.parameters = (operation.parameters ?? []).concat(
                describeParameters(schema, 'cookie')
            );
        }

        if (jsonSchemas.requestHeaders) {
            const schema = jsonSchemas.requestHeaders[
                '~standard'
            ].jsonSchema.input({
                target: 'openapi-3.0'
            });
            operation.parameters = (operation.parameters ?? []).concat(
                describeParameters(schema, 'header')
            );
        }

        if (jsonSchemas.requestBody) {
            operation.requestBody = {
                required: true,

                content: {
                    'application/json': {
                        schema: jsonSchemas.requestBody[
                            '~standard'
                        ].jsonSchema.input({
                            target: 'openapi-3.0'
                        })
                    }
                }
            };
        }

        const path = [
            ...(options.apiRoutePrefix ?? []),
            ...route.metadata.route.path
        ].join('/');

        operation.tags = route.metadata.tags
            ? route.metadata.tags
            : [route.metadata.route.path[0]];

        paths[path] ??= {};

        paths[path]![route.metadata.route.method] = {
            ...operation,
            ...(route.metadata.openApiMetadata ?? {})
        };
    }

    const result: OpenAPIV3.Document = {
        openapi: '3.0.3',
        ...options.document,
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
