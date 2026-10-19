import { defineHandler } from '@domain-first/handlers';
import { describe, expect, rstest, test } from '@rstest/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import z from 'zod';
import { createEndpoint } from './create-endpoint';
import { INVALID_REQUEST_CODE } from './errors';
import { invalidRequest } from './invalid-request';
import { mockAdapter } from './mock-adapter';
import { generateOpenAPI } from './open-api';

const echo = defineHandler({
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.object({ value: z.string() }),
    handler: async (x) => x
});

const sum = defineHandler({
    inputSchema: z.object({ a: z.number() }),
    outputSchema: z.number(),
    handler: async ({ a }) => a
});

const errorBody = (result: { body?: any }) => JSON.parse(result.body);

const endpoints = (mapping = invalidRequest()) => {
    const endpoint = createEndpoint({ errors: [mapping] })(mockAdapter);

    return {
        parsing: endpoint(echo, { route: { method: 'post', path: ['echo'] } })
            .input(() => ({ body: z.object({ value: z.string() }) }))
            .mapInput(({ body }) => body),
        mapping: endpoint(sum, { route: { method: 'get', path: [':a'] } })
            .input(() => ({}))
            .mapInput(({ params }) => ({ a: Number(params.a) }))
    };
};

describe('invalidRequest', () => {
    test('responds to request parsing errors with source and issues', async () => {
        const result = await endpoints().parsing({
            body: { value: 1 },
            pathParams: {}
        });
        expect(result.statusCode).toBe(400);
        expect(errorBody(result)).toEqual({
            code: INVALID_REQUEST_CODE,
            details: {
                source: 'body',
                issues: [{ message: expect.any(String), path: ['value'] }]
            }
        });
    });

    test('responds to input mapping errors with the same code', async () => {
        const result = await endpoints().mapping({ pathParams: { a: 'abc' } });
        expect(result.statusCode).toBe(400);
        expect(errorBody(result)).toEqual({
            code: INVALID_REQUEST_CODE,
            details: {
                issues: [{ message: expect.any(String), path: ['a'] }]
            }
        });
    });

    test('never sends received data', async () => {
        const result = await endpoints().parsing({
            body: { value: 1, secret: 'x' },
            pathParams: {}
        });
        expect(result.body).not.toContain('secret');
    });

    test('keeps numeric path segments as numbers', async () => {
        const list = defineHandler({
            inputSchema: z.object({ items: z.array(z.string()) }),
            outputSchema: z.number(),
            handler: async ({ items }) => items.length
        });
        const result = await createEndpoint({ errors: [invalidRequest()] })(
            mockAdapter
        )(list, { route: { method: 'post', path: [] } })
            .input(() => ({ body: z.object({ items: z.array(z.string()) }) }))
            .mapInput(({ body }) => body)({ body: { items: ['a', 1] } });
        expect(errorBody(result).details.issues[0].path).toEqual(['items', 1]);
    });

    test('takes status, code, message and details overrides', async () => {
        const mapping = invalidRequest({
            status: 422,
            code: 'INVALID',
            message: (e) => `${e.details.issues.length} issue(s)`,
            details: {
                schema: z.object({ count: z.number() }),
                map: (e) => ({ count: e.details.issues.length })
            }
        });
        const result = await endpoints(mapping).mapping({
            pathParams: { a: 'abc' }
        });
        expect(result.statusCode).toBe(422);
        expect(errorBody(result)).toEqual({
            code: 'INVALID',
            message: '1 issue(s)',
            details: { count: 1 }
        });
    });

    test('sends no details with details: false', async () => {
        const result = await endpoints(
            invalidRequest({ details: false })
        ).parsing({ body: {}, pathParams: {} });
        expect(errorBody(result)).toEqual({ code: INVALID_REQUEST_CODE });
    });

    test('is described in OpenAPI without a custom converter', () => {
        const standardSchemaToJSONSchema = rstest.fn(
            (schema: StandardSchemaV1) => schema as any
        );
        const result = generateOpenAPI([endpoints().parsing], {
            document: { info: { title: 'Test', version: '1.0.0' } },
            standardSchemaToJSONSchema
        });
        const schemas = standardSchemaToJSONSchema.mock.calls.map(
            ([x]) => x['~standard'].vendor
        );
        expect(schemas).not.toContain('@domain-first/handlers-rest');
        expect(result.paths['/echo']?.post?.responses?.['400']).toEqual({
            description: 'Invalid request',
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/InvalidRequestError' }
                }
            }
        });
        expect(result.components?.schemas?.InvalidRequestError).toMatchObject({
            properties: {
                code: { enum: [INVALID_REQUEST_CODE] },
                details: { required: ['issues'] }
            }
        });
    });

    test('is one component shared by endpoints', () => {
        const { parsing, mapping } = endpoints();
        const result = generateOpenAPI([parsing, mapping], {
            document: { info: { title: 'Test', version: '1.0.0' } }
        });
        const ref = { $ref: '#/components/schemas/InvalidRequestError' };
        expect(result.paths['/echo']?.post?.responses?.['400']).toMatchObject({
            content: { 'application/json': { schema: ref } }
        });
        expect(result.paths['/{a}']?.get?.responses?.['400']).toMatchObject({
            content: { 'application/json': { schema: ref } }
        });
        expect(Object.keys(result.components?.schemas ?? {})).toEqual([
            'InvalidRequestError'
        ]);
    });

    test('takes another component name', () => {
        const result = generateOpenAPI(
            [endpoints(invalidRequest({ schemaName: 'BadRequest' })).parsing],
            { document: { info: { title: 'Test', version: '1.0.0' } } }
        );
        expect(Object.keys(result.components?.schemas ?? {})).toEqual([
            'BadRequest'
        ]);
    });
});
