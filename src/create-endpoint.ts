import type { Handler } from '@domain-first/handlers';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
    Adapter,
    AdapterRequestSchemas,
    AdapterResponseSchemas,
    CheckCompatibility,
    ErrorStatuses,
    Metadata,
    RawRequestModel
} from './types';

type RemoveUnknownAndUndefined<T> = {
    [K in keyof T as unknown extends T[K]
        ? never
        : undefined extends T[K]
          ? never
          : K]: T[K];
};

type SafelyInferOutput<T> = T extends StandardSchemaV1
    ? StandardSchemaV1.InferOutput<T>
    : undefined;

type SafelyInferInput<T> = T extends StandardSchemaV1
    ? StandardSchemaV1.InferInput<T>
    : undefined;

type OutputTransformers<
    OutputSchema extends StandardSchemaV1,
    ResponseBody extends StandardSchemaV1 | undefined = undefined,
    ResponseHeaders extends StandardSchemaV1 | undefined = undefined,
    ResponseCookies extends StandardSchemaV1 | undefined = undefined
> = (handlerResponse: StandardSchemaV1.InferOutput<OutputSchema>) =>
    | RemoveUnknownAndUndefined<{
          body: SafelyInferOutput<ResponseBody>;
          cookies: SafelyInferOutput<ResponseCookies>;
          headers: SafelyInferOutput<ResponseHeaders>;
      }>
    | Promise<{
          body: SafelyInferOutput<ResponseBody>;
          cookies: SafelyInferOutput<ResponseCookies>;
          headers: SafelyInferOutput<ResponseHeaders>;
      }>;

export const createEndpoint =
    <RESTRequest extends unknown[], RESTResponse, Context = undefined>(
        adapter: Adapter<RESTRequest, RESTResponse>,
        config: Partial<{
            errorStatuses: ErrorStatuses;
            context: (rawRequestData: RawRequestModel) => Promise<Context>;
        }> = {}
    ) =>
    <
        InputSchema extends StandardSchemaV1,
        OutputSchema extends StandardSchemaV1
    >(
        handler: Handler<InputSchema, OutputSchema>,
        metadata: Metadata
    ) => {
        const withContract = <
            RequestQuerySchema extends StandardSchemaV1 | undefined,
            RequestBodySchema extends StandardSchemaV1 | undefined,
            RequestFormDataSchema extends StandardSchemaV1 | undefined,
            RequestHeadersSchema extends StandardSchemaV1 | undefined,
            RequestCookiesSchema extends StandardSchemaV1 | undefined,
            ResponseBody extends StandardSchemaV1 | undefined,
            ResponseHeaders extends StandardSchemaV1 | undefined,
            ResponseCookies extends StandardSchemaV1 | undefined
        >(payload: {
            request: AdapterRequestSchemas<
                InputSchema,
                RequestQuerySchema,
                RequestBodySchema,
                RequestFormDataSchema,
                RequestHeadersSchema,
                RequestCookiesSchema
            >;
            response: AdapterResponseSchemas<
                OutputSchema,
                ResponseBody,
                ResponseHeaders,
                ResponseCookies
            >;
        }) => {
            const withDataMapping = (transformers: {
                inputFromRequest: (
                    payload: RemoveUnknownAndUndefined<{
                        body: SafelyInferOutput<RequestBodySchema>;
                        query: SafelyInferOutput<RequestQuerySchema>;
                        formData: SafelyInferOutput<RequestFormDataSchema>;
                        headers: SafelyInferOutput<RequestHeadersSchema>;
                        cookies: SafelyInferOutput<RequestCookiesSchema>;
                        context: Context;
                    }>
                ) => StandardSchemaV1.InferOutput<InputSchema>;
                outputFromResponse: OutputTransformers<
                    OutputSchema,
                    ResponseBody,
                    ResponseHeaders,
                    ResponseCookies
                >;
            }) => {
                const requestSchemas = payload.request(handler.inputSchema);
                const responseSchemas = payload.response?.(
                    handler.outputSchema
                ) ?? {
                    body: handler.outputSchema
                };

                const rawRequestData: RawRequestModel = {};

                const transformedREST = handler.withTransformedContract<
                    RESTRequest,
                    RESTResponse
                >({
                    input: async (...input) => {
                        /**
                         * Query parameters logic.
                         */
                        const queryParameters = await adapter.input.queryParams(
                            ...input
                        );

                        const parsedQueryParameters =
                            'query' in requestSchemas
                                ? await requestSchemas.query[
                                      '~standard'
                                  ].validate(queryParameters)
                                : { value: queryParameters };

                        if (parsedQueryParameters.issues) {
                            throw new Error();
                        }

                        rawRequestData.query =
                            parsedQueryParameters.value as object;

                        /**
                         * Body logic.
                         */
                        const body = await adapter.input.body(...input);

                        const parsedBody =
                            'body' in requestSchemas
                                ? await requestSchemas.body[
                                      '~standard'
                                  ].validate(body)
                                : { value: body };

                        if (parsedBody.issues) {
                            throw new Error();
                        }

                        rawRequestData.body = parsedBody.value;

                        /**
                         * Form Data logic.
                         */
                        const formData = await adapter.input.formData(...input);

                        const parsedFormData =
                            'formData' in requestSchemas
                                ? await requestSchemas.formData[
                                      '~standard'
                                  ].validate(formData)
                                : { value: formData };

                        if (parsedFormData.issues) {
                            throw new Error();
                        }

                        rawRequestData.formData =
                            parsedFormData.value as object;

                        /**
                         * Headers logic.
                         */
                        const headers = await adapter.input.headers(...input);

                        const parsedHeaders =
                            'headers' in requestSchemas
                                ? await requestSchemas.headers[
                                      '~standard'
                                  ].validate(headers)
                                : { value: headers };

                        if (parsedHeaders.issues) {
                            throw new Error();
                        }

                        rawRequestData.headers = parsedHeaders.value as object;

                        /**
                         * Cookies logic.
                         */
                        const cookies = await adapter.input.cookies(...input);

                        const parsedCookies =
                            'cookies' in requestSchemas
                                ? await requestSchemas.cookies[
                                      '~standard'
                                  ].validate(cookies)
                                : { value: cookies };

                        if (parsedCookies.issues) {
                            throw new Error();
                        }

                        rawRequestData.cookies = parsedCookies.value as object;

                        /**
                         * Output building.
                         */
                        const context = await config?.context?.(rawRequestData);

                        const output = await handler.inputSchema[
                            '~standard'
                        ].validate(
                            transformers.inputFromRequest({
                                ...rawRequestData,
                                context
                            } as any)
                        );

                        if (output.issues) {
                            throw new Error(JSON.stringify(output.issues));
                        }

                        return output.value;
                    },
                    output: async (response, ...input) => {
                        if (!response.success) {
                            let statusCode = 500;
                            let errorResponse: {
                                name: string;
                                message?: string;
                                details?: object;
                            } = { name: response.error.name };

                            // TODO - remove copy-paste

                            for (const sharedErrors of Object.entries(
                                config.errorStatuses ?? {}
                            )) {
                                const isCurrentError = sharedErrors[1].checks
                                    .map((x) => x(response.error))
                                    .some((x) => !!x);
                                if (isCurrentError) {
                                    statusCode = +sharedErrors[0];
                                    if (sharedErrors[1].toFullModel) {
                                        errorResponse =
                                            sharedErrors[1].toFullModel(
                                                response.error
                                            );
                                    }
                                }
                            }

                            for (const endpointErrors of Object.entries(
                                metadata.errorStatuses ?? {}
                            )) {
                                const isCurrentError = endpointErrors[1].checks
                                    .map((x) => x(response.error))
                                    .some((x) => !!x);
                                if (isCurrentError) {
                                    statusCode = +endpointErrors[0];
                                    if (endpointErrors[1].toFullModel) {
                                        errorResponse =
                                            endpointErrors[1].toFullModel(
                                                response.error
                                            );
                                    }
                                }
                            }

                            return await adapter.output(
                                {
                                    success: false,
                                    error: errorResponse,
                                    statusCode
                                },
                                ...input
                            );
                        }

                        const output: any =
                            await transformers.outputFromResponse(
                                response.result
                            );

                        const getBodyPart = async () => {
                            if (
                                'body' in responseSchemas &&
                                responseSchemas.body
                            ) {
                                const result = await responseSchemas.body[
                                    '~standard'
                                ].validate(output.body);
                                if (result.issues) {
                                    throw new Error();
                                }
                                return result.value as any;
                            }

                            return undefined;
                        };

                        const getCookiesPart = async () => {
                            if (
                                'cookies' in responseSchemas &&
                                responseSchemas.cookies
                            ) {
                                const result = await responseSchemas.cookies[
                                    '~standard'
                                ].validate(output.cookies);
                                if (result.issues) {
                                    throw new Error();
                                }
                                return result.value as object;
                            }

                            return undefined;
                        };

                        const getHeadersPart = async () => {
                            if (
                                'headers' in responseSchemas &&
                                responseSchemas.headers
                            ) {
                                const result = await responseSchemas.headers[
                                    '~standard'
                                ].validate(output.headers);
                                if (result.issues) {
                                    throw new Error();
                                }
                                return result.value as object;
                            }

                            return undefined;
                        };

                        return await adapter.output(
                            {
                                body: await getBodyPart(),
                                cookies: await getCookiesPart(),
                                headers: await getHeadersPart(),
                                success: true,
                                statusCode: metadata?.successStatusCode ?? 200
                            },
                            ...input
                        );
                    }
                });

                return Object.assign(transformedREST, {
                    _api_schemas: {
                        requestSchemas,
                        responseSchemas
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

            return { withDataMapping };
        };

        const input = <
            RequestQuerySchema extends StandardSchemaV1 | undefined,
            RequestBodySchema extends StandardSchemaV1 | undefined,
            RequestFormDataSchema extends StandardSchemaV1 | undefined,
            RequestHeadersSchema extends StandardSchemaV1 | undefined,
            RequestCookiesSchema extends StandardSchemaV1 | undefined
        >(
            request: AdapterRequestSchemas<
                InputSchema,
                RequestQuerySchema,
                RequestBodySchema,
                RequestFormDataSchema,
                RequestHeadersSchema,
                RequestCookiesSchema
            >
        ) => {
            const result = withContract<
                RequestQuerySchema,
                RequestBodySchema,
                RequestFormDataSchema,
                RequestHeadersSchema,
                RequestCookiesSchema,
                OutputSchema,
                undefined,
                undefined
            >({
                request,
                response: (x) =>
                    ({ body: x }) as (OutputSchema extends undefined
                        ? {}
                        : { body: OutputSchema }) & {}
            });

            type EnsureStringValues<T> = T[keyof T] extends string
                ? true
                : false;

            type ValidQueryParams =
                true extends CheckCompatibility<
                    Record<string, never>,
                    SafelyInferInput<RequestQuerySchema>
                >
                    ? true
                    : true extends EnsureStringValues<
                            SafelyInferOutput<RequestQuerySchema>
                        >
                      ? true
                      : false;

            const withOutputSchemas =
                (
                    requestData: Parameters<
                        typeof result.withDataMapping
                    >[0]['inputFromRequest']
                ) =>
                <
                    ResponseBody extends StandardSchemaV1 | undefined,
                    ResponseHeaders extends StandardSchemaV1 | undefined,
                    ResponseCookies extends StandardSchemaV1 | undefined
                >(
                    schemas: AdapterResponseSchemas<
                        OutputSchema,
                        ResponseBody,
                        ResponseHeaders,
                        ResponseCookies
                    >
                ) => {
                    const mapOutput = (
                        logic: OutputTransformers<
                            OutputSchema,
                            ResponseBody,
                            ResponseHeaders,
                            ResponseCookies
                        >
                    ) => {
                        const result = withContract<
                            RequestQuerySchema,
                            RequestBodySchema,
                            RequestFormDataSchema,
                            RequestHeadersSchema,
                            RequestCookiesSchema,
                            ResponseBody,
                            ResponseHeaders,
                            ResponseCookies
                        >({
                            request,
                            response: schemas
                        }).withDataMapping({
                            inputFromRequest: requestData,
                            outputFromResponse: logic
                        });

                        return result;
                    };
                    return { mapOutput };
                };

            const mapInput = (
                request: Parameters<
                    typeof result.withDataMapping
                >[0]['inputFromRequest']
            ) => {
                const withDataMapping = result.withDataMapping({
                    inputFromRequest: request,
                    // @ts-expect-error
                    outputFromResponse: async (x) => {
                        return {
                            body: x
                        };
                    }
                });

                return Object.assign(withDataMapping, {
                    output: withOutputSchemas(request)
                });
            };

            return {
                mapInput
            } as true extends ValidQueryParams
                ? { mapInput: typeof mapInput }
                : {
                      ERROR: 'INVALID QUERY PARAMETERS SCHEMA';
                      CURRENT: SafelyInferInput<RequestQuerySchema>;
                  };
        };

        return {
            input
        };
    };
