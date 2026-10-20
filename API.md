# API Reference

Technical specification of the public API of `@domain-first/handlers-rest`.

- [Package](#package)
- [Exports overview](#exports-overview)
- [Endpoints](#endpoints)
    - [`createEndpoint`](#createendpoint)
    - [Endpoint builder](#endpoint-builder)
    - [`.input()`](#input)
    - [`.mapInput()`](#mapinput)
    - [`.output()`](#output)
    - [`.mapOutput()`](#mapoutput)
    - [Endpoint](#endpoint)
    - [`Metadata<Path>`](#metadatapath)
- [Error mappings](#error-mappings)
    - [`httpError`](#httperror)
    - [`httpStatus`](#httpstatus)
    - [`invalidRequest`](#invalidrequest)
    - [Response options](#response-options)
    - [`ErrorMapping`](#errormapping)
- [Built-in errors](#built-in-errors)
    - [`RequestParsingError`](#requestparsingerror)
    - [`InputMappingError`](#inputmappingerror)
    - [`ResponseParsingError`](#responseparsingerror)
    - [`ErrorResponseMappingError`](#errorresponsemappingerror)
    - [Codes](#codes)
- [OpenAPI](#openapi)
    - [`generateOpenAPI`](#generateopenapi)
    - [Shared schemas](#shared-schemas)
    - [Schema conversion](#schema-conversion)
- [Adapters](#adapters)
    - [`Adapter<RESTInput, RESTOutput>`](#adapterrestinput-restoutput)
    - [`mockAdapter`](#mockadapter)
- [Types](#types)
    - [Request and response schemas](#request-and-response-schemas)
    - [Mapper data](#mapper-data)
    - [Path parameters](#path-parameters)
    - [Contracts](#contracts)
    - [Error types](#error-types)
    - [Other types](#other-types)
- [Compile-time checks](#compile-time-checks)
- [Runtime semantics](#runtime-semantics)
    - [Request processing](#request-processing)
    - [Error resolution](#error-resolution)
    - [Hooks](#hooks)
- [Upgrading](#upgrading)

Notation used below:

- **Handler** is a handler of [`@domain-first/handlers`](https://www.npmjs.com/package/@domain-first/handlers) created with `defineHandler`. It has an `inputSchema` and an `outputSchema`.
- **Schema** is any [Standard Schema](https://standardschema.dev) (`StandardSchemaV1`): Zod, Valibot, ArkType, …
- **Request parts** are `query`, `params`, `body`, `formData`, `headers`, `cookies`. **Response parts** are `body`, `headers`, `cookies`.
- `RESTInput` is the tuple of arguments an adapter receives (e.g. `[Request, Response]`), `RESTOutput` is what it returns.

## Package

| Property          | Value                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| Name              | `@domain-first/handlers-rest`                                               |
| Entry point       | `.` (single entry, no subpath exports)                                      |
| Formats           | ESM (`dist/index.js`), CommonJS (`dist/index.cjs`)                          |
| Types             | `dist/index.d.ts`                                                           |
| Dependencies      | `@domain-first/errors`, `@standard-schema/spec`, `openapi-types`            |
| Peer dependencies | `@domain-first/handlers` `^5.0.2`                                           |
| Syntax            | ES syntax supported by Node.js 22                                           |
| Runtime           | Imports `node:fs` and `node:path` (used by `generateOpenAPI({ outputFile })`) |

## Exports overview

| Export                                                                 | Kind     | Section                                                   |
| ---------------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| `createEndpoint`                                                       | function | [`createEndpoint`](#createendpoint)                       |
| `httpError`                                                            | function | [`httpError`](#httperror)                                 |
| `httpStatus`                                                           | function | [`httpStatus`](#httpstatus)                               |
| `invalidRequest`                                                       | function | [`invalidRequest`](#invalidrequest)                       |
| `generateOpenAPI`                                                      | function | [`generateOpenAPI`](#generateopenapi)                     |
| `mockAdapter`                                                          | object   | [`mockAdapter`](#mockadapter)                             |
| `invalidRequestDetailsSchema`                                          | object   | [`invalidRequest`](#invalidrequest)                       |
| `RequestParsingError`                                                  | class    | [`RequestParsingError`](#requestparsingerror)             |
| `InputMappingError`                                                    | class    | [`InputMappingError`](#inputmappingerror)                 |
| `ResponseParsingError`                                                 | class    | [`ResponseParsingError`](#responseparsingerror)           |
| `ErrorResponseMappingError`                                            | class    | [`ErrorResponseMappingError`](#errorresponsemappingerror) |
| `Errors`                                                               | object   | [Codes](#codes)                                           |
| `INTERNAL_ERROR_CODE`, `INVALID_REQUEST_CODE`                          | constant | [Codes](#codes)                                           |
| `Endpoint`, `EndpointGenerator`, `Metadata`, `HttpMethod`              | type     | [Endpoints](#endpoints)                                   |
| `ErrorMapping`, `ErrorClass`, `DomainErrorClass`, `ErrorResponseBody`  | type     | [Error types](#error-types)                               |
| `HttpErrorOptions`, `HttpStatusOptions`, `InvalidRequestOptions`       | type     | [Error mappings](#error-mappings)                         |
| `InvalidRequestDetails`, `InvalidRequestError`                         | type     | [`invalidRequest`](#invalidrequest)                       |
| `GenerateOpenAPIOptions`                                               | type     | [`generateOpenAPI`](#generateopenapi)                     |
| `Adapter`, `CookiesConfiguration`                                      | type     | [Adapters](#adapters)                                     |
| `MockRestAdapterInput`, `MockRestAdapterOutput`                        | type     | [`mockAdapter`](#mockadapter)                             |
| `RequestSchemas`, `ResponseSchemas`, `RequestSource`, `RequestSchemaSource`, `ResponseTarget` | type | [Request and response schemas](#request-and-response-schemas) |
| `RequestData`, `ResponseData`, `RawRequestModel`                       | type     | [Mapper data](#mapper-data)                               |
| `PathParamName`, `PathParams`                                          | type     | [Path parameters](#path-parameters)                       |
| `EndpointContract`, `InferRequest*`, `InferResponse*`                  | type     | [Contracts](#contracts)                                   |
| `RawAPISchemas`, `JSONSchemas`                                         | type     | [Other types](#other-types)                               |

Nothing else is part of the public API.

## Endpoints

### `createEndpoint`

Creates an endpoint factory: shared configuration first, then an adapter.

**Signature**

```ts
function createEndpoint<Context = undefined>(config?: {
    errors?: ErrorMapping[];
    context?: (request: RawRequestModel) => Promise<Context>;
    hooks?: Hook<unknown, unknown>[];
}): <RESTInput extends unknown[], RESTOutput>(
    adapter: Adapter<RESTInput, RESTOutput>,
    adapterConfig?: { hooks?: Hook<RESTInput, RESTOutput>[] }
) => EndpointGenerator<Context, RESTInput, RESTOutput>;
```

**Parameters**

| Name                  | Type                                         | Description                                                                                          |
| --------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `config.errors`       | `ErrorMapping[]`                             | Error mappings shared by every endpoint. See [Error mappings](#error-mappings).                     |
| `config.context`      | `(request: RawRequestModel) => Promise<Context>` | Builds the `context` passed to `.mapInput()`. Receives the parsed request, see [Request processing](#request-processing). |
| `config.hooks`        | `Hook[]`                                     | Hooks of `@domain-first/handlers` for every adapter. See [Hooks](#hooks).                            |
| `adapter`             | `Adapter<RESTInput, RESTOutput>`             | Reads requests and writes responses. See [Adapters](#adapters).                                     |
| `adapterConfig.hooks` | `Hook<RESTInput, RESTOutput>[]`              | Hooks for this adapter only. They run after the shared ones.                                        |

**Returns**

`EndpointGenerator<Context, RESTInput, RESTOutput>`: a function `(handler, metadata)` that starts the [endpoint builder](#endpoint-builder).

**Behavior**

- `Context` is inferred from `config.context`. When it is `undefined`, `unknown` or includes `undefined`, `.mapInput()` gets no `context` field.
- The factory can be called with several adapters; each call gives an independent generator.

**Throws**

Nothing.

**Example**

```ts
const endpoint = createEndpoint({
    errors: [invalidRequest()],
    context: async ({ headers }) => ({ userAgent: headers?.["user-agent"] }),
})(mockAdapter);
```

### Endpoint builder

`EndpointGenerator` takes a handler and metadata and returns `{ input }`:

```ts
endpoint(handler, metadata) // EndpointGenerator
    .input((inputSchema) => requestSchemas)
    .mapInput((request) => handlerInput) // → Endpoint, with .output()
    .output((outputSchema) => responseSchemas, configuration?)
    .mapOutput((result) => response); // → Endpoint
```

| Step           | Required | Result                                                               |
| -------------- | -------- | -------------------------------------------------------------------- |
| `.input()`     | yes      | `{ mapInput }`, or a compile-time error description                  |
| `.mapInput()`  | yes      | A ready [Endpoint](#endpoint) with an extra `.output()` method       |
| `.output()`    | no       | `{ mapOutput }`                                                      |
| `.mapOutput()` | no       | A ready [Endpoint](#endpoint)                                        |

`metadata.route.path` is captured with a `const` type parameter, so path parameter names are inferred from an inline array. See [`Metadata<Path>`](#metadatapath).

### `.input()`

Declares which request parts are validated.

**Signature**

```ts
input<Request extends RequestSchemas>(
    requestSchemas: (inputSchema: Handler["inputSchema"]) => Request
): { mapInput } | CompileTimeIssue;
```

**Parameters**

| Name             | Type                              | Description                                                                                   |
| ---------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `requestSchemas` | `(inputSchema) => RequestSchemas` | Called once, immediately, with the handler's input schema. Returns schemas for `query`, `params`, `body`, `formData`, `headers`, `cookies`. |

**Behavior**

- `params` come from the route even without a schema. A `params` schema validates them and narrows their types; it can describe only some parameters, the rest stay `string`.
- Parts without a schema are still passed to `.mapInput()` when they are always read (`query`, `headers`, `cookies`), see [Request processing](#request-processing).
- If a schema can't match HTTP, the return type is an error description instead of `{ mapInput }`. See [Compile-time checks](#compile-time-checks).

**Example**

```ts
.input((schema) => ({ body: schema, headers: z.object({ authorization: z.string() }) }))
```

### `.mapInput()`

Maps the parsed request to the handler's input.

**Signature**

```ts
mapInput(
    inputFromRequest: (data: RequestData<Request, Path, Context>) => HandlerInput | Promise<HandlerInput>
): Endpoint & { output };
```

**Parameters**

| Name               | Type                                          | Description                                                                                   |
| ------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `inputFromRequest` | `(data) => HandlerInput \| Promise<HandlerInput>` | Receives the validated request parts, `params` (when the route has parameters) and `context` (when configured). See [`RequestData`](#mapper-data). |

**Returns**

An [Endpoint](#endpoint). The response is the handler result as `body`, validated with the handler's output schema. The endpoint also has [`.output()`](#output) to declare another response.

**Behavior**

- The result is validated with the handler's input schema. If it fails, the request fails with [`InputMappingError`](#inputmappingerror).
- Shared and endpoint error mappings are merged here, see [Error resolution](#error-resolution).

**Throws**

| Error   | When                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------- |
| `Error` | The route has path parameters and the adapter has no `input.pathParams`.                             |
| `Error` | One `code` is mapped twice in `createEndpoint({ errors })` or twice in `metadata.errors`.            |

**Example**

```ts
.mapInput(({ params, body }) => ({ id: Number(params.userId), ...body }))
```

### `.output()`

Declares response parts and how the handler result fills them.

**Signature**

```ts
output<Response extends ResponseSchemas>(
    responseSchemas: (outputSchema: Handler["outputSchema"]) => Response,
    configuration?: { cookies?: CookiesConfiguration }
): { mapOutput };
```

**Parameters**

| Name                    | Type                                | Description                                                                                   |
| ----------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `responseSchemas`       | `(outputSchema) => ResponseSchemas` | Called once, when `.mapOutput()` is called, with the handler's output schema. Returns schemas for `body`, `headers`, `cookies`. |
| `configuration.cookies` | `CookiesConfiguration`              | `{ [name]: { httpOnly, maxAge } }`, passed to the adapter as is.                              |

**Returns**

`{ mapOutput }`. See [`.mapOutput()`](#mapoutput).

### `.mapOutput()`

Maps the handler result to the declared response parts.

**Signature**

```ts
mapOutput(
    outputFromResult: (result: HandlerOutput) => ResponseData<Response> | Promise<ResponseData<Response>>
): Endpoint;
```

**Behavior**

- Must return every declared part. Each part is validated with its schema; a failure makes the request fail with [`ResponseParsingError`](#responseparsingerror).
- Parts without a schema are not sent: the adapter gets `undefined` for them.
- Throws the same errors as [`.mapInput()`](#mapinput).

**Example**

```ts
.output((schema) => ({ body: z.object({ result: schema }), headers: z.object({ "x-total": z.string() }) }))
.mapOutput((result) => ({ body: { result }, headers: { "x-total": String(result) } }))
```

### Endpoint

The result of `.mapInput()` or `.mapOutput()`.

```ts
type Endpoint<RESTInput, RESTOutput, Request, Response, Path> = ((
    ...input: RESTInput
) => Promise<RESTOutput>) & {
    _api_schemas: { requestSchemas: Request; responseSchemas: Response };
    metadata: Metadata<Path>;
};
```

| Member         | Description                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Call           | Processes a request with the adapter's arguments. Never rejects for request, handler or mapping errors: they become error responses. See [Request processing](#request-processing). |
| `_api_schemas` | Declared request and response schemas. Used by [`generateOpenAPI`](#generateopenapi) and [`EndpointContract`](#contracts). |
| `metadata`     | The metadata passed to the generator, with `errors` replaced by the merged shared and endpoint mappings. |

### `Metadata<Path>`

```ts
type Metadata<Path extends readonly string[] = readonly string[]> = {
    route: { method: HttpMethod; path: Path };
    summary?: string;
    description?: string;
    tags?: string[];
    successStatusCode?: number;
    successResponseDescription?: string;
    errors?: ErrorMapping[];
    openApiMetadata?: Partial<OpenAPIV3.OperationObject>;
};

type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "head" | "options";
```

| Field                        | Default                 | Description                                                                                      |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| `route.method`               |                         | HTTP method.                                                                                     |
| `route.path`                 |                         | Path segments. Segments starting with `:` are path parameters. A segment can contain slashes: `"tabs/:tab"`. |
| `successStatusCode`          | `200`                   | Status of successful responses.                                                                  |
| `errors`                     | `[]`                    | Endpoint error mappings. See [Error resolution](#error-resolution).                             |
| `summary`, `description`     |                         | OpenAPI operation fields.                                                                        |
| `tags`                       | `[route.path[0]]`       | OpenAPI operation tags.                                                                          |
| `successResponseDescription` | `"OK"`                  | OpenAPI description of the success response.                                                    |
| `openApiMetadata`            |                         | Merged over the generated OpenAPI operation, top-level keys replace generated ones.              |

## Error mappings

An error mapping decides the status and body of the response for errors it matches. The three helpers below create [`ErrorMapping`](#errormapping) objects for `createEndpoint({ errors })` and `metadata.errors`.

### `httpError`

Maps one error class (and its subclasses) to a status.

**Signature**

```ts
function httpError<Class extends ErrorClass, DetailsSchema extends StandardSchemaV1>(
    errorClass: Class,
    status: number,
    options?: HttpErrorOptions<Class, DetailsSchema> // required when Class has no static `code`
): ErrorMapping;

type HttpErrorOptions<Class, DetailsSchema> = {
    code?: string; // required when Class has no static `code`
} & ResponseOptions<InstanceType<Class>, DetailsSchema>;
```

**Parameters**

| Name         | Type               | Description                                                                                       |
| ------------ | ------------------ | ------------------------------------------------------------------------------------------------- |
| `errorClass` | `ErrorClass`       | Any class extending `Error`.                                                                      |
| `status`     | `number`           | Response status.                                                                                  |
| `options`    | `HttpErrorOptions` | `code` and [response options](#response-options). `message` and `details.map` receive `InstanceType<Class>`. |

**Behavior**

| `errorClass`                                                                  | `code`                             | Matching             |
| ----------------------------------------------------------------------------- | ---------------------------------- | -------------------- |
| Has a static string `code` and a static `is()` (e.g. `@domain-first/errors`)  | `options.code`, else `Class.code`  | `errorClass.is(error)` |
| Any other class                                                               | `options.code` (required)          | `error instanceof errorClass` |

**Throws**

| Error   | When                                                                         |
| ------- | ---------------------------------------------------------------------------- |
| `Error` | No `code` can be found: `Error class "<name>" has no code, pass it in the options`. TypeScript reports this at compile time. |

**Example**

```ts
httpError(ProjectNotFoundError, 404, {
    description: "Project not found",
    message: (e) => `Project ${e.details.projectId} not found`,
});

class StorageUnavailableError extends Error {}
httpError(StorageUnavailableError, 503, { code: "STORAGE_UNAVAILABLE" });
```

### `httpStatus`

Maps many errors to one status and one `code`.

**Signature**

```ts
function httpStatus<DetailsSchema extends StandardSchemaV1>(
    status: number,
    options: HttpStatusOptions<DetailsSchema>
): ErrorMapping;

type HttpStatusOptions<DetailsSchema> = {
    code: string;
    match: Array<ErrorClass | ((error: Error) => boolean)>;
} & ResponseOptions<Error, DetailsSchema>;
```

**Parameters**

| Name            | Type                                             | Description                                                                         |
| --------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `status`        | `number`                                         | Response status.                                                                    |
| `options.code`  | `string`                                         | Shared by every matched error.                                                      |
| `options.match` | `Array<ErrorClass \| (error: Error) => boolean>` | Error classes, matched like in [`httpError`](#httperror), and predicates. An error matches when any of them matches. |
| other options   |                                                  | [Response options](#response-options). `message` and `details.map` receive `Error`. |

**Behavior**

- An entry is treated as a class when it is `Error` or its prototype extends `Error`; any other function is a predicate.

**Example**

```ts
httpStatus(503, {
    code: "UNAVAILABLE",
    match: [StorageUnavailableError, (e) => e.message.includes("ECONNREFUSED")],
});
```

### `invalidRequest`

A ready-made [`httpStatus`](#httpstatus) for [`RequestParsingError`](#requestparsingerror) and [`InputMappingError`](#inputmappingerror).

**Signature**

```ts
function invalidRequest<DetailsSchema extends StandardSchemaV1>(
    options?: InvalidRequestOptions<DetailsSchema>
): ErrorMapping;

type InvalidRequestOptions<DetailsSchema> = {
    status?: number;
    code?: string;
    description?: string;
    schemaName?: string;
    message?: string | ((error: InvalidRequestError) => string);
    details?: false | {
        schema: DetailsSchema;
        map: (error: InvalidRequestError) => StandardSchemaV1.InferInput<DetailsSchema>;
    };
};

type InvalidRequestError =
    | InstanceType<typeof RequestParsingError>
    | InstanceType<typeof InputMappingError>;
```

**Parameters**

| Option        | Default                                      | Description                                    |
| ------------- | -------------------------------------------- | ---------------------------------------------- |
| `status`      | `400`                                        | Response status.                               |
| `code`        | `INVALID_REQUEST_CODE`                       | Response `code`.                               |
| `description` | `"Invalid request"`                          | OpenAPI response description.                  |
| `schemaName`  | `"InvalidRequestError"`                      | OpenAPI component name of the body.            |
| `message`     | none                                         | See [response options](#response-options).     |
| `details`     | `{ schema: invalidRequestDetailsSchema, map }` | `false` sends no `details`.                  |

**Default details**

```ts
type InvalidRequestDetails = {
    source?: "query" | "params" | "headers" | "cookies" | "body" | "formData";
    issues: { message: string; path?: (string | number)[] }[];
};
```

| Field            | Value                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| `source`         | `details.source` of a `RequestParsingError`; absent for `InputMappingError`.            |
| `issues[].message` | The issue message from the schema library.                                            |
| `issues[].path`  | The issue path, when the issue has one. `{ key }` segments are unwrapped, numbers stay numbers, symbols become strings. |

`received` is never sent.

**`invalidRequestDetailsSchema`**

The schema of the default details. It implements both Standard Schema and Standard JSON Schema by hand, so it works whatever validation library the app uses, and its vendor is `@domain-first/handlers-rest`. Its `validate` accepts any value as is. [`generateOpenAPI`](#generateopenapi) never passes it to `standardSchemaToJSONSchema`.

**Example**

```ts
createEndpoint({ errors: [invalidRequest()] });
// 400 { code: "@domain-first/handlers-rest.invalid-request",
//       details: { source: "body", issues: [{ message: "Invalid input: expected string, received number", path: ["name"] }] } }

invalidRequest({ status: 422, code: "VALIDATION_FAILED", details: false });
```

### Response options

Shared by [`httpError`](#httperror), [`httpStatus`](#httpstatus) and [`invalidRequest`](#invalidrequest). `E` is the error type: `InstanceType<Class>` for `httpError`, `Error` for `httpStatus`, `InvalidRequestError` for `invalidRequest`.

```ts
type ResponseOptions<E, DetailsSchema extends StandardSchemaV1> = {
    description?: string;
    schemaName?: string;
    message?: string | ((error: E) => string);
    details?: {
        schema: DetailsSchema;
        map: (error: E) => StandardSchemaV1.InferInput<DetailsSchema>;
    };
};
```

| Option        | Without it                         | With it                                                                                   |
| ------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `description` | OpenAPI uses `"Error response"`    | OpenAPI response description. Descriptions of mappings sharing a status are joined with `"; "`. |
| `schemaName`  | The body is described inline       | The body goes to OpenAPI `components.schemas` under this name and is referenced with `$ref`. |
| `message`     | No `message` in the body           | A fixed string, or built from the error.                                                  |
| `details`     | No `details` in the body           | `map` picks what is sent, `schema` validates it and describes it in OpenAPI.              |

If `message` or `details` can't be built, the response keeps its status and `code` without that part, and hooks get an [`ErrorResponseMappingError`](#errorresponsemappingerror):

| Failure                         | `part`      | `issues`             | `received`         | `cause`           |
| ------------------------------- | ----------- | -------------------- | ------------------ | ----------------- |
| `message` function throws       | `"message"` | `[]`                 | `undefined`        | The thrown value  |
| `details.map` throws            | `"details"` | `[]`                 | `undefined`        | The thrown value  |
| `details.schema` rejects        | `"details"` | The schema's issues  | The mapped value   | none              |
| `details.schema` throws         | `"details"` | `[]`                 | The mapped value   | The thrown value  |

`details` is the value returned by the schema, so transformations and stripped keys apply. Some libraries don't strip unknown keys (ArkType, for one); `map` is what keeps data private.

### `ErrorMapping`

The object every helper returns.

```ts
type ErrorMapping = {
    code: string;
    status: number;
    description?: string;
    schemaName?: string;
    matches: (error: Error) => boolean;
    message?: string | ((error: Error) => string);
    details?: { schema: StandardSchemaV1; map: (error: Error) => unknown };
};
```

Writing it by hand is supported: `message` and `details.map` are called only for errors `matches` accepted.

## Built-in errors

Classes of [`@domain-first/errors`](https://www.npmjs.com/package/@domain-first/errors) in the `@domain-first/handlers-rest` namespace (exported as `Errors`). Use them with `httpError`, `httpStatus` or `.is()`.

### `RequestParsingError`

A request part failed its schema, or a route parameter is missing.

```ts
details: {
    issues: ReadonlyArray<StandardSchemaV1.Issue>;
    source: "query" | "params" | "headers" | "cookies" | "body" | "formData";
    received: unknown; // the part as the adapter returned it
}
```

For a missing route parameter, `source` is `"params"` and the issue is `{ message: 'Path parameter "<name>" is missing', path: ["<name>"] }`.

### `InputMappingError`

The `.mapInput()` result failed the handler's input schema, e.g. `Number("abc")` for a numeric field.

```ts
details: {
    issues: ReadonlyArray<StandardSchemaV1.Issue>;
    received: unknown; // the .mapInput() result
}
```

### `ResponseParsingError`

A `.mapOutput()` part failed its response schema.

```ts
details: {
    issues: ReadonlyArray<StandardSchemaV1.Issue>;
    source: "body" | "headers" | "cookies";
    received: unknown;
}
```

### `ErrorResponseMappingError`

The `message` or `details` of an error response could not be built. Passed to hooks only, never sent. See [Response options](#response-options).

```ts
details: {
    code: string; // the mapping's code
    part: "message" | "details";
    issues: ReadonlyArray<StandardSchemaV1.Issue>;
    received: unknown;
}
```

### Codes

| Constant / class            | Value                                                  |
| --------------------------- | ------------------------------------------------------ |
| `RequestParsingError.code`  | `"@domain-first/handlers-rest.request-parsing"`        |
| `InputMappingError.code`    | `"@domain-first/handlers-rest.input-mapping"`          |
| `ResponseParsingError.code` | `"@domain-first/handlers-rest.response-parsing"`       |
| `ErrorResponseMappingError.code` | `"@domain-first/handlers-rest.error-response-mapping"` |
| `INTERNAL_ERROR_CODE`       | `"@domain-first/handlers-rest.internal"`: body code of unmapped errors |
| `INVALID_REQUEST_CODE`      | `"@domain-first/handlers-rest.invalid-request"`: default code of `invalidRequest()` |

## OpenAPI

### `generateOpenAPI`

Builds an OpenAPI 3.0.3 document from endpoints.

**Signature**

```ts
function generateOpenAPI(
    endpoints: { metadata: Metadata; _api_schemas: RawAPISchemas }[],
    options: GenerateOpenAPIOptions
): OpenAPIV3.Document;

type GenerateOpenAPIOptions = {
    document: Omit<OpenAPIV3.Document, "paths" | "openapi">;
    apiRoutePrefix?: string[];
    standardSchemaToJSONSchema?: (schema: StandardSchemaV1) => StandardJSONSchemaV1;
    outputFile?: { path: string; format?: (document: OpenAPIV3.Document) => string };
};
```

**Parameters**

| Name                                 | Description                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `endpoints`                          | [Endpoints](#endpoint).                                                                           |
| `options.document`                   | Everything but `paths` and `openapi`: `info`, `servers`, `components`, …                          |
| `options.apiRoutePrefix`             | Segments every route is served under: `["api", "v1"]`. Slashes are optional: `["/api/v1"]` is the same. |
| `options.standardSchemaToJSONSchema` | Converts schemas without Standard JSON Schema support. See [Schema conversion](#schema-conversion). |
| `options.outputFile.path`            | Also writes the document to this path, resolved against `process.cwd()`. Directories are created. |
| `options.outputFile.format`          | File content. Default: JSON indented with tabs.                                                   |

**Returns**

The document: `openapi: "3.0.3"`, the `document` fields, `paths` and, when there are named schemas, `components.schemas` merged with `document.components.schemas`.

**Behavior**

Every endpoint becomes an operation at `<prefix>/<path>` under its method. Endpoints sharing a path are merged under it.

| Endpoint part                  | OpenAPI                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `:name` segment                | `{name}` in the path and a required path parameter: its `params` schema property, or `string`     |
| `query`, `headers`, `cookies`  | One parameter per property (`in: query`, `header`, `cookie`), required when the property is. Record schemas with required keys give one parameter per key. |
| `body`                         | Required `application/json` request body                                                          |
| Response `body`                | `<successStatusCode>` response with `application/json` content                                    |
| `errors` mappings              | One response per status. Several mappings of one status become `oneOf` alternatives. Each body is `{ code, message?, details? }` with `code` as a single-value `enum`; `message` is required when the mapping sets it, `details` is never required (it isn't sent when it fails). A fixed `message` string is its `example`. |
| `summary`, `description`, `tags`, `openApiMetadata` | See [`Metadata<Path>`](#metadatapath)                                         |

Not described: form-data bodies, response headers and cookies.

**Throws**

| Error   | When                                                                                     |
| ------- | ---------------------------------------------------------------------------------------- |
| `Error` | A schema supports neither Standard JSON Schema nor the given converter: `Schema of "<vendor>" does not support Standard JSON Schema, pass "standardSchemaToJSONSchema" to generateOpenAPI`. |
| `Error` | A query, header or cookie schema isn't an object schema: `<target> schema must be an object`. |
| `Error` | A component name is invalid, taken in `document.components.schemas` or describes different schemas. See [Shared schemas](#shared-schemas). |
| Whatever it throws | The schema library fails to convert a schema.                                 |

Failures to write `outputFile` are logged with `console.error` and not thrown.

**Example**

```ts
generateOpenAPI([getUser, createUser], {
    document: { info: { title: "Users API", version: "1.0.0" } },
    apiRoutePrefix: ["api"],
    outputFile: { path: "openapi.json" },
});
```

### Shared schemas

Named schemas go to `components.schemas` and are referenced with `$ref` from every place they're used.

| Source of the name                                                     | Example                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------- |
| A key of `$defs` or `definitions` in the converted JSON Schema         | Zod's `.meta({ id: "Money" })`                  |
| An `id` keyword of a schema                                            | ArkType's `.configure({ id: "Money" })`         |
| `schemaName` of an error mapping                                       | `httpError(E, 404, { schemaName: "NotFound" })` |

**Behavior**

- A request or response part itself becomes a component when its JSON Schema has an `id`. Query, header and cookie roots always stay inline, since they are split into parameters; named schemas inside them are moved.
- Zod drops `id` of the part itself, so Zod parts stay inline.
- An `id` equal to the name of the schema it is inside of is ignored (ArkType copies `id` to union branches).
- A name used by requests and responses stays one component when both describe the same thing, otherwise it becomes `<name>Input` and `<name>Output`. Schemas referring to a split name are split too.
- `id` keywords are removed from components.

**Throws**

| Error message                                                                                            | When                                                         |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `Schema "<name>" can't be an OpenAPI component name, use letters, digits, ".", "-" and "_"`               | The name has other characters.                               |
| `Schema "<name>" is described differently in several places, give each variant its own name`             | One name describes different schemas in one direction.       |
| `Schema "<name>" is already in components.schemas`                                                       | The name is in `document.components.schemas`, or a split `<name>Input`/`<name>Output` collides. |

### Schema conversion

For every schema, the generator gets a JSON Schema in three steps:

1. **Converter.** `standardSchemaToJSONSchema(schema)` must return a Standard JSON Schema. The default returns the schema as is. Schemas of this package (vendor `@domain-first/handlers-rest`) skip the converter.
2. **Target.** `~standard.jsonSchema.input()` (requests) or `.output()` (responses, error details) is called with `{ target: "openapi-3.0" }`.
3. **Fallback.** If that throws, it is called with `{ target: "draft-07" }`, `$schema` is removed and draft-07 keywords are rewritten. If draft-07 throws too, the `openapi-3.0` error is thrown.

| draft-07                                      | OpenAPI 3.0                                                       |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `const: x`                                    | `enum: [x]`                                                       |
| `anyOf`/`oneOf` with a `{ type: "null" }` branch | The other branches get `nullable: true`; a single one replaces the union |
| `type: ["string", "null"]`                    | `type: "string", nullable: true`; several types become `anyOf`    |
| `exclusiveMinimum: n` / `exclusiveMaximum: n` | `minimum: n, exclusiveMinimum: true` / `maximum: n, exclusiveMaximum: true` |
| Tuple `items: [A, B]`                         | `items: { anyOf: [A, B] }`, `maxItems` from the tuple length when `additionalItems: false`; `items: {}` when extra items are allowed |

Values of `const`, `default`, `enum`, `example`, `examples` and property names are not rewritten.

| Library              | What to pass                                                    |
| -------------------- | --------------------------------------------------------------- |
| Zod 4                | Nothing: `openapi-3.0` target                                   |
| ArkType              | Nothing: draft-07 fallback                                      |
| Without Standard JSON Schema (e.g. Valibot) | A `standardSchemaToJSONSchema` that wraps its JSON Schema converter |

```ts
standardSchemaToJSONSchema: (schema) => ({
    "~standard": {
        version: 1,
        vendor: schema["~standard"].vendor,
        jsonSchema: {
            input: () => toJsonSchema(schema),
            output: () => toJsonSchema(schema),
        },
    },
}),
```

## Adapters

### `Adapter<RESTInput, RESTOutput>`

Connects endpoints to a framework.

```ts
type Adapter<RESTInput extends unknown[], RESTOutput> = {
    input: {
        queryParams: (...input: RESTInput) => object | Promise<object>;
        pathParams?: (...input: RESTInput) => object | Promise<object>;
        body: (...input: RESTInput) => object | Promise<object>;
        formData: (...input: RESTInput) => object | Promise<object>;
        headers: (...input: RESTInput) => object | Promise<object>;
        cookies: (...input: RESTInput) => object | Promise<object>;
    };
    output: (response: AdapterResponse, ...input: RESTInput) => RESTOutput | Promise<RESTOutput>;
};

type AdapterResponse =
    | {
          success: true;
          statusCode: number;
          body: object | any[] | string | number | boolean | Date | undefined;
          headers: object | undefined;
          cookies: object | undefined;
          configuration?: { cookies?: CookiesConfiguration };
      }
    | { success: false; statusCode: number; error: ErrorResponseBody };

type CookiesConfiguration = Record<string, { httpOnly: boolean; maxAge: number }>;
```

**Behavior**

| Reader        | Called                                                                    |
| ------------- | ------------------------------------------------------------------------- |
| `queryParams`, `headers`, `cookies` | On every request                                    |
| `body`, `formData` | Only when the endpoint declares a schema for them                    |
| `pathParams`  | Only when the route has parameters or the endpoint declares a `params` schema. Required then, see [`.mapInput()`](#mapinput) |

- `output` gets validated response parts on success, and the status and [error body](#error-types) on failure. `error` is typed `unknown` in the declaration.
- If `output` throws while writing a success response, the error is resolved like any other and `output` is called again with the error response. If it throws while writing an error response, the endpoint call rejects.

### `mockAdapter`

An adapter over plain objects, for tests and playgrounds.

```ts
const mockAdapter: Adapter<[MockRestAdapterInput], MockRestAdapterOutput>;

type MockRestAdapterInput = {
    queryParams?: object;
    pathParams?: object;
    body?: any;
    formData?: object;
    headers?: object;
    cookies?: object;
};

type MockRestAdapterOutput = {
    success: boolean;
    statusCode: number;
    body?: any;
    headers?: object;
    cookies?: object;
};
```

| Response | Fields                                                              |
| -------- | ------------------------------------------------------------------- |
| Success  | `success: true`, `statusCode`, `body`, `headers`, `cookies`          |
| Error    | `success: false`, `statusCode`, `body`: the error body as a JSON string |

Missing input parts (and a falsy `body`) are read as `{}`.

**Example**

```ts
const res = await getUser({ pathParams: { userId: "42" } });
JSON.parse(res.body); // on error: { code: "..." }
```

## Types

### Request and response schemas

```ts
type RequestSource = "query" | "params" | "body" | "formData" | "headers" | "cookies";
type RequestSchemaSource = RequestSource;
type ResponseTarget = "body" | "headers" | "cookies";

type RequestSchemas = { [Source in RequestSchemaSource]?: StandardSchemaV1 };
type ResponseSchemas = { [Target in ResponseTarget]?: StandardSchemaV1 };
```

### Mapper data

```ts
type RequestData<Request, Path, Context> = {
    [K in keyof Request]: StandardSchemaV1.InferOutput<Request[K]>;
} & ({ params: PathParams<Path, InferOutput<Request["params"]>> } | {}) & ({ context: Context } | {});

type ResponseData<Response> = {
    [K in keyof Response]: StandardSchemaV1.InferOutput<Response[K]>;
};

type RawRequestModel = {
    query?: object;
    params?: object;
    body?: unknown;
    formData?: object;
    headers?: object;
    cookies?: object;
};
```

- `RequestData` is the argument of `.mapInput()`: `params` is present when the route has parameters, `context` when a `context` factory is configured. Its runtime value has all request parts, see [Request processing](#request-processing).
- `ResponseData` is the return type of `.mapOutput()`.
- `RawRequestModel` is the argument of the `context` factory.

### Path parameters

```ts
type PathParamName<Path extends readonly string[]>; // ["users", ":userId", "tabs/:tab"] → "userId" | "tab"
type PathParams<Path extends readonly string[], Output = {}> = {
    [Name in PathParamName<Path>]: Name extends keyof Output ? Output[Name] : string;
};
```

`Output` is the output of a `params` schema: parameters it describes take its types. Names are read from the path type. A path typed as `string[]` gives `never` and no `params`, so write paths inline or with `as const`.

### Contracts

```ts
type EndpointContract<T extends { _api_schemas: object }> = {
    request: InferRequestQuery<T> & InferRequestParams<T> & InferRequestBody<T>
        & InferRequestCookies<T> & InferRequestFormData<T> & InferRequestHeaders<T>;
    response: InferResponseBody<T> & InferResponseCookies<T> & InferResponseHeaders<T>;
};
```

Each `Infer*` type gives `{ <part>: InferOutput<Schema> }` when the endpoint declares that part and `{}` otherwise. `InferRequestParams` gives `{ params: PathParams<Path, Output> }` when the route has parameters, `Output` being the `params` schema output (`{}` without one).

```ts
type UserContract = EndpointContract<typeof getUser>;
// { request: { params: { userId: string } }; response: { body: User } }
```

### Error types

```ts
type ErrorClass = abstract new (...args: any[]) => Error;

type DomainErrorClass = ErrorClass & {
    readonly code: string;
    is(target: unknown): boolean;
};

type ErrorResponseBody = {
    code: string;
    message?: string;
    details?: unknown;
};
```

`ErrorResponseBody` is the `error` an adapter gets for failed requests.

### Other types

| Type                | Description                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- |
| `EndpointGenerator<Context, RESTInput, RESTOutput>` | `(handler, metadata) => { input }`, returned by `createEndpoint()(adapter)`. |
| `RawAPISchemas`     | Shape of `Endpoint._api_schemas`, accepted by `generateOpenAPI`.                    |
| `JSONSchemas`       | Converted request and response schemas of one endpoint (internal shape of the generator). |

## Compile-time checks

When request schemas can't work over HTTP, `.input()` returns an object describing the problem instead of `{ mapInput }`, so the next call doesn't compile.

```ts
.input(() => ({ query: z.object({ a: z.number() }) }))
.mapInput(/* … */);
// ✗ Property 'mapInput' does not exist on type
//   { ERROR: "INVALID QUERY PARAMETERS SCHEMA"; INVALID: "a"; CURRENT: { a: number } }
```

| `ERROR`                           | When                                                                                    | Other fields                               |
| --------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------ |
| `INVALID QUERY PARAMETERS SCHEMA` | A `query` schema output has fields other than `string` or `string \| undefined`          | `INVALID`: the keys, `CURRENT`: the output |
| `INVALID HEADERS SCHEMA`          | The same for `headers`                                                                  | `INVALID`, `CURRENT`                       |
| `INVALID COOKIES SCHEMA`          | The same for `cookies`                                                                  | `INVALID`, `CURRENT`                       |
| `INVALID PATH PARAMETERS SCHEMA`  | A `params` schema output has fields other than `string` (optional ones included: route parameters are always present) | `INVALID`, `CURRENT`         |
| `UNKNOWN PATH PARAMETERS`         | A `params` schema describes keys that aren't route parameters                            | `UNKNOWN`: the keys, `ROUTE`: route parameter names |
| `UNKNOWN REQUEST SOURCES`         | A key other than `query`, `params`, `body`, `formData`, `headers`, `cookies`             | `UNKNOWN`: the keys                        |

When an unknown key is the only one, TypeScript reports instead that the object has no properties in common with `RequestSchemas`.

Mappers are checked too: `.mapInput()` must return the handler's input type, `.mapOutput()` every declared response part.

## Runtime semantics

### Request processing

An endpoint call goes through these steps. A failure at any step skips the rest and goes to [error resolution](#error-resolution).

1. **Read and validate request parts**, in the order `query`, `params`, `body`, `formData`, `headers`, `cookies`. The first failing part fails with [`RequestParsingError`](#requestparsingerror).

    | Part                            | With a schema             | Without a schema                         |
    | ------------------------------- | ------------------------- | ---------------------------------------- |
    | `query`, `headers`, `cookies`   | Validated value           | As the adapter returned it               |
    | `body`, `formData`              | Validated value           | `{}`, the adapter isn't called           |
    | `params`                        | Route parameters, each must be a string, then the schema's value over them | Route parameters only, each must be a string; `{}` when the route has none |

2. **Context.** `config.context` gets the parts from step 1.
3. **`.mapInput()`** gets the parts, plus `context` when configured. Its result is validated with the handler's input schema: [`InputMappingError`](#inputmappingerror) on failure.
4. **Handler** runs with the validated input.
5. **`.mapOutput()`** gets the handler result (without `.output()`, the result becomes `body`). Declared parts are validated: [`ResponseParsingError`](#responseparsingerror) on failure.
6. **Adapter output** gets `{ success: true, statusCode: successStatusCode ?? 200, body, headers, cookies, configuration }`.

Values thrown that aren't `Error` are wrapped as `new Error(JSON.stringify(value))`.

### Error resolution

1. Endpoint mappings (`metadata.errors`) are tried first, then shared ones (`createEndpoint({ errors })`) whose `code` isn't mapped by the endpoint. Within a list, mappings are tried in order. The first one whose `matches` returns `true` wins.
2. A matching mapping gives `statusCode: mapping.status` and the body `{ code, message?, details? }`, see [Response options](#response-options).
3. No match gives `statusCode: 500` and `{ code: INTERNAL_ERROR_CODE }`.
4. The adapter's `output` gets `{ success: false, statusCode, error: body }`.

Put subclasses before their base classes, and `httpError` before an `httpStatus` that matches the same errors.

Errors of `@domain-first/handlers` itself (e.g. the handler result failing its output schema) are resolved the same way: unmapped, they respond `500`.

### Hooks

`Hook` comes from `@domain-first/handlers`: `{ onError?(error), onSuccess?(input, result) }`. Shared hooks (`createEndpoint({ hooks })`) run before adapter hooks (`createEndpoint()(adapter, { hooks })`).

| Event                                         | Hook call                                                     |
| --------------------------------------------- | ------------------------------------------------------------- |
| A step of [request processing](#request-processing) fails | `onError(error)`                                   |
| The handler returns a failure                 | `onError(error)`                                              |
| An error response part can't be built         | `onError(ErrorResponseMappingError)`                          |
| The adapter output is returned                | `onSuccess(adapterArguments, adapterResult)`, also when the response is an error built from a handler failure |

Hook failures are swallowed and don't change the response.

## Upgrading

### From 8.x

- **`errors` replaces `errorStatuses`** in `createEndpoint()` and endpoint metadata. An entry `{ [status]: { checks, toFullModel, openApiTypes } }` becomes `httpStatus(status, { code, match: checks })`, or `httpError(ErrorClass, status)` per error class. `toFullModel` and `openApiTypes` become `message` and `details: { schema, map }`.
- **Error bodies** are `{ code, message?, details? }` instead of `{ name, message, details? }`. `message` and `details` are sent only when the mapping sets them.
- **Unmapped errors** respond `500` with `{ code: INTERNAL_ERROR_CODE }` instead of the error's name, message and details.
- **Removed types:** `ErrorStatuses` (use `ErrorMapping`).

### From 7.x

- **Path parameters**: `:segments` in routes, typed `params` in `.mapInput()` and contracts, `input.pathParams` in adapters (optional) and `pathParams` in `mockAdapter`.
- **`InputMappingError`** replaces the plain `Error` thrown when `.mapInput()` returns an invalid handler input, so it can get its own status.
- **Stricter header and cookie schemas.** Like query, they must produce strings, and fields that produce something else are errors even when optional (`z.number().optional()` used to pass for query). Convert values in `.mapInput()`.
- **Compile-time errors of `.input()`** list the offending keys in `INVALID`; `CURRENT` now shows the schema's output type instead of its input type. Unknown request parts (e.g. a typo like `qury`) are rejected with `UNKNOWN REQUEST SOURCES`.
- **Optional fields are kept in mapper types.** Request and response parts whose type allows `undefined` (e.g. `z.string().optional()` as a whole part) used to disappear from `.mapInput()` arguments and `.mapOutput()` results; now they are there.
- **`EndpointContract`** uses `cookies` instead of `cookie` for request cookies and includes `params`.
- **`ErrorStatuses.openApiTypes`** takes any Standard Schema; **`standardSchemaToJSONSchema`** is typed `(schema: StandardSchemaV1) => StandardJSONSchemaV1` and also converts error schemas.
- **`Metadata`** is generic over the path: `Metadata<Path>`, with `route.path` typed `readonly string[]`.
- **Removed types:** `AdapterRequestSchemas`, `AdapterResponseSchemas` (use `RequestSchemas`, `ResponseSchemas`) and `CheckCompatibility`.
