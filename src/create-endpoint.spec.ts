import { defineHandler } from '@domain-first/handlers';
import mockAdapter from '@domain-first/handlers-mock-rest-adapter';
import { describe, expect, test } from '@rstest/core';
import z from 'zod';
import { createEndpoint } from './create-endpoint';
import type { EndpointContract } from './types';

const mockEndpoint = createEndpoint(mockAdapter, {
    context: async (x) => {
        if (x.headers && 'Authorization' in x.headers) {
            const authData = x.headers.Authorization as string;
            const token = authData.substring('Bearer '.length);
            return { token };
        }

        return { token: undefined };
    }
});

describe('object adapter', async () => {
    const sum = defineHandler({
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        outputSchema: z.number(),
        handler: async ({ a, b }) => a + b
    });

    describe('params in query', async () => {
        const allInQuery = mockEndpoint(sum, {
            successStatusCode: 205
        })
            .input((query) => ({
                query: z.record(z.keyof(query), z.string())
            }))
            .mapInput((x) => ({
                a: +x.query.a,
                b: +x.query.b + (x.context.token?.length ? 100 : 0)
            }));

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
        const allInBody = mockEndpoint(sum)
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
