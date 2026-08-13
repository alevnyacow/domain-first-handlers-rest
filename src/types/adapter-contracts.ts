import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * Describes behavior of REST endpoint adapter.
 */
export type Adapter<RESTInput extends unknown[], RESTOutput> = {
    /**
     * Request obtaining.
     */
    input: {
        /**
         * Query parameters obtaining.
         */
        queryParams: (...input: RESTInput) => object | Promise<object>;
        /**
         * Body obtaining.
         */
        body: (...input: RESTInput) => object | Promise<object>;
        /**
         * Headers obtatining.
         */
        headers: (...input: RESTInput) => object | Promise<object>;
        /**
         * Form data obtaining.
         */
        formData: (...input: RESTInput) => object | Promise<object>;
        /**
         * Cookies obtaining.
         */
        cookies: (...input: RESTInput) => object | Promise<object>;
    };

    output: (
        responseData:
            | {
                  success: true;
                  body:
                      | object
                      | Array<any>
                      | string
                      | number
                      | boolean
                      | Date
                      | undefined;
                  headers: object | undefined;
                  cookies: object | undefined;
              }
            | { success: false; error: Error },
        ...input: RESTInput
    ) => RESTOutput | Promise<RESTOutput>;
};

export type AdapterRequestSchemas<
    InputSchema extends StandardSchemaV1,
    QuerySchema extends StandardSchemaV1 | undefined,
    BodySchema extends StandardSchemaV1 | undefined,
    FormDataSchema extends StandardSchemaV1 | undefined,
    HeadersSchema extends StandardSchemaV1 | undefined,
    CookiesSchema extends StandardSchemaV1 | undefined
> = (
    inputSchema: InputSchema
) => (QuerySchema extends undefined ? {} : { query: QuerySchema }) &
    (BodySchema extends undefined ? {} : { body: BodySchema }) &
    (FormDataSchema extends undefined ? {} : { formData: FormDataSchema }) &
    (CookiesSchema extends undefined ? {} : { cookies: CookiesSchema }) &
    (HeadersSchema extends undefined ? {} : { headers: HeadersSchema });

export type AdapterResponseSchemas<
    OutputSchema extends StandardSchemaV1,
    Body extends StandardSchemaV1 | undefined,
    Headers extends StandardSchemaV1 | undefined,
    Cookies extends StandardSchemaV1 | undefined
> = (
    outputSchema: OutputSchema
) => (Body extends undefined ? {} : { body: Body }) &
    (Headers extends undefined ? {} : { headers: Headers }) &
    (Cookies extends undefined ? {} : { cookies: Cookies });
