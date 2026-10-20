import { errorNamespace } from '@domain-first/errors';
import { defineHandler } from '@domain-first/handlers';
import { describe, expect, test } from '@rstest/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import z from 'zod';
import { createEndpoint } from './create-endpoint';
import {
    ErrorResponseMappingError,
    INTERNAL_ERROR_CODE,
    InputMappingError,
    RequestParsingError
} from './errors';
import { httpError, httpStatus } from './http-error';
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

const DomainErrors = errorNamespace('test');

const NotFoundError = DomainErrors.define<{ id: string; secret: string }>(
    'not-found'
);

const ConflictError = DomainErrors.define('conflict');

const throwing = (error: Error) =>
    defineHandler({
        inputSchema: z.object({}),
        outputSchema: z.number(),
        handler: async () => {
            throw error;
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
    errors: [
        httpError(RequestParsingError, 400, {
            details: {
                schema: z.object({
                    source: z.string(),
                    issues: z.array(
                        z.object({
                            message: z.string(),
                            path: z.array(z.string())
                        })
                    )
                }),
                map: (e) => ({
                    source: e.details.source,
                    issues: e.details.issues.map((issue) => ({
                        message: issue.message,
                        path: (issue.path ?? []).map((segment) =>
                            String(
                                typeof segment === 'object'
                                    ? segment.key
                                    : segment
                            )
                        )
                    }))
                })
            }
        })
    ]
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
                const { details } = errorBody(result);
                expect(details.source).toBe(source);
                // only mapped details are sent
                expect(details).not.toHaveProperty('received');
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
        expect(errorBody(result)).toEqual({ code: INTERNAL_ERROR_CODE });
    });

    test('lets invalid mapped input be a client error', async () => {
        const sum = defineHandler({
            inputSchema: z.object({ a: z.number() }),
            outputSchema: z.number(),
            handler: async ({ a }) => a
        });
        const result = await createEndpoint({
            errors: [httpError(InputMappingError, 400)]
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
        expect(errorBody(result).details).toEqual({
            source: 'params',
            issues: [
                {
                    message: 'Path parameter "value" is missing',
                    path: ['value']
                }
            ]
        });
    });

    test('validates params with a schema', async () => {
        const byEmail = withBadRequest(echo, {
            route: { method: 'get', path: ['users', ':email', ':tab'] }
        })
            .input(() => ({ params: z.object({ email: z.email() }) }))
            .mapInput(({ params }) => ({
                value: `${params.email}/${params.tab}`
            }));

        const valid = await byEmail({
            pathParams: { email: 'a@b.co', tab: 'posts', extra: 'x' }
        });
        expect(valid.body).toEqual({ value: 'a@b.co/posts' });

        const invalid = await byEmail({
            pathParams: { email: 'nope', tab: 'posts' }
        });
        expect(invalid.statusCode).toBe(400);
        expect(errorBody(invalid).details).toMatchObject({
            source: 'params',
            issues: [{ path: ['email'] }]
        });
    });

    test('checks presence before the params schema', async () => {
        const result = await withBadRequest(echo, {
            route: { method: 'get', path: [':value'] }
        })
            .input(() => ({ params: z.object({ value: z.string() }) }))
            .mapInput(({ params }) => params)({ pathParams: {} });
        expect(errorBody(result).details.issues).toEqual([
            { message: 'Path parameter "value" is missing', path: ['value'] }
        ]);
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
    const notFound = new NotFoundError({ id: '7', secret: 'token' });

    const call = (
        error: Error,
        config: Parameters<typeof createEndpoint>[0] = {},
        endpointErrors?: ReturnType<typeof httpError>[]
    ) =>
        createEndpoint(config)(mockAdapter)(throwing(error), {
            route,
            errors: endpointErrors
        })
            .input(() => ({}))
            .mapInput(() => ({}))({});

    test('become 500 with the internal code only by default', async () => {
        const result = await call(notFound);
        expect(result).toMatchObject({ success: false, statusCode: 500 });
        expect(errorBody(result)).toEqual({ code: INTERNAL_ERROR_CODE });
    });

    test('do not expose errors that are not domain errors', async () => {
        const result = await createEndpoint()(mockAdapter)(failing, { route })
            .input(() => ({}))
            .mapInput(() => ({}))({});
        expect(errorBody(result)).toEqual({ code: INTERNAL_ERROR_CODE });
    });

    test('send only the code by default', async () => {
        const result = await call(notFound, {
            errors: [httpError(NotFoundError, 404)]
        });
        expect(result.statusCode).toBe(404);
        expect(errorBody(result)).toEqual({ code: NotFoundError.code });
    });

    test('ignore mappings of other errors', async () => {
        const result = await call(notFound, {
            errors: [httpError(ConflictError, 409)]
        });
        expect(result.statusCode).toBe(500);
    });

    test('send messages that are set', async () => {
        const fixed = await call(notFound, {
            errors: [httpError(NotFoundError, 404, { message: 'Not found' })]
        });
        expect(errorBody(fixed)).toEqual({
            code: NotFoundError.code,
            message: 'Not found'
        });

        const built = await call(notFound, {
            errors: [
                httpError(NotFoundError, 404, {
                    message: (e) => `${e.details.id} is not found`
                })
            ]
        });
        expect(errorBody(built).message).toBe('7 is not found');
    });

    test('send mapped and validated details', async () => {
        const result = await call(notFound, {
            errors: [
                httpError(NotFoundError, 404, {
                    details: {
                        schema: z.object({ id: z.coerce.number() }),
                        map: (e) => ({ id: e.details.id })
                    }
                })
            ]
        });
        expect(errorBody(result)).toEqual({
            code: NotFoundError.code,
            details: { id: 7 }
        });
    });

    test('send no details that fail validation and notify hooks', async () => {
        const hookErrors: unknown[] = [];
        const result = await call(notFound, {
            hooks: [{ onError: (e) => void hookErrors.push(e) }],
            errors: [
                httpError(NotFoundError, 404, {
                    details: {
                        schema: z.object({ id: z.number() }),
                        map: (e) => ({ id: e.details.id as any })
                    }
                })
            ]
        });

        expect(result.statusCode).toBe(404);
        expect(errorBody(result)).toEqual({ code: NotFoundError.code });

        const mappingError = hookErrors.find((e) =>
            ErrorResponseMappingError.is(e)
        );
        expect(mappingError).toBeDefined();
        expect(
            ErrorResponseMappingError.is(mappingError) && mappingError.details
        ).toMatchObject({
            code: NotFoundError.code,
            part: 'details',
            received: { id: '7' }
        });
    });

    test('send no parts whose mappers throw', async () => {
        const hookErrors: unknown[] = [];
        const result = await call(notFound, {
            hooks: [{ onError: (e) => void hookErrors.push(e) }],
            errors: [
                httpError(NotFoundError, 404, {
                    message: () => {
                        throw new Error('message');
                    },
                    details: {
                        schema: z.object({}),
                        map: () => {
                            throw new Error('details');
                        }
                    }
                })
            ]
        });

        expect(result.statusCode).toBe(404);
        expect(errorBody(result)).toEqual({ code: NotFoundError.code });
        expect(
            hookErrors
                .filter((e) => ErrorResponseMappingError.is(e))
                .map((e) => [e.details.part, (e.cause as Error).message])
        ).toEqual([
            ['message', 'message'],
            ['details', 'details']
        ]);
    });

    test('prefer endpoint mappings of the same error', async () => {
        const result = await call(
            notFound,
            {
                errors: [
                    httpError(NotFoundError, 404),
                    httpError(ConflictError, 409)
                ]
            },
            [httpError(NotFoundError, 410, { message: 'Gone' })]
        );
        expect(result.statusCode).toBe(410);
        expect(errorBody(result)).toEqual({
            code: NotFoundError.code,
            message: 'Gone'
        });
    });

    test('expose merged mappings in metadata', () => {
        const described = createEndpoint({
            errors: [
                httpError(NotFoundError, 404),
                httpError(ConflictError, 409)
            ]
        })(mockAdapter)(failing, {
            route,
            errors: [httpError(NotFoundError, 410)]
        })
            .input(() => ({}))
            .mapInput(() => ({}));

        expect(
            described.metadata.errors?.map((x) => [x.code, x.status])
        ).toEqual([
            [NotFoundError.code, 410],
            [ConflictError.code, 409]
        ]);
    });

    test('reject an error mapped twice in one list', () => {
        expect(() =>
            createEndpoint()(mockAdapter)(failing, {
                route,
                errors: [
                    httpError(NotFoundError, 404),
                    httpError(NotFoundError, 410)
                ]
            })
                .input(() => ({}))
                .mapInput(() => ({}))
        ).toThrow(`Error "${NotFoundError.code}" is mapped more than once`);
    });

    describe('plain error classes', () => {
        class PaymentError extends Error {
            constructor(
                readonly reason: string,
                readonly cardNumber: string
            ) {
                super(reason);
            }
        }

        class CardExpiredError extends PaymentError {}

        const payment = httpError(PaymentError, 402, {
            code: 'PAYMENT_FAILED',
            details: {
                schema: z.object({ reason: z.string() }),
                map: (e) => ({ reason: e.reason })
            }
        });

        test('are matched with instanceof and use the given code', async () => {
            const result = await call(new PaymentError('declined', '4242'), {
                errors: [payment]
            });
            expect(result.statusCode).toBe(402);
            expect(errorBody(result)).toEqual({
                code: 'PAYMENT_FAILED',
                details: { reason: 'declined' }
            });
        });

        test('match subclasses', async () => {
            const result = await call(new CardExpiredError('expired', '4242'), {
                errors: [payment]
            });
            expect(errorBody(result).code).toBe('PAYMENT_FAILED');
        });

        test('need a code', () => {
            // @ts-expect-error plain classes have no code of their own
            expect(() => httpError(PaymentError, 402)).toThrow(
                'Error class "PaymentError" has no code, pass it in the options'
            );
        });

        test('are matched in order, endpoint mappings first', async () => {
            const result = await call(
                new CardExpiredError('expired', '4242'),
                { errors: [httpError(Error, 400, { code: 'ANY' })] },
                [
                    httpError(CardExpiredError, 410, { code: 'CARD_EXPIRED' }),
                    payment
                ]
            );
            expect(result.statusCode).toBe(410);

            const shared = await call(new Error('plain'), {
                errors: [httpError(Error, 400, { code: 'ANY' })]
            });
            expect(errorBody(shared)).toEqual({ code: 'ANY' });
        });
    });

    describe('httpStatus', () => {
        class TimeoutError extends Error {}

        const unavailable = httpStatus(503, {
            code: 'UNAVAILABLE',
            message: 'Try again later',
            match: [
                TimeoutError,
                NotFoundError,
                (e) => e.message.startsWith('db:')
            ]
        });

        test('gives every matching error one status and code', async () => {
            for (const error of [
                new TimeoutError(),
                notFound,
                new Error('db: connection lost')
            ]) {
                const result = await call(error, { errors: [unavailable] });
                expect(result.statusCode).toBe(503);
                expect(errorBody(result)).toEqual({
                    code: 'UNAVAILABLE',
                    message: 'Try again later'
                });
            }
        });

        test('ignores errors that match nothing', async () => {
            const result = await call(new Error('other'), {
                errors: [unavailable]
            });
            expect(result.statusCode).toBe(500);
        });

        test('builds message and details from the error', async () => {
            const result = await call(new TimeoutError('took 5s'), {
                errors: [
                    httpStatus(504, {
                        code: 'TIMEOUT',
                        match: [TimeoutError],
                        message: (e) => e.message,
                        details: {
                            schema: z.object({ name: z.string() }),
                            map: (e) => ({ name: e.name })
                        }
                    })
                ]
            });
            expect(errorBody(result)).toEqual({
                code: 'TIMEOUT',
                message: 'took 5s',
                details: { name: 'Error' }
            });
        });

        test('works next to httpError, the first match wins', async () => {
            const result = await call(notFound, {
                errors: [httpError(NotFoundError, 404), unavailable]
            });
            expect(result.statusCode).toBe(404);
            expect(errorBody(result)).toEqual({ code: NotFoundError.code });
        });
    });

    test('let domain errors override their code', async () => {
        const result = await call(notFound, {
            errors: [httpError(NotFoundError, 404, { code: 'NOT_FOUND' })]
        });
        expect(errorBody(result)).toEqual({ code: 'NOT_FOUND' });
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
            expect(errorBody(result)).toEqual({ code: INTERNAL_ERROR_CODE });
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
            errors: []
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
        errors: [
            httpError(NotFoundError, 422, {
                details: {
                    schema: stringRecord('field'),
                    map: (e) => ({ field: e.details.id })
                }
            })
        ]
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
