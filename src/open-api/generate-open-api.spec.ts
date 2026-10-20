import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { errorNamespace } from '@domain-first/errors';
import { defineHandler } from '@domain-first/handlers';
import { afterAll, describe, expect, rstest, test } from '@rstest/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import z from 'zod';
import { createEndpoint } from '../create-endpoint';
import { httpError, httpStatus } from '../http-error';
import { mockAdapter } from '../mock-adapter';
import type { Metadata, RawAPISchemas } from '../types';
import { generateOpenAPI } from './generate-open-api';

/**
 * Schema of a library without Standard JSON Schema support (e.g. Valibot).
 */
const validationOnly = (): StandardSchemaV1 => ({
    '~standard': {
        version: 1,
        vendor: 'validation-only',
        validate: (value) => ({ value })
    }
});

const UserErrors = errorNamespace('users');
const OrgNotFoundError = UserErrors.define<{ org: string }>('org-not-found');
const UserNotFoundError = UserErrors.define('user-not-found');
const ConflictError = UserErrors.define<{ field: string }>('conflict');

const route = (path: string[]) => ({
    metadata: { route: { method: 'get', path } } as Metadata,
    _api_schemas: {
        requestSchemas: {},
        responseSchemas: {}
    } as RawAPISchemas
});

const pathsOf = (apiRoutePrefix?: string[], path = ['orders', 'recent']) =>
    Object.keys(
        generateOpenAPI([route(path)], {
            document: { info: { title: 'Test', version: '1.0.0' } },
            apiRoutePrefix
        }).paths
    );

describe('generateOpenAPI paths', () => {
    test('start with a slash without a prefix', () => {
        expect(pathsOf()).toEqual(['/orders/recent']);
        expect(pathsOf([])).toEqual(['/orders/recent']);
    });

    test('accept prefix segments with or without slashes', () => {
        expect(pathsOf(['api'])).toEqual(['/api/orders/recent']);
        expect(pathsOf(['/api'])).toEqual(['/api/orders/recent']);
        expect(pathsOf(['api', 'v1'])).toEqual(['/api/v1/orders/recent']);
        expect(pathsOf(['/api/v1/'])).toEqual(['/api/v1/orders/recent']);
    });

    test('keep the leading empty segment form working', () => {
        expect(pathsOf(['', 'api'])).toEqual(['/api/orders/recent']);
        expect(pathsOf(['/'])).toEqual(['/orders/recent']);
    });

    test('keep a route without segments at the prefix root', () => {
        expect(pathsOf(['api'], [])).toEqual(['/api']);
        expect(pathsOf(undefined, [])).toEqual(['/']);
    });
});

describe('generateOpenAPI path params', () => {
    const document = { info: { title: 'Test', version: '1.0.0' } };

    test('converts route params and describes them', () => {
        const result = generateOpenAPI(
            [route(['users', ':userId', 'tabs/:tab'])],
            { document }
        );
        const operation = result.paths['/users/{userId}/tabs/{tab}']?.get;

        expect(operation?.parameters).toEqual([
            {
                name: 'userId',
                in: 'path',
                required: true,
                schema: { type: 'string' }
            },
            {
                name: 'tab',
                in: 'path',
                required: true,
                schema: { type: 'string' }
            }
        ]);
    });

    test('describes params with their schema', () => {
        const getUser = defineHandler({
            inputSchema: z.object({ email: z.string() }),
            outputSchema: z.object({}),
            handler: async () => ({})
        });
        const result = generateOpenAPI(
            [
                createEndpoint()(mockAdapter)(getUser, {
                    route: {
                        method: 'get',
                        path: ['users', ':email', ':id']
                    }
                })
                    .input(() => ({
                        params: z.object({
                            id: z.string().regex(/^\d+$/),
                            email: z.email()
                        })
                    }))
                    .mapInput(({ params }) => ({ email: params.email }))
            ],
            { document }
        );
        const parameters = result.paths['/users/{email}/{id}']?.get
            ?.parameters as any[];

        // route order, always required
        expect(parameters.map((x) => [x.name, x.in, x.required])).toEqual([
            ['email', 'path', true],
            ['id', 'path', true]
        ]);
        expect(parameters[0].schema).toMatchObject({
            type: 'string',
            format: 'email'
        });
        expect(parameters[1].schema).toMatchObject({
            type: 'string',
            pattern: '^\\d+$'
        });
    });

    test('describes params a schema skips as strings', () => {
        const echoId = defineHandler({
            inputSchema: z.object({ id: z.string() }),
            outputSchema: z.object({}),
            handler: async () => ({})
        });
        const result = generateOpenAPI(
            [
                createEndpoint()(mockAdapter)(echoId, {
                    route: { method: 'get', path: [':org', ':id'] }
                })
                    .input(() => ({
                        params: z.object({ id: z.enum(['a', 'b']) })
                    }))
                    .mapInput(({ params }) => ({ id: params.id }))
            ],
            { document }
        );

        expect(result.paths['/{org}/{id}']?.get?.parameters).toEqual([
            {
                name: 'org',
                in: 'path',
                required: true,
                schema: { type: 'string' }
            },
            {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string', enum: ['a', 'b'] }
            }
        ]);
    });

    test('adds no parameters for routes without params', () => {
        const result = generateOpenAPI([route(['users'])], { document });
        expect(result.paths['/users']?.get?.parameters).toBeUndefined();
    });
});

describe('generateOpenAPI operations', () => {
    const document = { info: { title: 'Test', version: '1.0.0' } };
    const endpoint = createEndpoint()(mockAdapter);

    const createUser = defineHandler({
        inputSchema: z.object({ name: z.string(), org: z.string() }),
        outputSchema: z.object({ id: z.number() }),
        handler: async () => ({ id: 1 })
    });

    const createUserPOST = endpoint(createUser, {
        route: { method: 'post', path: ['orgs', ':org', 'users'] },
        summary: 'Create user',
        description: 'Creates a user in an organization',
        successStatusCode: 201,
        successResponseDescription: 'Created',
        errors: [
            httpError(OrgNotFoundError, 404, {
                description: 'Organization not found'
            }),
            httpError(UserNotFoundError, 404, {
                description: 'User not found',
                message: 'User not found'
            }),
            httpError(ConflictError, 409, {
                message: (e) => `${e.details.field} is taken`,
                details: {
                    schema: z.object({ field: z.string() }),
                    map: (e) => ({ field: e.details.field })
                }
            })
        ]
    })
        .input(() => ({
            query: z.object({ dryRun: z.string().optional() }),
            body: z.object({ name: z.string() }),
            headers: z.object({ 'x-request-id': z.string() }),
            cookies: z.object({ session: z.string() })
        }))
        .mapInput(({ params, body }) => ({ ...body, org: params.org }));

    const result = generateOpenAPI([createUserPOST], { document });
    const operation = result.paths['/orgs/{org}/users']?.post;

    test('keeps the document', () => {
        expect(result.openapi).toBe('3.0.3');
        expect(result.info).toEqual(document.info);
    });

    test('describes the operation', () => {
        expect(operation?.summary).toBe('Create user');
        expect(operation?.description).toBe(
            'Creates a user in an organization'
        );
        expect(operation?.tags).toEqual(['orgs']);
    });

    test('describes parameters of every source', () => {
        expect(operation?.parameters).toEqual([
            {
                name: 'dryRun',
                in: 'query',
                required: false,
                schema: { type: 'string' }
            },
            {
                name: 'org',
                in: 'path',
                required: true,
                schema: { type: 'string' }
            },
            {
                name: 'session',
                in: 'cookie',
                required: true,
                schema: { type: 'string' }
            },
            {
                name: 'x-request-id',
                in: 'header',
                required: true,
                schema: { type: 'string' }
            }
        ]);
    });

    test('describes the request body', () => {
        expect(operation?.requestBody).toEqual({
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: { name: { type: 'string' } },
                        required: ['name']
                    }
                }
            }
        });
    });

    test('describes the success response', () => {
        expect(operation?.responses['201']).toEqual({
            description: 'Created',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: { id: { type: 'number' } },
                        required: ['id'],
                        additionalProperties: false
                    }
                }
            }
        });
    });

    test('describes errors of one status as alternatives', () => {
        expect(operation?.responses['404']).toEqual({
            description: 'Organization not found; User not found',
            content: {
                'application/json': {
                    schema: {
                        oneOf: [
                            {
                                type: 'object',
                                required: ['code'],
                                properties: {
                                    code: {
                                        type: 'string',
                                        enum: [OrgNotFoundError.code]
                                    }
                                }
                            },
                            {
                                type: 'object',
                                required: ['code', 'message'],
                                properties: {
                                    code: {
                                        type: 'string',
                                        enum: [UserNotFoundError.code]
                                    },
                                    message: {
                                        type: 'string',
                                        example: 'User not found'
                                    }
                                }
                            }
                        ]
                    }
                }
            }
        });
    });

    test('puts named error bodies with their details to components', () => {
        const Field = z.object({ name: z.string() }).meta({ id: 'Field' });
        const named = route(['users']);
        named.metadata = {
            route: { method: 'get', path: ['users'] },
            errors: [
                httpError(ConflictError, 409, {
                    schemaName: 'Conflict',
                    details: {
                        schema: z.object({ field: Field }),
                        map: (e) => ({ field: { name: e.details.field } })
                    }
                })
            ]
        };
        const result = generateOpenAPI([named], { document });

        expect(result.paths['/users']?.get?.responses?.['409']).toMatchObject({
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/Conflict' }
                }
            }
        });
        expect(result.components?.schemas).toMatchObject({
            Conflict: {
                properties: {
                    code: { enum: [ConflictError.code] },
                    details: {
                        properties: {
                            field: { $ref: '#/components/schemas/Field' }
                        }
                    }
                }
            },
            Field: { properties: { name: { type: 'string' } } }
        });
    });

    test('rejects one error schema name for different bodies', () => {
        const named = route(['users']);
        named.metadata = {
            route: { method: 'get', path: ['users'] },
            errors: [
                httpError(OrgNotFoundError, 404, { schemaName: 'NotFound' }),
                httpError(UserNotFoundError, 404, { schemaName: 'NotFound' })
            ]
        };
        expect(() => generateOpenAPI([named], { document })).toThrow(
            'Schema "NotFound" is described differently'
        );
    });

    test('describes groups and plain error classes by their code', () => {
        class TimeoutError extends Error {}
        const grouped = endpoint(createUser, {
            route: { method: 'post', path: ['groups'] },
            errors: [
                httpStatus(503, {
                    code: 'UNAVAILABLE',
                    description: 'Service unavailable',
                    match: [TimeoutError, (e) => e.message === 'down']
                }),
                httpError(TimeoutError, 504, { code: 'TIMEOUT' })
            ]
        })
            .input((schema) => ({ body: schema }))
            .mapInput(({ body }) => body);

        const responses = generateOpenAPI([grouped], { document }).paths[
            '/groups'
        ]?.post?.responses;

        expect(responses?.['503']).toEqual({
            description: 'Service unavailable',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['code'],
                        properties: {
                            code: { type: 'string', enum: ['UNAVAILABLE'] }
                        }
                    }
                }
            }
        });
        expect(responses?.['504']).toMatchObject({
            content: {
                'application/json': {
                    schema: {
                        properties: {
                            code: { type: 'string', enum: ['TIMEOUT'] }
                        }
                    }
                }
            }
        });
    });

    test('describes a single error with its message and details', () => {
        expect(operation?.responses['409']).toEqual({
            description: 'Error response',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['code', 'message'],
                        properties: {
                            code: {
                                type: 'string',
                                enum: [ConflictError.code]
                            },
                            message: { type: 'string' },
                            details: {
                                type: 'object',
                                properties: { field: { type: 'string' } },
                                required: ['field'],
                                additionalProperties: false
                            }
                        }
                    }
                }
            }
        });
    });

    test('omits response body without a body schema', () => {
        const headersOnly = endpoint(createUser, {
            route: { method: 'post', path: ['users'] }
        })
            .input((schema) => ({ body: schema }))
            .mapInput(({ body }) => body)
            .output(() => ({ headers: z.object({ location: z.string() }) }))
            .mapOutput(() => ({ headers: { location: '/users/1' } }));

        expect(
            generateOpenAPI([headersOnly], { document }).paths['/users']?.post
                ?.responses
        ).toEqual({});
    });

    test('describes header and cookie parameters on their own', () => {
        const headersOnly = route(['a']);
        headersOnly._api_schemas.requestSchemas.headers = z.object({
            h: z.string()
        });
        const cookiesOnly = route(['b']);
        cookiesOnly._api_schemas.requestSchemas.cookies = z.object({
            c: z.string()
        });

        const { paths } = generateOpenAPI([headersOnly, cookiesOnly], {
            document
        });

        expect(paths['/a']?.get?.parameters).toEqual([
            {
                name: 'h',
                in: 'header',
                required: true,
                schema: { type: 'string' }
            }
        ]);
        expect(paths['/b']?.get?.parameters).toEqual([
            {
                name: 'c',
                in: 'cookie',
                required: true,
                schema: { type: 'string' }
            }
        ]);
    });

    test('ignores form data and response headers and cookies', () => {
        const withExtras = route(['files']);
        withExtras._api_schemas.requestSchemas.formData = z.object({
            file: z.string()
        });
        withExtras._api_schemas.responseSchemas.headers = z.object({
            etag: z.string()
        });
        withExtras._api_schemas.responseSchemas.cookies = z.object({
            seen: z.string()
        });

        expect(
            generateOpenAPI([withExtras], { document }).paths['/files']?.get
        ).toEqual({ responses: {}, tags: ['files'] });
    });

    test('merges methods of the same path', () => {
        const get = route(['users']);
        const post = route(['users']);
        post.metadata = { route: { method: 'post', path: ['users'] } };

        expect(
            Object.keys(
                generateOpenAPI([get, post], { document }).paths['/users'] ?? {}
            )
        ).toEqual(['get', 'post']);
    });

    test('applies custom tags and OpenAPI metadata', () => {
        const custom = route(['users']);
        custom.metadata = {
            route: { method: 'get', path: ['users'] },
            tags: ['people'],
            openApiMetadata: { operationId: 'listUsers', deprecated: true }
        };

        expect(
            generateOpenAPI([custom], { document }).paths['/users']?.get
        ).toMatchObject({
            tags: ['people'],
            operationId: 'listUsers',
            deprecated: true
        });
    });

    test('converts every schema with standardSchemaToJSONSchema', () => {
        const custom = route(['users']);
        const body = validationOnly();
        const errorDetails = validationOnly();
        custom._api_schemas.responseSchemas.body = body;
        custom.metadata = {
            route: { method: 'get', path: ['users'] },
            errors: [
                httpError(ConflictError, 400, {
                    details: { schema: errorDetails, map: (e) => e.details }
                })
            ]
        };

        const conversions = new Map<StandardSchemaV1, z.ZodType>([
            [body, z.object({ converted: z.boolean() })],
            [errorDetails, z.object({ field: z.string() })]
        ]);
        const standardSchemaToJSONSchema = rstest.fn(
            (schema: StandardSchemaV1) => conversions.get(schema)!
        );

        const result = generateOpenAPI([custom], {
            document,
            standardSchemaToJSONSchema
        });
        const responses = result.paths['/users']?.get?.responses;

        expect(standardSchemaToJSONSchema.mock.calls.map(([x]) => x)).toEqual([
            body,
            errorDetails
        ]);
        expect(responses?.['200']).toMatchObject({
            content: {
                'application/json': {
                    schema: { properties: { converted: { type: 'boolean' } } }
                }
            }
        });
        expect(responses?.['400']).toMatchObject({
            content: {
                'application/json': {
                    schema: {
                        properties: {
                            code: {
                                type: 'string',
                                enum: [ConflictError.code]
                            },
                            details: {
                                type: 'object',
                                properties: { field: { type: 'string' } }
                            }
                        }
                    }
                }
            }
        });
    });

    test('explains how to convert schemas without JSON Schema support', () => {
        const custom = route(['users']);
        custom._api_schemas.requestSchemas.body = validationOnly();

        expect(() => generateOpenAPI([custom], { document })).toThrow(
            'Schema of "validation-only" does not support Standard JSON Schema, pass "standardSchemaToJSONSchema" to generateOpenAPI'
        );
    });
});

describe('generateOpenAPI schema components', () => {
    const document = { info: { title: 'Test', version: '1.0.0' } };

    /**
     * Schema of a library that keeps named subschemas in `$defs`.
     */
    const jsonSchema = (
        input: Record<string, unknown>,
        output: Record<string, unknown> = input
    ) =>
        ({
            '~standard': {
                version: 1,
                vendor: 'json-schema',
                validate: (value: unknown) => ({ value }),
                jsonSchema: { input: () => input, output: () => output }
            }
        }) as unknown as StandardSchemaV1;

    const withBody = (
        path: string,
        schemas: Partial<
            Record<'requestBody' | 'responseBody' | 'query', StandardSchemaV1>
        >
    ) => {
        const result = route([path]);
        result.metadata = { route: { method: 'post', path: [path] } };
        result._api_schemas.requestSchemas.body = schemas.requestBody;
        result._api_schemas.requestSchemas.query = schemas.query;
        result._api_schemas.responseSchemas.body = schemas.responseBody;
        return result;
    };

    const requestSchema = (
        result: ReturnType<typeof generateOpenAPI>,
        path: string
    ) =>
        (
            result.paths[path]?.post?.requestBody as {
                content: Record<string, { schema: unknown }>;
            }
        ).content['application/json']!.schema;

    const responseSchema = (
        result: ReturnType<typeof generateOpenAPI>,
        path: string
    ) =>
        (
            result.paths[path]?.post?.responses['200'] as {
                content: Record<string, { schema: unknown }>;
            }
        ).content['application/json']!.schema;

    const Money = z
        .object({ amount: z.number(), currency: z.string() })
        .meta({ id: 'Money' });

    test('adds no components without named schemas', () => {
        const result = generateOpenAPI(
            [withBody('a', { responseBody: z.object({ a: z.string() }) })],
            { document }
        );

        expect(result.components).toBeUndefined();
    });

    test('moves a named schema to components once', () => {
        const result = generateOpenAPI(
            [
                withBody('orders', {
                    responseBody: z.object({ total: Money, tax: Money })
                }),
                withBody('invoices', {
                    responseBody: z.object({ items: z.array(Money) })
                })
            ],
            { document }
        );

        expect(result.components?.schemas).toEqual({
            Money: {
                type: 'object',
                properties: {
                    amount: { type: 'number' },
                    currency: { type: 'string' }
                },
                required: ['amount', 'currency'],
                additionalProperties: false
            }
        });
        expect(responseSchema(result, '/orders')).toEqual({
            type: 'object',
            properties: {
                total: { $ref: '#/components/schemas/Money' },
                tax: { $ref: '#/components/schemas/Money' }
            },
            required: ['total', 'tax'],
            additionalProperties: false
        });
        expect(responseSchema(result, '/invoices')).toMatchObject({
            properties: {
                items: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Money' }
                }
            }
        });
    });

    test('splits request and response variants that differ', () => {
        const result = generateOpenAPI(
            [
                withBody('orders', {
                    requestBody: z.object({ total: Money }),
                    responseBody: z.object({ total: Money })
                })
            ],
            { document }
        );

        expect(Object.keys(result.components?.schemas ?? {})).toEqual([
            'MoneyInput',
            'MoneyOutput'
        ]);
        expect(result.components?.schemas?.MoneyInput).not.toHaveProperty(
            'additionalProperties'
        );
        expect(requestSchema(result, '/orders')).toMatchObject({
            properties: { total: { $ref: '#/components/schemas/MoneyInput' } }
        });
        expect(responseSchema(result, '/orders')).toMatchObject({
            properties: {
                total: { $ref: '#/components/schemas/MoneyOutput' }
            }
        });
    });

    test('keeps one component for matching variants of any library', () => {
        const body = jsonSchema({
            type: 'object',
            properties: { id: { $ref: '#/$defs/Id' } },
            $defs: { Id: { type: 'string', format: 'uuid' } }
        });
        const result = generateOpenAPI(
            [withBody('users', { requestBody: body, responseBody: body })],
            { document }
        );

        expect(result.components?.schemas).toEqual({
            Id: { type: 'string', format: 'uuid' }
        });
        expect(requestSchema(result, '/users')).toEqual({
            type: 'object',
            properties: { id: { $ref: '#/components/schemas/Id' } }
        });
        expect(responseSchema(result, '/users')).toEqual(
            requestSchema(result, '/users')
        );
    });

    test('splits schemas referring to split ones', () => {
        const variant = (closed: boolean) => ({
            type: 'object',
            properties: { price: { $ref: '#/$defs/Price' } },
            $defs: {
                Line: {
                    type: 'object',
                    properties: { price: { $ref: '#/$defs/Price' } }
                },
                Price: {
                    type: 'object',
                    properties: { amount: { type: 'number' } },
                    ...(closed && { additionalProperties: false })
                }
            }
        });
        const line = (closed: boolean) => ({
            ...variant(closed),
            properties: { line: { $ref: '#/$defs/Line' } }
        });
        const result = generateOpenAPI(
            [
                withBody('lines', {
                    requestBody: jsonSchema(line(false)),
                    responseBody: jsonSchema(line(false), line(true))
                })
            ],
            { document }
        );

        expect(Object.keys(result.components?.schemas ?? {}).sort()).toEqual([
            'LineInput',
            'LineOutput',
            'PriceInput',
            'PriceOutput'
        ]);
        expect(result.components?.schemas?.LineOutput).toEqual({
            type: 'object',
            properties: {
                price: { $ref: '#/components/schemas/PriceOutput' }
            }
        });
        expect(responseSchema(result, '/lines')).toMatchObject({
            properties: { line: { $ref: '#/components/schemas/LineOutput' } }
        });
    });

    test('resolves references in parameters', () => {
        const result = generateOpenAPI(
            [
                withBody('search', {
                    query: jsonSchema({
                        type: 'object',
                        properties: { sort: { $ref: '#/definitions/Sort' } },
                        definitions: { Sort: { type: 'string' } }
                    })
                })
            ],
            { document }
        );

        expect(result.paths['/search']?.post?.parameters).toEqual([
            {
                name: 'sort',
                in: 'query',
                required: false,
                schema: { $ref: '#/components/schemas/Sort' }
            }
        ]);
    });

    test('leaves data and property names as they are', () => {
        const result = generateOpenAPI(
            [
                withBody('data', {
                    responseBody: jsonSchema({
                        type: 'object',
                        properties: {
                            default: { $ref: '#/$defs/Id' },
                            $ref: { type: 'string' },
                            payload: {
                                type: 'object',
                                default: { $ref: '#/$defs/Id' }
                            },
                            external: { $ref: '#/$defs/Missing' }
                        },
                        $defs: { Id: { type: 'string' } }
                    })
                })
            ],
            { document }
        );

        expect(responseSchema(result, '/data')).toEqual({
            type: 'object',
            properties: {
                default: { $ref: '#/components/schemas/Id' },
                $ref: { type: 'string' },
                payload: { type: 'object', default: { $ref: '#/$defs/Id' } },
                external: { $ref: '#/$defs/Missing' }
            }
        });
    });

    test('merges components of the document', () => {
        const result = generateOpenAPI(
            [withBody('orders', { responseBody: z.object({ total: Money }) })],
            {
                document: {
                    ...document,
                    components: {
                        schemas: { Error: { type: 'string' } },
                        securitySchemes: {
                            bearer: { type: 'http', scheme: 'bearer' }
                        }
                    }
                }
            }
        );

        expect(Object.keys(result.components?.schemas ?? {})).toEqual([
            'Error',
            'Money'
        ]);
        expect(result.components?.securitySchemes).toEqual({
            bearer: { type: 'http', scheme: 'bearer' }
        });
    });

    test('rejects names already in the document components', () => {
        expect(() =>
            generateOpenAPI(
                [
                    withBody('orders', {
                        responseBody: z.object({ total: Money })
                    })
                ],
                {
                    document: {
                        ...document,
                        components: { schemas: { Money: { type: 'string' } } }
                    }
                }
            )
        ).toThrow('Schema "Money" is already in components.schemas');
    });

    test('rejects split names taken by other schemas', () => {
        const MoneyInput = z.object({ x: z.string() }).meta({
            id: 'MoneyInput'
        });

        expect(() =>
            generateOpenAPI(
                [
                    withBody('orders', {
                        requestBody: z.object({ total: Money, x: MoneyInput }),
                        responseBody: z.object({ total: Money })
                    })
                ],
                { document }
            )
        ).toThrow('Schema "MoneyInput" is already in components.schemas');
    });

    test('rejects different schemas of one name', () => {
        expect(() =>
            generateOpenAPI(
                [
                    withBody('a', {
                        responseBody: z.object({ money: Money })
                    }),
                    withBody('b', {
                        responseBody: z.object({
                            money: z.object({ cents: z.number() }).meta({
                                id: 'Money'
                            })
                        })
                    })
                ],
                { document }
            )
        ).toThrow(
            'Schema "Money" is described differently in several places, give each variant its own name'
        );
    });

    test('rejects names OpenAPI does not allow', () => {
        expect(() =>
            generateOpenAPI(
                [
                    withBody('a', {
                        responseBody: jsonSchema({
                            type: 'object',
                            properties: { x: { $ref: '#/$defs/My%20Id' } },
                            $defs: { 'My Id': { type: 'string' } }
                        })
                    })
                ],
                { document }
            )
        ).toThrow(
            `Schema "My Id" can't be an OpenAPI component name, use letters, digits, ".", "-" and "_"`
        );
    });

    test('names schemas with an id keyword, the root too', () => {
        const money = {
            id: 'Money',
            type: 'object',
            properties: { amount: { type: 'number' } }
        };
        const result = generateOpenAPI(
            [
                withBody('orders', {
                    responseBody: jsonSchema({
                        id: 'Order',
                        type: 'object',
                        properties: { total: money, paid: money }
                    })
                })
            ],
            { document }
        );

        expect(responseSchema(result, '/orders')).toEqual({
            $ref: '#/components/schemas/Order'
        });
        expect(result.components?.schemas).toEqual({
            Order: {
                type: 'object',
                properties: {
                    total: { $ref: '#/components/schemas/Money' },
                    paid: { $ref: '#/components/schemas/Money' }
                }
            },
            Money: {
                type: 'object',
                properties: { amount: { type: 'number' } }
            }
        });
    });

    test('ignores an id inherited from the named schema', () => {
        const result = generateOpenAPI(
            [
                withBody('search', {
                    responseBody: jsonSchema({
                        type: 'object',
                        properties: {
                            sort: {
                                id: 'Sort',
                                anyOf: [
                                    { id: 'Sort', const: 'asc' },
                                    { id: 'Sort', const: 'desc' }
                                ]
                            }
                        }
                    })
                })
            ],
            { document }
        );

        expect(result.components?.schemas).toEqual({
            Sort: { anyOf: [{ const: 'asc' }, { const: 'desc' }] }
        });
    });

    test('keeps parameter roots with an id inline', () => {
        const result = generateOpenAPI(
            [
                withBody('search', {
                    query: jsonSchema({
                        id: 'Search',
                        type: 'object',
                        properties: {
                            sort: { id: 'Sort', type: 'string' }
                        }
                    })
                })
            ],
            { document }
        );

        expect(result.paths['/search']?.post?.parameters).toEqual([
            {
                name: 'sort',
                in: 'query',
                required: false,
                schema: { $ref: '#/components/schemas/Sort' }
            }
        ]);
        expect(Object.keys(result.components?.schemas ?? {})).toEqual(['Sort']);
    });

    test('treats an id property as a name, not a keyword', () => {
        const result = generateOpenAPI(
            [
                withBody('users', {
                    responseBody: jsonSchema({
                        type: 'object',
                        properties: { id: { type: 'string' } }
                    })
                })
            ],
            { document }
        );

        expect(responseSchema(result, '/users')).toEqual({
            type: 'object',
            properties: { id: { type: 'string' } }
        });
        expect(result.components?.schemas ?? {}).toEqual({});
    });

    test('rejects one id for different schemas', () => {
        expect(() =>
            generateOpenAPI(
                [
                    withBody('orders', {
                        requestBody: jsonSchema({
                            type: 'object',
                            properties: {
                                a: { id: 'Money', type: 'number' },
                                b: { id: 'Money', type: 'string' }
                            }
                        })
                    })
                ],
                { document }
            )
        ).toThrow('Schema "Money" is described differently');
    });
});

describe('generateOpenAPI JSON Schema targets', () => {
    const document = { info: { title: 'Test', version: '1.0.0' } };

    /**
     * Schema of a library without the `openapi-3.0` target (e.g. ArkType).
     */
    const draftOnly = (schema: Record<string, unknown>) =>
        ({
            '~standard': {
                version: 1,
                vendor: 'draft-only',
                validate: (value: unknown) => ({ value }),
                jsonSchema: {
                    input: ({ target }: { target: string }) => {
                        if (target !== 'draft-07') {
                            throw new Error(`target ${target} is unsupported`);
                        }
                        return {
                            $schema: 'http://json-schema.org/draft-07/schema#',
                            ...schema
                        };
                    }
                }
            }
        }) as unknown as StandardSchemaV1;

    const withRequestBody = (body: StandardSchemaV1) => {
        const result = route(['items']);
        result.metadata = { route: { method: 'post', path: ['items'] } };
        result._api_schemas.requestSchemas.body = body;
        return result;
    };

    test('fall back to draft-07 without $schema', () => {
        const result = generateOpenAPI(
            [withRequestBody(draftOnly({ type: 'string' }))],
            { document }
        );

        expect(result.paths['/items']?.post?.requestBody).toEqual({
            required: true,
            content: { 'application/json': { schema: { type: 'string' } } }
        });
    });

    test('rethrow the openapi-3.0 error when draft-07 fails too', () => {
        const unsupported = {
            '~standard': {
                version: 1,
                vendor: 'unsupported',
                validate: (value: unknown) => ({ value }),
                jsonSchema: {
                    input: ({ target }: { target: string }) => {
                        throw new Error(`no ${target}`);
                    }
                }
            }
        } as unknown as StandardSchemaV1;

        expect(() =>
            generateOpenAPI([withRequestBody(unsupported)], { document })
        ).toThrow('no openapi-3.0');
    });
});

describe('generateOpenAPI output file', () => {
    const document = { info: { title: 'Test', version: '1.0.0' } };
    const directory = mkdtempSync(path.join(tmpdir(), 'handlers-rest-'));

    afterAll(() => rmSync(directory, { recursive: true, force: true }));

    test('writes the document as JSON', () => {
        const file = path.join(directory, 'nested', 'openapi.json');
        const result = generateOpenAPI([route(['users'])], {
            document,
            outputFile: { path: file }
        });

        expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual(result);
    });

    test('uses a custom format', () => {
        const file = path.join(directory, 'openapi.txt');
        generateOpenAPI([route(['users'])], {
            document,
            outputFile: {
                path: file,
                format: (x) => Object.keys(x.paths).join()
            }
        });

        expect(readFileSync(file, 'utf-8')).toBe('/users');
    });

    test('logs write errors instead of throwing', () => {
        const blocker = path.join(directory, 'blocker');
        writeFileSync(blocker, '');
        const consoleError = rstest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        const result = generateOpenAPI([route(['users'])], {
            document,
            outputFile: { path: path.join(blocker, 'openapi.json') }
        });

        expect(Object.keys(result.paths)).toEqual(['/users']);
        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining(
                'Error on openapi declaration file generating'
            )
        );
        consoleError.mockRestore();
    });

    test('logs non-error failures', () => {
        const consoleError = rstest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        generateOpenAPI([route(['users'])], {
            document,
            outputFile: {
                path: path.join(directory, 'failing.json'),
                format: () => {
                    throw 'format failed';
                }
            }
        });

        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining('"format failed"')
        );
        consoleError.mockRestore();
    });
});
