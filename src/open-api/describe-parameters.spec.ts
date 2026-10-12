import { describe, expect, test } from '@rstest/core';
import { describeParameters } from './describe-parameters';

describe('describeParameters', () => {
    test('requires an object schema', () => {
        expect(() => describeParameters({ type: 'string' }, 'query')).toThrow(
            'query schema must be an object'
        );
    });

    test('describes properties with their requirement', () => {
        expect(
            describeParameters(
                {
                    type: 'object',
                    properties: {
                        a: { type: 'string' },
                        b: { type: 'number' }
                    },
                    required: ['a']
                },
                'header'
            )
        ).toEqual([
            {
                name: 'a',
                in: 'header',
                required: true,
                schema: { type: 'string' }
            },
            {
                name: 'b',
                in: 'header',
                required: false,
                schema: { type: 'number' }
            }
        ]);
    });

    test('treats properties without required list as optional', () => {
        expect(
            describeParameters(
                { type: 'object', properties: { a: { type: 'string' } } },
                'cookie'
            )
        ).toEqual([
            {
                name: 'a',
                in: 'cookie',
                required: false,
                schema: { type: 'string' }
            }
        ]);
    });

    test('describes records by their required keys', () => {
        expect(
            describeParameters(
                {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                    required: ['x', 'y']
                },
                'header'
            )
        ).toEqual([
            {
                name: 'x',
                in: 'header',
                required: true,
                schema: { type: 'string' }
            },
            {
                name: 'y',
                in: 'header',
                required: true,
                schema: { type: 'string' }
            }
        ]);
    });

    test('returns nothing for empty schemas', () => {
        expect(describeParameters({ type: 'object' }, 'query')).toEqual([]);
        expect(
            describeParameters(
                { type: 'object', additionalProperties: { type: 'string' } },
                'query'
            )
        ).toEqual([]);
    });
});
