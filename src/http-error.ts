import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { DomainErrorClass, ErrorClass, ErrorMapping } from './types';

type ResponseOptions<
    Class extends ErrorClass,
    DetailsSchema extends StandardSchemaV1
> = {
    /**
     * Description of the error response in OpenAPI.
     */
    description?: string;
    /**
     * Without it the response has no `message`.
     */
    message?: string | ((error: InstanceType<Class>) => string);
    /**
     * Without it the response has no `details`. `map` picks what is sent,
     * `schema` validates it and describes it in OpenAPI.
     */
    details?: {
        schema: DetailsSchema;
        map: (
            error: InstanceType<Class>
        ) => StandardSchemaV1.InferInput<DetailsSchema>;
    };
};

export type HttpErrorOptions<
    Class extends ErrorClass,
    DetailsSchema extends StandardSchemaV1
> = (Class extends { readonly code: string }
    ? {
          /**
           * Overrides the class's own `code`.
           */
          code?: string;
      }
    : {
          /**
           * Identifies the error in responses and OpenAPI.
           */
          code: string;
      }) &
    ResponseOptions<Class, DetailsSchema>;

/**
 * Classes with their own `code` (e.g. of `@domain-first/errors`)
 * don't need options, others need at least `code`.
 */
type OptionsArgument<
    Class extends ErrorClass,
    DetailsSchema extends StandardSchemaV1
> = Class extends { readonly code: string }
    ? [options?: HttpErrorOptions<Class, DetailsSchema>]
    : [options: HttpErrorOptions<Class, DetailsSchema>];

const isDomainErrorClass = (
    errorClass: ErrorClass
): errorClass is DomainErrorClass =>
    'code' in errorClass &&
    typeof errorClass.code === 'string' &&
    'is' in errorClass &&
    typeof errorClass.is === 'function';

const classMatcher = (errorClass: ErrorClass) =>
    isDomainErrorClass(errorClass)
        ? (error: Error) => errorClass.is(error)
        : (error: Error) => error instanceof errorClass;

const isErrorClass = (
    matcher: ErrorClass | ((error: Error) => boolean)
): matcher is ErrorClass =>
    matcher === Error || matcher.prototype instanceof Error;

/**
 * `message` and `details` are built only for errors that match,
 * so the error type their options expect holds.
 */
const responseParts = (
    options: ResponseOptions<any, StandardSchemaV1>
): Pick<ErrorMapping, 'description' | 'message' | 'details'> => {
    const { description, message, details } = options;

    return {
        ...(description !== undefined && { description }),
        ...(message !== undefined && { message }),
        ...(details && { details })
    };
};

/**
 * Responds to errors of `errorClass` with `status`.
 * The response body is `{ code }`, plus `message` and `details` when set.
 */
export const httpError = <
    Class extends ErrorClass,
    DetailsSchema extends StandardSchemaV1 = StandardSchemaV1
>(
    errorClass: Class,
    status: number,
    ...args: OptionsArgument<Class, DetailsSchema>
): ErrorMapping => {
    const options = (args[0] ?? {}) as ResponseOptions<Class, DetailsSchema> & {
        code?: string;
    };
    const code =
        options.code ??
        (isDomainErrorClass(errorClass) ? errorClass.code : undefined);

    if (code === undefined) {
        throw new Error(
            `Error class "${errorClass.name}" has no code, pass it in the options`
        );
    }

    return {
        code,
        status,
        matches: classMatcher(errorClass),
        ...responseParts(options)
    };
};

export type HttpStatusOptions<DetailsSchema extends StandardSchemaV1> = {
    /**
     * Shared by every matched error in responses and OpenAPI.
     */
    code: string;
    /**
     * Error classes (with their subclasses) and checks. An error matches
     * when it matches any of them.
     */
    match: Array<ErrorClass | ((error: Error) => boolean)>;
} & ResponseOptions<ErrorClass, DetailsSchema>;

/**
 * Responds to every error matching `options.match` with `status`
 * and one `code`. The response body is `{ code }`, plus `message`
 * and `details` when set.
 */
export const httpStatus = <
    DetailsSchema extends StandardSchemaV1 = StandardSchemaV1
>(
    status: number,
    options: HttpStatusOptions<DetailsSchema>
): ErrorMapping => {
    const matchers = options.match.map((matcher) =>
        isErrorClass(matcher) ? classMatcher(matcher) : matcher
    );

    return {
        code: options.code,
        status,
        matches: (error) => matchers.some((matches) => matches(error)),
        ...responseParts(options)
    };
};
