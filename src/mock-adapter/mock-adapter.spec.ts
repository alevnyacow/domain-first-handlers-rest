import { describe, expect, test } from '@rstest/core';
import { mockAdapter } from './mock-adapter';

describe('mockAdapter', () => {
    test('reads every request source', async () => {
        const request = {
            queryParams: { q: '1' },
            pathParams: { id: '2' },
            body: { b: 3 },
            formData: { f: '4' },
            headers: { h: '5' },
            cookies: { c: '6' }
        };
        const { input } = mockAdapter;

        expect(await input.queryParams(request)).toEqual(request.queryParams);
        expect(await input.pathParams?.(request)).toEqual(request.pathParams);
        expect(await input.body(request)).toEqual(request.body);
        expect(await input.formData(request)).toEqual(request.formData);
        expect(await input.headers(request)).toEqual(request.headers);
        expect(await input.cookies(request)).toEqual(request.cookies);
    });

    test('defaults missing sources to empty objects', async () => {
        const { input } = mockAdapter;
        const readers = [
            input.queryParams,
            input.pathParams!,
            input.body,
            input.formData,
            input.headers,
            input.cookies
        ];

        for (const read of readers) {
            expect(await read({})).toEqual({});
        }
    });

    test('returns successful responses as is', async () => {
        expect(
            await mockAdapter.output(
                {
                    success: true,
                    statusCode: 201,
                    body: { a: 1 },
                    headers: { h: '1' },
                    cookies: { c: '1' },
                    configuration: {}
                },
                {}
            )
        ).toEqual({
            success: true,
            statusCode: 201,
            body: { a: 1 },
            headers: { h: '1' },
            cookies: { c: '1' }
        });
    });

    test('serializes errors into the body', async () => {
        expect(
            await mockAdapter.output(
                {
                    success: false,
                    statusCode: 404,
                    error: { name: 'NotFound' }
                },
                {}
            )
        ).toEqual({
            success: false,
            statusCode: 404,
            body: JSON.stringify({ name: 'NotFound' })
        });
    });
});
