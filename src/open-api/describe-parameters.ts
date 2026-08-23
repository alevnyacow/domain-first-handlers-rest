import type { OpenAPIV3 } from 'openapi-types';

export const describeParameters = (
    schema: any,
    target: 'query' | 'header' | 'cookie'
): OpenAPIV3.ParameterObject[] => {
    if (schema.type !== 'object') {
        throw new Error(`${target} schema must be an object`);
    }

    const properties = schema.properties ?? {};

    if (Object.keys(properties).length > 0) {
        const required = new Set(schema.required ?? []);

        return Object.entries(properties).map(([name, property]) => ({
            name,
            in: target,
            required: required.has(name),
            schema: property as OpenAPIV3.SchemaObject
        }));
    }

    // support of records (like z.record(z.keyof(schema), z.string()))
    if (schema.additionalProperties && schema.required) {
        return schema.required.map((name: string) => ({
            name,
            in: 'query',
            required: true,
            schema: schema.additionalProperties as OpenAPIV3.SchemaObject
        }));
    }

    return [];
};
