import { describe, expect, test } from '@rstest/core';
import type { Metadata, RawAPISchemas } from '../types';
import { generateOpenAPI } from './generate-open-api';

const route = (path: string[]) => ({
    metadata: { route: { method: 'get', path } } as Metadata,
    _api_schemas: {
        requestSchemas: {},
        responseSchemas: {}
    } as RawAPISchemas
});

const pathsOf = (apiRoutePrefix?: string[], path = ['orders', 'recent']) =>
    Object.keys(
        generateOpenAPI([route(path)], {
            document: { info: { title: 'Test', version: '1.0.0' } },
            apiRoutePrefix
        }).paths
    );

describe('generateOpenAPI paths', () => {
    test('start with a slash without a prefix', () => {
        expect(pathsOf()).toEqual(['/orders/recent']);
        expect(pathsOf([])).toEqual(['/orders/recent']);
    });

    test('accept prefix segments with or without slashes', () => {
        expect(pathsOf(['api'])).toEqual(['/api/orders/recent']);
        expect(pathsOf(['/api'])).toEqual(['/api/orders/recent']);
        expect(pathsOf(['api', 'v1'])).toEqual(['/api/v1/orders/recent']);
        expect(pathsOf(['/api/v1/'])).toEqual(['/api/v1/orders/recent']);
    });

    test('keep the leading empty segment form working', () => {
        expect(pathsOf(['', 'api'])).toEqual(['/api/orders/recent']);
        expect(pathsOf(['/'])).toEqual(['/orders/recent']);
    });

    test('keep a route without segments at the prefix root', () => {
        expect(pathsOf(['api'], [])).toEqual(['/api']);
        expect(pathsOf(undefined, [])).toEqual(['/']);
    });
});
