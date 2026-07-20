import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FamilyGraph, SubmissionResult } from '../src/services/data/familyRepository';
import {
    FamilyEditAttempt,
    FamilyEditSubmitter,
    FamilyCreationSubmitter,
    getAnonymousActorSecret,
    mapChildEdit,
    mapProfileEdit,
    mapSpouseEdit,
    type PersonFields,
} from '../src/ui/editor/submission';
import { suggestFamilySlug } from '../src/ui/editor';

const ids = {
    family1: '10000000-0000-4000-8000-000000000001',
    family2: '10000000-0000-4000-8000-000000000002',
    parent1: '20000000-0000-4000-8000-000000000001',
    parent2: '20000000-0000-4000-8000-000000000002',
    personRevision1: '21000000-0000-4000-8000-000000000001',
    personRevision2: '21000000-0000-4000-8000-000000000002',
};
const created_at = '2026-01-01T00:00:00Z';
const revisionBase = { submission_id: null, base_revision_id: null, created_at, reviewed_at: null };

function graph(): FamilyGraph {
    const person = (id: string, revisionId: string, display_name: string) => ({
        id, created_at,
        current_revision: {
            ...revisionBase, id: revisionId, status: 'approved' as const,
            given_name: display_name.split(' ')[0], middle_names: null,
            family_name: display_name.split(' ')[1], display_name, aliases: [],
            gender: null, is_living: true, summary: null, privacy: 'public' as const,
        },
        pending_revisions: [],
    });
    const membership = (id: string, family_id: string, person_id: string, revisionId: string) => ({
        id, family_id, person_id, created_at,
        current_revision: { ...revisionBase, id: revisionId, status: 'approved' as const },
        pending_revisions: [],
    });
    return {
        families: [
            { id: ids.family1, slug: 'alpha', name: 'Alpha', root_person_id: ids.parent1, created_at },
            { id: ids.family2, slug: 'beta', name: 'Beta', root_person_id: ids.parent2, created_at },
        ],
        people: [
            person(ids.parent1, ids.personRevision1, 'Parent One'),
            person(ids.parent2, ids.personRevision2, 'Parent Two'),
        ],
        life_events: [{
            id: '30000000-0000-4000-8000-000000000001', person_id: ids.parent1, created_at,
            current_revision: {
                ...revisionBase, id: '31000000-0000-4000-8000-000000000001', status: 'approved',
                event_type: 'birth', date_start: '1980-01-01', date_end: '1980-01-01',
                date_text: '1980-01-01', place_text: 'Old Town', details: null, certainty: 1,
            }, pending_revisions: [],
        }],
        partnerships: [], parent_links: [],
        memberships: [
            membership('60000000-0000-4000-8000-000000000001', ids.family1, ids.parent1, '61000000-0000-4000-8000-000000000001'),
            membership('60000000-0000-4000-8000-000000000002', ids.family2, ids.parent2, '61000000-0000-4000-8000-000000000002'),
        ],
        media: [], sources: [], submissions: [],
    };
}

function fields(overrides: Partial<PersonFields> = {}): PersonFields {
    return {
        first_name: 'Synthetic', last_name: 'Person', gender: 'U',
        birth_date: 'circa 1980', birthplace: 'New Town', death_date: '', death_place: '',
        occupation: 'Engineer', marriage: '', note: 'Synthetic note', ...overrides,
    };
}

function idsFrom(start = 1) {
    let value = start;
    return () => `90000000-0000-4000-8000-${String(value++).padStart(12, '0')}`;
}

class MemoryStorage implements Storage {
    private data = new Map<string, string>();
    get length() { return this.data.size; }
    clear() { this.data.clear(); }
    getItem(key: string) { return this.data.get(key) ?? null; }
    key(index: number) { return [...this.data.keys()][index] ?? null; }
    removeItem(key: string) { this.data.delete(key); }
    setItem(key: string, value: string) { this.data.set(key, value); }
}

describe('editor bundle mapping', () => {
    it('suggests an editable ASCII family slug without rendering input as markup', () => {
        expect(suggestFamilySlug('  Şelçuk Öztürk Ailesi  ')).toBe('selcuk-ozturk-ailesi');
        expect(suggestFamilySlug('<img src=x onerror=alert(1)>')).toBe('img-src-x-onerror-alert-1');
    });
    it('maps a full profile update using date_text without inventing exact precision', () => {
        const bundle = mapProfileEdit(graph(), ids.parent1, fields({
            source_title: 'Registry', source_url: 'https://example.test/source',
            media_url: 'https://example.test/photo.webp', media_type: 'image/webp',
        }), undefined, idsFrom());

        expect(bundle.people?.[0]).toMatchObject({
            ref: ids.parent1, person_id: ids.parent1, base_revision_id: ids.personRevision1,
            display_name: 'Synthetic Person', summary: 'Synthetic note', privacy: 'public',
        });
        expect(bundle.events).toEqual(expect.arrayContaining([
            expect.objectContaining({
                event_id: '30000000-0000-4000-8000-000000000001',
                base_revision_id: '31000000-0000-4000-8000-000000000001',
                event_type: 'birth', date_text: 'circa 1980', place_text: 'New Town',
            }),
            expect.objectContaining({ event_type: 'occupation', details: 'Engineer' }),
        ]));
        expect(bundle.events?.[0]).not.toHaveProperty('date_start');
        expect(bundle.sources).toBeUndefined();
        expect(bundle.media?.[0]).toMatchObject({ person_ref: ids.parent1, mime_type: 'image/jpeg' });
    });

    it('maps spouse creation as one atomic person, membership, partnership, and event bundle', () => {
        const bundle = mapSpouseEdit(graph(), ids.parent1, fields(), 'circa 2005', idsFrom());
        const spouse = bundle.people?.[0].ref;
        expect(bundle.memberships).toEqual([expect.objectContaining({ person_ref: spouse })]);
        expect(bundle.partnerships).toEqual([expect.objectContaining({
            person1_ref: ids.parent1, person2_ref: spouse, date_text: 'circa 2005',
        })]);
        expect(bundle.events).toEqual(expect.arrayContaining([expect.objectContaining({ person_ref: spouse })]));
    });

    it('maps one/two-parent children and adds an existing cross-family parent to the target family', () => {
        const oneParent = mapChildEdit(graph(), ids.parent1, fields(), {}, ids.family1, idsFrom());
        expect(oneParent.parent_links).toHaveLength(1);

        const twoParents = mapChildEdit(
            graph(), ids.parent1, fields(), { personId: ids.parent2 }, ids.family1, idsFrom(20),
        );
        expect(twoParents.parent_links?.map(link => link.parent_ref)).toEqual([ids.parent1, ids.parent2]);
        expect(twoParents.memberships).toEqual(expect.arrayContaining([
            expect.objectContaining({ person_ref: ids.parent2 }),
        ]));

        const newParent = mapChildEdit(
            graph(), ids.parent1, fields(), { fields: fields({ first_name: 'New', last_name: 'Parent' }) },
            ids.family1, idsFrom(40),
        );
        expect(newParent.people).toHaveLength(2);
        expect(newParent.memberships).toHaveLength(2);
        expect(newParent.parent_links).toHaveLength(2);
    });

    it('omits an unchanged partnership so a shared Alpha/Beta graph profile edit stays family-valid', () => {
        const shared = graph();
        shared.partnerships.push({
            id: '40000000-0000-4000-8000-000000000001', person1_id: ids.parent1, person2_id: ids.parent2, created_at,
            current_revision: {
                ...revisionBase, id: '41000000-0000-4000-8000-000000000001', status: 'approved',
                partnership_type: 'marriage', date_start: null, date_end: null, date_text: '2000', status_text: null,
            }, pending_revisions: [],
        });
        const bundle = mapProfileEdit(shared, ids.parent1, fields({ marriage: '2000' }), ids.family1, idsFrom());
        expect(bundle.partnerships).toBeUndefined();
        expect(() => mapProfileEdit(shared, ids.parent1, fields({ marriage: '2001' }), ids.family1, idsFrom()))
            .toThrow('Her iki kişiyi içeren aileyi seçin');
    });

    it('preserves unchanged exact dates and maps canonical or imprecise edits consistently', () => {
        const unchanged = mapProfileEdit(graph(), ids.parent1, fields({
            first_name: 'Parent', last_name: 'One', birth_date: '1980-01-01', birthplace: 'Old Town',
            occupation: '', note: '',
        }), ids.family1, idsFrom());
        expect(unchanged.events?.[0]).toMatchObject({
            date_start: '1980-01-01', date_end: '1980-01-01', date_text: '1980-01-01',
        });

        const range = mapProfileEdit(graph(), ids.parent1, fields({ birth_date: '1980-01-01/1980-01-31' }), ids.family1, idsFrom());
        expect(range.events?.[0]).toMatchObject({
            date_start: '1980-01-01', date_end: '1980-01-31', date_text: '1980-01-01/1980-01-31',
        });
        const imprecise = mapProfileEdit(graph(), ids.parent1, fields({ birth_date: 'circa 1980' }), ids.family1, idsFrom());
        expect(imprecise.events?.[0]).toMatchObject({ date_text: 'circa 1980' });
        expect(imprecise.events?.[0]).not.toHaveProperty('date_start');
    });
});

describe('anonymous submission identity', () => {
    const storage = new MemoryStorage();

    beforeEach(() => {
        storage.clear();
        vi.stubGlobal('localStorage', storage);
    });

    it('creates one high-entropy local actor secret and reuses it without URL or logging', () => {
        const first = getAnonymousActorSecret(storage);
        expect(first.length).toBeGreaterThanOrEqual(43);
        expect(getAnonymousActorSecret(storage)).toBe(first);
        expect(storage.length).toBe(1);
    });

    it('retries a failed payload with the same request ID and uses a new ID after success', async () => {
        const result: SubmissionResult = { submission_id: '80000000-0000-4000-8000-000000000001', status: 'pending' };
        const submit = vi.fn()
            .mockRejectedValueOnce(new Error('network unavailable'))
            .mockResolvedValue(result);
        const coordinator = new FamilyEditSubmitter(submit);
        const bundle = mapProfileEdit(graph(), ids.parent1, fields(), undefined, idsFrom());

        await expect(coordinator.send(ids.family1, bundle)).rejects.toThrow('network unavailable');
        await expect(coordinator.send(ids.family1, bundle)).resolves.toEqual(result);
        expect(submit.mock.calls[1][1]).toBe(submit.mock.calls[0][1]);
        expect(submit.mock.calls[1][3]).toBe(submit.mock.calls[0][3]);

        await coordinator.send(ids.family1, bundle);
        expect(submit.mock.calls[2][1]).not.toBe(submit.mock.calls[1][1]);
    });

    it('returns the same in-flight promise and makes only one network call on double submit', async () => {
        let resolve!: (value: SubmissionResult) => void;
        const submit = vi.fn(() => new Promise<SubmissionResult>(done => { resolve = done; }));
        const coordinator = new FamilyEditSubmitter(submit);
        const bundle = mapProfileEdit(graph(), ids.parent1, fields(), undefined, idsFrom());
        const first = coordinator.send(ids.family1, bundle);
        const second = coordinator.send(ids.family1, bundle);
        expect(second).toBe(first);
        expect(submit).toHaveBeenCalledTimes(1);
        resolve({ submission_id: '80000000-0000-4000-8000-000000000001', status: 'pending' });
        await first;
    });

    it('caches mapped spouse IDs and request identity across a failed form retry', async () => {
        const result: SubmissionResult = { submission_id: '80000000-0000-4000-8000-000000000001', status: 'pending' };
        const submit = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(result);
        const attempt = new FamilyEditAttempt(new FamilyEditSubmitter(submit));
        const map = vi.fn(() => mapSpouseEdit(graph(), ids.parent1, fields(), '2005', idsFrom()));

        await expect(attempt.send(ids.family1, map)).rejects.toThrow('offline');
        await expect(attempt.send(ids.family1, map)).resolves.toEqual(result);
        expect(map).toHaveBeenCalledTimes(1);
        expect(submit.mock.calls[1][1]).toBe(submit.mock.calls[0][1]);
        expect(submit.mock.calls[1][2]).toEqual(submit.mock.calls[0][2]);
    });

    it('reuses family-creation request identity after failure and dedupes double submit', async () => {
        const result: SubmissionResult = { submission_id: '80000000-0000-4000-8000-000000000001', status: 'pending' };
        let resolve!: (value: SubmissionResult) => void;
        const submit = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockImplementationOnce(() => new Promise<SubmissionResult>(done => { resolve = done; }));
        const coordinator = new FamilyCreationSubmitter(submit);
        const input = {
            sourceFamilyId: ids.family1, rootPersonId: ids.parent1,
            name: 'New Family', slug: 'new-family',
        };
        await expect(coordinator.send(input)).rejects.toThrow('offline');
        const retry = coordinator.send(input);
        expect(coordinator.send(input)).toBe(retry);
        expect(submit.mock.calls[1][1]).toBe(submit.mock.calls[0][1]);
        expect(submit.mock.calls[1][2]).toBe(submit.mock.calls[0][2]);
        resolve(result);
        await expect(retry).resolves.toEqual(result);
    });
});
