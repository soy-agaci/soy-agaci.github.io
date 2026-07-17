import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    approveFamilySubmission,
    getFamilyGraph,
    getFamilyGraphBySlugs,
    listPublicFamilies,
    rejectFamilySubmission,
    submitFamilyCreation,
    submitFamilyEdit,
} from '../src/services/data/familyRepository';
import { getSupabaseClient } from '../src/services/supabase/client';

vi.mock('../src/services/supabase/client', () => ({
    getSupabaseClient: vi.fn(),
}));

const graph = {
    families: [{
        id: '10000000-0000-4000-8000-000000000001',
        slug: 'example',
        name: 'Example',
        root_person_id: null,
        created_at: '2026-01-01T00:00:00Z',
    }],
    people: [],
    life_events: [],
    partnerships: [],
    parent_links: [],
    memberships: [],
    media: [],
    sources: [],
    submissions: [],
    family_creation_proposals: [],
};

describe('familyRepository', () => {
    const rpc = vi.fn();

    beforeEach(() => {
        rpc.mockReset();
        vi.mocked(getSupabaseClient).mockReset();
        vi.mocked(getSupabaseClient).mockReturnValue({ rpc } as never);
    });

    it('returns a valid graph from the RPC', async () => {
        rpc.mockResolvedValue({ data: graph, error: null });

        await expect(getFamilyGraph([graph.families[0].id], true)).resolves.toEqual(graph);
        expect(rpc).toHaveBeenCalledWith('get_family_graph', {
            p_family_ids: [graph.families[0].id],
            p_include_pending: true,
        });
    });

    it('rejects malformed RPC payloads', async () => {
        rpc.mockResolvedValue({ data: { ...graph, people: [{}] }, error: null });

        await expect(getFamilyGraph([graph.families[0].id])).rejects.toThrow();
    });

    it('validates approved and pending graph source records', async () => {
        const source = {
            id: '70000000-0000-4000-8000-000000000001',
            submission_id: '80000000-0000-4000-8000-000000000001',
            submission_status: 'pending' as const,
            title: 'Synthetic source',
            url: 'https://example.invalid/source',
            citation: null,
            created_at: '2026-01-01T00:00:00Z',
        };
        rpc.mockResolvedValue({ data: { ...graph, sources: [source] }, error: null });
        await expect(getFamilyGraph([graph.families[0].id], true)).resolves.toMatchObject({ sources: [source] });

        rpc.mockResolvedValue({ data: { ...graph, sources: [{ ...source, submission_status: 'rejected' }] }, error: null });
        await expect(getFamilyGraph([graph.families[0].id], true)).rejects.toThrow();
    });

    it('surfaces RPC errors', async () => {
        rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

        await expect(getFamilyGraph([graph.families[0].id])).rejects.toThrow(
            'Failed to load family graph: permission denied',
        );
    });

    it('loads slugs in requested order and forwards pending inclusion', async () => {
        const second = { ...graph.families[0], id: '10000000-0000-4000-8000-000000000002', slug: 'second' };
        rpc
            .mockResolvedValueOnce({ data: { ...graph, families: [second, graph.families[0]] }, error: null })
            .mockResolvedValueOnce({ data: [], error: null });

        const result = await getFamilyGraphBySlugs(['example', 'second'], true);

        expect(result.families.map(family => family.slug)).toEqual(['example', 'second']);
        expect(rpc).toHaveBeenCalledWith('get_family_graph_by_slugs', {
            p_family_slugs: ['example', 'second'],
            p_include_pending: true,
        });
        expect(rpc).toHaveBeenCalledWith('list_family_creation_proposals', {
            p_source_family_ids: [second.id, graph.families[0].id],
        });
    });

    it('maps safe pending family proposals into the existing submission selector', async () => {
        const proposal = {
            id: '90000000-0000-4000-8000-000000000001',
            submission_id: '80000000-0000-4000-8000-000000000001', status: 'pending',
            slug: 'new-family', name: '<b>New Family</b>',
            root_person_id: '30000000-0000-4000-8000-000000000001', root_display_name: '<Root>',
            source_family_id: graph.families[0].id, source_family_slug: 'example', source_family_name: 'Example',
            created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', reviewed_at: null,
        } as const;
        rpc.mockResolvedValueOnce({ data: graph, error: null }).mockResolvedValueOnce({ data: [proposal], error: null });
        const result = await getFamilyGraphBySlugs(['example'], true);
        expect(result.family_creation_proposals).toEqual([proposal]);
        expect(result.submissions).toEqual([expect.objectContaining({ id: proposal.submission_id, status: 'pending' })]);
    });

    it('discovers only validated public family fields', async () => {
        const families = [{ id: graph.families[0].id, slug: 'example', name: 'Example' }];
        rpc.mockResolvedValue({ data: families, error: null });
        await expect(listPublicFamilies()).resolves.toEqual(families);
        expect(rpc).toHaveBeenCalledWith('list_public_families');
    });

    it('reports unresolved family slugs', async () => {
        rpc.mockResolvedValue({ data: graph, error: null });
        await expect(getFamilyGraphBySlugs(['example', 'missing'])).rejects.toThrow(
            'Unknown family slug(s): missing',
        );
    });

    it('rejects malformed slugs before calling the RPC', async () => {
        await expect(getFamilyGraphBySlugs(['Not_Valid'])).rejects.toThrow('Invalid family slug');
        expect(rpc).not.toHaveBeenCalled();
    });

    it('returns fresh empty graphs without configuring or calling Supabase', async () => {
        const first = await getFamilyGraph([]);
        first.families.push(graph.families[0]);
        const second = await getFamilyGraph([]);

        expect(second).toEqual({
            families: [], people: [], life_events: [], partnerships: [],
            parent_links: [], memberships: [], media: [], sources: [], submissions: [], family_creation_proposals: [],
        });
        for (const key of Object.keys(second) as Array<keyof typeof second>) {
            expect(second[key]).not.toBe(first[key]);
        }
        expect(getSupabaseClient).not.toHaveBeenCalled();
        expect(rpc).not.toHaveBeenCalled();
    });

    it('submits a validated explicit edit bundle', async () => {
        const familyId = '10000000-0000-4000-8000-000000000001';
        const requestId = '20000000-0000-4000-8000-000000000001';
        const personRef = '30000000-0000-4000-8000-000000000001';
        const result = { submission_id: '40000000-0000-4000-8000-000000000001', status: 'pending' };
        const bundle = {
            people: [{ ref: personRef, display_name: 'Synthetic Person', privacy: 'public' as const }],
            events: [{
                ref: '50000000-0000-4000-8000-000000000001',
                person_ref: personRef,
                event_type: 'birth' as const,
                date_text: 'circa 2000',
            }],
        };
        rpc.mockResolvedValue({ data: result, error: null });

        await expect(submitFamilyEdit(familyId, requestId, bundle)).resolves.toEqual(result);
        expect(rpc).toHaveBeenCalledWith('submit_family_edit', {
            p_family_id: familyId,
            p_client_request_id: requestId,
            p_bundle: bundle,
        });
    });

    it('submits only validated family-creation fields and actor identity', async () => {
        const result = { submission_id: '40000000-0000-4000-8000-000000000001', status: 'pending' };
        rpc.mockResolvedValue({ data: result, error: null });
        await expect(submitFamilyCreation({
            sourceFamilyId: graph.families[0].id,
            rootPersonId: '30000000-0000-4000-8000-000000000001',
            name: 'New Family', slug: 'new-family',
        }, '20000000-0000-4000-8000-000000000001', 'synthetic-actor-secret-000000000000000001')).resolves.toEqual(result);
        expect(rpc).toHaveBeenCalledWith('submit_family_creation', {
            p_source_family_id: graph.families[0].id,
            p_root_person_id: '30000000-0000-4000-8000-000000000001',
            p_client_request_id: '20000000-0000-4000-8000-000000000001',
            p_name: 'New Family', p_slug: 'new-family',
            p_anonymous_actor_secret: 'synthetic-actor-secret-000000000000000001',
        });
        await expect(submitFamilyCreation({
            sourceFamilyId: graph.families[0].id,
            rootPersonId: '30000000-0000-4000-8000-000000000001',
            name: '<script>', slug: 'Not Valid',
        }, '20000000-0000-4000-8000-000000000001')).rejects.toThrow();
    });

    it('forwards a validated anonymous actor secret without putting it in the bundle', async () => {
        const result = { submission_id: '40000000-0000-4000-8000-000000000001', status: 'pending' };
        const actorSecret = 'synthetic-actor-secret-000000000000000001';
        const bundle = {
            people: [{ ref: '30000000-0000-4000-8000-000000000001', display_name: 'Synthetic' }],
        };
        rpc.mockResolvedValue({ data: result, error: null });
        await submitFamilyEdit(
            '10000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001',
            bundle,
            actorSecret,
        );
        expect(rpc).toHaveBeenCalledWith('submit_family_edit', {
            p_family_id: '10000000-0000-4000-8000-000000000001',
            p_client_request_id: '20000000-0000-4000-8000-000000000001',
            p_bundle: bundle,
            p_anonymous_actor_secret: actorSecret,
        });
    });

    it('accepts typed membership additions and updates', async () => {
        const result = { submission_id: '40000000-0000-4000-8000-000000000001', status: 'pending' };
        const membershipId = '50000000-0000-4000-8000-000000000001';
        const bundle = {
            memberships: [{
                ref: membershipId,
                membership_id: membershipId,
                base_revision_id: '60000000-0000-4000-8000-000000000001',
                person_ref: '30000000-0000-4000-8000-000000000001',
            }],
        };
        rpc.mockResolvedValue({ data: result, error: null });
        await expect(submitFamilyEdit(
            '10000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001',
            bundle,
        )).resolves.toEqual(result);
        expect(rpc).toHaveBeenCalledWith('submit_family_edit', expect.objectContaining({ p_bundle: bundle }));
    });

    it('rejects malformed membership updates before the RPC', async () => {
        await expect(submitFamilyEdit(
            '10000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001',
            { memberships: [{
                ref: '50000000-0000-4000-8000-000000000001',
                membership_id: '50000000-0000-4000-8000-000000000002',
                person_ref: '30000000-0000-4000-8000-000000000001',
            }] },
        )).rejects.toThrow();
        expect(rpc).not.toHaveBeenCalled();
    });

    it('rejects unsafe edit input before calling the RPC', async () => {
        await expect(submitFamilyEdit(
            '10000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001',
            {
                people: [{ ref: '30000000-0000-4000-8000-000000000001', display_name: 'Synthetic' }],
                media: [{
                    person_ref: '30000000-0000-4000-8000-000000000001',
                    url: 'http://example.invalid/image.jpg',
                    mime_type: 'image/jpeg',
                }],
            },
        )).rejects.toThrow('URL must use HTTPS');
        expect(rpc).not.toHaveBeenCalled();
    });

    it('rejects mixed public/private source bundles before the RPC', async () => {
        await expect(submitFamilyEdit(
            '10000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001',
            {
                people: [
                    { ref: '30000000-0000-4000-8000-000000000001', display_name: 'Public', privacy: 'public' },
                    { ref: '30000000-0000-4000-8000-000000000002', display_name: 'Private', privacy: 'private' },
                ],
                sources: [{ title: 'Mixed source' }],
            },
        )).rejects.toThrow('Sources require an entirely public edit bundle');
        expect(rpc).not.toHaveBeenCalled();
    });

    it('rejects empty bundles and self-links before calling the RPC', async () => {
        const familyId = '10000000-0000-4000-8000-000000000001';
        const requestId = '20000000-0000-4000-8000-000000000001';
        const personId = '30000000-0000-4000-8000-000000000001';
        await expect(submitFamilyEdit(familyId, requestId, {})).rejects.toThrow(
            'Edit bundle must contain at least one genealogy edit',
        );
        await expect(submitFamilyEdit(familyId, requestId, {
            parent_links: [{
                ref: '40000000-0000-4000-8000-000000000001',
                parent_ref: personId,
                child_ref: personId,
                relationship_type: 'biological',
            }],
        })).rejects.toThrow('Parent and child must be distinct');
        expect(rpc).not.toHaveBeenCalled();
    });

    it('rejects invented exact precision while accepting exact or text-only dates', async () => {
        const familyId = '10000000-0000-4000-8000-000000000001';
        const requestId = '20000000-0000-4000-8000-000000000001';
        const personRef = '30000000-0000-4000-8000-000000000001';
        const event = {
            ref: '40000000-0000-4000-8000-000000000001',
            person_ref: personRef,
            event_type: 'birth' as const,
        };
        await expect(submitFamilyEdit(familyId, requestId, {
            events: [{ ...event, date_text: 'circa 2000', date_start: '2000-01-01' }],
        })).rejects.toThrow('imprecise date_text cannot include invented exact dates');
        rpc.mockResolvedValue({
            data: { submission_id: '50000000-0000-4000-8000-000000000001', status: 'pending' },
            error: null,
        });
        await expect(submitFamilyEdit(familyId, requestId, {
            events: [{ ...event, date_text: 'circa 2000' }],
        })).resolves.toMatchObject({ status: 'pending' });
        await expect(submitFamilyEdit(familyId, requestId, {
            events: [{ ...event, date_text: '2000-01-01', date_start: '2000-01-01' }],
        })).resolves.toMatchObject({ status: 'pending' });
    });

    it('calls typed approval and rejection RPCs', async () => {
        const submissionId = '40000000-0000-4000-8000-000000000001';
        rpc
            .mockResolvedValueOnce({ data: { submission_id: submissionId, status: 'approved' }, error: null })
            .mockResolvedValueOnce({ data: { submission_id: submissionId, status: 'rejected' }, error: null });

        await expect(approveFamilySubmission(submissionId, 'Reviewed')).resolves.toEqual({
            submission_id: submissionId,
            status: 'approved',
        });
        await expect(rejectFamilySubmission(submissionId)).resolves.toEqual({
            submission_id: submissionId,
            status: 'rejected',
        });
        expect(rpc).toHaveBeenNthCalledWith(1, 'approve_family_submission', {
            p_submission_id: submissionId,
            p_review_note: 'Reviewed',
        });
        expect(rpc).toHaveBeenNthCalledWith(2, 'reject_family_submission', {
            p_submission_id: submissionId,
        });
    });

    it('surfaces moderation RPC errors and rejects internal result fields', async () => {
        const submissionId = '40000000-0000-4000-8000-000000000001';
        rpc.mockResolvedValueOnce({ data: null, error: { message: 'admin authorization required' } });
        await expect(approveFamilySubmission(submissionId)).rejects.toThrow(
            'Failed to approve family submission: admin authorization required',
        );

        rpc.mockResolvedValueOnce({
            data: { submission_id: submissionId, status: 'approved', reviewed_by: 'secret' },
            error: null,
        });
        await expect(approveFamilySubmission(submissionId)).rejects.toThrow();
    });
});
