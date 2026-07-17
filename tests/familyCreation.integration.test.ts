import { createHmac, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/types/database';

const run = process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_JWT_SECRET ? describe : describe.skip;
const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const jwtSecret = process.env.SUPABASE_JWT_SECRET!;
const sourceFamilyId = '10000000-0000-0000-0000-000000000001';
const momFamilyId = '10000000-0000-0000-0000-000000000002';
const sourceRootId = '20000000-0000-0000-0000-000000000003';
const momRootId = '20000000-0000-0000-0000-000000000004';

function client(key = anonKey): SupabaseClient<Database> {
    return createClient<Database>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: 'family-create-' + randomUUID() },
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
        auth: { persistSession: false, autoRefreshToken: false, storageKey: 'family-create-' + randomUUID() },
        global: { headers: { Authorization: `Bearer ${token}` } },
    });
}

async function propose(
    api: SupabaseClient<Database>, requestId: string, slug: string,
    sourceFamilyId = sourceFamilyId, rootPersonId = sourceRootId, name = 'Created Family',
) {
    return api.rpc('submit_family_creation', {
        p_source_family_id: sourceFamilyId, p_root_person_id: rootPersonId,
        p_client_request_id: requestId, p_name: name, p_slug: slug,
        p_anonymous_actor_secret: 'family-creation-test-actor-secret-000000000001',
    });
}

run('moderated family creation HTTP roles', () => {
    it('validates, dedupes, moderates, races, reuses the root, and preserves privacy', async () => {
        const service = client(serviceKey);
        const anon = client();
        const email = `family-admin-${randomUUID()}@example.invalid`;
        const user = await service.auth.admin.createUser({
            email, email_confirm: true,
            app_metadata: { provider: 'google', providers: ['google'] },
        });
        expect(user.error).toBeNull();
        expect((await service.rpc('bootstrap_first_google_admin', { p_user_id: user.data.user!.id })).error).toBeNull();
        const admin = googleClient(user.data.user!.id, email);
        const nonAdminEmail = `family-user-${randomUUID()}@example.invalid`;
        const nonAdminUser = await service.auth.admin.createUser({
            email: nonAdminEmail, email_confirm: true,
            app_metadata: { provider: 'google', providers: ['google'] },
        });
        const nonAdmin = googleClient(nonAdminUser.data.user!.id, nonAdminEmail);

        const direct = await service.from('family_creation_proposals').insert({
            id: randomUUID(), submission_id: randomUUID(), slug: 'injected', name: 'Injected',
            root_person_id: sourceRootId, source_family_id: sourceFamilyId,
        });
        expect(direct.error?.code).toBe('42501');

        const requestId = randomUUID();
        const first = await propose(anon, requestId, 'root-family', sourceFamilyId, sourceRootId, '<b>Safe Name</b>');
        const retry = await propose(anon, requestId, 'root-family', sourceFamilyId, sourceRootId, '<b>Safe Name</b>');
        expect(first.error).toBeNull();
        expect(retry.data).toEqual(first.data);
        expect((await propose(anon, requestId, 'different-payload')).error?.message).toContain('different request');
        const submissionId = (first.data as { submission_id: string }).submission_id;
        expect((await nonAdmin.rpc('approve_family_submission', { p_submission_id: submissionId })).error?.message)
            .toContain('admin authorization required');

        const pending = await anon.rpc('list_family_creation_proposals', { p_source_family_ids: [sourceFamilyId] });
        expect(pending.error).toBeNull();
        expect(pending.data).toEqual(expect.arrayContaining([expect.objectContaining({
            submission_id: submissionId, slug: 'root-family', root_person_id: sourceRootId,
            root_display_name: 'Parent Alpha', name: '<b>Safe Name</b>', status: 'pending',
        })]));
        expect(JSON.stringify((await anon.rpc('list_public_families')).data)).not.toContain('root-family');

        expect((await admin.rpc('get_admin_submission', { p_submission_id: submissionId })).data)
            .toMatchObject({ family_creation: { slug: 'root-family', root_person: { id: sourceRootId } } });
        const rejected = await admin.rpc('reject_family_submission', {
            p_submission_id: submissionId, p_review_note: 'Use a clearer family name',
        });
        expect(rejected.data).toMatchObject({ status: 'rejected' });
        expect(JSON.stringify((await anon.rpc('list_family_creation_proposals', {
            p_source_family_ids: [sourceFamilyId],
        })).data)).not.toContain('root-family');

        const resubmitted = await propose(anon, randomUUID(), 'root-family');
        const resubmittedId = (resubmitted.data as { submission_id: string }).submission_id;
        expect((await admin.rpc('approve_family_submission', { p_submission_id: resubmittedId })).data)
            .toEqual(expect.objectContaining({ submission_id: resubmittedId, status: 'approved' }));
        const discovery = await anon.rpc('list_public_families');
        expect(discovery.data).toEqual(expect.arrayContaining([expect.objectContaining({ slug: 'root-family' })]));
        const createdGraph = await anon.rpc('get_family_graph_by_slugs', {
            p_family_slugs: ['root-family'], p_include_pending: false,
        });
        const graph = createdGraph.data as unknown as {
            families: Array<{ root_person_id: string }>;
            people: Array<{ id: string }>;
            memberships: Array<{ person_id: string; current_revision: { status: string } }>;
        };
        expect(graph.families[0].root_person_id).toBe(sourceRootId);
        expect(graph.people.filter(person => person.id === sourceRootId)).toHaveLength(1);
        expect(graph.memberships).toEqual([expect.objectContaining({
            person_id: sourceRootId, current_revision: expect.objectContaining({ status: 'approved' }),
        })]);

        const [collisionA, collisionB] = await Promise.all([
            propose(anon, randomUUID(), 'collision-family', sourceFamilyId, sourceRootId, 'Collision A'),
            propose(anon, randomUUID(), 'collision-family', momFamilyId, momRootId, 'Collision B'),
        ]);
        const collisionIds = [collisionA, collisionB].map(result => (result.data as { submission_id: string }).submission_id);
        const decisions = await Promise.all(collisionIds.map(id => admin.rpc('approve_family_submission', {
            p_submission_id: id,
        })));
        expect(decisions.map(result => (result.data as { status: string }).status).sort()).toEqual(['approved', 'conflict']);
        expect((await anon.rpc('list_public_families')).data?.filter(family => family.slug === 'collision-family')).toHaveLength(1);

        expect((await propose(anon, randomUUID(), 'wrong-source', sourceFamilyId, momRootId)).error?.message)
            .toContain('not a visible current source-family member');
        expect((await propose(anon, randomUUID(), 'private-root', sourceFamilyId,
            '20000000-0000-0000-0000-000000000001')).error?.message)
            .toContain('not a visible current source-family member');
        expect((await anon.rpc('submit_family_creation', {
            p_source_family_id: sourceFamilyId, p_root_person_id: sourceRootId,
            p_client_request_id: randomUUID(), p_name: 'Bad', p_slug: 'Bad_Slug',
            p_anonymous_actor_secret: 'family-creation-test-actor-secret-000000000001',
        })).error?.message).toContain('invalid family creation request');
    });
});
