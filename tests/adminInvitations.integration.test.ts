import { createHmac, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/types/database';

const run = process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_JWT_SECRET ? describe : describe.skip;
const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const jwtSecret = process.env.SUPABASE_JWT_SECRET!;

function api(key = anonKey): SupabaseClient<Database> {
    return createClient<Database>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: `invite-${randomUUID()}` },
    });
}

function signed(userId: string, provider = 'google'): SupabaseClient<Database> {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
        aud: 'authenticated', role: 'authenticated', sub: userId, email: 'untrusted@example.invalid',
        iat: now, exp: now + 3600,
        app_metadata: { provider, providers: [provider] }, user_metadata: { email: 'spoofed@example.invalid' },
    })}`;
    const token = `${unsigned}.${createHmac('sha256', jwtSecret).update(unsigned).digest('base64url')}`;
    return createClient<Database>(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: `invite-${randomUUID()}` },
        global: { headers: { Authorization: `Bearer ${token}` } },
    });
}

async function user(service: SupabaseClient<Database>, email: string, provider = 'google', confirmed = true) {
    const result = await service.auth.admin.createUser({
        email, email_confirm: confirmed, app_metadata: { provider, providers: [provider] },
    });
    expect(result.error).toBeNull();
    return result.data.user!.id;
}

run('admin invitation HTTP authorization', () => {
    it('bootstraps once and serializes invite, acceptance, revoke, and expiry', async () => {
        const service = api(serviceKey);
        const anon = api();
        const candidates = await Promise.all([0, 1].map(async () => {
            const email = `admin-${randomUUID()}@example.invalid`;
            return { email, id: await user(service, email) };
        }));
        const bootstrap = await Promise.all(candidates.map(candidate => service.rpc('bootstrap_first_google_admin', {
            p_user_id: candidate.id,
        })));
        expect(bootstrap.filter(result => result.error === null)).toHaveLength(1);
        expect(bootstrap.filter(result => result.error?.message.includes('admin bootstrap already completed'))).toHaveLength(1);
        const winner = candidates[bootstrap.findIndex(result => result.error === null)];
        const adminEmail = winner.email;
        const adminId = winner.id;
        expect((await service.rpc('bootstrap_first_google_admin', { p_user_id: adminId })).error?.message).toContain('admin bootstrap already completed');
        expect((await service.from('admins').insert({ user_id: randomUUID() })).error?.code).toBe('42501');
        expect((await service.from('admin_bootstrap_state').select('*')).error?.code).toBe('42501');
        expect((await service.from('admin_invitations').select('*')).error?.code).toBe('42501');
        expect((await service.rpc('create_admin_invitation', { p_email: 'denied@example.invalid' })).error?.code).toBe('42501');
        expect((await anon.rpc('accept_admin_invitation')).error?.code).toBe('42501');

        const admin = signed(adminId);
        const inviteeEmail = `invitee-${randomUUID()}@example.invalid`;
        const created = await admin.rpc('create_admin_invitation', { p_email: `  ${inviteeEmail.toUpperCase()}  ` });
        expect(created.error).toBeNull();
        expect((created.data as { email: string }).email).toBe(inviteeEmail);
        const inviteeId = await user(service, inviteeEmail);
        const accepted = await signed(inviteeId).rpc('accept_admin_invitation');
        expect(accepted.error).toBeNull();
        expect(accepted.data).toEqual({ is_admin: true });
        expect((await signed(inviteeId).rpc('accept_admin_invitation')).data).toEqual({ is_admin: true });
        expect((await signed(inviteeId).rpc('get_admin_profile')).data).toMatchObject({ is_admin: true });

        const providerEmail = `provider-${randomUUID()}@example.invalid`;
        expect((await admin.rpc('create_admin_invitation', { p_email: providerEmail })).error).toBeNull();
        const providerId = await user(service, providerEmail, 'email');
        expect((await signed(providerId).rpc('accept_admin_invitation')).data).toEqual({ is_admin: false });

        const unverifiedEmail = `unverified-${randomUUID()}@example.invalid`;
        expect((await admin.rpc('create_admin_invitation', { p_email: unverifiedEmail })).error).toBeNull();
        const unverifiedId = await user(service, unverifiedEmail, 'google', false);
        expect((await signed(unverifiedId).rpc('accept_admin_invitation')).data).toEqual({ is_admin: false });

        const raceEmail = `race-${randomUUID()}@example.invalid`;
        const raceInvite = await admin.rpc('create_admin_invitation', { p_email: raceEmail });
        const raceId = await user(service, raceEmail);
        const [raceAccept, raceRevoke] = await Promise.all([
            signed(raceId).rpc('accept_admin_invitation'),
            admin.rpc('revoke_admin_invitation', { p_invitation_id: (raceInvite.data as { id: string }).id }),
        ]);
        expect(raceAccept.error).toBeNull();
        expect(raceRevoke.error).toBeNull();
        const invitations = (await admin.rpc('list_admin_invitations')).data as unknown as Array<{ email: string; status: string }>;
        const raceStatus = invitations.find(invitation => invitation.email === raceEmail)!.status;
        expect(['accepted', 'revoked']).toContain(raceStatus);
        expect((raceAccept.data as { is_admin: boolean }).is_admin).toBe(raceStatus === 'accepted');

        const expiredEmail = `expired-${randomUUID()}@example.invalid`;
        expect((await admin.rpc('create_admin_invitation', {
            p_email: expiredEmail, p_expires_at: new Date(Date.now() + 250).toISOString(),
        })).error).toBeNull();
        const expiredId = await user(service, expiredEmail);
        await new Promise(resolve => setTimeout(resolve, 350));
        expect((await signed(expiredId).rpc('accept_admin_invitation')).data).toEqual({ is_admin: false });
        const afterExpiry = (await admin.rpc('list_admin_invitations')).data as unknown as Array<{ email: string; status: string }>;
        expect(afterExpiry.find(invitation => invitation.email === expiredEmail)?.status).toBe('expired');
    });
});
