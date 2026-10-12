import type { Handler, Hook } from '@domain-first/handlers';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
    buildEndpoint,
    type EndpointConfig,
    type ResponseConfiguration
} from './build-endpoint';
import type { PathParamName, PathParams } from './path-params';
import type {
    Adapter,
    Metadata,
    RequestSchemaSource,
    RequestSchemas,
    ResponseSchemas
} from './types';

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type InferSchemas<Schemas> = {
    [K in keyof Schemas]: Schemas[K] extends StandardSchemaV1
        ? StandardSchemaV1.InferOutput<Schemas[K]>
        : never;
};

type ContextData<Context> = unknown extends Context
    ? {}
    : undefined extends Context
      ? {}
      : { context: Context };

/**
 * Path parameters come from the route, e.g. `['users', ':id']` → `{ id: string }`.
 */
type PathParamsData<Path extends readonly string[]> = [
    PathParamName<Path>
] extends [never]
    ? {}
    : { params: PathParams<Path> };

/**
 * Argument of `.mapInput()`.
 */
export type RequestData<
    Request,
    Path extends readonly string[],
    Context
> = Simplify<
    InferSchemas<Request> & PathParamsData<Path> & ContextData<Context>
>;

/**
 * Return value of `.mapOutput()`.
 */
export type ResponseData<Response> = Simplify<InferSchemas<Response>>;

type UnknownSourcesIssue<Request> = [
    Exclude<keyof Request, RequestSchemaSource>
] extends [never]
    ? never
    : {
          ERROR: 'UNKNOWN REQUEST SOURCES';
          UNKNOWN: Exclude<keyof Request, RequestSchemaSource>;
      };

type NonStringOutputKeys<T> = {
    [K in keyof T]-?: T[K] extends string | undefined ? never : K;
}[keyof T];

/**
 * Query, headers and cookies come as string records,
 * so their schemas must produce strings (optional fields are fine).
 */
type StringRecordSchemaIssue<
    Request,
    Source extends RequestSchemaSource,
    ErrorName extends string
> = Request extends { [K in Source]: infer Schema extends StandardSchemaV1 }
    ? [NonStringOutputKeys<StandardSchemaV1.InferOutput<Schema>>] extends [
          never
      ]
        ? never
        : {
              ERROR: ErrorName;
              INVALID: NonStringOutputKeys<
                  StandardSchemaV1.InferOutput<Schema>
              >;
              CURRENT: StandardSchemaV1.InferOutput<Schema>;
          }
    : never;

type RequestSchemasIssue<Request> =
    | UnknownSourcesIssue<Request>
    | StringRecordSchemaIssue<
          Request,
          'query',
          'INVALID QUERY PARAMETERS SCHEMA'
      >
    | StringRecordSchemaIssue<Request, 'headers', 'INVALID HEADERS SCHEMA'>
    | StringRecordSchemaIssue<Request, 'cookies', 'INVALID COOKIES SCHEMA'>;

export type Endpoint<
    RESTRequest extends unknown[],
    RESTResponse,
    Request extends RequestSchemas,
    Response extends ResponseSchemas,
    Path extends readonly string[]
> = ((...input: RESTRequest) => Promise<RESTResponse>) & {
    _api_schemas: { requestSchemas: Request; responseSchemas: Response };
    metadata: Metadata<Path>;
};

export const createEndpoint =
    <Context = undefined>(
        config: EndpointConfig<Context, unknown, unknown> = {}
    ) =>
    <RESTRequest extends unknown[], RESTResponse>(
        adapter: Adapter<RESTRequest, RESTResponse>,
        endpointConfig?: Partial<{
            hooks: Array<Hook<RESTRequest, RESTResponse>>;
        }>
    ) =>
        endpointGenerator<RESTRequest, RESTResponse, Context>(adapter, {
            ...config,
            hooks: [
                ...((config.hooks ?? []) as Hook<RESTRequest, RESTResponse>[]),
                ...(endpointConfig?.hooks ?? [])
            ]
        });

const endpointGenerator =
    <RESTRequest extends unknown[], RESTResponse, Context = undefined>(
        adapter: Adapter<RESTRequest, RESTResponse>,
        config: EndpointConfig<Context, RESTRequest, RESTResponse> = {}
    ) =>
    <
        InputSchema extends StandardSchemaV1,
        OutputSchema extends StandardSchemaV1,
        const Path extends readonly string[]
    >(
        handler: Handler<InputSchema, OutputSchema>,
        metadata: Metadata<Path>
    ) => {
        type HandlerInput = StandardSchemaV1.InferOutput<InputSchema>;
        type HandlerOutput = StandardSchemaV1.InferOutput<OutputSchema>;

        const input = <Request extends RequestSchemas>(
            requestSchemas: (inputSchema: InputSchema) => Request
        ) => {
            const request = requestSchemas(handler.inputSchema);

            const mapInput = (
                inputFromRequest: (
                    data: RequestData<Request, Path, Context>
                ) => HandlerInput | Promise<HandlerInput>
            ) => {
                const output = <Response extends ResponseSchemas>(
                    responseSchemas: (outputSchema: OutputSchema) => Response,
                    configuration?: ResponseConfiguration
                ) => ({
                    mapOutput: (
                        outputFromResult: (
                            result: HandlerOutput
                        ) =>
                            | ResponseData<Response>
                            | Promise<ResponseData<Response>>
                    ) =>
                        buildEndpoint(adapter, config, handler, metadata, {
                            request,
                            response: responseSchemas(handler.outputSchema),
                            inputFromRequest,
                            outputFromResult,
                            configuration: configuration ?? {}
                        }) as Endpoint<
                            RESTRequest,
                            RESTResponse,
                            Request,
                            Response,
                            Path
                        >
                });

                const endpoint = buildEndpoint(
                    adapter,
                    config,
                    handler,
                    metadata,
                    {
                        request,
                        response: { body: handler.outputSchema },
                        inputFromRequest,
                        outputFromResult: (result) => ({ body: result })
                    }
                ) as Endpoint<
                    RESTRequest,
                    RESTResponse,
                    Request,
                    { body: OutputSchema },
                    Path
                >;

                return Object.assign(endpoint, { output });
            };

            type Issue = RequestSchemasIssue<Request>;

            return { mapInput } as [Issue] extends [never]
                ? { mapInput: typeof mapInput }
                : Issue;
        };

        return { input };
    };

export type EndpointGenerator<
    Context = undefined,
    Input extends unknown[] = any[],
    Output = any
> = ReturnType<typeof endpointGenerator<Input, Output, Context>>;
