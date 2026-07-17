import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';

async function main() {
    const [action, identity] = process.argv.slice(2);
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key || action !== 'bootstrap' || !identity) {
        throw new Error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run admin -- bootstrap email-or-uuid');
    }

    const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
    let userId = identity;
    let userEmail: string | undefined;
    let appMetadata: Record<string, unknown> = {};

    if (!uuid.test(identity)) {
        for (let page = 1; ; page++) {
            const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
            if (error) throw error;
            const user = data.users.find(candidate => candidate.email?.toLowerCase() === identity.toLowerCase());
            if (user) { userId = user.id; userEmail = user.email; appMetadata = user.app_metadata; break; }
            if (data.users.length < 1000) throw new Error('Existing auth user not found. The user must sign in with Google first.');
        }
    } else {
        const { data, error } = await client.auth.admin.getUserById(identity);
        if (error) throw error;
        userEmail = data.user.email;
        appMetadata = data.user.app_metadata;
    }

    if (appMetadata.provider !== 'google' || !Array.isArray(appMetadata.providers) || !appMetadata.providers.includes('google')) {
        throw new Error('Refusing to provision a user whose Auth metadata does not prove Google identity.');
    }

    const { data, error } = await client.rpc('bootstrap_first_google_admin', { p_user_id: userId });
    if (error) throw error;
    process.stdout.write(JSON.stringify({ email: userEmail, user_id: userId, ...data }, null, 2) + '\n');
}

main().catch(error => {
    const message = error instanceof Error
        ? error.message
        : error && typeof error === 'object' && 'message' in error
            ? String(error.message)
            : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
