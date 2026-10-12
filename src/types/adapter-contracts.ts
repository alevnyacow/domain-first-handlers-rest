import type { StandardSchemaV1 } from '@standard-schema/spec';

export type CookiesConfiguration = Record<
    string,
    { httpOnly: boolean; maxAge: number }
>;

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
         * Path parameters obtaining. Required for routes with
         * parameter segments (e.g. `':id'`).
         */
        pathParams?: (...input: RESTInput) => object | Promise<object>;
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
                  statusCode: number;
                  configuration?: Partial<{ cookies: CookiesConfiguration }>;
              }
            | { success: false; error: unknown; statusCode: number },
        ...input: RESTInput
    ) => RESTOutput | Promise<RESTOutput>;
};

export type RequestSource =
    | 'query'
    | 'params'
    | 'body'
    | 'formData'
    | 'headers'
    | 'cookies';

export type ResponseTarget = 'body' | 'headers' | 'cookies';

/**
 * Request parts described with schemas. Path parameters are not among them:
 * their names come from the route and their values are always strings.
 */
export type RequestSchemaSource = Exclude<RequestSource, 'params'>;

export type RequestSchemas = {
    [Source in RequestSchemaSource]?: StandardSchemaV1;
};

export type ResponseSchemas = { [Target in ResponseTarget]?: StandardSchemaV1 };
