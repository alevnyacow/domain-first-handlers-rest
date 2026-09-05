import type {
    StandardJSONSchemaV1,
    StandardSchemaV1
} from '@standard-schema/spec';
import type { OpenAPIV3 } from 'openapi-types';

export type HttpMethod =
    | 'get'
    | 'post'
    | 'put'
    | 'patch'
    | 'delete'
    | 'head'
    | 'options';

export type ErrorStatuses = Record<
    number,
    {
        description?: string;
        checks: Array<(e: Error) => boolean>;
        toFullModel?: <T extends Error = Error>(
            e: T
        ) => {
            name: string;
            message?: string;
            details?: object;
        };
        openApiTypes?: {
            details?: StandardJSONSchemaV1;
            name?: StandardJSONSchemaV1;
        };
    }
>;

export type Metadata = {
    route: { method: HttpMethod; path: string[] };
    description?: string;
    successResponseDescription?: string;
    summary?: string;
    successStatusCode?: number;
    tags?: string[];
    errorStatuses?: ErrorStatuses;
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
        query?: unknown;
        body?: unknown;
        cookies?: unknown;
        formData?: unknown;
        headers?: unknown;
    };
    responseSchemas: {
        body?: unknown;
        headers?: unknown;
        cookies?: unknown;
    };
};

export type InferRequestQuery<T> = T extends {
    _api_schemas: {
        requestSchemas: { query: infer Query extends StandardSchemaV1 };
    };
}
    ? { query: StandardSchemaV1.InferOutput<Query> }
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
    ? { cookie: StandardSchemaV1.InferOutput<Cookies> }
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
    body?: unknown;
    cookies?: object;
    formData?: object;
    headers?: object;
};
