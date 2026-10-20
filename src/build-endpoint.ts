import type { Handler, Hook } from '@domain-first/handlers';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
    ErrorResponseMappingError,
    INTERNAL_ERROR_CODE,
    InputMappingError,
    RequestParsingError,
    ResponseParsingError
} from './errors';
import { pathParamNames, validatePathParams } from './path-params';
import type {
    Adapter,
    CookiesConfiguration,
    ErrorMapping,
    ErrorResponseBody,
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
    errors: ErrorMapping[];
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
    metadata: Metadata,
    paramsSchema: StandardSchemaV1 | undefined
): Record<RequestSource, RequestReader<RESTRequest>> => {
    const paramNames = pathParamNames(metadata.route.path);
    const readsParams = paramNames.length > 0 || !!paramsSchema;
    const { pathParams } = adapter.input;

    if (readsParams && !pathParams) {
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
            validate: readsParams
                ? (received) =>
                      validatePathParams(paramNames, received, paramsSchema)
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
        // the params reader validates with its schema itself
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
 * Endpoint mappings override shared ones with the same code.
 */
const mergeErrorMappings = (
    shared: ErrorMapping[] = [],
    own: ErrorMapping[] = []
): ErrorMapping[] => {
    for (const list of [shared, own]) {
        const codes = new Set<string>();

        for (const { code } of list) {
            if (codes.has(code)) {
                throw new Error(`Error "${code}" is mapped more than once`);
            }

            codes.add(code);
        }
    }

    const ownCodes = new Set(own.map((x) => x.code));

    // the first matching mapping wins, endpoint ones are tried first
    return [...own, ...shared.filter((x) => !ownCodes.has(x.code))];
};

/**
 * Hooks are notified only, their failures don't change the response.
 */
const notifyHooks = async (hooks: Array<Hook<any, any>>, error: Error) => {
    try {
        for (const hook of hooks) {
            await hook.onError?.(error);
        }
    } catch {}
};

/**
 * Unmatched errors expose nothing.
 */
const resolveError = async (
    error: Error,
    mappings: ErrorMapping[],
    hooks: Array<Hook<any, any>>
) => {
    const mapping = mappings.find((x) => x.matches(error));

    if (!mapping) {
        return { statusCode: 500, error: { code: INTERNAL_ERROR_CODE } };
    }

    return {
        statusCode: mapping.status,
        error: await mappedBody(error, mapping, hooks)
    };
};

/**
 * The body has only what the mapping exposes:
 * parts that fail to build are not sent.
 */
const mappedBody = async (
    error: Error,
    mapping: ErrorMapping,
    hooks: Array<Hook<any, any>>
) => {
    const body: ErrorResponseBody = { code: mapping.code };
    const { message, details } = mapping;
    const failure = (
        part: 'message' | 'details',
        issues: Readonly<StandardSchemaV1.Issue[]>,
        received: unknown,
        cause?: unknown
    ) =>
        notifyHooks(
            hooks,
            new ErrorResponseMappingError(
                { code: mapping.code, part, issues, received },
                cause === undefined ? undefined : { cause }
            )
        );

    if (message !== undefined) {
        try {
            body.message =
                typeof message === 'string' ? message : message(error);
        } catch (cause) {
            await failure('message', [], undefined, cause);
        }
    }

    if (details) {
        let received: unknown;

        try {
            received = details.map(error);
            const result = await details.schema['~standard'].validate(received);

            if (result.issues) {
                await failure('details', result.issues, received);
            } else {
                body.details = result.value;
            }
        } catch (cause) {
            await failure('details', [], received, cause);
        }
    }

    return body;
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
    const readers = requestReaders(
        adapter,
        metadata,
        definition.request.params
    );
    const errors = mergeErrorMappings(config.errors, metadata.errors);

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
                            ...(await resolveError(
                                response.error,
                                errors,
                                config.hooks ?? []
                            ))
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
        metadata: { ...metadata, errors }
    });
};
