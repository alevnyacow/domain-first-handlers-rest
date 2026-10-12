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

export const ResponseParsingError = Errors.define<{
    issues: Readonly<StandardSchemaV1.Issue[]>;
    source: 'headers' | 'cookies' | 'body';
    received: unknown;
}>('response-parsing');
