import type {
    StandardJSONSchemaV1,
    StandardSchemaV1
} from '@standard-schema/spec';
import type { OpenAPIV3 } from 'openapi-types';

export type StandardSchemaToJSONSchema = (
    schema: StandardSchemaV1
) => StandardJSONSchemaV1;

/**
 * Works for libraries implementing Standard JSON Schema (e.g. Zod 4),
 * others need their own converter.
 */
export const defaultStandardSchemaToJSONSchema: StandardSchemaToJSONSchema = (
    schema
) => schema as unknown as StandardJSONSchemaV1;

export const toOpenAPISchema = (
    schema: StandardJSONSchemaV1,
    direction: 'input' | 'output'
): OpenAPIV3.SchemaObject => {
    const convert = schema['~standard'].jsonSchema?.[direction];

    if (!convert) {
        throw new Error(
            `Schema of "${schema['~standard'].vendor}" does not support Standard JSON Schema, pass "standardSchemaToJSONSchema" to generateOpenAPI`
        );
    }

    return convert({ target: 'openapi-3.0' }) as OpenAPIV3.SchemaObject;
};
