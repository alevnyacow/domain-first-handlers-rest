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
 * Path parameters of a route, e.g. `['users', ':userId']` → `{ userId: string }`.
 * Parameters described by `Output` (the output of a `params` schema)
 * take its types, the rest stay `string`.
 */
export type PathParams<Path extends readonly string[], Output = {}> = {
    [Name in PathParamName<Path>]: Name extends keyof Output
        ? Output[Name]
        : string;
};

export const pathParamNames = (path: readonly string[]): string[] =>
    path
        .flatMap((segment) => segment.split('/'))
        .filter((segment) => segment.startsWith(':'))
        .map((segment) => segment.slice(1));

/**
 * Every route parameter must be present as a string;
 * only route parameters are kept, then checked with the schema if any.
 */
export const validatePathParams = async (
    names: string[],
    received: object,
    schema?: StandardSchemaV1
): Promise<StandardSchemaV1.Result<Record<string, unknown>>> => {
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

    const params = Object.fromEntries(
        names.map((name) => [name, values[name] as string])
    );

    if (!schema) {
        return { value: params };
    }

    const result = await schema['~standard'].validate(params);

    if (result.issues) {
        return result;
    }

    // a schema may describe only some parameters, the rest stay as they are
    return { value: { ...params, ...(result.value as object) } };
};
