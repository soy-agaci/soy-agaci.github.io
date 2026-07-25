import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const output = process.env.BACKUP_STORAGE_DIR;
if (!url || !key || !output) throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and BACKUP_STORAGE_DIR are required');

const root = resolve(output);
const client = createClient(url, key, { auth: { persistSession: false } });
let copied = 0;

function destination(bucket: string, name: string) {
    const file = resolve(root, bucket, name);
    if (!file.startsWith(`${root}${sep}`)) throw new Error(`Unsafe storage path: ${bucket}/${name}`);
    return file;
}

async function copy(bucket: string, prefix = ''): Promise<void> {
    for (let offset = 0;; offset += 1000) {
        const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset });
        if (error) throw error;
        for (const entry of data ?? []) {
            const name = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (!entry.id) { await copy(bucket, name); continue; }
            const { data: file, error: downloadError } = await client.storage.from(bucket).download(name);
            if (downloadError || !file) throw downloadError ?? new Error(`Missing ${bucket}/${name}`);
            const target = destination(bucket, name);
            await mkdir(resolve(target, '..'), { recursive: true });
            await writeFile(target, Buffer.from(await file.arrayBuffer()));
            copied++;
        }
        if ((data?.length ?? 0) < 1000) return;
    }
}

async function main() {
    await mkdir(root, { recursive: true });
    const { data: buckets, error } = await client.storage.listBuckets();
    if (error) throw error;
    for (const bucket of buckets ?? []) await copy(bucket.id);
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ buckets, objects: copied }, null, 2));
    console.log(JSON.stringify({ buckets: buckets?.length ?? 0, copied }));
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
