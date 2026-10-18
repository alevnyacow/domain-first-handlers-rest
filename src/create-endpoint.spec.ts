import { defineHandler } from '@domain-first/handlers';
import { describe, expect, test } from '@rstest/core';
import z from 'zod';
import {
    createEndpoint,
    type EndpointGenerator,
    type RequestData,
    type ResponseData
} from './create-endpoint';
import { mockAdapter } from './mock-adapter';
import type { EndpointContract } from './types';

const endpoint = createEndpoint({
    context: async (x) => {
        if (x.headers && 'Authorization' in x.headers) {
            const authData = x.headers.Authorization as string;
            const token = authData.substring('Bearer '.length);
            return { token };
        }

        return { token: undefined };
    }
});

const mockEndpoint = endpoint(mockAdapter);

describe('object adapter', async () => {
    const sum = defineHandler({
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        outputSchema: z.number(),
        handler: async ({ a, b }) => {
            return a + b;
        }
    });

    describe('params in query', async () => {
        const allInQuery = mockEndpoint(sum, {
            route: { method: 'get', path: ['ssss', 'fs'] },
            successStatusCode: 205
        })
            .input((_query) => ({
                query: _query
                    .omit({ a: true, b: true })
                    .extend({ a: z.string(), b: z.string() })
            }))
            .mapInput((x) => ({
                a: +x.query.a,
                b: +x.query.b + (x.context.token?.length ? 100 : 0)
            }));

        const aa = (s: EndpointGenerator<{ token: string | undefined }>) => {
            s(sum, { route: { method: 'delete', path: [] } })
                .input((body) => ({ body }))
                .mapInput((x) => ({ a: x.body.a, b: x.body.b }));
        };

        aa(mockEndpoint);

        type CONTRACT = EndpointContract<typeof allInQuery>;
        type Check<
            _ extends {
                request: {
                    query: {
                        a: string;
                        b: string;
                    };
                };
                response: {
                    body: number;
                };
            }
        > = {};
        type _ = Check<CONTRACT>;
        const result = await allInQuery({
            queryParams: { a: '111', b: '333' },
            headers: { Authorization: 'Bearer afjsfkajbfkafbaks' }
        });
        test('has correct response', () =>
            expect(result.body).toBe(111 + 333 + 100));
        test('has correct status code', () =>
            expect(result.statusCode).toBe(205));
    });

    describe('params in body', async () => {
        const allInBody = mockEndpoint(sum, {
            route: { method: 'get', path: ['sup'] }
        })
            .input((body) => ({
                body
            }))
            .mapInput(({ body }) => ({
                ...body
            }));

        type CONTRACT = EndpointContract<typeof allInBody>;
        type Check<
            _ extends {
                request: {
                    body: {
                        a: number;
                        b: number;
                    };
                };
                response: {
                    body: number;
                };
            }
        > = {};
        type _ = Check<CONTRACT>;
        const result = await allInBody({
            body: { a: 111, b: 333 }
        });
        test('has correct response', () => expect(result.body).toBe(444));
    });
});

describe('path params', async () => {
    const getUser = defineHandler({
        inputSchema: z.object({ id: z.number(), tab: z.string() }),
        outputSchema: z.object({ id: z.number(), tab: z.string() }),
        handler: async (x) => x
    });

    const route = {
        method: 'get',
        path: ['users', ':userId', 'tabs/:tab']
    } as const;

    const typed = mockEndpoint(getUser, { route })
        .input(() => ({}))
        .mapInput(({ params }) => ({
            id: Number(params.userId),
            tab: params.tab
        }));

    type _Contract = Check<
        EndpointContract<typeof typed>,
        { request: { params: { userId: string; tab: string } } }
    >;

    test('passes route params only', async () => {
        const result = await typed({
            pathParams: { userId: '42', tab: 'posts', extra: 'x' }
        });
        expect(result.body).toEqual({ id: 42, tab: 'posts' });
    });

    test('rejects missing params', async () => {
        const result = await typed({ pathParams: { userId: '42' } });
        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(500);
    });

    test('types params from the route', () => {
        mockEndpoint(getUser, { route })
            .input(() => ({}))
            .mapInput(({ params }) => {
                type _Params = Check<
                    typeof params,
                    { userId: string; tab: string }
                >;
                // @ts-expect-error only route params are available
                params.extra;
                return { id: 1, tab: params.tab };
            });

        // params are not described with schemas
        const withSchema = mockEndpoint(getUser, { route }).input(() => ({
            body: z.object({}),
            params: z.object({ userId: z.string(), tab: z.string() })
        }));
        const _withSchema: 'params' = withSchema.UNKNOWN;

        // non-literal paths can't be typed
        const widePath: string[] = ['users', ':userId', 'tabs/:tab'];
        mockEndpoint(getUser, { route: { method: 'get', path: widePath } })
            .input(() => ({}))
            .mapInput((data) => {
                // @ts-expect-error no params for a string[] path
                data.params;
                return { id: 1, tab: 'posts' };
            });

        expect(true).toBe(true);
    });

    test('requires adapter support', () => {
        const { pathParams: _, ...input } = mockAdapter.input;
        expect(() =>
            endpoint({ ...mockAdapter, input })(getUser, { route })
                .input(() => ({}))
                .mapInput(({ params }) => ({ id: 1, tab: params.tab }))
        ).toThrow('input.pathParams');
    });
});

describe('types', () => {
    const echo = defineHandler({
        inputSchema: z.object({ value: z.string() }),
        outputSchema: z.object({ value: z.string() }),
        handler: async (x) => x
    });
    const plainEndpoint = createEndpoint()(mockAdapter);
    const route = { method: 'post', path: ['echo'] } as const;

    test('validates query schemas', () => {
        const numbers = plainEndpoint(echo, { route }).input(() => ({
            query: z.object({ value: z.number() })
        }));
        const _numbers: 'INVALID QUERY PARAMETERS SCHEMA' = numbers.ERROR;

        plainEndpoint(echo, { route })
            .input(() => ({ query: z.object({ value: z.string() }) }))
            .mapInput(({ query }) => query);

        const optionalNumber = plainEndpoint(echo, { route }).input(() => ({
            query: z.object({ q: z.string(), page: z.number().optional() })
        }));
        const _optionalNumber: 'page' = optionalNumber.INVALID;

        plainEndpoint(echo, { route })
            .input(() => ({ query: z.object({ page: z.string().optional() }) }))
            .mapInput(() => ({ value: 'v' }));

        plainEndpoint(echo, { route })
            .input(() => ({ query: z.record(z.string(), z.string()) }))
            .mapInput(() => ({ value: 'v' }));

        plainEndpoint(echo, { route })
            .input(() => ({ query: z.object({}) }))
            .mapInput(() => ({ value: 'v' }));

        expect(true).toBe(true);
    });

    test('validates headers and cookies schemas', () => {
        const headers = plainEndpoint(echo, { route }).input(() => ({
            headers: z.object({ 'x-count': z.coerce.number() })
        }));
        const _headers: 'INVALID HEADERS SCHEMA' = headers.ERROR;

        const cookies = plainEndpoint(echo, { route }).input(() => ({
            cookies: z.object({ consent: z.stringbool() })
        }));
        const _cookies: 'INVALID COOKIES SCHEMA' = cookies.ERROR;

        const both = plainEndpoint(echo, { route }).input(() => ({
            headers: z.object({ 'x-count': z.number() }),
            cookies: z.object({ consent: z.boolean() })
        }));
        const _both: 'INVALID HEADERS SCHEMA' | 'INVALID COOKIES SCHEMA' =
            both.ERROR;

        plainEndpoint(echo, { route })
            .input(() => ({
                headers: z.object({ 'x-id': z.string() }),
                cookies: z.object({ session: z.string().min(1) })
            }))
            .mapInput(({ headers }) => ({ value: headers['x-id'] }));

        const optionalNumbers = plainEndpoint(echo, { route }).input(() => ({
            headers: z.object({ 'x-page': z.number().optional() }),
            cookies: z.object({ visits: z.number().optional() })
        }));
        const _optionalNumbers: 'x-page' | 'visits' = optionalNumbers.INVALID;

        plainEndpoint(echo, { route })
            .input(() => ({
                headers: z.object({ 'x-page': z.string().optional() }),
                cookies: z.object({ theme: z.string().optional() })
            }))
            .mapInput(() => ({ value: 'v' }));

        expect(true).toBe(true);
    });

    test('rejects unknown request sources', () => {
        const unknown = plainEndpoint(echo, { route }).input(() => ({
            body: z.object({ value: z.string() }),
            parms: z.object({})
        }));
        const _unknown: 'parms' = unknown.UNKNOWN;

        expect(true).toBe(true);
    });

    test('types mapInput data', () => {
        plainEndpoint(echo, { route })
            .input(() => ({
                body: z.object({ value: z.string() }),
                headers: z.object({ 'x-id': z.string() }),
                cookies: z.object({ session: z.string() }),
                formData: z.object({ file: z.string() })
            }))
            .mapInput((data) => {
                type _Data = Check<
                    typeof data,
                    {
                        body: { value: string };
                        headers: { 'x-id': string };
                        cookies: { session: string };
                        formData: { file: string };
                    }
                >;
                // @ts-expect-error no context without a context factory
                data.context;
                // @ts-expect-error no params without route params
                data.params;
                // @ts-expect-error no query without a query schema
                data.query;
                return data.body;
            });

        type _WithContext = Check<
            RequestData<{}, ['users', ':id'], { user: string }>,
            { params: { id: string }; context: { user: string } }
        >;

        expect(true).toBe(true);
    });

    test('types mapInput result', () => {
        plainEndpoint(echo, { route })
            .input(() => ({}))
            // @ts-expect-error result must match the handler input
            .mapInput(() => ({ value: 1 }));

        expect(true).toBe(true);
    });

    test('types mapOutput', () => {
        const output = plainEndpoint(echo, { route })
            .input((schema) => ({ body: schema }))
            .mapInput(({ body }) => body)
            .output((schema) => ({
                body: z.object({ wrapped: schema }),
                headers: z.object({ location: z.string() })
            }));

        output.mapOutput((result) => {
            type _Result = Check<typeof result, { value: string }>;
            return {
                body: { wrapped: result },
                headers: { location: '/echo' }
            };
        });

        // @ts-expect-error headers are required by the output schemas
        output.mapOutput((result) => ({ body: { wrapped: result } }));

        type _Response = Check<
            ResponseData<{ cookies: z.ZodObject<{ id: z.ZodNumber }> }>,
            { cookies: { id: number } }
        >;

        expect(true).toBe(true);
    });

    test('infers full endpoint contracts', () => {
        const full = plainEndpoint(echo, {
            route: { method: 'put', path: ['items', ':id'] }
        })
            .input(() => ({
                query: z.object({ q: z.string() }),
                body: z.object({ value: z.string() }),
                formData: z.object({ file: z.string() }),
                headers: z.object({ h: z.string() }),
                cookies: z.object({ c: z.string() })
            }))
            .mapInput(({ body }) => body)
            .output(() => ({
                body: z.object({ ok: z.boolean() }),
                headers: z.object({ etag: z.string() }),
                cookies: z.object({ seen: z.string() })
            }))
            .mapOutput(() => ({
                body: { ok: true },
                headers: { etag: '1' },
                cookies: { seen: 'yes' }
            }));

        type _Contract = Check<
            EndpointContract<typeof full>,
            {
                request: {
                    query: { q: string };
                    params: { id: string };
                    body: { value: string };
                    formData: { file: string };
                    headers: { h: string };
                    cookies: { c: string };
                };
                response: {
                    body: { ok: boolean };
                    headers: { etag: string };
                    cookies: { seen: string };
                };
            }
        >;

        const staticRoute = plainEndpoint(echo, { route })
            .input(() => ({}))
            .mapInput(() => ({ value: 'v' }));
        type _NoParams = Check<
            keyof EndpointContract<typeof staticRoute>['request'],
            never
        >;

        expect(full.metadata.route.path).toEqual(['items', ':id']);
    });
});

type Check<Actual extends Expected, Expected> = Actual;
