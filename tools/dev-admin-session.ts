import { createHmac } from 'node:crypto';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

async function main() {
    const targetEmail = (process.argv[2] || 'admin@example.com').toLowerCase().trim();

    // Force/read local supabase status configuration to prevent remote env variables from overriding
    let url = 'http://127.0.0.1:54321';
    let anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
    let serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
    let jwtSecret = 'super-secret-jwt-token-with-at-least-32-characters-long';

    try {
        const statusJson = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const parsed = JSON.parse(statusJson);
        if (parsed.API_URL) url = parsed.API_URL;
        if (parsed.PUBLISHABLE_KEY) anonKey = parsed.PUBLISHABLE_KEY;
        if (parsed.SERVICE_ROLE_KEY) serviceRoleKey = parsed.SERVICE_ROLE_KEY;
        if (parsed.JWT_SECRET) jwtSecret = parsed.JWT_SECRET;
    } catch (err) {
        // Fall back to default local ports/secrets if CLI query fails
    }

    const serviceClient = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

    function makeJwt(userId: string, email: string) {
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + 60 * 60 * 24 * 7; // 7 days
        const header = { alg: 'HS256', typ: 'JWT' };
        const payload = {
            aud: 'authenticated', exp: expiresAt, sub: userId, email: email, phone: '',
            app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: {},
            role: 'authenticated', aal: 'aal1', amr: [{ method: 'oauth', timestamp: now }],
            session_id: '00000000-0000-0000-0000-000000000000',
        };
        const b64url = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
        const unsigned = `${b64url(header)}.${b64url(payload)}`;
        const signature = createHmac('sha256', jwtSecret).update(unsigned).digest('base64url');
        return { accessToken: `${unsigned}.${signature}`, expiresAt };
    }

    // 1. Get or create target user
    const { data: listData } = await serviceClient.auth.admin.listUsers();
    let targetUser = listData.users.find(u => u.email?.toLowerCase() === targetEmail);

    if (!targetUser) {
        const { data: newUser, error } = await serviceClient.auth.admin.createUser({
            email: targetEmail,
            email_confirm: true,
            app_metadata: { provider: 'google', providers: ['google'] },
        });
        if (error || !newUser.user) throw error || new Error(`Failed to create user ${targetEmail}`);
        targetUser = newUser.user;
    }

    // 2. Try bootstrap RPC if database has no active admin yet
    const bootstrapRes = await serviceClient.rpc('bootstrap_first_google_admin', { p_user_id: targetUser.id });

    if (bootstrapRes.error) {
        // Bootstrap already done for a different user.
        // Find existing admin to create an invitation for targetEmail.
        let activeAdminUser = listData.users.find(u => u.id !== targetUser!.id);
        if (!activeAdminUser) {
            const { data: refetched } = await serviceClient.auth.admin.listUsers();
            activeAdminUser = refetched.users.find(u => u.id !== targetUser!.id);
        }

        if (activeAdminUser) {
            const { accessToken: adminJwt } = makeJwt(activeAdminUser.id, activeAdminUser.email || '');
            const adminClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${adminJwt}` } } });
            await adminClient.rpc('create_admin_invitation', { p_email: targetEmail });
        }

        // Accept invitation as target user
        const { accessToken: targetJwt } = makeJwt(targetUser.id, targetEmail);
        const targetClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${targetJwt}` } } });
        await targetClient.rpc('accept_admin_invitation');
    }

    // 3. Generate final session object for target user
    const { accessToken, expiresAt } = makeJwt(targetUser.id, targetEmail);

    const sessionObject = {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 604800,
        expires_at: expiresAt,
        refresh_token: 'local-dev-refresh-token',
        user: {
            id: targetUser.id,
            aud: 'authenticated',
            role: 'authenticated',
            email: targetEmail,
            email_confirmed_at: new Date().toISOString(),
            app_metadata: { provider: 'google', providers: ['google'] },
            user_metadata: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        },
    };

    const setCmd = `["sb-127-auth-token", "sb-localhost-auth-token", "sb-127.0.0.1-auth-token", "sb-pvvxzpwxjvzkzrzrkbaj-auth-token", `
        + '`sb-${location.hostname.split(".")[0]}-auth-token`'
        + `].forEach(k => localStorage.setItem(k, JSON.stringify(${JSON.stringify(sessionObject)}))); location.reload();`;

    console.log('\n--- Local Dev Admin Session Generated ---');
    console.log(`User Email: ${targetEmail}`);
    console.log(`User ID:    ${targetUser.id}`);
    console.log('\nRun this one-liner in your browser DevTools Console (F12) on the open app page:\n');
    console.log(setCmd);
    console.log('\n-----------------------------------------\n');
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
