# Domain First Handlers REST

<p>
    <a href="https://www.npmjs.com/package/@domain-first/handlers-rest">
        <img src="https://img.shields.io/npm/v/%40domain-first%2Fhandlers-rest" alt="npm version">
    </a>
    <img src="https://img.shields.io/badge/TypeScript-ready-3178C6?logo=typescript&amp;logoColor=white" alt="TypeScript ready">
    <a href="./LICENSE"><img src="https://img.shields.io/npm/l/%40domain-first%2Fhandlers-rest" alt="MIT license"></a>
</p>

Your business logic shouldn't know what an HTTP request is. Write it once as a [`@domain-first/handlers`](https://www.npmjs.com/package/@domain-first/handlers) handler, then describe how HTTP reaches it — and get:

- ✅ **Runtime validation** of body, query, path parameters, headers, cookies and form data
- 🧠 **Inferred types** in every mapper — path parameters included, straight from the route
- 🛑 **Compile-time checks** for schemas that can't match HTTP (non-string query, headers, cookies…)
- 🔌 **Any [Standard Schema](https://standardschema.dev) library** — Zod, Valibot, ArkType…
- 📄 **OpenAPI 3.0.3** generated from the endpoints you actually ship
- 🧪 **Tests without a server** via the built-in `mockAdapter`

## Try it in 30 seconds

```sh
npm install @domain-first/handlers-rest @domain-first/handlers zod
```

```ts
import { defineHandler } from "@domain-first/handlers";
import {
    createEndpoint,
    mockAdapter,
} from "@domain-first/handlers-rest";
import z from "zod";

// Pure domain logic — no HTTP in sight.
const sum = defineHandler({
    inputSchema: z.object({ a: z.number(), b: z.number() }),
    outputSchema: z.number(),
    handler: async ({ a, b }) => a + b,
});

const endpoint = createEndpoint()(mockAdapter);

const sumPOST = endpoint(sum, {
    route: { method: "post", path: ["sum"] },
})
    .input((schema) => ({ body: schema })) // reuse the handler's schema
    .mapInput(({ body }) => body);

const res = await sumPOST({ body: { a: 10, b: 30 } });
console.log(res.statusCode, res.body); // 200 40
```

No server, no setup — just run it. Swap `mockAdapter` for a real one when you're ready.

## How an endpoint is built

```ts
endpoint(handler, metadata) // what to run and where
    .input((inputSchema) => schemas) // which request parts to validate
    .mapInput((request) => handlerInput) // HTTP → domain
    .output((outputSchema) => schemas) // optional: response parts to validate
    .mapOutput((result) => response); // optional: domain → HTTP
```

- **Request parts:** `query`, `body`, `formData`, `headers`, `cookies` take schemas; `params` come from the route.
- **Response parts:** `body`, `headers`, `cookies`.
- Without `.output()`, the handler result is returned as `body` and validated with the handler's output schema.
- Mappers may be async.

## Same handler, different contracts

Expose it via query string and wrap the response — the handler stays untouched:

```ts
const sumGET = endpoint(sum, {
    route: { method: "get", path: ["sum"] },
})
    .input(() => ({
        query: z.object({ a: z.string(), b: z.string() }),
    }))
    .mapInput(({ query }) => ({
        a: Number(query.a),
        b: Number(query.b),
    }))
    .output((schema) => ({ body: z.object({ result: schema }) }))
    .mapOutput((result) => ({ body: { result } }));

await sumGET({ queryParams: { a: "10", b: "30" } }); // body: { result: 40 }
```

Response headers and cookies work the same way; cookie options go in the second argument of `.output()`:

```ts
    .output(
        () => ({ cookies: z.object({ session: z.string() }) }),
        { cookies: { session: { httpOnly: true, maxAge: 3600 } } },
    )
    .mapOutput((user) => ({ cookies: { session: user.token } }));
```

## Path parameters

Mark segments with `:`. The route is the only place parameters are declared: their names are inferred from it, so `params` is typed in `.mapInput()` with no schema to write:

```ts
const getUser = endpoint(findUser, {
    route: { method: "get", path: ["users", ":userId"] },
})
    .input(() => ({}))
    .mapInput(({ params }) => ({ id: Number(params.userId) })); // params: { userId: string }

await getUser({ pathParams: { userId: "42" } });
```

- Values are always strings, convert them in `.mapInput()`. The handler's input schema then validates the result: `Number("abc")` fails as an `InputMappingError`, which you can map to `400` (see [errors](#errors-context-hooks)).
- Every route parameter must be present: a missing one fails with `RequestParsingError` (`details.source` is `params`). Only route parameters reach `.mapInput()`.
- Parameter names come from the path **type**, so write the path inline or with `as const`. A path typed as `string[]` gives no `params`.
- Segments with slashes work too: `["users", ":userId", "tabs/:tab"]` → `{ userId: string; tab: string }`.
- In OpenAPI the route becomes `/users/{userId}` with a required `string` path parameter.
- Adapters provide values via `input.pathParams`. If a route uses parameters and the adapter doesn't implement it, creating the endpoint throws.

## Compile-time checks

When request schemas can't work over HTTP, `.input()` returns a description of the problem instead of `.mapInput`, so the code doesn't compile and your IDE shows why:

```ts
endpoint(sum, { route: { method: "get", path: ["sum"] } })
    .input(() => ({ query: z.object({ a: z.number() }) }))
    .mapInput(/* … */);
// ✗ Property 'mapInput' does not exist on type
//   { ERROR: 'INVALID QUERY PARAMETERS SCHEMA'; INVALID: 'a'; CURRENT: { a: number } }
```

| Error                             | When                                                                                                                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID QUERY PARAMETERS SCHEMA` | a `query` schema produces something other than `string` (optional fields are fine: `string \| undefined`)                                                                                                                              |
| `INVALID HEADERS SCHEMA`          | same for `headers`                                                                                                                                                                                                                     |
| `INVALID COOKIES SCHEMA`          | same for `cookies`                                                                                                                                                                                                                     |
| `UNKNOWN REQUEST SOURCES`         | a key other than `query`, `body`, `formData`, `headers`, `cookies` — including `params`, which come from the route. If it's the only key, TypeScript reports instead that the object has no properties in common with `RequestSchemas` |

Mappers are type-checked too: `.mapInput()` must return the handler's input, `.mapOutput()` must return every declared response part.

## Sharing types

```ts
import type { EndpointContract } from "@domain-first/handlers-rest";

type SumContract = EndpointContract<typeof sumPOST>;
// { request: { body: { a: number; b: number } }; response: { body: number } }

type UserContract = EndpointContract<typeof getUser>;
// { request: { params: { userId: string } }; response: { body: User } }
```

The contract contains every declared part: `query`, `params` (from the route), `body`, `formData`, `headers`, `cookies` for requests and `body`, `headers`, `cookies` for responses.

## Errors, context, hooks

Configure once, reuse everywhere:

```ts
import { errorNamespace } from "@domain-first/errors";
import { httpError, invalidRequest } from "@domain-first/handlers-rest";

const appEndpoint = createEndpoint({
    errors: [
        // RequestParsingError and InputMappingError → 400 with issues
        invalidRequest(),
    ],
    context: async (request) => ({ requestedAt: Date.now() }), // available as `context` in .mapInput()
    hooks: [/* Hook API from @domain-first/handlers */],
})(mockAdapter);

const ProjectNotFoundError = errorNamespace("PROJECTS").define<{
    projectId: string;
    ownerEmail: string;
}>("NOT_FOUND");

const getProject = appEndpoint(findProject, {
    route: { method: "get", path: ["projects", ":projectId"] },
    errors: [
        httpError(ProjectNotFoundError, 404, {
            description: "Project not found",
            message: (e) => `Project ${e.details.projectId} not found`,
            details: {
                schema: z.object({ projectId: z.string() }),
                map: (e) => ({ projectId: e.details.projectId }), // ownerEmail stays on the server
            },
        }),
        // any other error class: matched with instanceof, needs a code
        httpError(StorageUnavailableError, 503, { code: "STORAGE_UNAVAILABLE" }),
    ],
})
    .input(() => ({}))
    .mapInput(({ params }) => ({ id: params.projectId }));
```

**Error responses**

Two helpers fill the `errors` list:

- `httpError(ErrorClass, status, options?)` maps one error class to a status. Any class extending `Error` works: its errors and errors of its subclasses are matched with `instanceof`, and `code` is required in options.
- Classes of [`@domain-first/errors`](https://www.npmjs.com/package/@domain-first/errors) need no boilerplate: their own `code` is used (pass `code` to override it) and errors are matched with `ErrorClass.is()`.
- `httpStatus(status, { code, match, ... })` maps many errors to one status and one `code`. `match` lists error classes (matched like in `httpError`) and checks `(error) => boolean`; an error matches when any of them does. Use it when clients don't need to tell these errors apart, otherwise map them with `httpError` one by one.

- `invalidRequest(options?)` is a ready-made `httpStatus` for `RequestParsingError` and `InputMappingError`: `400` with `code` `INVALID_REQUEST_CODE` and `details` `{ source?, issues: [{ message, path? }] }` (`source` is absent for `InputMappingError`, `received` is never sent). Its `details` schema is built in, so it works with any validation library and needs no `standardSchemaToJSONSchema`. In OpenAPI its body is the `InvalidRequestError` component. `status`, `code`, `description`, `schemaName`, `message` and `details` can be overridden, `details: false` sends none.

All of them take the same response options:

- The body is `{ code }`. `message` and `details` are sent only when the mapping sets them, so nothing leaks by accident:
    - `message` is a string or a function of the error (typed in `httpError`, `Error` in `httpStatus`);
    - `details` is a `map` from the error, which picks what is sent, and a `schema` (any Standard Schema), which validates it and describes it in OpenAPI.
- If `message` or `details` can't be built (a mapper throws or `details` fail the schema), the response keeps its status without that part, and hooks get an `ErrorResponseMappingError` in `onError`.
- Errors without a mapping become `500` with `{ code: INTERNAL_ERROR_CODE }` only.
- `errors` can be set per endpoint too; endpoint mappings override shared ones with the same `code`. Mapping one `code` twice in one list throws.
- The first matching mapping wins, endpoint mappings are tried before shared ones: put subclasses before their base classes and `httpError` before an `httpStatus` that matches the same errors.
- In OpenAPI, errors sharing a status are described as `oneOf` alternatives told apart by `code`.
- `schemaName` puts the response body to `components.schemas` under that name, endpoints then refer to it with `$ref` instead of repeating it. Generation throws an error when one name describes different bodies.

**What can fail**

| Error                  | Cause                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RequestParsingError`  | a request part doesn't match its schema, or a route parameter is missing; `details.source` says which (`query`, `params`, `body`, `formData`, `headers`, `cookies`) |
| `ResponseParsingError` | `.mapOutput()` result doesn't match a response schema; `details.source` is `body`, `headers` or `cookies`                                                           |
| `InputMappingError`    | `.mapInput()` result doesn't match the handler's input schema (e.g. `Number("abc")` from a path parameter); `details` has `issues` and `received`                   |
| your domain errors     | thrown by the handler                                                                                                                                               |

All of them are turned into error responses through the adapter instead of being thrown. Their `details` (including `received` request data) are sent only through a `details` mapping; `invalidRequest()` sends `issues` without `received`.

**Context** receives the parsed request (`query`, `params`, `body`, `formData`, `headers`, `cookies`): parts with schemas after validation, `params` with route parameters only, `query`, `headers`, `cookies` without schemas as the adapter returned them, `body` and `formData` without schemas as `{}`. Its result is passed to `.mapInput()` as `context`. Without a `context` factory, there is no `context` field.

**Hooks** go in `createEndpoint({ hooks })` for every adapter, or in the second argument for one adapter: `createEndpoint()(adapter, { hooks })`. Shared hooks run first.

## OpenAPI from the same code

```ts
import { generateOpenAPI } from "@domain-first/handlers-rest";

generateOpenAPI([sumPOST, sumGET, getUser], {
    document: {
        info: { title: "Calculator API", version: "1.0.0" },
    },
    apiRoutePrefix: ["api"], // → /api/sum
    outputFile: { path: "openapi.json" }, // optional, `format` customizes the content
});
```

- Covers query, path, header and cookie parameters, JSON request bodies, success responses and every `errors` mapping.
- Add `summary`, `description`, `tags`, `successResponseDescription` to endpoint metadata, or override anything with `openApiMetadata`. Tags default to the first path segment.
- Endpoints sharing a path are merged under it.

**Shared schemas.** Named subschemas go to `components.schemas` and are referenced from every place they're used. Name them the way your library does, e.g. Zod's `.meta({ id })` or ArkType's `.configure({ id })`:

```ts
const Money = z
    .object({ amount: z.number(), currency: z.string() })
    .meta({ id: "Money" });
// → components.schemas.Money, used as { $ref: "#/components/schemas/Money" }

const Money = type({ amount: "number", currency: "string" }).configure({ id: "Money" });
// the same with ArkType
```

- Works for any library: whatever a schema's JSON Schema keeps in `$defs` or `definitions`, and every schema with an `id` keyword, becomes a component.
- A name used by requests and responses stays one component when both describe the same thing, otherwise it becomes `MoneyInput` and `MoneyOutput` (Zod, for one, closes objects with `additionalProperties: false` only in responses).
- Components from `document.components.schemas` are kept. Generation throws an error when one name describes different schemas, when it's already taken in the document, or when it has characters OpenAPI doesn't allow (only letters, digits, `.`, `-`, `_`).
- The schema of a request or response part itself becomes a component when its JSON Schema has an `id` (ArkType does this; Zod ignores `id` of the part itself, so it stays inline). Query, header and cookie schemas always stay inline: they're described as separate parameters.

**Schemas from any library.** Every schema goes through `standardSchemaToJSONSchema` before it reaches the document, except built-in ones (`invalidRequest()` details). It must return a [Standard JSON Schema](https://standardschema.dev) — an object with `~standard.jsonSchema.input()` and `.output()`. By default the schema is used as is, which is enough for libraries implementing Standard JSON Schema (Zod 4, ArkType). Libraries without the `openapi-3.0` target (ArkType) are asked for draft-07, which is rewritten to OpenAPI 3.0: `const` becomes `enum`, the `null` type becomes `nullable`, numeric `exclusiveMinimum`/`exclusiveMaximum` become boolean, tuples become arrays of any of their items. For libraries without Standard JSON Schema (e.g. Valibot), pass a converter — otherwise generation throws an error naming the library. A plain JSON Schema converter just needs wrapping:

```ts
generateOpenAPI(endpoints, {
    document,
    standardSchemaToJSONSchema: (schema) => ({
        "~standard": {
            version: 1,
            vendor: schema["~standard"].vendor,
            jsonSchema: {
                input: () => toJsonSchema(schema), // your library's JSON Schema converter
                output: () => toJsonSchema(schema),
            },
        },
    }),
});
```

## Adapters

| Adapter                                                                                    | For                   |
| ------------------------------------------------------------------------------------------ | --------------------- |
| [`@domain-first/handlers-next`](https://www.npmjs.com/package/@domain-first/handlers-next) | Next.js App Router    |
| `mockAdapter` (built in)                                                                   | Tests and playgrounds |
| Your own `Adapter<Request, Response>`                                                      | Any other framework   |

An adapter reads request parts and writes the response:

```ts
import type { Adapter } from "@domain-first/handlers-rest";
import type { Request, Response } from "express";

const expressAdapter: Adapter<[Request, Response], void> = {
    input: {
        queryParams: (req) => req.query,
        pathParams: (req) => req.params, // optional unless routes use `:params`
        body: (req) => req.body,
        formData: (req) => req.body,
        headers: (req) => req.headers,
        cookies: (req) => req.cookies,
    },
    output: (response, req, res) => {
        if (!response.success) {
            res.status(response.statusCode).json(response.error);
            return;
        }
        // response: { statusCode, body, headers, cookies, configuration: { cookies } }
        res.status(response.statusCode)
            .set(response.headers ?? {})
            .json(response.body);
    },
};
```

`body` and `formData` are read only when the endpoint declares a schema for them; `pathParams` only when the route has parameters.

## Testing

`mockAdapter` takes a plain object and returns `{ success, statusCode, body, headers, cookies }` (error bodies are JSON strings):

```ts
await getUser({
    queryParams: { expand: "posts" },
    pathParams: { userId: "42" },
    body: {},
    formData: {},
    headers: { authorization: "Bearer token" },
    cookies: { session: "abc" },
});
```

## Upgrading from 8.x

- **`errors` replaces `errorStatuses`** in `createEndpoint()` and endpoint metadata. An entry `{ [status]: { checks, toFullModel, openApiTypes } }` becomes `httpStatus(status, { code, match: checks })`, or `httpError(ErrorClass, status)` per error class. `toFullModel` and `openApiTypes` become `message` and `details: { schema, map }`.
- **Error bodies** are `{ code, message?, details? }` instead of `{ name, message, details? }`. `message` and `details` are sent only when the mapping sets them.
- **Unmapped errors** respond `500` with `{ code: INTERNAL_ERROR_CODE }` instead of the error's name, message and details.
- **Removed types:** `ErrorStatuses` (use `ErrorMapping`).

## Upgrading from 7.x

- **Path parameters** — `:segments` in routes, typed `params` in `.mapInput()` and contracts, `input.pathParams` in adapters (optional) and `pathParams` in `mockAdapter`.
- **`InputMappingError`** replaces the plain `Error` thrown when `.mapInput()` returns an invalid handler input, so it can get its own status.
- **Stricter header and cookie schemas.** Like query, they must produce strings, and fields that produce something else are errors even when optional (`z.number().optional()` used to pass for query). Convert values in `.mapInput()`.
- **Compile-time errors of `.input()`** list the offending keys in `INVALID`; `CURRENT` now shows the schema's output type instead of its input type. Unknown request parts (e.g. a typo like `qury`) are rejected with `UNKNOWN REQUEST SOURCES`.
- **Optional fields are kept in mapper types.** Request and response parts whose type allows `undefined` (e.g. `z.string().optional()` as a whole part) used to disappear from `.mapInput()` arguments and `.mapOutput()` results; now they are there.
- **`EndpointContract`** uses `cookies` instead of `cookie` for request cookies and includes `params`.
- **`ErrorStatuses.openApiTypes`** takes any Standard Schema; **`standardSchemaToJSONSchema`** is typed `(schema: StandardSchemaV1) => StandardJSONSchemaV1` and also converts error schemas.
- **`Metadata`** is generic over the path: `Metadata<Path>`, with `route.path` typed `readonly string[]`.
- **Removed types:** `AdapterRequestSchemas`, `AdapterResponseSchemas` (use `RequestSchemas`, `ResponseSchemas`) and `CheckCompatibility`.

## Good to know

- `successStatusCode` in metadata changes the default `200`.
- OpenAPI doesn't yet cover form-data bodies or response headers/cookies.
- Requires `@domain-first/handlers` **^5.0.2**. Ships ESM + CJS with types.

## License

[MIT](./LICENSE)
