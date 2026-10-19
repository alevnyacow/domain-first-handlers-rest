import { describe, expect, test } from '@rstest/core';
import { draft07ToOpenAPI } from './draft-07-to-openapi';

describe('draft07ToOpenAPI', () => {
    test('turns const into enum', () => {
        expect(draft07ToOpenAPI({ const: 'x' })).toEqual({ enum: ['x'] });
    });

    test('turns numeric exclusive bounds into boolean ones', () => {
        expect(
            draft07ToOpenAPI({
                type: 'integer',
                exclusiveMinimum: 0,
                exclusiveMaximum: 10
            })
        ).toEqual({
            type: 'integer',
            minimum: 0,
            exclusiveMinimum: true,
            maximum: 10,
            exclusiveMaximum: true
        });
    });

    test('marks schemas with a null branch nullable', () => {
        expect(
            draft07ToOpenAPI({ anyOf: [{ type: 'string' }, { type: 'null' }] })
        ).toEqual({ type: 'string', nullable: true });
        expect(
            draft07ToOpenAPI({
                anyOf: [
                    { type: 'string' },
                    { type: 'number' },
                    { type: 'null' }
                ]
            })
        ).toEqual({
            anyOf: [
                { type: 'string', nullable: true },
                { type: 'number', nullable: true }
            ]
        });
    });

    test('splits type arrays', () => {
        expect(draft07ToOpenAPI({ type: ['string', 'null'] })).toEqual({
            type: 'string',
            nullable: true
        });
        expect(draft07ToOpenAPI({ type: ['string', 'number'] })).toEqual({
            anyOf: [{ type: 'string' }, { type: 'number' }]
        });
    });

    test('turns tuples into arrays of their items', () => {
        expect(
            draft07ToOpenAPI({
                type: 'array',
                minItems: 2,
                items: [{ type: 'string' }, { type: 'number' }],
                additionalItems: false
            })
        ).toEqual({
            type: 'array',
            minItems: 2,
            maxItems: 2,
            items: { anyOf: [{ type: 'string' }, { type: 'number' }] }
        });
        expect(
            draft07ToOpenAPI({
                type: 'array',
                items: [{ type: 'string' }],
                additionalItems: { type: 'number' }
            })
        ).toEqual({
            type: 'array',
            items: { anyOf: [{ type: 'string' }, { type: 'number' }] }
        });
        expect(
            draft07ToOpenAPI({ type: 'array', items: [{ type: 'string' }] })
        ).toEqual({ type: 'array', items: {} });
        expect(
            draft07ToOpenAPI({
                type: 'array',
                items: [{ type: 'string' }],
                additionalItems: false
            })
        ).toEqual({ type: 'array', maxItems: 1, items: { type: 'string' } });
    });

    test('rewrites nested schemas, not data or property names', () => {
        expect(
            draft07ToOpenAPI({
                type: 'object',
                properties: {
                    const: { const: 1 },
                    list: { type: 'array', items: { const: 2 } }
                },
                definitions: { Id: { type: ['string', 'null'] } },
                default: { const: 3 },
                examples: [{ type: ['string'] }]
            })
        ).toEqual({
            type: 'object',
            properties: {
                const: { enum: [1] },
                list: { type: 'array', items: { enum: [2] } }
            },
            definitions: { Id: { type: 'string', nullable: true } },
            default: { const: 3 },
            examples: [{ type: ['string'] }]
        });
    });
});
