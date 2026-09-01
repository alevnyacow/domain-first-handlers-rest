import { errorNamespace } from '@domain-first/errors';
import type { StandardSchemaV1 } from '@standard-schema/spec';

export const Errors = errorNamespace('@domain-first/handlers-rest');

export const RequestParsingError = Errors.define<{
    issues: Readonly<StandardSchemaV1.Issue[]>;
    source: 'query' | 'headers' | 'cookies' | 'body' | 'formData';
    received: unknown;
}>('request-parsing');

export const ResponseParsingError = Errors.define<{
    issues: Readonly<StandardSchemaV1.Issue[]>;
    source: 'headers' | 'cookies' | 'body';
    received: unknown;
}>('response-parsing');
