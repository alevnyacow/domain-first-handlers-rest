<p align="center">
    <picture>
        <img src='https://raw.githubusercontent.com/alevnyacow/domain-first-handlers-rest/refs/heads/main/logo.svg?sanitize=true'>
    </picture>
</p>

<p align="center">
    Expose your Domain-First Handlers as REST endpoints.
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/%40domain-first%2Fhandlers-rest" alt="version">
  <img src="https://img.shields.io/badge/TypeScript-ready-3178C6?logo=typescript&logoColor=white?style=for-the-badge" alt="size">
  <img src="https://img.shields.io/badge/semantic--release-angular-e10079?logo=semantic-release" alt="semver">
  <img src="https://img.shields.io/npm/l/%40domain-first%2Fhandlers-rest" alt="license">
</p>

# Requirements

- [@domain-first/handlers](https://www.npmjs.com/package/@domain-first/handlers) (^4.0.0)

# About

The API is intentionally small and fluent: describe transport → map to domain → describe response → map back. When the transport schema already matches the domain schema, mapping steps can be omitted, so the happy path stays minimal. TypeScript checks the contract at compile time.

# Adapters

- [Mock Adapter](https://www.npmjs.com/package/@domain-first/handlers-mock-rest-adapter)

# Examples

## Quick Start

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
 * POST /sum
 *
 * REQUEST BODY: { a: 10, b: 30 }
 * RESPONSE BODY: 40
 */
```

If schemas don't match, describe mappers via `mapped` field:

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
 * GET /sum?firstNumber=15&secondNumber=40
 *
 * RESPONSE BODY: 55
 */
```

You can also modify response:

```ts
const sumNextGETWithModifiedBodyEndpoint = createNextEndpoint(
    sumHandler,
)
    .withRequestSchemas((inputSchema) => ({
        query: z.record(z.keyof(inputSchema), z.string()),
    }))
    .mapped((input) => ({
        a: +input.a,
        b: +input.b,
    }))
    .withResponseSchemas((outputSchema) => ({
        body: z.object({
            sum: outputSchema,
        }),
    }))
    .mapped({
        outputToBody: (x) => ({ sum: x }),
    });

export const GET = sumNextGETWithModifiedBodyEndpoint;
/**
 * GET /sum?a=100&b=400
 *
 * RESPONSE BODY: { sum: 500 }
 */
```

## Endpoint contracts

To obtain an endpoint contract, use `EndpointContract` generic:

```ts
import type { EndpointContract } from "@domain-first/handlers-rest";

type SumGETWithModifiedBodyContract = EndpointContract<
    typeof sumNextGETWithModifiedBodyEndpoint
>;

/**
type SumGETWithModifiedBodyContract = {
    request: {
        query: Record<"a" | "b", string>;
    };
    response: {
        body: {
            sum: number;
        };
    };
}
 */
```
