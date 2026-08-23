import type { StandardJSONSchemaV1 } from '@standard-schema/spec';
import type { JSONSchemas, RawAPISchemas } from '../types';

export const jsonSchemasFromRoute = (
    route: { _api_schemas: RawAPISchemas },
    config: { jsonSchemaObtainer: (x: any) => StandardJSONSchemaV1 }
) =>
    ({
        requestBody:
            'body' in route._api_schemas.requestSchemas
                ? config.jsonSchemaObtainer(
                      route._api_schemas.requestSchemas.body
                  )
                : undefined,
        requestQuery:
            'query' in route._api_schemas.requestSchemas
                ? config.jsonSchemaObtainer(
                      route._api_schemas.requestSchemas.query
                  )
                : undefined,
        requestHeaders:
            'headers' in route._api_schemas.requestSchemas
                ? config.jsonSchemaObtainer(
                      route._api_schemas.requestSchemas.headers
                  )
                : undefined,
        requestFormData:
            'formData' in route._api_schemas.requestSchemas
                ? config.jsonSchemaObtainer(
                      route._api_schemas.requestSchemas.formData
                  )
                : undefined,
        requestCookies:
            'cookies' in route._api_schemas.requestSchemas
                ? config.jsonSchemaObtainer(
                      route._api_schemas.requestSchemas.cookies
                  )
                : undefined,
        responseBody:
            'body' in route._api_schemas.responseSchemas
                ? config.jsonSchemaObtainer(
                      route._api_schemas.responseSchemas.body
                  )
                : undefined,
        responseHeaders:
            'headers' in route._api_schemas.responseSchemas
                ? config.jsonSchemaObtainer(
                      route._api_schemas.responseSchemas.headers
                  )
                : undefined,
        responseCookies:
            'cookies' in route._api_schemas.responseSchemas
                ? config.jsonSchemaObtainer(
                      route._api_schemas.responseSchemas.cookies
                  )
                : undefined
    }) as JSONSchemas;
