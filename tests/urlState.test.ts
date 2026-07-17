import { describe, it, expect, beforeEach } from 'vitest';
import { encodeState, decodeState, buildIdMaps, persistentIdMap, updateDataQuery } from '../src/services/state/urlState';
import { FamilyData } from '../src/types/types';

describe('urlState', () => {
    // Mock window.location and history
    const originalLocation = window.location;
    const originalHistory = window.history;

    beforeEach(() => {
        // Reset maps
        persistentIdMap.clear();

        // Mock window.location
        delete (window as any).location;
        (window as any).location = {
            href: 'https://example.test/tree?keep=1#existing',
            hash: '',
            pathname: '/',
            search: ''
        };

        // Mock history
        (window as any).history = {
            replaceState: (state: any, title: string, url: string) => {
                window.location.hash = url.startsWith('#') ? url : '';
            }
        };
    });

    // Restore after all tests (optional, but good practice)
    // afterAll(() => { window.location = originalLocation; ... });

    it('should encode and decode state correctly', () => {
        const data: FamilyData = {
            start: 'mem_0',
            members: {
                'mem_0': { id: 'mem_0', name: 'John Doe', first_name: 'John', last_name: 'Doe', birth_date: '1990', is_spouse: false } as any
            },
            links: []
        };

        buildIdMaps(data);
        const pid = persistentIdMap.get('joh_doe_90'); // Expected ID format

        // Test Encode
        const transform = { k: 1, x: 100, y: 200 };
        const encoded = encodeState('mem_0', transform, true, new Set(['mem_0']));

        expect(encoded).toBeTruthy();

        // Set hash for decode
        window.location.hash = '#' + encoded;

        // Test Decode
        const decoded = decodeState();
        expect(decoded).toBeTruthy();
        expect(decoded.currentNode).toBe('mem_0');
        expect(decoded.patrilineal).toBe(true);
        expect(decoded.transform).toEqual({ k: 1, x: 100, y: 200 });
        expect(decoded.visibleNodes.has('mem_0')).toBe(true);
        expect(encoded!.length).toBeLessThan(110);
    });

    it('keeps transform when no explicit visible node view is shared', () => {
        const data: FamilyData = {
            start: 'mem_0',
            members: {
                'mem_0': { id: 'mem_0', name: 'John Doe', first_name: 'John', last_name: 'Doe', birth_date: '1990', is_spouse: false } as any
            },
            links: []
        };

        buildIdMaps(data);
        window.location.hash = '#' + encodeState('mem_0', { k: 1, x: 100, y: 200 }, false);

        expect(decodeState().transform).toEqual({ k: 1, x: 100, y: 200 });
    });

    it('still decodes old long hashes with visible node state', () => {
        const data: FamilyData = {
            start: 'mem_0',
            members: {
                'mem_0': { id: 'mem_0', name: 'John Doe', first_name: 'John', last_name: 'Doe', birth_date: '1990', is_spouse: false } as any
            },
            links: []
        };

        buildIdMaps(data);
        window.location.hash = '#' + btoa(JSON.stringify({ n: 'joh_doe_90', t: null, p: 0, v: ['joh_doe_90'] }));

        const decoded = decodeState();
        expect(decoded.visibleNodes.has('mem_0')).toBe(true);
    });

    it('should return null for invalid hash', () => {
        window.location.hash = '#invalid_base64_json';
        const decoded = decodeState();
        expect(decoded).toBeNull();
    });

    it('updates family and proposal query state without destroying unrelated query or hash state', () => {
        let replaced = '';
        (window as any).history.replaceState = (_state: unknown, _title: string, url: string) => { replaced = url; };

        updateDataQuery(['selcuk', 'second-family'], true, '80000000-0000-4000-8000-000000000001');

        expect(replaced).toBe('/tree?keep=1&family=selcuk&family=second-family&view=pending&proposal=80000000-0000-4000-8000-000000000001#existing');
    });

    it('pushes explicit multi/single/mode/proposal choices as distinct history entries', () => {
        const entries: string[] = [];
        (window as any).history.pushState = (_state: unknown, _title: string, url: string) => entries.push(url);

        updateDataQuery(['selcuk', 'second-family'], false, undefined, 'push');
        updateDataQuery(['selcuk'], false, undefined, 'push');
        updateDataQuery(['selcuk', 'second-family'], true, '80000000-0000-4000-8000-000000000001', 'push');

        expect(entries).toEqual([
            '/tree?keep=1&family=selcuk&family=second-family#existing',
            '/tree?keep=1&family=selcuk#existing',
            '/tree?keep=1&family=selcuk&family=second-family&view=pending&proposal=80000000-0000-4000-8000-000000000001#existing',
        ]);
    });
});
