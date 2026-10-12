import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineHandler } from '@domain-first/handlers';
import { afterAll, describe, expect, rstest, test } from '@rstest/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import z from 'zod';
import { createEndpoint } from '../create-endpoint';
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
        errorStatuses: {
            404: { checks: [], description: 'Not found' },
            409: {
                checks: [],
                openApiTypes: {
                    name: z.literal('Conflict'),
                    details: z.object({ field: z.string() })
                }
            }
        }
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

    test('describes error responses', () => {
        expect(operation?.responses['404']).toEqual({
            description: 'Not found',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['name'],
                        properties: {
                            name: { type: 'string' },
                            message: { type: 'string', nullable: true }
                        }
                    }
                }
            }
        });
        expect(operation?.responses['409']).toMatchObject({
            description: 'Error response',
            content: {
                'application/json': {
                    schema: {
                        properties: {
                            name: { type: 'string', enum: ['Conflict'] },
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
        const errorName = validationOnly();
        const errorDetails = validationOnly();
        custom._api_schemas.responseSchemas.body = body;
        custom.metadata = {
            route: { method: 'get', path: ['users'] },
            errorStatuses: {
                400: {
                    checks: [],
                    openApiTypes: { name: errorName, details: errorDetails }
                }
            }
        };

        const conversions = new Map<StandardSchemaV1, z.ZodType>([
            [body, z.object({ converted: z.boolean() })],
            [errorName, z.literal('BadRequest')],
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
            errorName,
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
                            name: { type: 'string', enum: ['BadRequest'] },
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
