import { pathToFileURL } from 'node:url';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

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

export async function unifyPeople(
    client: SupabaseClient,
    options: {
        sourcePersonId?: string;
        targetPersonId?: string;
        sourceFamilySlug?: string;
        sourceLegacyId?: string;
        targetFamilySlug?: string;
        targetLegacyId?: string;
    }
): Promise<Record<string, unknown>> {
    if (options.sourcePersonId && options.targetPersonId) {
        const { data, error } = await client.rpc('unify_person', {
            p_source_person_id: options.sourcePersonId,
            p_target_person_id: options.targetPersonId,
        });
        if (error) throw new Error(`Failed to unify people: ${error.message}`);
        return data as Record<string, unknown>;
    }

    if (
        options.sourceFamilySlug &&
        options.sourceLegacyId &&
        options.targetFamilySlug &&
        options.targetLegacyId
    ) {
        const { data, error } = await client.rpc('unify_person_by_legacy_id', {
            p_source_family_slug: options.sourceFamilySlug,
            p_source_legacy_id: options.sourceLegacyId,
            p_target_family_slug: options.targetFamilySlug,
            p_target_legacy_id: options.targetLegacyId,
        });
        if (error) throw new Error(`Failed to unify people by legacy ID: ${error.message}`);
        return data as Record<string, unknown>;
    }

    throw new Error('Must provide either source/target person UUIDs or source/target family slugs and legacy IDs');
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

    const client = createClient(importSupabaseUrl(process.env.SUPABASE_URL), serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    const result = await unifyPeople(client, {
        sourcePersonId: args['source-person-id'],
        targetPersonId: args['target-person-id'],
        sourceFamilySlug: args['source-family-slug'],
        sourceLegacyId: args['source-legacy-id'],
        targetFamilySlug: args['target-family-slug'],
        targetLegacyId: args['target-legacy-id'],
    });

    console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
