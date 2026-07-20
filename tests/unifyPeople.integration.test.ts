import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { csvParseRows } from 'd3';
import { describe, expect, it } from 'vitest';
import { processSheetData } from '../src/services/data/sheetLoader';
import { buildImportPayload, importFamily } from '../tools/import-sheet';
import { unifyPeople } from '../tools/unify-people';

const run = process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;

run('unify people RPC', () => {
    it('unifies person memberships and parent links across two imported families', async () => {
        const csv = await readFile(resolve('tests/fixtures/import-family.csv'), 'utf8');
        const rows = csvParseRows(csv);
        const payload = buildImportPayload(
            processSheetData(rows.slice(1), { writeBackGeneratedIds: false }),
            rows.length - 1,
        );
        const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
            auth: { persistSession: false, autoRefreshToken: false },
        });

        // Import into family 1 and family 2
        await importFamily(client, payload, 'test-family-1', 'Family 1');
        await importFamily(client, payload, 'test-family-2', 'Family 2');

        // Unify root person of family 2 into root person of family 1
        const rootId1 = payload.root_person_legacy_id;
        const result = await unifyPeople(client, {
            sourceFamilySlug: 'test-family-2',
            sourceLegacyId: rootId1,
            targetFamilySlug: 'test-family-1',
            targetLegacyId: rootId1,
        });

        expect(result).toMatchObject({
            success: true,
        });
    });
});
