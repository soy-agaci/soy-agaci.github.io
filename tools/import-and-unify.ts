import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { csvParseRows } from 'd3';
import { processSheetData } from '../src/services/data/sheetLoader';
import { buildImportPayload, importFamily, type ImportPrivacy } from './import-sheet';
import { unifyPeople } from './unify-people';

export function importSupabaseUrl(value: string | undefined, allowRemote = process.env.ALLOW_REMOTE_SUPABASE === '1'): string {
    if (!value) throw new Error('SUPABASE_URL is required');
    const url = new URL(value);
    if (!allowRemote && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
        throw new Error('SUPABASE_URL must point to local Supabase unless ALLOW_REMOTE_SUPABASE=1');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('SUPABASE_URL must use HTTP or HTTPS');
    return url.toString().replace(/\/$/, '');
}

function parseArgs(argv: string[]): Record<string, string> {
    const args: Record<string, string> = {};
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument: ${key ?? ''}`);
        args[key.slice(2)] = value;
    }
    return args;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if ((!args.url && !args.file) || (args.url && args.file)) throw new Error('Pass exactly one of --url or --file');
    if (!args['family-slug'] || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args['family-slug'])) throw new Error('A valid --family-slug is required');
    if (!args['family-name']) throw new Error('--family-name is required');
    const privacy = (args.privacy ?? 'family') as ImportPrivacy;
    if (!['public', 'family', 'private'].includes(privacy)) {
        throw new Error('--privacy must be public, family, or private');
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

    const rawCsv = args.file ? await readFile(args.file, 'utf8') : await fetch(args.url!).then(response => {
        if (!response.ok) throw new Error(`Sheet download failed with HTTP ${response.status}`);
        return response.text();
    });

    const rows = csvParseRows(rawCsv);
    if (rows.length <= 1) throw new Error('No data rows found');

    const warnings: string[] = [];
    const graph = processSheetData(rows.slice(1), {
        writeBackGeneratedIds: false,
        onWarning: message => warnings.push(message),
    });

    const payload = buildImportPayload(graph, rows.length - 1, warnings, privacy);
    const client = createClient(importSupabaseUrl(process.env.SUPABASE_URL), serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    console.log('Importing family sheet...');
    const importReport = await importFamily(client, payload, args['family-slug'], args['family-name']);
    console.log('Import result:', JSON.stringify(importReport, null, 2));

    const sourceLegacyId = args['unify-source-legacy-id'];
    const targetFamilySlug = args['unify-target-family-slug'];
    const targetLegacyId = args['unify-target-legacy-id'];

    if (sourceLegacyId && targetFamilySlug && targetLegacyId) {
        console.log(`Unifying person (source: ${args['family-slug']}:${sourceLegacyId} -> target: ${targetFamilySlug}:${targetLegacyId})...`);
        const unifyReport = await unifyPeople(client, {
            sourceFamilySlug: args['family-slug'],
            sourceLegacyId,
            targetFamilySlug,
            targetLegacyId,
        });
        console.log('Unification result:', JSON.stringify(unifyReport, null, 2));
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
