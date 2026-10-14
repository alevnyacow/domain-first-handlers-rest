import type { OpenAPIV3 } from 'openapi-types';

type Direction = 'input' | 'output';

type Schema = Record<string, unknown>;

/**
 * JSON Schema keeps named subschemas in `$defs` (draft 2019-09+) or
 * `definitions` (draft-07, Zod with the `openapi-3.0` target).
 */
const definitionKeys = new Set(['$defs', 'definitions']);

const definitionRef = /^#\/(?:\$defs|definitions)\/(.+)$/;

const componentName = /^[a-zA-Z0-9.\-_]+$/;

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

const isObject = (value: unknown): value is Schema =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const decodePointerToken = (token: string) => {
    const unescaped = token.replaceAll('~1', '/').replaceAll('~0', '~');
    try {
        return decodeURIComponent(unescaped);
    } catch {
        return unescaped;
    }
};

const stableStringify = (value: unknown): string => {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }

    if (isObject(value)) {
        return `{${Object.keys(value)
            .sort()
            .map(
                (key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`
            )
            .join(',')}}`;
    }

    return JSON.stringify(value);
};

type Reference = {
    holder: Schema;
    name: string;
    direction: Direction;
    /** Named schema the reference is inside of. */
    owner?: string;
};

/**
 * Moves named subschemas of converted schemas (`$defs`, `definitions`)
 * to `components.schemas` and points their references there.
 *
 * A name used by requests and responses becomes one component when both
 * describe the same thing, otherwise `<name>Input` and `<name>Output`
 * (e.g. Zod closes objects only for responses).
 */
export const createSchemaComponents = () => {
    const definitions = new Map<string, Partial<Record<Direction, Schema>>>();
    const references: Reference[] = [];

    const rewrite = (
        node: unknown,
        context: { direction: Direction; names: Set<string>; owner?: string }
    ): unknown => {
        if (Array.isArray(node)) {
            return node.map((item) => rewrite(item, context));
        }

        if (!isObject(node)) {
            return node;
        }

        const result: Schema = {};

        for (const [key, value] of Object.entries(node)) {
            if (key === '$ref' && typeof value === 'string') {
                const match = value.match(definitionRef);
                const name = match && decodePointerToken(match[1]!);

                if (name && context.names.has(name)) {
                    references.push({
                        holder: result,
                        name,
                        direction: context.direction,
                        owner: context.owner
                    });
                }

                result[key] = value;
            } else if (dataKeywords.has(key)) {
                result[key] = value;
            } else if (schemaMaps.has(key) && isObject(value)) {
                result[key] = Object.fromEntries(
                    Object.entries(value).map(([name, schema]) => [
                        name,
                        rewrite(schema, context)
                    ])
                );
            } else {
                result[key] = rewrite(value, context);
            }
        }

        return result;
    };

    const hoist = (
        schema: OpenAPIV3.SchemaObject,
        direction: Direction
    ): OpenAPIV3.SchemaObject => {
        const entries = Object.entries(schema);
        const ownDefinitions: Schema = Object.assign(
            {},
            ...entries
                .filter(
                    ([key, value]) => definitionKeys.has(key) && isObject(value)
                )
                .map(([, value]) => value)
        );
        const names = new Set(Object.keys(ownDefinitions));

        for (const [name, definition] of Object.entries(ownDefinitions)) {
            if (!componentName.test(name)) {
                throw new Error(
                    `Schema "${name}" can't be an OpenAPI component name, use letters, digits, ".", "-" and "_"`
                );
            }

            const hoisted = rewrite(definition, {
                direction,
                names,
                owner: name
            }) as Schema;
            const variants = definitions.get(name) ?? {};
            const previous = variants[direction];

            if (
                previous &&
                stableStringify(previous) !== stableStringify(hoisted)
            ) {
                throw new Error(
                    `Schema "${name}" is described differently in several places, give each variant its own name`
                );
            }

            variants[direction] ??= hoisted;
            definitions.set(name, variants);
        }

        return rewrite(
            Object.fromEntries(
                entries.filter(([key]) => !definitionKeys.has(key))
            ),
            { direction, names }
        ) as OpenAPIV3.SchemaObject;
    };

    /**
     * Points references to their components and returns the components.
     * References keep their original targets until then, so variants can be
     * compared with the names they refer to.
     */
    const finalize = (
        existing: OpenAPIV3.ComponentsObject['schemas'] = {}
    ): Record<string, OpenAPIV3.SchemaObject> => {
        const split = new Set(
            [...definitions]
                .filter(
                    ([, { input, output }]) =>
                        input &&
                        output &&
                        stableStringify(input) !== stableStringify(output)
                )
                .map(([name]) => name)
        );

        // Equal variants still differ when they refer to a split name
        for (let changed = true; changed; ) {
            changed = false;
            for (const { owner, name } of references) {
                if (!owner || split.has(owner) || !split.has(name)) {
                    continue;
                }

                const variants = definitions.get(owner);
                if (variants?.input && variants.output) {
                    split.add(owner);
                    changed = true;
                }
            }
        }

        const finalName = (name: string, direction: Direction) =>
            split.has(name)
                ? `${name}${direction === 'input' ? 'Input' : 'Output'}`
                : name;

        const schemas: Record<string, OpenAPIV3.SchemaObject> = {};
        const sources = new Map<string, string>();

        for (const [name, variants] of definitions) {
            for (const direction of ['input', 'output'] as const) {
                const variant = variants[direction];
                const target = finalName(name, direction);
                const source = sources.get(target);

                if (!variant || source === name) {
                    continue;
                }

                if (source !== undefined || target in existing) {
                    throw new Error(
                        `Schema "${target}" is already in components.schemas`
                    );
                }

                sources.set(target, name);
                schemas[target] = variant as OpenAPIV3.SchemaObject;
            }
        }

        for (const { holder, name, direction } of references) {
            holder.$ref = `#/components/schemas/${finalName(name, direction)}`;
        }

        return schemas;
    };

    return { hoist, finalize };
};
