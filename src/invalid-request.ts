import type {
    StandardJSONSchemaV1,
    StandardSchemaV1
} from '@standard-schema/spec';
import {
    INVALID_REQUEST_CODE,
    InputMappingError,
    RequestParsingError
} from './errors';
import { httpStatus } from './http-error';
import type { ErrorMapping } from './types';

export type InvalidRequestError =
    | InstanceType<typeof RequestParsingError>
    | InstanceType<typeof InputMappingError>;

/**
 * `details` of `invalidRequest()` responses by default.
 * `source` is absent when `.mapInput()` produced the invalid input.
 */
export type InvalidRequestDetails = {
    source?: InstanceType<typeof RequestParsingError>['details']['source'];
    issues: { message: string; path?: (string | number)[] }[];
};

const pathSegmentSchema = {
    oneOf: [{ type: 'string' }, { type: 'integer' }]
};

const detailsJSONSchema = {
    type: 'object',
    properties: {
        source: {
            type: 'string',
            enum: ['query', 'params', 'headers', 'cookies', 'body', 'formData']
        },
        issues: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    message: { type: 'string' },
                    path: { type: 'array', items: pathSegmentSchema }
                },
                required: ['message']
            }
        }
    },
    required: ['issues']
};

/**
 * Written by hand, so it works whatever validation library the app uses.
 * `details` are built by `toDetails`, there is nothing to validate.
 */
export const invalidRequestDetailsSchema: StandardSchemaV1<InvalidRequestDetails> &
    StandardJSONSchemaV1<InvalidRequestDetails> = {
    '~standard': {
        version: 1,
        vendor: '@domain-first/handlers-rest',
        validate: (value) => ({ value: value as InvalidRequestDetails }),
        jsonSchema: {
            input: () => structuredClone(detailsJSONSchema),
            output: () => structuredClone(detailsJSONSchema)
        }
    }
};

const toIssues = (
    issues: Readonly<StandardSchemaV1.Issue[]>
): InvalidRequestDetails['issues'] =>
    issues.map(({ message, path }) => ({
        message,
        ...(path && {
            path: path.map((segment) => {
                const key = typeof segment === 'object' ? segment.key : segment;
                return typeof key === 'number' ? key : String(key);
            })
        })
    }));

const toDetails = (error: InvalidRequestError): InvalidRequestDetails =>
    RequestParsingError.is(error)
        ? {
              source: error.details.source,
              issues: toIssues(error.details.issues)
          }
        : { issues: toIssues(error.details.issues) };

export type InvalidRequestOptions<DetailsSchema extends StandardSchemaV1> = {
    /**
     * `400` by default.
     */
    status?: number;
    /**
     * `INVALID_REQUEST_CODE` by default.
     */
    code?: string;
    /**
     * `'Invalid request'` by default.
     */
    description?: string;
    /**
     * `'InvalidRequestError'` by default.
     */
    schemaName?: string;
    /**
     * Without it the response has no `message`.
     */
    message?: string | ((error: InvalidRequestError) => string);
    /**
     * `source` and `issues` (`message` and `path`) by default, never
     * `received`. `false` sends no `details`.
     */
    details?:
        | false
        | {
              schema: DetailsSchema;
              map: (
                  error: InvalidRequestError
              ) => StandardSchemaV1.InferInput<DetailsSchema>;
          };
};

/**
 * Responds to `RequestParsingError` and `InputMappingError`
 * with one status and `code`.
 */
export const invalidRequest = <
    DetailsSchema extends StandardSchemaV1 = StandardSchemaV1
>(
    options: InvalidRequestOptions<DetailsSchema> = {}
): ErrorMapping => {
    const {
        status = 400,
        code = INVALID_REQUEST_CODE,
        description = 'Invalid request',
        schemaName = 'InvalidRequestError',
        message,
        details = { schema: invalidRequestDetailsSchema, map: toDetails }
    } = options;

    // only matched errors reach `message` and `details`
    const asMatched = (error: Error) => error as InvalidRequestError;

    return httpStatus(status, {
        code,
        description,
        schemaName,
        match: [RequestParsingError, InputMappingError],
        ...(message !== undefined && {
            message:
                typeof message === 'string'
                    ? message
                    : (error) => message(asMatched(error))
        }),
        ...(details && {
            details: {
                schema: details.schema,
                map: (error) => details.map(asMatched(error))
            }
        })
    });
};
