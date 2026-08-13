# Installation

```bash
npm i @domain-first/handlers # to make handlers
npm i @domain-first/handlers-rest # to make REST endpoints
```

# About

Call your domain handlers via REST with fully type-safe request and response contracts.

The API is intentionally small and fluent: describe transport → map to domain → describe response → map back. When the transport schema already matches the domain schema, unnecessary steps become optional — the happy path stays minimal. TypeScript checks the contract at compile time.

# Examples

```ts
import { createEndpoint } from "@domain-first/handlers-rest";
/**
 * takes two numbers as { a: number, b: number }, returns a number
 */
import { sumHandler } from "./handlers/sum";
import nextAdapter from "./adapters/next";

const createNextEndpoint = createEndpoint(nextAdapter);

const sumNextPOSTEndpoint = createNextEndpoint(
    sumHandler,
).withRequestSchemas((inputSchema) => {
    return {
        body: inputSchema,
    };
});

export const POST = sumNextPOSTEndpoint;

/**
 * /sum
 *
 * REQUEST BODY: { a: 10, b: 30 }
 * RESPONSE BODY: 40
 */
```

For custom transport representations, add only what you need:

```ts
// any standard schema compatible library fits
import z from "zod";

const sumNextGETEndpoint = createNextEndpoint(sumHandler)
    .withRequestSchemas((x) => ({
        query: z.object({
            firstNumber: z.string(),
            secondNumber: z.string(),
        }),
    }))
    .mapped((input) => ({
        a: +input.firstNumber,
        b: +input.secondNumber,
    }));

export const GET = sumNextGETEndpoint;
/**
 * /sum?firstNumber=15&secondNumber=40
 *
 * RESPONSE BODY: 55
 */
```

Simple cases stay simple. Complex cases stay type-safe. You can also modify response:

```ts
const sumNextGETEWithModifiedBodyEndpoint = createNextEndpoint(
    sumHandler,
)
    .withRequestSchemas((inputSchema) => ({
        query: z.record(z.keyof(inputSchema), z.string()),
    }))
    .mapped((input) => ({
        a: +input.a,
        b: +input.b,
    }))
    .withResponseSchemas((outputSchema) =>
        z.object({
            sum: outputSchema,
        }),
    )
    .mapped({
        outputToBody: (x) => ({ sum: x }),
    });

export const GET = sumNextGETEWithModifiedBodyEndpoint;
/**
 * /sum?a=100&b=400
 *
 * RESPONSE BODY: { sum: 500 }
 */
```
