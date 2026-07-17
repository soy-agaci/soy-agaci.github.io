import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

const run = process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;
const exec = promisify(execFile);

run('first-admin bootstrap CLI', () => {
    it('succeeds once and permanently rejects a second bootstrap', async () => {
        const email = `bootstrap-${randomUUID()}@example.invalid`;
        const service = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        const created = await service.auth.admin.createUser({
            email,
            email_confirm: true,
            app_metadata: { provider: 'google', providers: ['google'] },
        });
        expect(created.error).toBeNull();

        const args = ['run', 'admin', '--', 'bootstrap', email];
        const options = { cwd: process.cwd(), env: process.env };
        const first = await exec('npm', args, options);
        expect(JSON.parse(first.stdout.slice(first.stdout.indexOf('{')))).toMatchObject({ email, is_admin: true });

        await expect(exec('npm', args, options)).rejects.toMatchObject({
            stderr: expect.stringContaining('admin bootstrap already completed'),
        });
    }, 30_000);
});
