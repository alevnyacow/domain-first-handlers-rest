import type {
    StandardJSONSchemaV1,
    StandardSchemaV1
} from '@standard-schema/spec';
import type { OpenAPIV3 } from 'openapi-types';
import { draft07ToOpenAPI } from './draft-07-to-openapi';

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

/**
 * Libraries without the `openapi-3.0` target (e.g. ArkType) are asked
 * for draft-07, which is then rewritten to OpenAPI 3.0.
 */
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

    try {
        return convert({ target: 'openapi-3.0' }) as OpenAPIV3.SchemaObject;
    } catch (openAPIError) {
        try {
            const { $schema, ...draft07 } = convert({ target: 'draft-07' });
            return draft07ToOpenAPI(draft07) as OpenAPIV3.SchemaObject;
        } catch {
            // the schema can't be converted at all, not just to OpenAPI
            throw openAPIError;
        }
    }
};
