import { describe, expect, test } from '@rstest/core';
import { type PathParamName, type PathParams, pathParamNames } from '.';

type Equals<A, B> =
    (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
        ? true
        : false;
type Assert<_ extends true> = never;

describe('pathParamNames', () => {
    test('returns nothing for static routes', () => {
        expect(pathParamNames([])).toEqual([]);
        expect(pathParamNames(['users', 'me'])).toEqual([]);
    });

    test('collects params in order', () => {
        expect(
            pathParamNames(['users', ':userId', 'posts', ':postId'])
        ).toEqual(['userId', 'postId']);
    });

    test('supports segments with slashes', () => {
        expect(pathParamNames(['/users/:userId/', 'tabs/:tab'])).toEqual([
            'userId',
            'tab'
        ]);
    });

    test('ignores colons inside segments', () => {
        expect(pathParamNames(['users:search', 'a:b'])).toEqual([]);
    });
});

describe('path param types', () => {
    test('are inferred from literal routes', () => {
        type _Static = Assert<Equals<PathParamName<['users']>, never>>;
        type _Names = Assert<
            Equals<
                PathParamName<['users', ':userId', 'tabs/:tab']>,
                'userId' | 'tab'
            >
        >;
        type _Params = Assert<
            Equals<
                PathParams<readonly ['users', ':userId']>,
                { userId: string }
            >
        >;
        type _Wide = Assert<Equals<PathParamName<string[]>, never>>;

        expect(true).toBe(true);
    });
});
