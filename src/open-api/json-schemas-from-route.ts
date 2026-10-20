import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { JSONSchemas, RawAPISchemas } from '../types';
import type { StandardSchemaToJSONSchema } from './to-openapi-schema';

export const jsonSchemasFromRoute = (
    route: { _api_schemas: RawAPISchemas },
    config: { jsonSchemaObtainer: StandardSchemaToJSONSchema }
): JSONSchemas => {
    const { requestSchemas, responseSchemas } = route._api_schemas;
    const convert = (schema: StandardSchemaV1 | undefined) =>
        schema ? config.jsonSchemaObtainer(schema) : undefined;

    return {
        requestBody: convert(requestSchemas.body),
        requestQuery: convert(requestSchemas.query),
        requestParams: convert(requestSchemas.params),
        requestHeaders: convert(requestSchemas.headers),
        requestFormData: convert(requestSchemas.formData),
        requestCookies: convert(requestSchemas.cookies),
        responseBody: convert(responseSchemas.body),
        responseHeaders: convert(responseSchemas.headers),
        responseCookies: convert(responseSchemas.cookies)
    };
};
