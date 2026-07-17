import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { csvParseRows } from 'd3';
import { processSheetData } from '../src/services/data/sheetLoader';
import { buildImportPayload, importSupabaseUrl } from '../tools/import-sheet';

describe('sheet import conversion', () => {
    it('converts parser unions, events, media, and imprecise dates', async () => {
        const csv = await readFile(resolve('tests/fixtures/import-family.csv'), 'utf8');
        const rows = csvParseRows(csv);
        const graph = processSheetData(rows.slice(1), { writeBackGeneratedIds: false });
        graph.members.mem_7.occupation = 'Teacher';
        graph.members.mem_7.aliases = ['Alias'];
        const payload = buildImportPayload(graph, rows.length - 1);

        expect(payload.people).toHaveLength(8);
        expect(payload.people.every(person => person.privacy === 'family')).toBe(true);
        expect(payload.union_count).toBe(3);
        expect(payload.partnerships).toHaveLength(2);
        expect(payload.parent_links).toHaveLength(9);
        expect(payload.media).toHaveLength(3);
        expect(payload.people.find(person => person.legacy_id === 'mem_7')?.aliases).toEqual(['Alias']);
        expect(payload.life_events).toContainEqual(expect.objectContaining({ event_type: 'occupation', details: 'Teacher' }));
        expect(payload.life_events).toContainEqual(expect.objectContaining({
            person_legacy_id: 'mem_1', event_type: 'birth', date_text: 'c. 1900', date_start: null,
        }));
        expect(payload.life_events).toContainEqual(expect.objectContaining({
            person_legacy_id: 'mem_2', event_type: 'birth', date_text: '1901-02-03', date_start: '1901-02-03',
        }));
        expect(payload.people.find(person => person.legacy_id === 'mem_4')?.is_living).toBe(false);

        const publicPayload = buildImportPayload(graph, rows.length - 1, [], 'public');
        expect(publicPayload.people.every(person => person.privacy === 'public')).toBe(true);
    });

    it('disables generated-ID write-back during import parsing', () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch');
        const warnings: string[] = [];
        processSheetData([['1', 'No ID']], {
            writeBackGeneratedIds: false,
            onWarning: warning => warnings.push(warning),
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(warnings).toHaveLength(1);
        fetchMock.mockRestore();
    });

    it('rejects unions with more than two parents', () => {
        const members = Object.fromEntries(['1', '2', '3', '4'].map(id => [`mem_${id}`, { id: `mem_${id}`, name: id }]));
        expect(() => buildImportPayload({
            start: 'mem_1', members,
            links: [['mem_1', 'u_x'], ['mem_2', 'u_x'], ['mem_3', 'u_x'], ['u_x', 'mem_4']],
        }, 4)).toThrow('maximum is 2');
    });

    it('requires explicit opt-in for a hosted import target', () => {
        expect(importSupabaseUrl('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321');
        expect(() => importSupabaseUrl('https://project.supabase.co')).toThrow('ALLOW_REMOTE_SUPABASE=1');
        expect(importSupabaseUrl('https://project.supabase.co/', true)).toBe('https://project.supabase.co');
    });
});
