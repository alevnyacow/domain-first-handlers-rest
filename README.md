<p align="center">
    <picture>
        <img src='https://raw.githubusercontent.com/alevnyacow/domain-first-handlers-rest/refs/heads/main/logo.svg?sanitize=true'>
    </picture>
</p>

<p align="center">
    Expose domain operations through REST without coupling your domain to HTTP.
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

The API is intentionally small and fluent: describe transport → map to domain → describe response → map back. Describing a response is an optional step - by default all response go to the body, so the happy path stays minimal. Everything is strongly-typed. TypeScript checks the contract at compile time.

# Adapters

- [Adapter + App router endpoints for Next.js](https://www.npmjs.com/package/@domain-first/handlers-next)
- [Mock Adapter](https://www.npmjs.com/package/@domain-first/handlers-mock-rest-adapter)

# Examples

## Quick Start

```ts
import { createEndpoint } from "@domain-first/handlers-rest";
import { defineHandler } from "@domain-first/handlers";
/**
 * Any adapter can be used.
 */
import nextAdapter from "./adapters/next";
/**
 * Any Standard Schema compatible library fits.
 */
import z from "zod";

const sum = defineHandler({
    inputSchema: z.object({
        a: z.number(),
        b: z.number(),
    }),
    outputSchema: z.number(),
    handler: async ({ a, b }) => a + b,
});

const endpoint = createEndpoint();
const nextEndpoint = endpoint(nextAdapter);

const sumPOST = nextEndpoint(sum, {
    route: { method: "post", path: ["sum"] },
})
    /**
     * Describe input schemas.
     */
    .input((schema) => {
        return {
            body: schema,
        };
    })
    /**
     * Describe input mapping.
     */
    .mapInput((input) => ({
        a: input.body.a,
        b: input.body.b,
    }));

export const POST = sumPOST;

/**
 * POST /sum
 *
 * REQUEST BODY: { a: 10, b: 30 }
 * RESPONSE BODY: 40
 */
```

## Endpoint contracts

To obtain an endpoint contract, use `EndpointContract` generic:

```ts
import type { EndpointContract } from "@domain-first/handlers-rest";

type SumPOSTContract = EndpointContract<typeof sumPOST>;

/**
type SumPOSTContract = {
    request: {
        body: { a: number; b: number; };
    };
    response: {
        body: number;
    };
}
 */
```

## Context and error handling

```ts
import {
    type RawRequestModel,
    createEndpoint,
} from "@domain-first/handlers-rest";
import { defineHandler } from "@domain-first/handlers";
import z from "zod";
import adapter from "./adapter";

class UnauthorizedAccessError extends Error {}

/**
 * Context logic.
 */
const authContext = async (rawRequest: RawRequestModel) => {
    const bearerHeader = rawRequest.headers?.Authorization ?? "";

    if (!bearerHeader) {
        throw new UnauthorizedAccessError();
    }

    const token = bearerHeader.split(" ").pop();

    // some decoding logic
    const { userId } = await decodeToken(token);

    return { userId };
};

/**
 * Adding context in endpoint generator.
 */
const endpointWithAuth = createEndpoint({
    context: async (rawRequest) => {
        const auth = await authContext(rawRequest);

        return { auth };
    },
    errorStatuses: {
        401: {
            checks: [(x) => x instanceof UnauthorizedAccessError],
            description: "User is not logged in",
        },
    },
});

const nextEndpointWithAuth = endpointWithAuth(nextAdapter);

const greetUser = defineHandler({
    input: z.object({ authorId: z.string(), name: z.string() }),
    output: z.string(),
    handler: async ({ authorId, name }) => {
        return `Hello, ${name}! (from ${authorId})`;
    },
});

const greetUserEndpoint = nextEndpointWithAuth(greetUser, {
    route: { method: "get", path: ["users", "greet"] },
})
    .input((inputSchema) => ({
        query: inputSchema.pick({ name: true }),
    }))
    .mapInput((input) => {
        return {
            name: input.query.name,
            // strongly-typed
            authorId: input.context.auth.userId,
        };
    });
```

## Defining custom output

```ts
const sumPATCH = nextEndpoint(sum, {
    route: { method: "patch", path: ["sum"] },
})
    .input((schema) => ({
        body: schema,
    }))
    .mapInput((input) => ({
        a: input.body.a,
        b: input.body.b,
    }))
    .output((schema) => ({
        body: z.object({
            result: schema,
        }),
    }))
    .mapOutput((output) => ({
        body: { result: output },
    }));

export const PATCH = sumPATCH;
```

## OpenAPI generation

```ts
import { generateOpenAPI } from "@domain-first/handlers-rest";

const endpoints = [sumPOST, greetUserEndpoint, sumPATCH];

const openAPI = async () => {
    const openAPIDocument = generateOpenAPI(endpoints, {
        document: {
            info: { title: "Test API", version: "1.0.0" },
        },
        outputFile: { path: "openapi.json" },
        /**
         * If your Standard Schemas are not Standard JSON Schemas
         * out of the box, you can pass optional mapper in
         * `standardSchemaToJSONSchema` field
         */
    });
};
```
