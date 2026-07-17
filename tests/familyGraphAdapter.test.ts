import { describe, expect, it, vi } from 'vitest';
import type { FamilyGraph } from '../src/services/data/familyRepository';
import {
    familyGraphToFamilyData,
    loadRendererFamilyData,
    proposalFrame,
    selectedFamilySlugs,
} from '../src/services/data/familyGraphAdapter';
import { uniqueSearchEntries } from '../src/services/data/searchIndex';

const ids = {
    family1: '10000000-0000-4000-8000-000000000001',
    family2: '10000000-0000-4000-8000-000000000002',
    a: '20000000-0000-4000-8000-000000000001',
    b: '20000000-0000-4000-8000-000000000002',
    c: '20000000-0000-4000-8000-000000000003',
    d: '20000000-0000-4000-8000-000000000004',
    e: '20000000-0000-4000-8000-000000000005',
    f: '20000000-0000-4000-8000-000000000006',
};
const created_at = '2026-01-01T00:00:00Z';
const revisionBase = {
    submission_id: null,
    base_revision_id: null,
    created_at,
    reviewed_at: null,
};

function graph(): FamilyGraph {
    const person = (id: string, name: string, gender: string, pendingName?: string) => ({
        id,
        created_at,
        current_revision: {
            ...revisionBase,
            id: id.replace('20000000', '21000000'),
            status: 'approved' as const,
            given_name: name,
            middle_names: null,
            family_name: 'Example',
            display_name: `${name} Example`,
            aliases: [],
            gender,
            is_living: true,
            summary: name === 'Alpha' ? 'Root note' : null,
            privacy: 'public' as const,
        },
        pending_revisions: pendingName ? [{
            ...revisionBase,
            id: id.replace('20000000', '22000000'),
            status: 'pending' as const,
            given_name: pendingName,
            middle_names: null,
            family_name: 'Example',
            display_name: `${pendingName} Example`,
            aliases: [],
            gender,
            is_living: true,
            summary: null,
            privacy: 'public' as const,
        }] : [],
    });
    const partnership = (id: string, person1_id: string, person2_id: string, date: string) => ({
        id, person1_id, person2_id, created_at,
        current_revision: {
            ...revisionBase, id: id.replace('30000000', '31000000'), status: 'approved' as const,
            partnership_type: 'marriage' as const, date_start: null, date_end: null,
            date_text: date, status_text: null,
        },
        pending_revisions: [],
    });
    const parentLink = (id: string, parent_id: string, child_id: string) => ({
        id, parent_id, child_id, created_at,
        current_revision: {
            ...revisionBase, id: id.replace('40000000', '41000000'), status: 'approved' as const,
            relationship_type: 'biological' as const, certainty: 1,
        },
        pending_revisions: [],
    });
    return {
        families: [
            { id: ids.family1, slug: 'one', name: 'One', root_person_id: ids.a, created_at },
            { id: ids.family2, slug: 'two', name: 'Two', root_person_id: ids.b, created_at },
        ],
        people: [
            person(ids.a, 'Alpha', 'male', 'Pending Alpha'), person(ids.b, 'Beta', 'female'),
            person(ids.c, 'Child', 'female'), person(ids.d, 'Delta', 'female'),
            person(ids.e, 'Second Child', 'male'), person(ids.f, 'Solo Child', 'male'),
        ],
        life_events: [{
            id: '50000000-0000-4000-8000-000000000001', person_id: ids.a, created_at,
            current_revision: {
                ...revisionBase, id: '51000000-0000-4000-8000-000000000001', status: 'approved',
                event_type: 'birth', date_start: null, date_end: null, date_text: 'c. 1900',
                place_text: 'Town', details: null, certainty: null,
            },
            pending_revisions: [],
        }, {
            id: '50000000-0000-4000-8000-000000000002', person_id: ids.a, created_at,
            current_revision: {
                ...revisionBase, id: '51000000-0000-4000-8000-000000000002', status: 'approved',
                event_type: 'occupation', date_start: null, date_end: null, date_text: null,
                place_text: null, details: 'Teacher', certainty: null,
            },
            pending_revisions: [],
        }],
        partnerships: [
            partnership('30000000-0000-4000-8000-000000000001', ids.a, ids.b, '1920'),
            partnership('30000000-0000-4000-8000-000000000002', ids.a, ids.d, '1930'),
        ],
        parent_links: [
            parentLink('40000000-0000-4000-8000-000000000001', ids.a, ids.c),
            parentLink('40000000-0000-4000-8000-000000000002', ids.b, ids.c),
            parentLink('40000000-0000-4000-8000-000000000003', ids.a, ids.e),
            parentLink('40000000-0000-4000-8000-000000000004', ids.d, ids.e),
            parentLink('40000000-0000-4000-8000-000000000005', ids.a, ids.f),
        ],
        memberships: [],
        media: [{
            ...revisionBase, id: '60000000-0000-4000-8000-000000000001', person_id: ids.a,
            status: 'approved', storage_path: null, legacy_uri: 'images/alpha.jpg',
            mime_type: 'application/x-legacy-image-reference', caption: null,
        }],
        sources: [],
        submissions: [],
    };
}

describe('family graph renderer adapter', () => {
    it('indexes a person shared by combined selected families exactly once', () => {
        const combined = graph();
        combined.memberships = [{
            id: '60000000-0000-4000-8000-000000000001', family_id: ids.family1, person_id: ids.c,
            created_at, current_revision: null, pending_revisions: [],
        }, {
            id: '60000000-0000-4000-8000-000000000002', family_id: ids.family2, person_id: ids.c,
            created_at, current_revision: null, pending_revisions: [],
        }];
        const data = familyGraphToFamilyData(combined);
        const sharedId = `person_${ids.c}`;
        const index = uniqueSearchEntries([
            ...Object.values(data.members).map(member => ({ id: member.id, display: member.name })),
            { id: sharedId, display: data.members[sharedId].name },
        ], value => value.toLocaleLowerCase('tr'));

        expect(Object.keys(data.members).filter(id => id === sharedId)).toHaveLength(1);
        expect(index.filter(entry => entry.id === sharedId)).toEqual([{
            id: sharedId, display: 'Child Example', normalized: 'child example',
        }]);
    });

    it('deduplicates overlapping people and maps root metadata with stable non-legacy IDs', () => {
        const data = familyGraphToFamilyData(graph());
        const root = data.members[`person_${ids.a}`];

        expect(Object.keys(data.members)).toHaveLength(6);
        expect(data.start).toBe(`person_${ids.a}`);
        expect(root).toMatchObject({
            persistentId: ids.a, name: 'Alpha Example', birth_date: 'c. 1900',
            birthplace: 'Town', occupation: 'Teacher', image_path: 'images/alpha.jpg',
            note: 'Root note', gen: 1,
        });
        expect(data.members[`person_${ids.c}`].gen).toBe(2);
        expect(Object.keys(data.members).every(id => id.startsWith('person_'))).toBe(true);
    });

    it('uses one union per partnership, keeps multiple partnerships distinct, and does not invent a spouse', () => {
        const { links } = familyGraphToFamilyData(graph());
        const union1 = 'u_partnership_30000000-0000-4000-8000-000000000001';
        const union2 = 'u_partnership_30000000-0000-4000-8000-000000000002';
        const solo = `u_parents_${ids.a}`;

        expect(links).toContainEqual([`person_${ids.a}`, union1]);
        expect(links).toContainEqual([`person_${ids.b}`, union1]);
        expect(links).toContainEqual([union1, `person_${ids.c}`]);
        expect(links).toContainEqual([union2, `person_${ids.e}`]);
        expect(links).toContainEqual([`person_${ids.a}`, solo]);
        expect(links).toContainEqual([solo, `person_${ids.f}`]);
        expect(links.filter(([source, target]) => source === `person_${ids.a}` && target.startsWith('u_partnership_'))).toHaveLength(2);
    });

    it('selects pending revisions only when requested', () => {
        expect(familyGraphToFamilyData(graph()).members[`person_${ids.a}`].name).toBe('Alpha Example');
        expect(familyGraphToFamilyData(graph(), '80000000-0000-4000-8000-000000000001').members[`person_${ids.a}`].name)
            .toBe('Alpha Example');
    });
    it('keeps competing proposals separate and applies only the selected submission', () => {
        const competing = graph();
        competing.people[0].pending_revisions[0].submission_id = '80000000-0000-4000-8000-000000000001';
        competing.people[0].pending_revisions.push({
            ...competing.people[0].pending_revisions[0],
            id: '22000000-0000-4000-8000-000000000099',
            submission_id: '80000000-0000-4000-8000-000000000002',
            display_name: 'Competing Alpha Example',
        });
        expect(familyGraphToFamilyData(competing).members[`person_${ids.a}`].name).toBe('Alpha Example');
        expect(familyGraphToFamilyData(competing, '80000000-0000-4000-8000-000000000001').members[`person_${ids.a}`].name)
            .toBe('Pending Alpha Example');
        expect(familyGraphToFamilyData(competing, '80000000-0000-4000-8000-000000000002').members[`person_${ids.a}`].name)
            .toBe('Competing Alpha Example');
        expect(competing.people[0].pending_revisions).toHaveLength(2);
    });

    it('lets selected pending media override approved media without leaking competing media', () => {
        const pending = graph();
        pending.media.push({
            ...pending.media[0], id: '60000000-0000-4000-8000-000000000002', status: 'pending',
            submission_id: '80000000-0000-4000-8000-000000000001', legacy_uri: 'https://example.test/selected.webp',
        }, {
            ...pending.media[0], id: '60000000-0000-4000-8000-000000000003', status: 'pending',
            submission_id: '80000000-0000-4000-8000-000000000002', legacy_uri: 'https://example.test/competing.webp',
        });

        expect(familyGraphToFamilyData(pending).members[`person_${ids.a}`].image_path).toBe('images/alpha.jpg');
        expect(familyGraphToFamilyData(pending, '80000000-0000-4000-8000-000000000001')
            .members[`person_${ids.a}`].image_path).toBe('https://example.test/selected.webp');
    });

    it('frames a newly proposed relative and its immediate relationship neighborhood', () => {
        const pending = graph();
        const proposal = '80000000-0000-4000-8000-000000000001';
        const relative = '20000000-0000-4000-8000-000000000099';
        pending.people.push({
            id: relative,
            created_at,
            current_revision: null,
            pending_revisions: [{
                ...pending.people[0].current_revision!,
                id: '22000000-0000-4000-8000-000000000099',
                submission_id: proposal,
                status: 'pending',
                display_name: 'New Relative',
            }],
        });
        pending.partnerships.push({
            id: '30000000-0000-4000-8000-000000000099',
            person1_id: ids.a,
            person2_id: relative,
            created_at,
            current_revision: null,
            pending_revisions: [{
                ...revisionBase,
                id: '31000000-0000-4000-8000-000000000099',
                submission_id: proposal,
                status: 'pending',
                partnership_type: 'marriage',
                date_start: null,
                date_end: null,
                date_text: null,
                status_text: null,
            }],
        });
        const data = familyGraphToFamilyData(pending, proposal);
        const frame = proposalFrame(pending, data, proposal)!;

        expect(frame.focusId).toBe(`person_${relative}`);
        expect(frame.visibleNodes).toEqual(new Set([
            `person_${relative}`,
            'u_partnership_30000000-0000-4000-8000-000000000099',
            `person_${ids.a}`,
        ]));
    });
});

describe('family graph read orchestration', () => {
    it('trims and deduplicates URL overrides and comma-separated env defaults', () => {
        expect(selectedFamilySlugs('?family=one&family=two,one', 'ignored')).toEqual(['one', 'two']);
        expect(selectedFamilySlugs('', ' one, two,one ')).toEqual(['one', 'two']);
        expect(selectedFamilySlugs('?family=selcuk', 'ignored')).toEqual(['selcuk']);
    });

    it('rejects malformed and oversized URL or env slugs before loading', () => {
        expect(() => selectedFamilySlugs('?family=Upper_Case', 'ignored')).toThrow('Invalid family slug');
        expect(() => selectedFamilySlugs('', `${'a'.repeat(101)},valid`)).toThrow('100-character limit');
    });

    it('forwards the pending flag and returns adapted data', async () => {
        const load = vi.fn().mockResolvedValue(graph());
        await expect(loadRendererFamilyData(['one', 'two'], true, load, 'proposal')).resolves.toMatchObject({
            start: `person_${ids.a}`,
        });
        expect(load).toHaveBeenCalledWith(['one', 'two'], true);
    });

    it('surfaces missing configuration, empty graphs, and read errors', async () => {
        await expect(loadRendererFamilyData([])).rejects.toThrow('No families configured');
        await expect(loadRendererFamilyData(['one'], false, async () => ({
            families: [], people: [], life_events: [], partnerships: [], parent_links: [],
            memberships: [], media: [], sources: [], submissions: [],
        }))).rejects.toThrow('no visible people');
        await expect(loadRendererFamilyData(['one'], false, async () => {
            throw new Error('offline');
        })).rejects.toThrow('offline');
    });
});
