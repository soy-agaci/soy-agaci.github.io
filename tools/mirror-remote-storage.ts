import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const remoteUrl = process.env.SUPABASE_URL!;
const remoteKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!remoteUrl || !remoteKey) throw new Error('Missing remote Supabase credentials');

const status = execFileSync('npm', ['run', 'supabase:status', '--', '-o', 'env'], {
    encoding: 'utf8',
    env: { ...process.env, XDG_CONFIG_HOME: '/tmp/sselcuk/supabase-config', SUPABASE_TELEMETRY_DISABLED: '1' },
});
const local = Object.fromEntries([...status.matchAll(/^(API_URL|SERVICE_ROLE_KEY)="([^"]*)"$/gm)].map(([, key, value]) => [key, value]));
if (!local.API_URL || !local.SERVICE_ROLE_KEY) throw new Error('Local Supabase is not running');
const remote = createClient(remoteUrl, remoteKey, { auth: { persistSession: false } });
const target = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let copied = 0;

async function copy(bucket: string, path = ''): Promise<void> {
    const { data, error } = await remote.storage.from(bucket).list(path, { limit: 1000 });
    if (error) throw error;
    for (const entry of data ?? []) {
        const name = path ? `${path}/${entry.name}` : entry.name;
        if (!entry.id) { await copy(bucket, name); continue; }
        const { data: file, error: downloadError } = await remote.storage.from(bucket).download(name);
        if (downloadError || !file) throw downloadError ?? new Error(`Missing ${bucket}/${name}`);
        const { error: uploadError } = await target.storage.from(bucket).upload(name, file, {
            upsert: true, contentType: entry.metadata?.mimetype,
        });
        if (uploadError) throw uploadError;
        copied++;
    }
}

async function main() {
    const { data: buckets, error } = await remote.storage.listBuckets();
    if (error) throw error;
    for (const bucket of buckets ?? []) await copy(bucket.id);
    console.log(JSON.stringify({ buckets: buckets?.length ?? 0, copied }));
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
