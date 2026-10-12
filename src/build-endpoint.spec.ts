import { defineHandler } from '@domain-first/handlers';
import { describe, expect, test } from '@rstest/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import z from 'zod';
import { createEndpoint } from './create-endpoint';
import {
    InputMappingError,
    RequestParsingError,
    ResponseParsingError
} from './errors';
import { type MockRestAdapterInput, mockAdapter } from './mock-adapter';
import { generateOpenAPI } from './open-api';
import type { Adapter, RawRequestModel, RequestSchemas } from './types';

const echo = defineHandler({
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.object({ value: z.string() }),
    handler: async (x) => x
});

const failing = defineHandler({
    inputSchema: z.object({}),
    outputSchema: z.number(),
    handler: async () => {
        throw new Error('domain failure');
    }
});

const errorBody = (result: { body?: any }) => JSON.parse(result.body);

/**
 * Mock adapter that records which request sources were read
 * and what was passed to the output.
 */
const recordingAdapter = () => {
    const reads: string[] = [];
    const outputs: Parameters<
        Adapter<[MockRestAdapterInput], unknown>['output']
    >[0][] = [];

    const read =
        (name: string, key: keyof MockRestAdapterInput) =>
        (x: MockRestAdapterInput) => {
            reads.push(name);
            return x[key] ?? {};
        };

    const adapter: Adapter<[MockRestAdapterInput], 'done'> = {
        input: {
            queryParams: read('query', 'queryParams'),
            pathParams: read('params', 'pathParams'),
            body: read('body', 'body'),
            formData: read('formData', 'formData'),
            headers: read('headers', 'headers'),
            cookies: read('cookies', 'cookies')
        },
        output: (x) => {
            outputs.push(x);
            return 'done';
        }
    };

    return { adapter, reads, outputs };
};

const withBadRequest = createEndpoint({
    errorStatuses: {
        400: { checks: [(e) => e instanceof RequestParsingError] }
    }
})(mockAdapter);

describe('request parsing', () => {
    const cases = [
        {
            source: 'query',
            route: [] as string[],
            valid: { queryParams: { value: 'q' } },
            invalid: { queryParams: { value: 1 } }
        },
        {
            source: 'body',
            route: [],
            valid: { body: { value: 'q' } },
            invalid: { body: { value: 1 } }
        },
        {
            source: 'formData',
            route: [],
            valid: { formData: { value: 'q' } },
            invalid: { formData: {} }
        },
        {
            source: 'headers',
            route: [],
            valid: { headers: { value: 'q' } },
            invalid: { headers: { value: 1 } }
        },
        {
            source: 'cookies',
            route: [],
            valid: { cookies: { value: 'q' } },
            invalid: { cookies: {} }
        }
    ] as const;

    for (const { source, route, valid, invalid } of cases) {
        describe(source, () => {
            const schema = z.object({ value: z.string() });
            const sourceEndpoint = withBadRequest(echo, {
                route: { method: 'post', path: route }
            })
                .input(() => ({ [source]: schema }) as RequestSchemas)
                .mapInput((x: any) => x[source]);

            test('passes valid data to mapInput', async () => {
                const result = await sourceEndpoint(valid);
                expect(result).toEqual({
                    success: true,
                    statusCode: 200,
                    body: { value: 'q' },
                    headers: undefined,
                    cookies: undefined
                });
            });

            test('rejects invalid data with its source', async () => {
                const result = await sourceEndpoint(invalid as any);
                expect(result.statusCode).toBe(400);
                expect(errorBody(result).details).toMatchObject({
                    source,
                    received: Object.values(invalid)[0]
                });
            });
        });
    }

    test('applies schema transformations', async () => {
        const sum = defineHandler({
            inputSchema: z.object({ a: z.number(), b: z.number() }),
            outputSchema: z.number(),
            handler: async ({ a, b }) => a + b
        });
        const result = await withBadRequest(sum, {
            route: { method: 'get', path: [':a'] }
        })
            .input(() => ({
                query: z.object({ b: z.string().trim() })
            }))
            .mapInput(({ params, query }) => ({
                a: Number(params.a),
                b: Number(query.b)
            }))({
            pathParams: { a: '2' },
            queryParams: { b: ' 3 ' }
        });
        expect(result.body).toBe(5);
    });

    test('reports the first invalid source in parsing order', async () => {
        const result = await withBadRequest(echo, {
            route: { method: 'post', path: [] }
        })
            .input(() => ({
                body: z.object({ value: z.string() }),
                query: z.object({ value: z.string() })
            }))
            .mapInput(({ body }) => body)({ body: {}, queryParams: {} });
        expect(errorBody(result).details.source).toBe('query');
    });

    test('reads body, form data and params only when needed', async () => {
        const { adapter, reads } = recordingAdapter();
        await createEndpoint()(adapter)(echo, {
            route: { method: 'get', path: [] }
        })
            .input(() => ({}))
            .mapInput(() => ({ value: 'v' }))({});
        expect(reads).toEqual(['query', 'headers', 'cookies']);
    });

    test('reads params when the route declares them', async () => {
        const { adapter, reads } = recordingAdapter();
        await createEndpoint()(adapter)(echo, {
            route: { method: 'get', path: [':value'] }
        })
            .input(() => ({}))
            .mapInput(({ params }) => params)({ pathParams: { value: 'v' } });
        expect(reads).toEqual(['query', 'params', 'headers', 'cookies']);
    });

    test('passes raw params through without a schema', async () => {
        const result = await createEndpoint()(mockAdapter)(echo, {
            route: { method: 'get', path: ['items', ':value'] }
        })
            .input(() => ({}))
            .mapInput(({ params }) => params)({
            pathParams: { value: 'v', extra: 'e' }
        });
        // extra keys are dropped by the handler schema, not by params parsing
        expect(result.body).toEqual({ value: 'v' });
    });

    test('rejects mapInput results the handler schema rejects', async () => {
        const result = await createEndpoint()(mockAdapter)(echo, {
            route: { method: 'get', path: [] }
        })
            .input(() => ({}))
            .mapInput(() => ({ value: 1 }) as any)({});
        expect(result.statusCode).toBe(500);
        expect(errorBody(result)).toMatchObject({
            name: new InputMappingError({ issues: [], received: {} }).name,
            details: { received: { value: 1 } }
        });
    });

    test('lets invalid mapped input be a client error', async () => {
        const sum = defineHandler({
            inputSchema: z.object({ a: z.number() }),
            outputSchema: z.number(),
            handler: async ({ a }) => a
        });
        const result = await createEndpoint({
            errorStatuses: {
                400: { checks: [(e) => e instanceof InputMappingError] }
            }
        })(mockAdapter)(sum, { route: { method: 'get', path: [':a'] } })
            .input(() => ({}))
            .mapInput(({ params }) => ({ a: Number(params.a) }))({
            pathParams: { a: 'abc' }
        });
        expect(result.statusCode).toBe(400);
    });

    test('rejects missing route params', async () => {
        const result = await withBadRequest(echo, {
            route: { method: 'get', path: ['items', ':value'] }
        })
            .input(() => ({}))
            .mapInput(({ params }) => params)({ pathParams: { other: 'x' } });
        expect(result.statusCode).toBe(400);
        expect(errorBody(result).details).toMatchObject({
            source: 'params',
            received: { other: 'x' },
            issues: [
                {
                    message: 'Path parameter "value" is missing',
                    path: ['value']
                }
            ]
        });
    });

    test('supports async mappers', async () => {
        const result = await createEndpoint()(mockAdapter)(echo, {
            route: { method: 'get', path: [] }
        })
            .input(() => ({}))
            .mapInput(async () => ({ value: 'in' }))
            .output((schema) => ({ body: schema }))
            .mapOutput(async (x) => ({ body: { value: `${x.value}-out` } }))(
            {}
        );
        expect(result.body).toEqual({ value: 'in-out' });
    });
});

describe('adapter without path params', () => {
    const { pathParams: _, ...input } = mockAdapter.input;
    const legacyEndpoint = createEndpoint()({ ...mockAdapter, input });

    test('fails on routes with params', () => {
        expect(() =>
            legacyEndpoint(echo, { route: { method: 'get', path: [':value'] } })
                .input(() => ({}))
                .mapInput(({ params }) => params)
        ).toThrow('input.pathParams');
    });

    test('works on routes without params', async () => {
        const result = await legacyEndpoint(echo, {
            route: { method: 'get', path: ['items'] }
        })
            .input(() => ({}))
            .mapInput(() => ({ value: 'v' }))({});
        expect(result.body).toEqual({ value: 'v' });
    });
});

describe('context', () => {
    test('receives parsed and raw request data', async () => {
        const received: RawRequestModel[] = [];
        const result = await createEndpoint({
            context: async (raw) => {
                received.push(raw);
                return { user: 'admin' };
            }
        })(mockAdapter)(echo, { route: { method: 'post', path: [':id'] } })
            .input(() => ({ body: z.object({ value: z.string() }) }))
            .mapInput(({ body, context }) => ({
                value: `${body.value}:${context.user}`
            }))({
            body: { value: 'v' },
            queryParams: { q: '1' },
            pathParams: { id: '7' },
            headers: { h: '2' },
            cookies: { c: '3' }
        });

        expect(result.body).toEqual({ value: 'v:admin' });
        expect(received).toEqual([
            {
                query: { q: '1' },
                params: { id: '7' },
                body: { value: 'v' },
                formData: {},
                headers: { h: '2' },
                cookies: { c: '3' }
            }
        ]);
    });

    test('is undefined without a context factory', async () => {
        let context: unknown = 'not called';
        await createEndpoint()(mockAdapter)(echo, {
            route: { method: 'get', path: [] }
        })
            .input(() => ({}))
            .mapInput((x) => {
                context = (x as any).context;
                return { value: 'v' };
            })({});
        expect(context).toBeUndefined();
    });
});

describe('errors', () => {
    const route = { method: 'get', path: [] } as const;

    test('become 500 by default', async () => {
        const result = await createEndpoint()(mockAdapter)(failing, { route })
            .input(() => ({}))
            .mapInput(() => ({}))({});
        expect(result).toMatchObject({ success: false, statusCode: 500 });
        expect(errorBody(result)).toEqual({
            name: 'Error',
            message: 'domain failure'
        });
    });

    test('use shared statuses', async () => {
        const result = await createEndpoint({
            errorStatuses: { 409: { checks: [() => false, () => true] } }
        })(mockAdapter)(failing, { route })
            .input(() => ({}))
            .mapInput(() => ({}))({});
        expect(result.statusCode).toBe(409);
    });

    test('ignore statuses whose checks do not match', async () => {
        const result = await createEndpoint({
            errorStatuses: { 409: { checks: [() => false] } }
        })(mockAdapter)(failing, {
            route,
            errorStatuses: { 418: { checks: [() => false] } }
        })
            .input(() => ({}))
            .mapInput(() => ({}))({});
        expect(result.statusCode).toBe(500);
    });

    test('prefer endpoint statuses and their full model', async () => {
        const failingEndpoint = createEndpoint({
            errorStatuses: {
                409: {
                    checks: [() => true],
                    toFullModel: () => ({ name: 'shared' })
                }
            }
        })(mockAdapter)(failing, {
            route,
            errorStatuses: {
                422: {
                    checks: [() => true],
                    toFullModel: (e) => ({
                        name: 'endpoint',
                        message: e.message,
                        details: { extra: true }
                    })
                }
            }
        })
            .input(() => ({}))
            .mapInput(() => ({}));

        const result = await failingEndpoint({});
        expect(result.statusCode).toBe(422);
        expect(errorBody(result)).toEqual({
            name: 'endpoint',
            message: 'domain failure',
            details: { extra: true }
        });
        expect(
            Object.keys(failingEndpoint.metadata.errorStatuses ?? {})
        ).toEqual(['409', '422']);
    });

    test('keep details of domain errors', async () => {
        const result = await withBadRequest(echo, { route })
            .input(() => ({ query: z.object({ value: z.string() }) }))
            .mapInput(({ query }) => query)({});
        expect(errorBody(result)).toMatchObject({
            name: new RequestParsingError({
                issues: [],
                source: 'query',
                received: {}
            }).name,
            details: { source: 'query', received: {} }
        });
    });
});

describe('responses', () => {
    const route = { method: 'post', path: [] } as const;

    test('use metadata success status code', async () => {
        const result = await createEndpoint()(mockAdapter)(echo, {
            route,
            successStatusCode: 201
        })
            .input(() => ({}))
            .mapInput(() => ({ value: 'v' }))({});
        expect(result.statusCode).toBe(201);
    });

    test('pass validated parts and configuration to the adapter', async () => {
        const { adapter, outputs } = recordingAdapter();
        const cookies = { session: { httpOnly: true, maxAge: 60 } };
        const result = await createEndpoint()(adapter)(echo, { route })
            .input(() => ({}))
            .mapInput(() => ({ value: 'v' }))
            .output(
                () => ({
                    headers: z.object({ 'x-value': z.string() }),
                    cookies: z.object({ session: z.string() })
                }),
                { cookies }
            )
            .mapOutput((x) => ({
                headers: { 'x-value': x.value },
                cookies: { session: 'token' }
            }))({});

        expect(result).toBe('done');
        expect(outputs).toEqual([
            {
                success: true,
                statusCode: 200,
                body: undefined,
                headers: { 'x-value': 'v' },
                cookies: { session: 'token' },
                configuration: { cookies }
            }
        ]);
    });

    test('use empty configuration by default', async () => {
        const { adapter, outputs } = recordingAdapter();
        await createEndpoint()(adapter)(echo, { route })
            .input(() => ({}))
            .mapInput(() => ({ value: 'v' }))({});
        expect(outputs[0]).toMatchObject({
            body: { value: 'v' },
            configuration: {}
        });
    });

    for (const target of ['body', 'headers', 'cookies'] as const) {
        test(`reject invalid ${target}`, async () => {
            const invalidEndpoint = createEndpoint()(mockAdapter)(echo, {
                route
            })
                .input(() => ({}))
                .mapInput(() => ({ value: 'v' }))
                .output(() => ({ [target]: z.object({ value: z.number() }) }))
                .mapOutput((x) => ({ [target]: x }) as any);

            const result = await invalidEndpoint({});
            expect(result.statusCode).toBe(500);
            expect(errorBody(result)).toMatchObject({
                name: new ResponseParsingError({
                    issues: [],
                    source: target,
                    received: undefined
                }).name,
                details: { source: target, received: { value: 'v' } }
            });
        });
    }
});

describe('hooks', () => {
    test('run shared hooks before adapter hooks', async () => {
        const calls: string[] = [];
        await createEndpoint({
            hooks: [{ onSuccess: () => void calls.push('shared') }]
        })(mockAdapter, {
            hooks: [{ onSuccess: () => void calls.push('adapter') }]
        })(echo, { route: { method: 'get', path: [] } })
            .input(() => ({}))
            .mapInput(() => ({ value: 'v' }))({});
        expect(calls).toEqual(['shared', 'adapter']);
    });

    test('receive request errors', async () => {
        const errors: unknown[] = [];
        await createEndpoint({
            hooks: [{ onError: (e) => void errors.push(e) }]
        })(mockAdapter)(echo, { route: { method: 'get', path: [] } })
            .input(() => ({ query: z.object({ value: z.string() }) }))
            .mapInput(({ query }) => query)({});
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(RequestParsingError);
    });
});

describe('endpoint description', () => {
    const body = z.object({ value: z.string() });
    const headers = z.object({ 'x-value': z.string() });

    test('exposes request and default response schemas', () => {
        const described = createEndpoint()(mockAdapter)(echo, {
            route: { method: 'post', path: ['echo'] },
            summary: 'Echo'
        })
            .input(() => ({ body }))
            .mapInput(({ body }) => body);

        expect(described._api_schemas).toEqual({
            requestSchemas: { body },
            responseSchemas: { body: echo.outputSchema }
        });
        expect(described.metadata).toEqual({
            route: { method: 'post', path: ['echo'] },
            summary: 'Echo',
            errorStatuses: {}
        });
    });

    test('exposes custom response schemas', () => {
        const described = createEndpoint()(mockAdapter)(echo, {
            route: { method: 'post', path: [] }
        })
            .input(() => ({ body }))
            .mapInput(({ body }) => body)
            .output(() => ({ headers }))
            .mapOutput((x) => ({ headers: { 'x-value': x.value } }));

        expect(described._api_schemas.responseSchemas).toEqual({ headers });
    });

    test('passes the handler schemas to schema factories', () => {
        let received: unknown[] = [];
        createEndpoint()(mockAdapter)(echo, {
            route: { method: 'post', path: [] }
        })
            .input((input) => {
                received.push(input);
                return {};
            })
            .mapInput(() => ({ value: 'v' }))
            .output((output) => {
                received = [...received, output];
                return {};
            })
            .mapOutput(() => ({}));
        expect(received).toEqual([echo.inputSchema, echo.outputSchema]);
    });
});

describe('schemas without JSON Schema support', () => {
    /**
     * Minimal Standard Schema of a library like Valibot:
     * validation only, no `jsonSchema`.
     */
    const stringRecord = <Key extends string>(
        ...keys: Key[]
    ): StandardSchemaV1<Record<Key, string>> => ({
        '~standard': {
            version: 1,
            vendor: 'custom',
            validate: (value) => {
                const record = (value ?? {}) as Record<string, unknown>;
                const missing = keys.filter(
                    (key) => typeof record[key] !== 'string'
                );
                return missing.length > 0
                    ? { issues: missing.map((key) => ({ message: key })) }
                    : { value: record as Record<Key, string> };
            }
        }
    });

    const greet = defineHandler({
        inputSchema: stringRecord('name'),
        outputSchema: stringRecord('greeting'),
        handler: async ({ name }) => ({ greeting: `Hello, ${name}` })
    });

    const greetGET = withBadRequest(greet, {
        route: { method: 'get', path: ['greet', ':name'] },
        errorStatuses: {
            422: {
                checks: [],
                openApiTypes: { details: stringRecord('field') }
            }
        }
    })
        .input(() => ({ headers: stringRecord('x-lang') }))
        .mapInput(({ params, headers }) => ({
            name: `${params.name} (${headers['x-lang']})`
        }));

    test('validate requests', async () => {
        expect(
            await greetGET({
                pathParams: { name: 'Ann' },
                headers: { 'x-lang': 'en' }
            })
        ).toMatchObject({
            statusCode: 200,
            body: { greeting: 'Hello, Ann (en)' }
        });

        expect(
            (await greetGET({ pathParams: { name: 'Ann' } })).statusCode
        ).toBe(400);
    });

    test('describe OpenAPI through the converter', () => {
        const result = generateOpenAPI([greetGET], {
            document: { info: { title: 'Test', version: '1.0.0' } },
            standardSchemaToJSONSchema: () => z.object({ value: z.string() })
        });
        const operation = result.paths['/greet/{name}']?.get;

        expect(operation?.parameters?.map((x: any) => [x.in, x.name])).toEqual([
            ['path', 'name'],
            ['header', 'value']
        ]);
        expect(operation?.responses['422']).toBeDefined();
    });
});
