import type {
    StandardJSONSchemaV1,
    StandardSchemaV1
} from '@standard-schema/spec';
import type { OpenAPIV3 } from 'openapi-types';
import type { PathParamName, PathParams } from '../path-params';

export type HttpMethod =
    | 'get'
    | 'post'
    | 'put'
    | 'patch'
    | 'delete'
    | 'head'
    | 'options';

export type ErrorClass = abstract new (...args: any[]) => Error;

/**
 * Error class that identifies itself, like classes of `@domain-first/errors`.
 */
export type DomainErrorClass = ErrorClass & {
    readonly code: string;
    is(target: unknown): boolean;
};

/**
 * How errors become an error response,
 * created with `httpError()` or `httpStatus()`.
 */
export type ErrorMapping = {
    code: string;
    status: number;
    description?: string;
    matches: (error: Error) => boolean;
    message?: string | ((error: Error) => string);
    details?: {
        schema: StandardSchemaV1;
        map: (error: Error) => unknown;
    };
};

/**
 * `message` and `details` are present only when the mapping sets them.
 */
export type ErrorResponseBody = {
    code: string;
    message?: string;
    details?: unknown;
};

export type Metadata<Path extends readonly string[] = readonly string[]> = {
    /**
     * Segments prefixed with `:` are path parameters,
     * e.g. `['users', ':userId']`.
     */
    route: { method: HttpMethod; path: Path };
    description?: string;
    successResponseDescription?: string;
    summary?: string;
    successStatusCode?: number;
    tags?: string[];
    /**
     * Created with `httpError()` and `httpStatus()`. Errors without a mapping
     * respond `500` with `{ code: INTERNAL_ERROR_CODE }` only.
     */
    errors?: ErrorMapping[];
    openApiMetadata?: Partial<OpenAPIV3.OperationObject>;
};

export type JSONSchemas = {
    requestQuery: StandardJSONSchemaV1 | undefined;
    requestBody: StandardJSONSchemaV1 | undefined;
    requestCookies: StandardJSONSchemaV1 | undefined;
    requestFormData: StandardJSONSchemaV1 | undefined;
    requestHeaders: StandardJSONSchemaV1 | undefined;
    responseBody: StandardJSONSchemaV1 | undefined;
    responseHeaders: StandardJSONSchemaV1 | undefined;
    responseCookies: StandardJSONSchemaV1 | undefined;
};

export type RawAPISchemas = {
    requestSchemas: {
        query?: StandardSchemaV1;
        body?: StandardSchemaV1;
        cookies?: StandardSchemaV1;
        formData?: StandardSchemaV1;
        headers?: StandardSchemaV1;
    };
    responseSchemas: {
        body?: StandardSchemaV1;
        headers?: StandardSchemaV1;
        cookies?: StandardSchemaV1;
    };
};

export type InferRequestQuery<T> = T extends {
    _api_schemas: {
        requestSchemas: { query: infer Query extends StandardSchemaV1 };
    };
}
    ? { query: StandardSchemaV1.InferOutput<Query> }
    : {};

export type InferRequestParams<T> = T extends {
    metadata: { route: { path: infer Path extends readonly string[] } };
}
    ? [PathParamName<Path>] extends [never]
        ? {}
        : { params: PathParams<Path> }
    : {};

export type InferRequestBody<T> = T extends {
    _api_schemas: {
        requestSchemas: { body: infer Body extends StandardSchemaV1 };
    };
}
    ? { body: StandardSchemaV1.InferOutput<Body> }
    : {};

export type InferRequestCookies<T> = T extends {
    _api_schemas: {
        requestSchemas: { cookies: infer Cookies extends StandardSchemaV1 };
    };
}
    ? { cookies: StandardSchemaV1.InferOutput<Cookies> }
    : {};

export type InferRequestFormData<T> = T extends {
    _api_schemas: {
        requestSchemas: { formData: infer FormData extends StandardSchemaV1 };
    };
}
    ? { formData: StandardSchemaV1.InferOutput<FormData> }
    : {};

export type InferRequestHeaders<T> = T extends {
    _api_schemas: {
        requestSchemas: { headers: infer Headers extends StandardSchemaV1 };
    };
}
    ? { headers: StandardSchemaV1.InferOutput<Headers> }
    : {};

export type InferResponseBody<T> = T extends {
    _api_schemas: {
        responseSchemas: { body: infer Body extends StandardSchemaV1 };
    };
}
    ? { body: StandardSchemaV1.InferOutput<Body> }
    : {};

export type InferResponseHeaders<T> = T extends {
    _api_schemas: {
        responseSchemas: { headers: infer Headers extends StandardSchemaV1 };
    };
}
    ? { headers: StandardSchemaV1.InferOutput<Headers> }
    : {};

export type InferResponseCookies<T> = T extends {
    _api_schemas: {
        responseSchemas: { cookies: infer Cookies extends StandardSchemaV1 };
    };
}
    ? { cookies: StandardSchemaV1.InferOutput<Cookies> }
    : {};

export type EndpointContract<T extends { _api_schemas: object }> = {
    request: InferRequestQuery<T> &
        InferRequestParams<T> &
        InferRequestBody<T> &
        InferRequestCookies<T> &
        InferRequestFormData<T> &
        InferRequestHeaders<T>;
    response: InferResponseBody<T> &
        InferResponseCookies<T> &
        InferResponseHeaders<T>;
};

export type RawRequestModel = {
    query?: object;
    params?: object;
    body?: unknown;
    cookies?: object;
    formData?: object;
    headers?: object;
};
