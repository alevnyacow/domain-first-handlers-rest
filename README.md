# Domain First Handlers REST

<p>
    <img src="https://img.shields.io/npm/v/%40domain-first%2Fhandlers-rest" alt="version">
    <img src="https://img.shields.io/badge/TypeScript-ready-3178C6?logo=typescript&logoColor=white?style=for-the-badge" alt="TypeScript ready">
    <img src="https://img.shields.io/badge/semantic--release-angular-e10079?logo=semantic-release" alt="semver">
    <img src="https://img.shields.io/npm/l/%40domain-first%2Fhandlers-rest" alt="license">
</p>

Domain logic without HTTP. HTTP without boilerplate.

## What is it?

In most backends business logic and HTTP grow into each other: handlers read `req.body`, validation is scattered between controllers and services, error responses leak stack traces and internal data, and the OpenAPI document is written by hand and drifts away from the code.

Domain First Handlers REST keeps them apart. Write the logic once as a [`@domain-first/handlers`](https://www.npmjs.com/package/@domain-first/handlers) handler, then describe how HTTP reaches it: which request parts to validate, how they become the handler input, how the result becomes the response, which errors become which statuses. Every mapper is typed, path parameters included, schemas come from any [Standard Schema](https://standardschema.dev) library (Zod, Valibot, ArkType, …), and an OpenAPI 3.0.3 document is generated from the endpoints you actually ship.

```
npm i @domain-first/handlers-rest @domain-first/handlers
```

## API

The full technical specification lives in [API.md](./API.md).

## Guide

### How to create an endpoint

Write the handler, pick an adapter, describe the request.

```ts
import { defineHandler } from "@domain-first/handlers";
import { createEndpoint, mockAdapter } from "@domain-first/handlers-rest";
import z from "zod";

const sum = defineHandler({
    inputSchema: z.object({ a: z.number(), b: z.number() }),
    outputSchema: z.number(),
    handler: async ({ a, b }) => a + b,
});

const endpoint = createEndpoint()(mockAdapter);

const sumPOST = endpoint(sum, { route: { method: "post", path: ["sum"] } })
    .input((schema) => ({ body: schema })) // reuse the handler's schema
    .mapInput(({ body }) => body);

await sumPOST({ body: { a: 10, b: 30 } }); // { success: true, statusCode: 200, body: 40, … }
```

`.input()` takes schemas for `query`, `body`, `formData`, `headers` and `cookies`. Swap `mockAdapter` for a real adapter when you're ready.

### How to expose one handler in different ways

The handler stays untouched, only the mapping changes.

```ts
const sumGET = endpoint(sum, { route: { method: "get", path: ["sum"] } })
    .input(() => ({ query: z.object({ a: z.string(), b: z.string() }) }))
    .mapInput(({ query }) => ({ a: Number(query.a), b: Number(query.b) }))
    .output((schema) => ({ body: z.object({ result: schema }) }))
    .mapOutput((result) => ({ body: { result } }));

await sumGET({ queryParams: { a: "10", b: "30" } }); // body: { result: 40 }
```

Without `.output()`, the handler result is the response body. With it, `.mapOutput()` fills `body`, `headers` and `cookies`; cookie options go in the second argument:

```ts
.output(() => ({ cookies: z.object({ session: z.string() }) }), {
    cookies: { session: { httpOnly: true, maxAge: 3600 } },
})
.mapOutput((user) => ({ cookies: { session: user.token } }));
```

### How to use path parameters

Mark segments with `:`. Names are inferred from the route, so `params` is typed with no schema.

```ts
const getUser = endpoint(findUser, { route: { method: "get", path: ["users", ":userId"] } })
    .input(() => ({}))
    .mapInput(({ params }) => ({ id: Number(params.userId) })); // params: { userId: string }

await getUser({ pathParams: { userId: "42" } });
```

Values are strings: convert them in `.mapInput()`, and the handler's input schema validates the result. Write paths inline or with `as const`, a `string[]` gives no `params`.

### How to catch mistakes at compile time

Query, headers and cookies arrive as strings. A schema that expects something else doesn't compile, and the IDE says why:

```ts
endpoint(sum, { route: { method: "get", path: ["sum"] } })
    .input(() => ({ query: z.object({ a: z.number() }) }))
    .mapInput(/* … */);
// ✗ Property 'mapInput' does not exist on type
//   { ERROR: 'INVALID QUERY PARAMETERS SCHEMA'; INVALID: 'a'; CURRENT: { a: number } }
```

Mappers are checked too: `.mapInput()` must return the handler input, `.mapOutput()` every declared response part.

### How to map errors

Nothing about an error is sent unless a mapping says so. Unmapped errors respond `500` with `{ code: INTERNAL_ERROR_CODE }`.

```ts
import { errorNamespace } from "@domain-first/errors";
import { httpError, httpStatus } from "@domain-first/handlers-rest";

const ProjectNotFound = errorNamespace("PROJECTS").define<{
    projectId: string;
    ownerEmail: string;
}>("NOT_FOUND");

const getProject = endpoint(findProject, {
    route: { method: "get", path: ["projects", ":projectId"] },
    errors: [
        httpError(ProjectNotFound, 404, {
            message: (e) => `Project ${e.details.projectId} not found`,
            details: {
                schema: z.object({ projectId: z.string() }),
                map: (e) => ({ projectId: e.details.projectId }), // ownerEmail stays on the server
            },
        }),
        // any other Error class: matched with instanceof, needs a code
        httpError(StorageUnavailableError, 503, { code: "STORAGE_UNAVAILABLE" }),
        // many errors → one status and code
        httpStatus(409, { code: "CONFLICT", match: [DuplicateName, (e) => e.message === "locked"] }),
    ],
})
    .input(() => ({}))
    .mapInput(({ params }) => ({ id: params.projectId }));
// 404 { code: "PROJECTS.NOT_FOUND", message: "Project p1 not found", details: { projectId: "p1" } }
```

The first matching mapping wins, so put subclasses before their base classes.

### How to answer invalid requests

`invalidRequest()` turns schema failures of the request and of `.mapInput()` into one `400`:

```ts
import { invalidRequest } from "@domain-first/handlers-rest";

createEndpoint({ errors: [invalidRequest()] });
// 400 { code: "@domain-first/handlers-rest.invalid-request",
//       details: { source: "body", issues: [{ message: "Invalid input: expected string, received number", path: ["name"] }] } }
```

The received data is never sent. Status, code, message and details can be changed, `details: false` sends none.

### How to share configuration

Errors, context and hooks set in `createEndpoint()` apply to every endpoint of the factory. Endpoint errors are tried first.

```ts
const appEndpoint = createEndpoint({
    errors: [invalidRequest()],
    context: async () => ({ requestedAt: Date.now() }),
    hooks: [{ onError: (error) => logger.error(error) }],
})(mockAdapter);

appEndpoint(handler, metadata)
    .input(() => ({}))
    .mapInput(({ context }) => ({ since: context.requestedAt }));
```

### How to share types with clients

```ts
import type { EndpointContract } from "@domain-first/handlers-rest";

type UserContract = EndpointContract<typeof getUser>;
// { request: { params: { userId: string } }; response: { body: User } }
```

### How to generate OpenAPI

```ts
import { generateOpenAPI } from "@domain-first/handlers-rest";

generateOpenAPI([sumPOST, sumGET, getUser], {
    document: { info: { title: "Calculator API", version: "1.0.0" } },
    apiRoutePrefix: ["api"], // → /api/sum
    outputFile: { path: "openapi.json" }, // optional
});
```

Parameters, request bodies, success responses and every error mapping are described. `summary`, `description` and `tags` go to endpoint metadata, `openApiMetadata` overrides anything else.

### How to name OpenAPI schemas

Name schemas the way your library does. Named schemas become `components.schemas` and are referenced with `$ref`.

```ts
const Money = z.object({ amount: z.number() }).meta({ id: "Money" }); // Zod
const Money = type({ amount: "number" }).configure({ id: "Money" }); // ArkType

httpError(ProjectNotFound, 404, { schemaName: "ProjectNotFound" }); // error bodies
```

### How to use any validation library

Zod 4 and ArkType work as they are. For a library without [Standard JSON Schema](https://standardschema.dev) (e.g. Valibot), wrap its JSON Schema converter:

```ts
generateOpenAPI(endpoints, {
    document,
    standardSchemaToJSONSchema: (schema) => ({
        "~standard": {
            version: 1,
            vendor: schema["~standard"].vendor,
            jsonSchema: { input: () => toJsonSchema(schema), output: () => toJsonSchema(schema) },
        },
    }),
});
```

### How to connect a framework

Use a ready adapter, such as [`@domain-first/handlers-next`](https://www.npmjs.com/package/@domain-first/handlers-next) for the Next.js App Router, or write one: it reads request parts and writes the response.

```ts
import type { Adapter } from "@domain-first/handlers-rest";
import type { Request, Response } from "express";

const expressAdapter: Adapter<[Request, Response], void> = {
    input: {
        queryParams: (req) => req.query,
        pathParams: (req) => req.params,
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
        res.status(response.statusCode).set(response.headers ?? {}).json(response.body);
    },
};
```

### How to test

`mockAdapter` takes a plain object and returns `{ success, statusCode, body, headers, cookies }`. No server needed.

```ts
const res = await getUser({ pathParams: { userId: "42" }, headers: { authorization: "Bearer token" } });

res.statusCode; // 200
JSON.parse(res.body); // error bodies are JSON strings
```

## License

MIT
