import { z } from 'zod';
import { getSupabaseClient } from '../supabase/client';
import { familyTreePeople } from './familyLineage';

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable();
const nullableString = z.string().nullable();
const optionalText = (max: number) => z.string().max(max).optional();
const httpsUrl = z.string().url().max(2000).refine(value => value.startsWith('https://'), 'URL must use HTTPS');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const anonymousActorSecret = z.string().min(32).max(256);

function validateDatePrecision(
    value: { date_start?: string; date_end?: string; date_text?: string },
    context: z.RefinementCtx,
    label: string,
): void {
    if (value.date_end && !value.date_start) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: label + ' date_end requires date_start' });
    }
    if (value.date_start && value.date_end && value.date_start > value.date_end) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: label + ' date_start cannot exceed date_end' });
    }
    if (value.date_text && value.date_start) {
        const exact = value.date_end && value.date_end !== value.date_start
            ? value.date_start + '/' + value.date_end
            : value.date_start;
        if (value.date_text !== exact) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: label + ' imprecise date_text cannot include invented exact dates',
            });
        }
    }
}

const revisionBase = {
    id: uuid,
    submission_id: nullableUuid,
    base_revision_id: nullableUuid,
    created_at: z.string(),
    reviewed_at: nullableString,
};

const personRevisionSchema = z.object({
    ...revisionBase,
    status: z.enum(['approved', 'pending']),
    given_name: nullableString,
    middle_names: nullableString,
    family_name: nullableString,
    display_name: z.string(),
    aliases: z.array(z.string()),
    gender: nullableString,
    is_living: z.boolean().nullable(),
    summary: nullableString,
    privacy: z.literal('public'),
}).strict();

const lifeEventRevisionSchema = z.object({
    ...revisionBase,
    status: z.enum(['approved', 'pending']),
    event_type: z.enum(['birth', 'death', 'residence', 'education', 'occupation', 'other']),
    date_start: nullableString,
    date_end: nullableString,
    date_text: nullableString,
    place_text: nullableString,
    details: nullableString,
    certainty: z.number().nullable(),
}).strict();

const partnershipRevisionSchema = z.object({
    ...revisionBase,
    status: z.enum(['approved', 'pending']),
    partnership_type: z.enum(['marriage', 'civil_union', 'domestic_partnership', 'other']),
    // Legacy remote migrations may still return this field; rendering does not use it.
    primary_person_id: nullableUuid.optional(),
    date_start: nullableString,
    date_end: nullableString,
    date_text: nullableString,
    status_text: nullableString,
}).strict();

const parentLinkRevisionSchema = z.object({
    ...revisionBase,
    status: z.enum(['approved', 'pending']),
    relationship_type: z.enum(['biological', 'adoptive', 'step', 'foster', 'guardian']),
    certainty: z.number().nullable(),
}).strict();

const membershipRevisionSchema = z.object({
    ...revisionBase,
    status: z.enum(['approved', 'pending']),
}).strict();

const entityBase = {
    id: uuid,
    created_at: z.string(),
};

export const familyGraphSchema = z.object({
    families: z.array(z.object({
        ...entityBase,
        slug: z.string(),
        name: z.string(),
        root_person_id: nullableUuid,
    }).strict()),
    people: z.array(z.object({
        ...entityBase,
        current_revision: personRevisionSchema.nullable(),
        pending_revisions: z.array(personRevisionSchema),
    }).strict()),
    life_events: z.array(z.object({
        ...entityBase,
        person_id: uuid,
        current_revision: lifeEventRevisionSchema.nullable(),
        pending_revisions: z.array(lifeEventRevisionSchema),
    }).strict()),
    partnerships: z.array(z.object({
        ...entityBase,
        person1_id: uuid,
        person2_id: uuid,
        current_revision: partnershipRevisionSchema.nullable(),
        pending_revisions: z.array(partnershipRevisionSchema),
    }).strict()),
    parent_links: z.array(z.object({
        ...entityBase,
        parent_id: uuid,
        child_id: uuid,
        current_revision: parentLinkRevisionSchema.nullable(),
        pending_revisions: z.array(parentLinkRevisionSchema),
    }).strict()),
    memberships: z.array(z.object({
        ...entityBase,
        family_id: uuid,
        person_id: uuid,
        current_revision: membershipRevisionSchema.nullable(),
        pending_revisions: z.array(membershipRevisionSchema),
    }).strict()),
    lineage_memberships: z.array(z.object({ family_id: uuid, person_id: uuid }).strict()).default([]),
    all_lineage_memberships: z.array(z.object({ family_id: uuid, person_id: uuid }).strict()).default([]),
    media: z.array(z.object({
        ...revisionBase,
        person_id: uuid,
        status: z.enum(['approved', 'pending']),
        storage_path: nullableString,
        legacy_uri: nullableString,
        mime_type: z.string(),
        caption: nullableString,
    }).strict()),
    sources: z.array(z.object({
        id: uuid,
        submission_id: uuid,
        submission_status: z.enum(['approved', 'pending']),
        title: z.string(),
        url: nullableString,
        citation: nullableString,
        created_at: z.string(),
    }).strict()),
    submissions: z.array(z.object({
        id: uuid,
        status: z.enum(['pending', 'approved', 'rejected', 'superseded', 'conflict']),
        created_at: z.string(),
        updated_at: z.string(),
        reviewed_at: nullableString,
    }).strict()),
    family_creation_proposals: z.array(z.object({
        id: uuid,
        submission_id: uuid,
        status: z.literal('pending'),
        slug: z.string(),
        name: z.string(),
        root_person_id: uuid,
        root_display_name: z.string(),
        source_family_id: uuid,
        source_family_slug: z.string(),
        source_family_name: z.string(),
        created_at: z.string(),
        updated_at: z.string(),
        reviewed_at: nullableString,
    }).strict()).default([]),
}).strict();

export type FamilyGraph = z.infer<typeof familyGraphSchema>;
export type FamilyGraphPerson = FamilyGraph['people'][number];
export type FamilyGraphPartnership = FamilyGraph['partnerships'][number];
export type FamilyGraphParentLink = FamilyGraph['parent_links'][number];

export const publicFamilySchema = z.object({
    id: uuid,
    slug: z.string(),
    name: z.string(),
}).strict();
export type PublicFamily = z.infer<typeof publicFamilySchema>;

const personEditSchema = z.object({
    ref: uuid,
    person_id: uuid.optional(),
    base_revision_id: uuid.optional(),
    given_name: optionalText(200),
    middle_names: optionalText(300),
    family_name: optionalText(200),
    display_name: z.string().min(1).max(300),
    aliases: z.array(z.string().max(200)).max(20).optional(),
    gender: optionalText(50),
    is_living: z.boolean().optional(),
    summary: optionalText(5000),
    privacy: z.enum(['public', 'family', 'private']).optional(),
}).strict().superRefine((person, context) => {
    const existing = person.person_id !== undefined || person.base_revision_id !== undefined;
    if (existing && (!person.person_id || !person.base_revision_id || person.ref !== person.person_id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Existing people require matching ref, person_id, and base_revision_id' });
    }
});

const eventEditSchema = z.object({
    ref: uuid,
    event_id: uuid.optional(),
    base_revision_id: uuid.optional(),
    person_ref: uuid,
    event_type: z.enum(['birth', 'death', 'residence', 'education', 'occupation', 'other']),
    date_start: date.optional(),
    date_end: date.optional(),
    date_text: optionalText(200),
    place_text: optionalText(500),
    details: optionalText(2000),
    certainty: z.number().min(0).max(1).optional(),
}).strict().superRefine((event, context) => {
    if ((event.event_id === undefined) !== (event.base_revision_id === undefined)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Event updates require event_id and base_revision_id' });
    }
    validateDatePrecision(event, context, 'Event');
});

const partnershipEditSchema = z.object({
    ref: uuid,
    partnership_id: uuid.optional(),
    base_revision_id: uuid.optional(),
    person1_ref: uuid,
    person2_ref: uuid,
    partnership_type: z.enum(['marriage', 'civil_union', 'domestic_partnership', 'other']),
    date_start: date.optional(),
    date_end: date.optional(),
    date_text: optionalText(200),
    status_text: optionalText(200),
}).strict().superRefine((partnership, context) => {
    if ((partnership.partnership_id === undefined) !== (partnership.base_revision_id === undefined)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Partnership updates require partnership_id and base_revision_id' });
    }
    if (partnership.person1_ref === partnership.person2_ref) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Partnership endpoints must be distinct' });
    }
    validateDatePrecision(partnership, context, 'Partnership');
});

const parentLinkEditSchema = z.object({
    ref: uuid,
    parent_link_id: uuid.optional(),
    base_revision_id: uuid.optional(),
    parent_ref: uuid,
    child_ref: uuid,
    relationship_type: z.enum(['biological', 'adoptive', 'step', 'foster', 'guardian']),
    certainty: z.number().min(0).max(1).optional(),
}).strict().superRefine((link, context) => {
    if ((link.parent_link_id === undefined) !== (link.base_revision_id === undefined)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Parent-link updates require parent_link_id and base_revision_id' });
    }
    if (link.parent_ref === link.child_ref) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Parent and child must be distinct' });
    }
});

const membershipEditSchema = z.object({
    ref: uuid,
    membership_id: uuid.optional(),
    base_revision_id: uuid.optional(),
    person_ref: uuid,
}).strict().superRefine((membership, context) => {
    if ((membership.membership_id === undefined) !== (membership.base_revision_id === undefined)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Membership updates require membership_id and base_revision_id' });
    }
    if (membership.membership_id && membership.ref !== membership.membership_id) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Membership update ref must match membership_id' });
    }
});

export const familyEditBundleSchema = z.object({
    message: optionalText(2000),
    submitter_name: optionalText(200),
    submitter_contact: optionalText(320),
    people: z.array(personEditSchema).max(20).optional(),
    events: z.array(eventEditSchema).max(40).optional(),
    partnerships: z.array(partnershipEditSchema).max(20).optional(),
    parent_links: z.array(parentLinkEditSchema).max(40).optional(),
    memberships: z.array(membershipEditSchema).max(20).optional(),
    sources: z.array(z.object({
        title: z.string().min(1).max(500),
        url: httpsUrl.optional(),
        citation: optionalText(2000),
    }).strict()).max(20).optional(),
    media: z.array(z.object({
        person_ref: uuid,
        url: httpsUrl,
        mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
        caption: optionalText(500),
    }).strict()).max(20).optional(),
}).strict().superRefine((bundle, context) => {
    const editCount = (bundle.people?.length ?? 0)
        + (bundle.events?.length ?? 0)
        + (bundle.partnerships?.length ?? 0)
        + (bundle.parent_links?.length ?? 0)
        + (bundle.memberships?.length ?? 0)
        + (bundle.media?.length ?? 0);
    if (editCount === 0) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Edit bundle must contain at least one genealogy edit' });
    }
    if (bundle.sources?.length && bundle.people?.some(person => person.privacy && person.privacy !== 'public')) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Sources require an entirely public edit bundle' });
    }
});

export const submissionResultSchema = z.object({
    submission_id: uuid,
    status: z.enum(['pending', 'approved', 'rejected', 'conflict']),
}).strict();

export const moderationResultSchema = z.object({
    submission_id: uuid,
    status: z.enum(['approved', 'rejected', 'conflict']),
}).strict();

export type FamilyEditBundle = z.infer<typeof familyEditBundleSchema>;
export type SubmissionResult = z.infer<typeof submissionResultSchema>;
export type ModerationResult = z.infer<typeof moderationResultSchema>;

export const familyCreationInputSchema = z.object({
    sourceFamilyId: uuid,
    personId: uuid,
    name: z.string().trim().min(1).max(200),
    slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
}).strict();
export type FamilyCreationInput = z.infer<typeof familyCreationInputSchema>;

function emptyGraph(): FamilyGraph {
    return {
        families: [],
        people: [],
        life_events: [],
        partnerships: [],
        parent_links: [],
        memberships: [],
        lineage_memberships: [],
        all_lineage_memberships: [],
        media: [],
        sources: [],
        submissions: [],
        family_creation_proposals: [],
    };
}

async function addFamilyCreationProposals(graph: FamilyGraph, includePending: boolean): Promise<FamilyGraph> {
    if (!includePending || !graph.families.length) return graph;
    const { data, error } = await getSupabaseClient().rpc('list_family_creation_proposals', {
        p_source_family_ids: graph.families.map(family => family.id),
    });
    if (error) throw new Error(`Failed to load family creation proposals: ${error.message}`);
    graph.family_creation_proposals = familyGraphSchema.shape.family_creation_proposals.parse(data);
    for (const proposal of graph.family_creation_proposals) {
        if (!graph.submissions.some(submission => submission.id === proposal.submission_id)) {
            graph.submissions.push({
                id: proposal.submission_id, status: proposal.status,
                created_at: proposal.created_at, updated_at: proposal.updated_at,
                reviewed_at: proposal.reviewed_at,
            });
        }
    }
    return graph;
}

async function addLineageMemberships(graph: FamilyGraph, familyIds = graph.families.map(family => family.id)): Promise<FamilyGraph> {
    if (!graph.families.length) return graph;
    const { data, error } = await getSupabaseClient().rpc('get_family_lineage_members', {
        p_family_ids: familyIds,
    });
    if (error) throw new Error(`Failed to load family lineage: ${error.message}`);
    graph.all_lineage_memberships = familyGraphSchema.shape.all_lineage_memberships.parse(data);
    const selected = new Set(graph.families.map(family => family.id));
    graph.lineage_memberships = graph.all_lineage_memberships.filter(item => selected.has(item.family_id));
    return graph;
}

export function normalizeFamilySlugs(values: string[]): string[] {
    const slugs = [...new Set(values.flatMap(value => value.split(','))
        .map(value => value.trim())
        .filter(Boolean))];
    for (const slug of slugs) {
        if (slug.length > 100) throw new Error(`Family slug exceeds the 100-character limit: ${slug.slice(0, 30)}...`);
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
            throw new Error(`Invalid family slug "${slug}". Use lowercase letters, numbers, and single hyphens.`);
        }
    }
    return slugs;
}

export async function listPublicFamilies(): Promise<PublicFamily[]> {
    const { data, error } = await getSupabaseClient().rpc('list_public_families');
    if (error) throw new Error(`Failed to list public families: ${error.message}`);
    return z.array(publicFamilySchema).parse(data);
}

export async function getFamilyGraph(
    familyIds: string[],
    includePending = false,
): Promise<FamilyGraph> {
    if (familyIds.length === 0) return emptyGraph();

    const { data, error } = await getSupabaseClient().rpc('get_family_graph', {
        p_family_ids: familyIds,
        p_include_pending: includePending,
    });

    if (error) throw new Error(`Failed to load family graph: ${error.message}`);
    return addLineageMemberships(familyGraphSchema.parse(data));
}

export async function getFamilyGraphBySlugs(
    familySlugs: string[],
    includePending = false,
    allFamilyIds?: string[],
): Promise<FamilyGraph> {
    const slugs = normalizeFamilySlugs(familySlugs);
    if (slugs.length === 0) return emptyGraph();
    const { data, error } = await getSupabaseClient().rpc('get_family_graph_by_slugs', {
        p_family_slugs: slugs,
        p_include_pending: includePending,
    });
    if (error) throw new Error(`Failed to load family graph: ${error.message}`);
    const graph = familyGraphSchema.parse(data);
    const families = new Map(graph.families.map(family => [family.slug, family]));
    const missing = slugs.filter(slug => !families.has(slug));
    if (missing.length) throw new Error(`Unknown family slug(s): ${missing.join(', ')}`);
    graph.families = slugs.map(slug => families.get(slug)!);
    if (includePending && allFamilyIds?.length) {
        const { data: allData, error: allError } = await getSupabaseClient().rpc('get_family_graph', {
            p_family_ids: allFamilyIds,
            p_include_pending: true,
        });
        if (allError) throw new Error(`Failed to load pending family lineage: ${allError.message}`);
        const allGraph = familyGraphSchema.parse(allData);
        const selectedFamilies = new Set(graph.families.map(family => family.id));
        const pendingMemberships = allGraph.memberships.filter(membership => membership.pending_revisions.length);
        const treePeople = new Set<string>();
        for (const membership of pendingMemberships) {
            if (selectedFamilies.has(membership.family_id)) {
                for (const person of familyTreePeople(allGraph, membership.person_id)) treePeople.add(person);
            }
        }
        const merge = <T extends { id: string }>(left: T[], right: T[]) =>
            [...new Map([...left, ...right].map(item => [item.id, item])).values()];
        graph.memberships = merge(graph.memberships, [
            ...pendingMemberships,
            ...allGraph.memberships.filter(item => treePeople.has(item.person_id)),
        ]);
        graph.people = merge(graph.people, allGraph.people.filter(item => treePeople.has(item.id)));
        graph.life_events = merge(graph.life_events, allGraph.life_events.filter(item => treePeople.has(item.person_id)));
        graph.media = merge(graph.media, allGraph.media.filter(item => treePeople.has(item.person_id)));
        graph.parent_links = merge(graph.parent_links, allGraph.parent_links.filter(item =>
            treePeople.has(item.parent_id) && treePeople.has(item.child_id)));
        graph.partnerships = merge(graph.partnerships, allGraph.partnerships.filter(item =>
            treePeople.has(item.person1_id) && treePeople.has(item.person2_id)));
        graph.submissions = merge(graph.submissions, allGraph.submissions);
    }
    return addLineageMemberships(await addFamilyCreationProposals(graph, includePending), allFamilyIds);
}

export async function submitFamilyEdit(
    familyId: string,
    clientRequestId: string,
    bundle: FamilyEditBundle,
    actorSecret?: string,
): Promise<SubmissionResult> {
    const { data, error } = await getSupabaseClient().rpc('submit_family_edit', {
        p_family_id: uuid.parse(familyId),
        p_client_request_id: uuid.parse(clientRequestId),
        p_bundle: familyEditBundleSchema.parse(bundle),
        ...(actorSecret === undefined
            ? {}
            : { p_anonymous_actor_secret: anonymousActorSecret.parse(actorSecret) }),
    });
    if (error) throw new Error('Failed to submit family edit: ' + error.message);
    return submissionResultSchema.parse(data);
}

export async function submitFamilyCreation(
    input: FamilyCreationInput,
    clientRequestId: string,
    actorSecret?: string,
): Promise<SubmissionResult> {
    const value = familyCreationInputSchema.parse(input);
    const { data, error } = await getSupabaseClient().rpc('submit_family_creation', {
        p_source_family_id: value.sourceFamilyId,
        p_root_person_id: value.personId,
        p_client_request_id: uuid.parse(clientRequestId),
        p_name: value.name,
        p_slug: value.slug,
        ...(actorSecret === undefined ? {} : { p_anonymous_actor_secret: anonymousActorSecret.parse(actorSecret) }),
    });
    if (error) throw new Error('Failed to submit family creation: ' + error.message);
    return submissionResultSchema.parse(data);
}

export const mergedPersonFieldsSchema = z.object({
    given_name: nullableString, middle_names: nullableString, family_name: nullableString,
    gender: nullableString, is_living: z.boolean().nullable(), summary: nullableString,
    aliases: z.array(z.string().max(200)).max(20),
    birth_date: nullableString, birthplace: nullableString,
    death_date: nullableString, death_place: nullableString, occupation: nullableString,
}).strict();
export type MergedPersonFields = z.infer<typeof mergedPersonFieldsSchema>;

export async function unifyPeople(
    sourcePersonId: string,
    targetPersonId: string,
    fields: MergedPersonFields,
): Promise<void> {
    const { error } = await getSupabaseClient().rpc('admin_unify_person_resolved', {
        p_source_person_id: uuid.parse(sourcePersonId),
        p_target_person_id: uuid.parse(targetPersonId),
        p_fields: mergedPersonFieldsSchema.parse(fields),
    });
    if (error) throw new Error('Kişiler birleştirilemedi: ' + error.message);
}

export async function submitPersonMerge(
    familyId: string,
    clientRequestId: string,
    sourcePersonId: string,
    targetPersonId: string,
    fields: MergedPersonFields,
    actorSecret?: string,
): Promise<SubmissionResult> {
    const { data, error } = await getSupabaseClient().rpc('submit_person_merge', {
        p_family_id: uuid.parse(familyId), p_client_request_id: uuid.parse(clientRequestId),
        p_source_person_id: uuid.parse(sourcePersonId), p_target_person_id: uuid.parse(targetPersonId),
        p_fields: mergedPersonFieldsSchema.parse(fields),
        ...(actorSecret === undefined ? {} : { p_anonymous_actor_secret: anonymousActorSecret.parse(actorSecret) }),
    });
    if (error) throw new Error('Kişi birleştirme önerilemedi: ' + error.message);
    return submissionResultSchema.parse(data);
}

async function moderateFamilySubmission(
    decision: 'approve' | 'reject',
    submissionId: string,
    reviewNote?: string,
): Promise<ModerationResult> {
    const rpc = decision === 'approve' ? 'approve_family_submission' : 'reject_family_submission';
    const { data, error } = await getSupabaseClient().rpc(rpc, {
        p_submission_id: uuid.parse(submissionId),
        ...(reviewNote === undefined ? {} : { p_review_note: z.string().max(2000).parse(reviewNote) }),
    });
    if (error) throw new Error('Failed to ' + decision + ' family submission: ' + error.message);
    return moderationResultSchema.parse(data);
}

export function approveFamilySubmission(submissionId: string, reviewNote?: string): Promise<ModerationResult> {
    return moderateFamilySubmission('approve', submissionId, reviewNote);
}

export function rejectFamilySubmission(submissionId: string, reviewNote?: string): Promise<ModerationResult> {
    return moderateFamilySubmission('reject', submissionId, reviewNote);
}
