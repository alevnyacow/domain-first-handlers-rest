import type { Adapter } from '../types';

export type MockRestAdapterInput = {
    queryParams?: object;
    pathParams?: object;
    headers?: object;
    body?: any;
    formData?: object;
    cookies?: object;
};

export type MockRestAdapterOutput = {
    success: boolean;
    statusCode: number;
    body?: any;
    headers?: object;
    cookies?: object;
};

export const mockAdapter: Adapter<
    [MockRestAdapterInput],
    MockRestAdapterOutput
> = {
    input: {
        body: async (x) => x.body || {},
        cookies: async (x) => x.cookies || {},
        formData: async (x) => x.formData || {},
        headers: async (x) => x.headers || {},
        queryParams: async (x) => x.queryParams || {},
        pathParams: async (x) => x.pathParams || {}
    },
    output: (x) => {
        if (x.success) {
            return {
                statusCode: x.statusCode,
                success: true,
                body: x.body,
                cookies: x.cookies,
                headers: x.headers
            };
        }
        return {
            success: false,
            statusCode: x.statusCode,
            body: JSON.stringify(x.error)
        };
    }
};
