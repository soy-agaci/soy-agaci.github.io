import { createHmac, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database, Json } from '../src/types/database';

const run = process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_JWT_SECRET ? describe : describe.skip;
const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const jwtSecret = process.env.SUPABASE_JWT_SECRET!;
const familyId = '10000000-0000-0000-0000-000000000001';
const secondFamilyId = '10000000-0000-0000-0000-000000000002';
const parentId = '20000000-0000-0000-0000-000000000003';
const sharedPersonId = '20000000-0000-0000-0000-000000000005';
const sharedBaseRevisionId = '21000000-0000-0000-0000-000000000005';
const globalPersonId = '20000000-0000-0000-0000-000000000004';
const actorSecrets = new WeakMap<SupabaseClient<Database>, string>();

function client(key = anonKey): SupabaseClient<Database> {
    return createClient<Database>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: 'test-' + randomUUID() },
    });
}

function googleClient(userId: string, email: string): SupabaseClient<Database> {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
        aud: 'authenticated', role: 'authenticated', sub: userId, email,
        iat: now, exp: now + 3600,
        app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: {},
    })}`;
    const token = `${unsigned}.${createHmac('sha256', jwtSecret).update(unsigned).digest('base64url')}`;
    return createClient<Database>(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: 'test-' + randomUUID() },
        global: { headers: { Authorization: `Bearer ${token}` } },
    });
}

async function waitForAuth(): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
        if ((await fetch(url + '/auth/v1/health')).ok) return;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Local GoTrue did not become ready');
}

async function submit(
    api: SupabaseClient<Database>,
    requestId: string,
    bundle: Json,
    targetFamilyId = familyId,
) {
    let actorSecret = actorSecrets.get(api);
    if (!actorSecret) {
        actorSecret = randomUUID();
        actorSecrets.set(api, actorSecret);
    }
    return api.rpc('submit_family_edit', {
        p_family_id: targetFamilyId,
        p_client_request_id: requestId,
        p_bundle: bundle,
        p_anonymous_actor_secret: actorSecret,
    });
}

run('public edit moderation HTTP roles', () => {
    it('submits, validates, moderates, conflicts, and serializes atomically', async () => {
        await waitForAuth();
        const service = client(serviceKey);
        const anon = client();
        const adminEmail = 'admin-' + randomUUID() + '@example.invalid';
        const nonAdminEmail = 'nonadmin-' + randomUUID() + '@example.invalid';
        const adminUser = await service.auth.admin.createUser({
            email: adminEmail, email_confirm: true,
            app_metadata: { provider: 'google', providers: ['google'] },
        });
        const nonAdminUser = await service.auth.admin.createUser({
            email: nonAdminEmail, email_confirm: true,
        });
        expect(adminUser.error).toBeNull();
        expect(nonAdminUser.error).toBeNull();
        const adminId = adminUser.data.user!.id;
        const seeded = await service.rpc('bootstrap_first_google_admin', { p_user_id: adminId });
        expect(seeded.error).toBeNull();
        const serviceWriteAttempts = await Promise.all([
            service.from('people').insert({ id: randomUUID() }),
            service.from('people').update({ current_revision_id: null }).eq('id', parentId),
            service.from('person_revisions').update({ status: 'rejected' }).eq(
                'id', '21000000-0000-0000-0000-000000000003',
            ),
            service.from('submissions').insert({ id: randomUUID() }),
            service.from('sources').insert({
                id: randomUUID(), submission_id: randomUUID(), title: 'Denied',
            }),
            service.from('media_revisions').insert({
                id: randomUUID(), person_id: parentId, legacy_uri: 'https://example.invalid/denied.jpg',
                mime_type: 'image/jpeg',
            }),
        ]);
        expect(serviceWriteAttempts.every(result => result.error?.code === '42501')).toBe(true);

        const admin = googleClient(adminId, adminEmail);
        const nonAdmin = googleClient(nonAdminUser.data.user!.id, nonAdminEmail);

        const spouseRef = randomUUID();
        const childRef = randomUUID();
        const requestId = randomUUID();
        const bundle = {
            people: [
                { ref: spouseRef, display_name: 'HTTP Synthetic Spouse', privacy: 'public' },
                { ref: childRef, display_name: 'HTTP Synthetic Child', privacy: 'public' },
            ],
            partnerships: [{
                ref: randomUUID(),
                person1_ref: parentId,
                person2_ref: spouseRef,
                partnership_type: 'marriage',
                date_text: 'circa 2020',
                status_text: 'current',
            }],
            parent_links: [
                { ref: randomUUID(), parent_ref: parentId, child_ref: childRef, relationship_type: 'biological' },
                { ref: randomUUID(), parent_ref: spouseRef, child_ref: childRef, relationship_type: 'biological' },
            ],
            memberships: [{ ref: randomUUID(), person_ref: spouseRef }],
            sources: [{
                title: 'HTTP Synthetic Source',
                url: 'https://example.invalid/http-source',
                citation: 'HTTP synthetic citation',
            }],
        };
        const [duplicateA, duplicateB] = await Promise.all([
            submit(anon, requestId, bundle),
            submit(anon, requestId, bundle),
        ]);
        expect(duplicateA.error).toBeNull();
        expect(duplicateB.error).toBeNull();
        expect(duplicateA.data).toEqual(duplicateB.data);
        const submissionId = (duplicateA.data as { submission_id: string }).submission_id;

        const independentAnon = client();
        const independent = await submit(independentAnon, requestId, bundle);
        expect(independent.error).toBeNull();
        expect((independent.data as { submission_id: string }).submission_id).not.toBe(submissionId);

        const approvedOnly = await anon.rpc('get_family_graph', {
            p_family_ids: [familyId], p_include_pending: false,
        });
        const pending = await anon.rpc('get_family_graph', {
            p_family_ids: [familyId], p_include_pending: true,
        });
        expect(JSON.stringify(approvedOnly.data)).not.toContain('HTTP Synthetic');
        expect(JSON.stringify(approvedOnly.data)).not.toContain('HTTP Synthetic Source');
        expect(JSON.stringify(pending.data)).toContain('HTTP Synthetic Spouse');
        expect(JSON.stringify(pending.data)).toContain('HTTP Synthetic Source');
        expect(JSON.stringify(pending.data)).toContain('"submission_status":"pending"');
        expect(JSON.stringify(pending.data)).toContain('"status":"pending"');
        expect(JSON.stringify(pending.data)).not.toContain('idempotency_actor_digest');
        expect(JSON.stringify(pending.data)).not.toContain(actorSecrets.get(anon));

        const payloadConflict = await submit(anon, requestId, {
            people: [{ ref: randomUUID(), display_name: 'Different payload' }],
        });
        expect(payloadConflict.error?.message).toContain('different request');

        const invalidRequestId = randomUUID();
        const invalid = await submit(anon, invalidRequestId, {
            parent_links: [{
                ref: randomUUID(),
                parent_ref: parentId,
                child_ref: parentId,
                relationship_type: 'biological',
            }],
        });
        expect(invalid.error?.message).toContain('invalid parent link edit');
        const validAfterInvalid = await submit(anon, invalidRequestId, {
            people: [{ ref: randomUUID(), display_name: 'Rollback Proof', privacy: 'public' }],
        });
        expect(validAfterInvalid.error).toBeNull();

        const denied = await nonAdmin.rpc('approve_family_submission', {
            p_submission_id: submissionId,
        });
        expect(denied.error?.message).toContain('admin authorization required');

        const approved = await admin.rpc('approve_family_submission', {
            p_submission_id: submissionId,
            p_review_note: 'HTTP synthetic approval',
        });
        expect(approved.error).toBeNull();
        expect((approved.data as { status: string }).status).toBe('approved');
        const canonical = await anon.rpc('get_family_graph', {
            p_family_ids: [familyId], p_include_pending: false,
        });
        expect(JSON.stringify(canonical.data)).toContain('HTTP Synthetic Spouse');
        expect(JSON.stringify(canonical.data)).toContain('circa 2020');
        expect(JSON.stringify(canonical.data)).toContain('HTTP Synthetic Source');
        expect(JSON.stringify(canonical.data)).toContain('"submission_status":"approved"');

        const rejectedSubmission = await submit(anon, randomUUID(), {
            people: [{ ref: randomUUID(), display_name: 'HTTP Rejected Person', privacy: 'public' }],
            sources: [{ title: 'HTTP Rejected Source', url: 'https://example.invalid/rejected' }],
        });
        const rejectedId = (rejectedSubmission.data as { submission_id: string }).submission_id;
        const rejected = await admin.rpc('reject_family_submission', {
            p_submission_id: rejectedId, p_review_note: 'Synthetic rejection',
        });
        expect(rejected.error).toBeNull();
        const afterReject = await anon.rpc('get_family_graph', {
            p_family_ids: [familyId], p_include_pending: true,
        });
        expect(JSON.stringify(afterReject.data)).not.toContain('HTTP Rejected Person');
        expect(JSON.stringify(afterReject.data)).not.toContain('HTTP Rejected Source');

        const rejectedMembership = await submit(anon, randomUUID(), {
            memberships: [{ ref: randomUUID(), person_ref: globalPersonId }],
            sources: [{ title: 'HTTP Rejected Membership Source' }],
        });
        expect(rejectedMembership.error).toBeNull();
        const membershipPendingGraph = await anon.rpc('get_family_graph', {
            p_family_ids: [familyId], p_include_pending: true,
        });
        const pendingMembership = (membershipPendingGraph.data as {
            memberships: Array<{ id: string; person_id: string }>;
        }).memberships.find(membership => membership.person_id === globalPersonId)!;
        expect(pendingMembership).toBeDefined();
        expect(JSON.stringify(membershipPendingGraph.data)).toContain('HTTP Rejected Membership Source');
        expect((await admin.rpc('reject_family_submission', {
            p_submission_id: (rejectedMembership.data as { submission_id: string }).submission_id,
            p_review_note: 'Synthetic membership rejection',
        })).error).toBeNull();

        const approvedMembership = await submit(anon, randomUUID(), {
            memberships: [{ ref: randomUUID(), person_ref: globalPersonId }],
            sources: [{ title: 'HTTP Approved Membership Source' }],
        });
        expect(approvedMembership.error).toBeNull();
        const membershipPendingAgain = await anon.rpc('get_family_graph', {
            p_family_ids: [familyId], p_include_pending: true,
        });
        expect((membershipPendingAgain.data as {
            memberships: Array<{ id: string; person_id: string }>;
        }).memberships.find(membership => membership.person_id === globalPersonId)?.id).toBe(pendingMembership.id);
        expect(JSON.stringify(membershipPendingAgain.data)).not.toContain('HTTP Rejected Membership Source');
        expect((await admin.rpc('approve_family_submission', {
            p_submission_id: (approvedMembership.data as { submission_id: string }).submission_id,
        })).error).toBeNull();
        const membershipCanonical = await anon.rpc('get_family_graph', {
            p_family_ids: [familyId], p_include_pending: false,
        });
        const currentMembership = (membershipCanonical.data as {
            memberships: Array<{
                id: string;
                person_id: string;
                current_revision: { id: string };
            }>;
        }).memberships.find(membership => membership.person_id === globalPersonId)!;
        expect(currentMembership.id).toBe(pendingMembership.id);
        expect(JSON.stringify(membershipCanonical.data)).toContain('HTTP Approved Membership Source');

        const membershipUpdate = {
            memberships: [{
                ref: currentMembership.id,
                membership_id: currentMembership.id,
                base_revision_id: currentMembership.current_revision.id,
                person_ref: globalPersonId,
            }],
        };
        const membershipFirst = await submit(anon, randomUUID(), membershipUpdate);
        const membershipStale = await submit(anon, randomUUID(), membershipUpdate);
        expect(membershipFirst.error).toBeNull();
        expect(membershipStale.error).toBeNull();
        expect((await admin.rpc('approve_family_submission', {
            p_submission_id: (membershipFirst.data as { submission_id: string }).submission_id,
        })).error).toBeNull();
        const membershipConflict = await admin.rpc('approve_family_submission', {
            p_submission_id: (membershipStale.data as { submission_id: string }).submission_id,
        });
        expect(membershipConflict.error).toBeNull();
        expect((membershipConflict.data as { status: string }).status).toBe('conflict');

        const firstUpdate = await submit(anon, randomUUID(), {
            people: [{
                ref: sharedPersonId,
                person_id: sharedPersonId,
                base_revision_id: sharedBaseRevisionId,
                display_name: 'HTTP First Shared Update',
                privacy: 'public',
            }],
        }, secondFamilyId);
        const staleUpdate = await submit(anon, randomUUID(), {
            people: [{
                ref: sharedPersonId,
                person_id: sharedPersonId,
                base_revision_id: sharedBaseRevisionId,
                display_name: 'HTTP Stale Shared Update',
                privacy: 'public',
            }],
        });
        expect(firstUpdate.error).toBeNull();
        expect(staleUpdate.error).toBeNull();
        expect((await admin.rpc('approve_family_submission', {
            p_submission_id: (firstUpdate.data as { submission_id: string }).submission_id,
        })).error).toBeNull();
        const staleDetail = await admin.rpc('get_admin_submission', {
            p_submission_id: (staleUpdate.data as { submission_id: string }).submission_id,
        });
        expect(staleDetail.error).toBeNull();
        const stalePerson = (staleDetail.data as unknown as {
            people: Array<{
                base: { display_name: string };
                current: { display_name: string };
                proposed: { display_name: string };
            }>;
        }).people[0];
        expect(stalePerson.base.display_name).toBe('Shared Child');
        expect(stalePerson.current.display_name).toBe('HTTP First Shared Update');
        expect(stalePerson.proposed.display_name).toBe('HTTP Stale Shared Update');
        const stale = await admin.rpc('approve_family_submission', {
            p_submission_id: (staleUpdate.data as { submission_id: string }).submission_id,
        });
        expect(stale.error).toBeNull();
        expect((stale.data as { status: string }).status).toBe('conflict');

        const concurrentSubmission = await submit(anon, randomUUID(), {
            people: [{ ref: randomUUID(), display_name: 'HTTP Concurrent Person', privacy: 'public' }],
        });
        const concurrentId = (concurrentSubmission.data as { submission_id: string }).submission_id;
        const [approveRace, rejectRace] = await Promise.all([
            admin.rpc('approve_family_submission', { p_submission_id: concurrentId }),
            admin.rpc('reject_family_submission', { p_submission_id: concurrentId, p_review_note: 'Synthetic race rejection' }),
        ]);
        const race = [approveRace, rejectRace];
        expect(race.filter(result => result.error === null)).toHaveLength(1);
        expect(race.find(result => result.error)?.error?.message).toMatch(/already (approved|rejected)/);
        const repeated = await admin.rpc('approve_family_submission', { p_submission_id: concurrentId });
        expect(repeated.error?.message).toMatch(/already (approved|rejected)/);

        const mixedRequestId = randomUUID();
        const mixedSourceSubmission = await submit(anon, mixedRequestId, {
            people: [
                { ref: randomUUID(), display_name: 'HTTP MIXED PUBLIC SENTINEL', privacy: 'public' },
                { ref: randomUUID(), display_name: 'HTTP MIXED PRIVATE SENTINEL', privacy: 'private' },
            ],
            sources: [{
                title: 'HTTP MIXED SOURCE SENTINEL',
                url: 'https://example.invalid/mixed-source',
                citation: 'Must never enter pending or approved graph state',
            }],
        });
        expect(mixedSourceSubmission.data).toBeNull();
        expect(mixedSourceSubmission.error?.message).toContain('sources require an entirely public edit bundle');
        const afterMixedReject = await anon.rpc('get_family_graph', {
            p_family_ids: [familyId], p_include_pending: true,
        });
        expect(JSON.stringify(afterMixedReject.data)).not.toContain('HTTP MIXED');

        const rollbackProof = await submit(anon, mixedRequestId, {
            people: [{ ref: randomUUID(), display_name: 'HTTP Mixed Rollback Proof', privacy: 'public' }],
            sources: [{ title: 'HTTP Mixed Rollback Proof Source' }],
        });
        expect(rollbackProof.error).toBeNull();
        expect((await admin.rpc('approve_family_submission', {
            p_submission_id: (rollbackProof.data as { submission_id: string }).submission_id,
        })).error).toBeNull();
        const afterRollbackApproval = await anon.rpc('get_family_graph', {
            p_family_ids: [familyId], p_include_pending: false,
        });
        expect(JSON.stringify(afterRollbackApproval.data)).toContain('HTTP Mixed Rollback Proof Source');
        expect(JSON.stringify(afterRollbackApproval.data)).not.toContain('HTTP MIXED SOURCE SENTINEL');

        const privateSubmission = await submit(anon, randomUUID(), {
            people: [{ ref: randomUUID(), display_name: 'HTTP PRIVATE SENTINEL', privacy: 'private' }],
        });
        expect(privateSubmission.error).toBeNull();
        const privateGraph = await anon.rpc('get_family_graph', {
            p_family_ids: [familyId], p_include_pending: true,
        });
        expect(JSON.stringify(privateGraph.data)).not.toContain('HTTP PRIVATE SENTINEL');
        expect(JSON.stringify(privateGraph.data)).not.toContain(
            (privateSubmission.data as { submission_id: string }).submission_id,
        );
    }, 30_000);
});
