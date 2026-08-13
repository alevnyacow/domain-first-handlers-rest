import { defineHandler } from '@domain-first/handlers';
import { describe, expect, test } from '@rstest/core';
import z from 'zod';
import { createEndpoint } from './create-endpoint';
import type { Adapter, EndpointContract } from './types';

type Input =
    | 'input-body'
    | 'input-cookies'
    | 'input-formData'
    | 'input-headers'
    | 'input-queryParams';

type Output = 'output-body' | 'output-cookies' | 'output-request';

describe('object adapter', async () => {
    const objectAdapter: Adapter<
        [inputData: Partial<Record<Input, any>>],
        Partial<Record<Output, any>>
    > = {
        input: {
            body: (x) => x['input-body'],
            cookies: (x) => x['input-cookies'],
            formData: (x) => x['input-formData'],
            headers: (x) => x['input-headers'],
            queryParams: (x) => x['input-queryParams']
        },
        output: async (x) => {
            if (x.success) {
                const { body, cookies, headers } = x;
                return {
                    'output-body': body,
                    'output-cookies': cookies,
                    'output-request': headers
                };
            }
            throw x.error;
        }
    };

    const createObjectEndpoint = createEndpoint(objectAdapter);

    const sum = defineHandler({
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        outputSchema: z.number(),
        handler: async ({ a, b }) => a + b
    });

    describe('params in query', async () => {
        const allInQuery = createObjectEndpoint(sum)
            .withRequestSchemas((query) => ({
                query: z.record(z.keyof(query), z.string())
            }))
            .mapped((x) => ({ a: +x.a, b: +x.b }));

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
            'input-queryParams': { a: 111, b: 333 }
        });
        test('has correct response', () =>
            expect(result['output-body']).toBe(444));
    });

    describe('params in body', async () => {
        const allInBody = createObjectEndpoint(sum).withRequestSchemas(
            (body) => ({
                body
            })
        );
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
            'input-body': { a: 111, b: 333 }
        });
        test('has correct response', () =>
            expect(result['output-body']).toBe(444));
    });

    const custom = createObjectEndpoint(sum)
        .withRequestSchemas((x) => ({
            body: x.pick({ a: true }),
            query: z.object({ b: z.string() }) //x.omit({ a: true })
        }))
        .mapped((x) => ({ a: x.a, b: +x.b }))
        .withResponseSchemas((_inputSchema) => {
            return {
                body: z.object({ sup: z.string() }),
                cookies: z.string(),
                headers: undefined
            } as const;
        })
        .mapped({
            outputToBody: (x) => ({ sup: x.toString() }),
            outputToCookies: (x) => x.toString()
        });
    // custom.

    /**
     * type FFFF = {
         request: {
             query: {
                 b: string;
             };
         } & {
             body: {
                 a: number;
             };
         };
         response: {
             body: {
                 sup: string;
             };
         } & {
             cookies: string;
         };
     }
     */
    type _FFFF = EndpointContract<typeof custom>;
});
