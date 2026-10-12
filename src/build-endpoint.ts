import type { Handler, Hook } from '@domain-first/handlers';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
    InputMappingError,
    RequestParsingError,
    ResponseParsingError
} from './errors';
import { pathParamNames, validatePathParams } from './path-params';
import type {
    Adapter,
    CookiesConfiguration,
    ErrorStatuses,
    Metadata,
    RawRequestModel,
    RequestSchemas,
    RequestSource,
    ResponseSchemas,
    ResponseTarget
} from './types';

export type EndpointConfig<
    Context,
    RESTRequest = unknown,
    RESTResponse = unknown
> = Partial<{
    errorStatuses: ErrorStatuses;
    context: (rawRequestData: RawRequestModel) => Promise<Context>;
    hooks: Array<Hook<RESTRequest, RESTResponse>>;
}>;

export type ResponseConfiguration = Partial<{
    cookies: CookiesConfiguration;
}>;

export type EndpointDefinition = {
    request: RequestSchemas;
    response: ResponseSchemas;
    inputFromRequest: (data: any) => unknown;
    outputFromResult: (result: any) => unknown;
    configuration?: ResponseConfiguration;
};

type RequestReader<RESTRequest extends unknown[]> = {
    read: (...input: RESTRequest) => object | Promise<object>;
    /**
     * Whether the source is read (e.g. for context) without a schema.
     */
    alwaysRead: boolean;
    /**
     * Validation of a source that has no schema.
     */
    validate?: (
        received: object
    ) =>
        | StandardSchemaV1.Result<unknown>
        | Promise<StandardSchemaV1.Result<unknown>>;
};

/**
 * Parsing order, it also defines which error is thrown first.
 */
const REQUEST_SOURCES: RequestSource[] = [
    'query',
    'params',
    'body',
    'formData',
    'headers',
    'cookies'
];

const RESPONSE_TARGETS: ResponseTarget[] = ['body', 'headers', 'cookies'];

const requestReaders = <RESTRequest extends unknown[], RESTResponse>(
    adapter: Adapter<RESTRequest, RESTResponse>,
    metadata: Metadata
): Record<RequestSource, RequestReader<RESTRequest>> => {
    const paramNames = pathParamNames(metadata.route.path);
    const { pathParams } = adapter.input;

    if (paramNames.length > 0 && !pathParams) {
        throw new Error(
            `Route "${metadata.route.path.join('/')}" uses path parameters, but the adapter does not implement "input.pathParams"`
        );
    }

    return {
        query: {
            read: (...input) => adapter.input.queryParams(...input),
            alwaysRead: true
        },
        params: {
            // presence is checked above whenever params are read
            read: (...input) => pathParams!(...input),
            alwaysRead: false,
            validate:
                paramNames.length > 0
                    ? (received) => validatePathParams(paramNames, received)
                    : undefined
        },
        body: {
            read: (...input) => adapter.input.body(...input),
            alwaysRead: false
        },
        formData: {
            read: (...input) => adapter.input.formData(...input),
            alwaysRead: false
        },
        headers: {
            read: (...input) => adapter.input.headers(...input),
            alwaysRead: true
        },
        cookies: {
            read: (...input) => adapter.input.cookies(...input),
            alwaysRead: true
        }
    };
};

const parseRequest = async <RESTRequest extends unknown[]>(
    readers: Record<RequestSource, RequestReader<RESTRequest>>,
    schemas: RequestSchemas,
    input: RESTRequest
): Promise<RawRequestModel> => {
    const data: Partial<Record<RequestSource, unknown>> = {};

    for (const source of REQUEST_SOURCES) {
        const reader = readers[source];
        const schema = source === 'params' ? undefined : schemas[source];
        const validate = schema
            ? (received: object) => schema['~standard'].validate(received)
            : reader.validate;

        if (!validate && !reader.alwaysRead) {
            data[source] = {};
            continue;
        }

        const received = await reader.read(...input);

        if (!validate) {
            data[source] = received;
            continue;
        }

        const result = await validate(received);

        if (result.issues) {
            throw new RequestParsingError({
                issues: result.issues,
                source,
                received
            });
        }

        data[source] = result.value;
    }

    return data as RawRequestModel;
};

const parseResponse = async (schemas: ResponseSchemas, output: any) => {
    const parts: Partial<Record<ResponseTarget, any>> = {};

    for (const target of RESPONSE_TARGETS) {
        const schema = schemas[target];

        if (!schema) {
            continue;
        }

        const received = output?.[target];
        const result = await schema['~standard'].validate(received);

        if (result.issues) {
            throw new ResponseParsingError({
                issues: result.issues,
                source: target,
                received
            });
        }

        parts[target] = result.value;
    }

    return {
        body: parts.body,
        headers: parts.headers as object | undefined,
        cookies: parts.cookies as object | undefined
    };
};

/**
 * Later matching statuses override earlier ones,
 * so endpoint statuses win over shared ones.
 */
const resolveError = (
    error: Error,
    statusesList: Array<ErrorStatuses | undefined>
) => {
    let statusCode = 500;
    let errorResponse: { name: string; message?: string; details?: object } = {
        name: error.name,
        message: error.message,
        details: 'details' in error ? (error.details as object) : undefined
    };

    for (const statuses of statusesList) {
        for (const [code, status] of Object.entries(statuses ?? {})) {
            if (status.checks.some((check) => check(error))) {
                statusCode = Number(code);
                if (status.toFullModel) {
                    errorResponse = status.toFullModel(error);
                }
            }
        }
    }

    return { statusCode, error: errorResponse };
};

export const buildEndpoint = <
    RESTRequest extends unknown[],
    RESTResponse,
    Context,
    InputSchema extends StandardSchemaV1,
    OutputSchema extends StandardSchemaV1
>(
    adapter: Adapter<RESTRequest, RESTResponse>,
    config: EndpointConfig<Context, RESTRequest, RESTResponse>,
    handler: Handler<InputSchema, OutputSchema>,
    metadata: Metadata,
    definition: EndpointDefinition
) => {
    const readers = requestReaders(adapter, metadata);

    const transformed = handler.withTransformedContract<
        RESTRequest,
        RESTResponse
    >(
        {
            input: async (...input) => {
                const rawRequestData = await parseRequest(
                    readers,
                    definition.request,
                    input
                );
                const context = await config.context?.(rawRequestData);

                const mappedInput = await definition.inputFromRequest({
                    ...rawRequestData,
                    context
                });
                const parsedInput =
                    await handler.inputSchema['~standard'].validate(
                        mappedInput
                    );

                if (parsedInput.issues) {
                    throw new InputMappingError({
                        issues: parsedInput.issues,
                        received: mappedInput
                    });
                }

                return parsedInput.value;
            },
            output: async (response, ...input) => {
                if (!response.success) {
                    return await adapter.output(
                        {
                            success: false,
                            ...resolveError(response.error, [
                                config.errorStatuses,
                                metadata.errorStatuses
                            ])
                        },
                        ...input
                    );
                }

                const output = await definition.outputFromResult(
                    response.result
                );

                return await adapter.output(
                    {
                        ...(await parseResponse(definition.response, output)),
                        success: true,
                        statusCode: metadata.successStatusCode ?? 200,
                        configuration: definition.configuration ?? {}
                    },
                    ...input
                );
            }
        },
        { transformedHandler: config.hooks ?? [] }
    );

    return Object.assign(transformed, {
        _api_schemas: {
            requestSchemas: definition.request,
            responseSchemas: definition.response
        },
        metadata: {
            ...metadata,
            errorStatuses: {
                ...(config.errorStatuses ?? {}),
                ...metadata.errorStatuses
            }
        }
    });
};
