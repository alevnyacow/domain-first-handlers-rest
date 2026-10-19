type Schema = Record<string, unknown>;

/** Keys of these keywords are names, every value is a schema. */
const schemaMaps = new Set([
    'properties',
    'patternProperties',
    '$defs',
    'definitions'
]);

/** Values of these keywords are data, not schemas. */
const dataKeywords = new Set([
    'const',
    'default',
    'enum',
    'example',
    'examples'
]);

const exclusiveBounds = [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum']
] as const;

const isObject = (value: unknown): value is Schema =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const isNullSchema = (schema: unknown) =>
    isObject(schema) &&
    schema.type === 'null' &&
    Object.keys(schema).length === 1;

/**
 * OpenAPI 3.0 has no `null` type, nullable schemas are marked instead.
 */
const withoutNullBranches = (schema: Schema): Schema => {
    for (const key of ['anyOf', 'oneOf'] as const) {
        const branches = schema[key];

        if (!Array.isArray(branches) || !branches.some(isNullSchema)) {
            continue;
        }

        const nullable = branches
            .filter((branch) => !isNullSchema(branch))
            .map((branch) => ({ ...branch, nullable: true }));
        const { [key]: _, ...rest } = schema;

        return nullable.length === 1
            ? { ...rest, ...nullable[0] }
            : { ...rest, [key]: nullable };
    }

    return schema;
};

const withoutTypeArrays = (schema: Schema): Schema => {
    if (!Array.isArray(schema.type)) {
        return schema;
    }

    const { type, ...rest } = schema;
    const types = type.filter((name) => name !== 'null');
    const nullable = types.length < type.length && { nullable: true };

    if (types.length === 1) {
        return { ...rest, type: types[0], ...nullable };
    }

    return {
        ...rest,
        anyOf: types.map((name) => ({ type: name, ...nullable }))
    };
};

/**
 * Tuples become arrays of any of their items, lengths keep their size.
 */
const withoutTupleItems = (schema: Schema): Schema => {
    if (!Array.isArray(schema.items)) {
        return schema;
    }

    const { items, additionalItems, ...rest } = schema;
    const variants = isObject(additionalItems)
        ? [...items, additionalItems]
        : items;

    return {
        ...rest,
        items:
            additionalItems === undefined || additionalItems === true
                ? {}
                : variants.length === 1
                  ? variants[0]
                  : { anyOf: variants },
        ...(additionalItems === false &&
            rest.maxItems === undefined && { maxItems: items.length })
    };
};

const downlevel = (schema: Schema): Schema => {
    const result = { ...schema };

    if ('const' in result) {
        result.enum = [result.const];
        delete result.const;
    }

    for (const [exclusive, bound] of exclusiveBounds) {
        if (typeof result[exclusive] === 'number') {
            result[bound] = result[exclusive];
            result[exclusive] = true;
        }
    }

    return withoutTupleItems(withoutTypeArrays(withoutNullBranches(result)));
};

/**
 * Rewrites draft-07 keywords OpenAPI 3.0 describes differently:
 * `const`, numeric exclusive bounds, the `null` type and tuples.
 */
export const draft07ToOpenAPI = (node: unknown): unknown => {
    if (Array.isArray(node)) {
        return node.map(draft07ToOpenAPI);
    }

    if (!isObject(node)) {
        return node;
    }

    const result: Schema = {};

    for (const [key, value] of Object.entries(node)) {
        if (dataKeywords.has(key)) {
            result[key] = value;
        } else if (schemaMaps.has(key) && isObject(value)) {
            result[key] = Object.fromEntries(
                Object.entries(value).map(([name, schema]) => [
                    name,
                    draft07ToOpenAPI(schema)
                ])
            );
        } else {
            result[key] = draft07ToOpenAPI(value);
        }
    }

    return downlevel(result);
};
