import type { Handler } from '@domain-first/handlers';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
    Adapter,
    AdapterRequestSchemas,
    AdapterResponseSchemas,
    CheckCompatibility
} from './types';

type SafelyInferOutput<T> = T extends StandardSchemaV1
    ? StandardSchemaV1.InferOutput<T>
    : {};

type SafelyInferInput<T> = T extends StandardSchemaV1
    ? StandardSchemaV1.InferInput<T>
    : {};

type OutputTransformers<
    OutputSchema extends StandardSchemaV1,
    ResponseBody extends StandardSchemaV1 | undefined,
    ResponseHeaders extends StandardSchemaV1 | undefined,
    ResponseCookies extends StandardSchemaV1 | undefined
> = {
    outputToBody: ResponseBody extends undefined
        ? undefined
        : (
              x: StandardSchemaV1.InferOutput<OutputSchema>
          ) => SafelyInferOutput<ResponseBody>;
} & (ResponseCookies extends undefined
    ? {}
    : {
          outputToCookies: (
              x: StandardSchemaV1.InferOutput<OutputSchema>
          ) => SafelyInferOutput<ResponseCookies>;
      }) &
    (ResponseHeaders extends undefined
        ? {}
        : {
              outputToHeaders: (
                  x: StandardSchemaV1.InferOutput<OutputSchema>
              ) => SafelyInferOutput<ResponseHeaders>;
          });

const defaultErrorCodesMapping = (_e: unknown) => undefined;

export const createEndpoint =
    <RESTRequest extends unknown[], RESTResponse>(
        adapter: Adapter<RESTRequest, RESTResponse>,
        errorCodesMapping: (e: unknown) => number | undefined = () => undefined
    ) =>
    <
        InputSchema extends StandardSchemaV1,
        OutputSchema extends StandardSchemaV1
    >(
        handler: Handler<InputSchema, OutputSchema>,
        successStatusCode = 200,
        handlerErrorCodesMapping: (e: unknown) => number | undefined = () =>
            undefined
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
            const withDataMapping = (
                transformers: {
                    inputFromRequest: (
                        x: SafelyInferOutput<RequestBodySchema> &
                            SafelyInferOutput<RequestQuerySchema> &
                            SafelyInferOutput<RequestFormDataSchema> &
                            SafelyInferOutput<RequestHeadersSchema> &
                            SafelyInferOutput<RequestCookiesSchema>
                    ) => StandardSchemaV1.InferOutput<InputSchema>;
                } & OutputTransformers<
                    OutputSchema,
                    ResponseBody,
                    ResponseHeaders,
                    ResponseCookies
                >
            ) => {
                const requestSchemas = payload.request(handler.inputSchema);
                const responseSchemas = payload.response?.(
                    handler.outputSchema
                ) ?? {
                    body: handler.outputSchema
                };

                const transformedREST = handler.withTransformedContract<
                    RESTRequest,
                    RESTResponse
                >({
                    input: async (...input) => {
                        let result: Object = {};

                        /**
                         * Query parameters parsing if needed.
                         */
                        if ('query' in requestSchemas && requestSchemas.query) {
                            const queryParameters =
                                await adapter.input.queryParams(...input);

                            const parsedQueryParameters =
                                await requestSchemas.query[
                                    '~standard'
                                ].validate(queryParameters);

                            if (parsedQueryParameters.issues) {
                                throw new Error();
                            }

                            result = {
                                ...result,
                                ...(parsedQueryParameters.value as object)
                            };
                        }

                        /**
                         * Body parsing if needed.
                         */
                        if ('body' in requestSchemas && requestSchemas.body) {
                            const body = await adapter.input.body(...input);
                            const parsedBody =
                                await requestSchemas.body['~standard'].validate(
                                    body
                                );
                            if (parsedBody.issues) {
                                throw new Error();
                            }
                            result = {
                                ...result,
                                ...(parsedBody.value as object)
                            };
                        }

                        /**
                         * FormData parsing if needed.
                         */
                        if (
                            'formData' in requestSchemas &&
                            requestSchemas.formData
                        ) {
                            const formData = await adapter.input.formData(
                                ...input
                            );
                            const parsedFormData =
                                await requestSchemas.formData[
                                    '~standard'
                                ].validate(formData);

                            if (parsedFormData.issues) {
                                throw new Error();
                            }

                            result = {
                                ...result,
                                ...(parsedFormData.value as object)
                            };
                        }

                        /**
                         * Headers parsing if needed.
                         */
                        if (
                            'headers' in requestSchemas &&
                            requestSchemas.headers
                        ) {
                            const headers = await adapter.input.headers(
                                ...input
                            );
                            const parsedHeaders =
                                await requestSchemas.headers[
                                    '~standard'
                                ].validate(headers);
                            if (parsedHeaders.issues) {
                                throw new Error();
                            }
                            result = {
                                ...result,
                                ...(parsedHeaders.value as object)
                            };
                        }

                        /**
                         * Cookies parsing if needed.
                         */
                        if (
                            'cookies' in requestSchemas &&
                            requestSchemas.cookies
                        ) {
                            const cookies = await adapter.input.cookies(
                                ...input
                            );
                            const parsedCookies =
                                await requestSchemas.cookies[
                                    '~standard'
                                ].validate(cookies);
                            if (parsedCookies.issues) {
                                throw new Error();
                            }
                            result = {
                                ...result,
                                ...(parsedCookies.value as object)
                            };
                        }

                        const output = await handler.inputSchema[
                            '~standard'
                        ].validate(
                            transformers.inputFromRequest(
                                result as unknown as any
                            )
                        );

                        if (output.issues) {
                            throw new Error();
                        }

                        return output.value;
                    },
                    output: async (response, ...input) => {
                        if (!response.success) {
                            const statusCode =
                                handlerErrorCodesMapping(response.error) ??
                                errorCodesMapping(response.error) ??
                                defaultErrorCodesMapping(response.error) ??
                                500;
                            return await adapter.output(
                                {
                                    success: false,
                                    error: response.error,
                                    statusCode
                                },
                                ...input
                            );
                        }

                        const getBodyPart = async () => {
                            if (
                                'body' in responseSchemas &&
                                responseSchemas.body
                            ) {
                                const result = await responseSchemas.body[
                                    '~standard'
                                ].validate(
                                    transformers.outputToBody!(response.result)
                                );
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
                                responseSchemas.cookies &&
                                'outputToCookies' in transformers
                            ) {
                                const result = await responseSchemas.cookies[
                                    '~standard'
                                ].validate(
                                    transformers.outputToCookies!(
                                        response.result
                                    )
                                );
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
                                responseSchemas.headers &&
                                'outputToHeaders' in transformers
                            ) {
                                const result = await responseSchemas.headers[
                                    '~standard'
                                ].validate(
                                    transformers.outputToHeaders!(
                                        response.result
                                    )
                                );
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
                                statusCode: successStatusCode
                            },
                            ...input
                        );
                    }
                });

                return Object.assign(transformedREST, {
                    _api_schemas: {
                        requestSchemas,
                        responseSchemas
                    }
                });
            };

            return { withDataMapping };
        };

        const withRequestSchemas = <
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

            type AllInput = SafelyInferInput<RequestQuerySchema> &
                SafelyInferInput<RequestBodySchema> &
                SafelyInferInput<RequestFormDataSchema> &
                SafelyInferInput<RequestHeadersSchema> &
                SafelyInferInput<RequestCookiesSchema>;

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

            type CompatibleInput =
                AllInput extends StandardSchemaV1.InferOutput<InputSchema>
                    ? true
                    : false;

            const endpoint = result.withDataMapping({
                inputFromRequest: (x) => x,
                // @ts-expect-error
                outputToBody: (x) => x
            });

            const withResponseSchemas = <
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
                const mapData = (
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
                        inputFromRequest: (x) => x,
                        ...logic
                    });

                    return result;
                };
                return { mapped: mapData };
            };

            const withRequestMapping = (
                request: Parameters<
                    typeof result.withDataMapping
                >[0]['inputFromRequest']
            ) => {
                const withDataMapping = result.withDataMapping({
                    inputFromRequest: request,
                    // @ts-expect-error
                    outputToBody: (x) => x
                });

                return Object.assign(withDataMapping, {
                    withResponseSchemas
                });
            };

            return Object.assign(endpoint, {
                mapped: withRequestMapping,
                withResponseSchemas
            }) as true extends ValidQueryParams
                ? true extends CompatibleInput
                    ? typeof endpoint & {
                          mapped: typeof withRequestMapping;
                          withResponseSchemas: typeof withResponseSchemas;
                      }
                    : { mapped: typeof withRequestMapping }
                : {
                      ERROR: 'INVALID QUERY PARAMETERS SCHEMA';
                      CURRENT: SafelyInferInput<RequestQuerySchema>;
                  };
        };

        return {
            withRequestSchemas
        };
    };
