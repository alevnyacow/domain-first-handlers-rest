<p align="center">
    <img src="https://raw.githubusercontent.com/alevnyacow/domain-first-handlers-rest/refs/heads/main/logo.svg?sanitize=true" alt="Domain First Handlers REST">
</p>

<h1 align="center">Your domain logic. A typed REST boundary.</h1>

<p align="center">
    One handler → any number of validated, fully typed REST endpoints → OpenAPI for free.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@domain-first/handlers-rest"><img src="https://img.shields.io/npm/v/%40domain-first%2Fhandlers-rest" alt="npm version"></a>
    <img src="https://img.shields.io/badge/TypeScript-ready-3178C6?logo=typescript&amp;logoColor=white" alt="TypeScript ready">
    <a href="./LICENSE"><img src="https://img.shields.io/npm/l/%40domain-first%2Fhandlers-rest" alt="MIT license"></a>
</p>

Your business logic shouldn't know what an HTTP request is. Write it once as a [`@domain-first/handlers`](https://www.npmjs.com/package/@domain-first/handlers) handler, then describe how HTTP reaches it — and get:

- ✅ **Runtime validation** of body, query, headers, cookies and form data
- 🧠 **Inferred types** in every mapper — no hand-written request/response interfaces
- 📄 **OpenAPI 3.0.3** generated from the endpoints you actually ship
- 🧪 **Tests without a server** via the built-in `mockAdapter`

## Try it in 30 seconds

```sh
npm install @domain-first/handlers-rest @domain-first/handlers zod
```

```ts
import { defineHandler } from "@domain-first/handlers";
import { createEndpoint, mockAdapter } from "@domain-first/handlers-rest";
import z from "zod";

// Pure domain logic — no HTTP in sight.
const sum = defineHandler({
    inputSchema: z.object({ a: z.number(), b: z.number() }),
    outputSchema: z.number(),
    handler: async ({ a, b }) => a + b,
});

const endpoint = createEndpoint()(mockAdapter);

const sumPOST = endpoint(sum, { route: { method: "post", path: ["sum"] } })
    .input((schema) => ({ body: schema })) // reuse the handler's schema
    .mapInput(({ body }) => body);

const res = await sumPOST({ body: { a: 10, b: 30 } });
console.log(res.statusCode, res.body); // 200 40
```

No server, no setup — just run it. Swap `mockAdapter` for a real one when you're ready.

## Same handler, different contracts

Expose it via query string and wrap the response — the handler stays untouched:

```ts
const sumGET = endpoint(sum, { route: { method: "get", path: ["sum"] } })
    .input(() => ({
        query: z.object({ a: z.string(), b: z.string() }),
    }))
    .mapInput(({ query }) => ({ a: Number(query.a), b: Number(query.b) }))
    .output((schema) => ({ body: z.object({ result: schema }) }))
    .mapOutput((result) => ({ body: { result } }));

await sumGET({ queryParams: { a: "10", b: "30" } }); // body: { result: 40 }
```

Need the types elsewhere (e.g. on the client)?

```ts
import type { EndpointContract } from "@domain-first/handlers-rest";

type SumContract = EndpointContract<typeof sumPOST>;
// { request: { body: { a: number; b: number } }; response: { body: number } }
```

## Errors, context, hooks

Configure once, reuse everywhere:

```ts
import { RequestParsingError } from "@domain-first/handlers-rest";

const appEndpoint = createEndpoint({
    errorStatuses: {
        400: { checks: [(e) => e instanceof RequestParsingError], description: "Invalid request" },
    },
    context: async () => ({ requestedAt: Date.now() }), // available as `context` in .mapInput()
    hooks: [/* Hook API from @domain-first/handlers */],
})(mockAdapter);
```

Unmatched errors become `500`. `errorStatuses` can also be set per endpoint; adapter-specific hooks go in the second argument: `createEndpoint()(adapter, { hooks })`.

## OpenAPI from the same code

```ts
import { generateOpenAPI } from "@domain-first/handlers-rest";

generateOpenAPI([sumPOST, sumGET], {
    document: { info: { title: "Calculator API", version: "1.0.0" } },
    apiRoutePrefix: ["", "api"], // → /api/sum
    outputFile: { path: "openapi.json" },
});
```

Add `summary`, `description`, `tags` to endpoint metadata, or override anything with `openApiMetadata`. Schemas need Standard JSON Schema support (Zod 4 has it) — otherwise pass `standardSchemaToJSONSchema`.

## Adapters

| Adapter | For |
| --- | --- |
| [`@domain-first/handlers-next`](https://www.npmjs.com/package/@domain-first/handlers-next) | Next.js App Router |
| `mockAdapter` (built in) | Tests and playgrounds |
| Your own `Adapter<Request, Response>` | Any other framework — implement input readers and one output function |

## Good to know

- Request fields: `body`, `query`, `formData`, `headers`, `cookies`. Response fields: `body`, `headers`, `cookies`.
- Query schemas must produce strings — convert in `.mapInput()`.
- `successStatusCode` in metadata changes the default `200`.
- OpenAPI doesn't yet cover form-data bodies or response headers/cookies.
- Requires `@domain-first/handlers` **^5.0.2**. Ships ESM + CJS with types.

## License

[MIT](./LICENSE)
