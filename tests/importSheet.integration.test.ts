import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { csvParseRows } from 'd3';
import { describe, expect, it } from 'vitest';
import { processSheetData } from '../src/services/data/sheetLoader';
import { buildImportPayload, importFamily } from '../tools/import-sheet';

const run = process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;

run('sheet import RPC', () => {
    it('imports once, repeats as a no-op, and rejects a conflicting target', async () => {
        const csv = await readFile(resolve('tests/fixtures/import-family.csv'), 'utf8');
        const rows = csvParseRows(csv);
        const payload = buildImportPayload(
            processSheetData(rows.slice(1), { writeBackGeneratedIds: false }),
            rows.length - 1,
        );
        const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
            auth: { persistSession: false, autoRefreshToken: false },
        });

        const first = await importFamily(client, payload, 'demo-import-integration', 'Import Integration');
        const second = await importFamily(client, payload, 'demo-import-integration', 'Import Integration');
        expect(first).toMatchObject({ rows: 8, people: 8, unions: 3, partnerships: 2, parent_links: 9, no_op: false });
        expect(second).toEqual({ ...first, no_op: true });
        await expect(importFamily(client, payload, 'demo-import-integration', 'Different Name')).rejects.toThrow('conflicting family');
    });
});
