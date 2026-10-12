import type { StandardSchemaV1 } from '@standard-schema/spec';

type SegmentParamName<Segment extends string> =
    Segment extends `${infer Head}/${infer Rest}`
        ? SegmentParamName<Head> | SegmentParamName<Rest>
        : Segment extends `:${infer Name}`
          ? Name
          : never;

/**
 * Names of path parameters declared in a route,
 * e.g. `['users', ':userId']` → `'userId'`.
 */
export type PathParamName<Path extends readonly string[]> = SegmentParamName<
    Path[number]
>;

/**
 * Raw path parameters of a route, e.g. `['users', ':userId']` → `{ userId: string }`.
 */
export type PathParams<Path extends readonly string[]> = {
    [Name in PathParamName<Path>]: string;
};

export const pathParamNames = (path: readonly string[]): string[] =>
    path
        .flatMap((segment) => segment.split('/'))
        .filter((segment) => segment.startsWith(':'))
        .map((segment) => segment.slice(1));

/**
 * Every route parameter must be present as a string;
 * only route parameters are kept.
 */
export const validatePathParams = (
    names: string[],
    received: object
): StandardSchemaV1.Result<Record<string, string>> => {
    const values = received as Record<string, unknown>;
    const issues = names
        .filter((name) => typeof values[name] !== 'string')
        .map((name) => ({
            message: `Path parameter "${name}" is missing`,
            path: [name]
        }));

    if (issues.length > 0) {
        return { issues };
    }

    return {
        value: Object.fromEntries(
            names.map((name) => [name, values[name] as string])
        )
    };
};
