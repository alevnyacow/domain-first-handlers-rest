import { errorNamespace } from '@domain-first/errors';
import type { StandardSchemaV1 } from '@standard-schema/spec';

export const Errors = errorNamespace('@domain-first/handlers-rest');

export const RequestParsingError = Errors.define<{
    issues: Readonly<StandardSchemaV1.Issue[]>;
    source: 'query' | 'params' | 'headers' | 'cookies' | 'body' | 'formData';
    received: unknown;
}>('request-parsing');

/**
 * `.mapInput()` returned something the handler's input schema rejects,
 * e.g. `Number('abc')` for a numeric field.
 */
export const InputMappingError = Errors.define<{
    issues: Readonly<StandardSchemaV1.Issue[]>;
    received: unknown;
}>('input-mapping');

/**
 * `code` of the response to errors without an `httpError()` mapping.
 */
export const INTERNAL_ERROR_CODE = '@domain-first/handlers-rest.internal';

/**
 * `code` of `invalidRequest()` responses by default.
 */
export const INVALID_REQUEST_CODE =
    '@domain-first/handlers-rest.invalid-request';

/**
 * `message` or `details` of an error response could not be built,
 * the response is sent without them. Passed to hooks only.
 */
export const ErrorResponseMappingError = Errors.define<{
    code: string;
    part: 'message' | 'details';
    issues: Readonly<StandardSchemaV1.Issue[]>;
    received: unknown;
}>('error-response-mapping');

export const ResponseParsingError = Errors.define<{
    issues: Readonly<StandardSchemaV1.Issue[]>;
    source: 'headers' | 'cookies' | 'body';
    received: unknown;
}>('response-parsing');
