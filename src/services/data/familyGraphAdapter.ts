import type { FamilyData, Member } from '../../types/types';
import { getFamilyGraphBySlugs, normalizeFamilySlugs, type FamilyGraph } from './familyRepository';

type RevisionEntity<T> = { current_revision: T | null; pending_revisions: T[] };

function revision<T extends { submission_id: string | null }>(
    entity: RevisionEntity<T>,
    proposalId?: string,
): T | null {
    return proposalId
        ? entity.pending_revisions.find(candidate => candidate.submission_id === proposalId) ?? entity.current_revision
        : entity.current_revision;
}

function personId(id: string): string {
    return `person_${id}`;
}

function gender(value: string | null): Member['gender'] {
    const normalized = value?.toLocaleLowerCase('tr');
    if (['male', 'm', 'erkek', 'e'].includes(normalized ?? '')) return 'E';
    if (['female', 'f', 'kadın', 'kadin', 'k'].includes(normalized ?? '')) return 'K';
    return 'U';
}

function dateText(event: { date_text: string | null; date_start: string | null }): string | undefined {
    return event.date_text ?? event.date_start ?? undefined;
}

export function toTitleCaseTurkish(str: string): string {
    if (!str) return str;
    return str.split(/\s+/).map(word => {
        if (!word) return "";
        const first = word.charAt(0);
        const rest = word.slice(1);

        let upperFirst = first.toLocaleUpperCase('tr-TR');
        if (first === 'i') upperFirst = 'İ';
        else if (first === 'ı') upperFirst = 'I';

        let lowerRest = rest.toLocaleLowerCase('tr-TR');
        lowerRest = lowerRest
            .replace(/I/g, 'ı')
            .replace(/İ/g, 'i');

        return upperFirst + lowerRest;
    }).join(' ');
}

export function familyGraphToFamilyData(graph: FamilyGraph, proposalId?: string): FamilyData {
    const members: Record<string, Member> = {};
    const links = new Set<string>();
    const visiblePeople = new Set<string>();
    const addLink = (source: string, target: string) => links.add(`${source}\0${target}`);

    for (const person of graph.people) {
        const current = revision(person, proposalId);
        if (!current) continue;
        const id = personId(person.id);
        visiblePeople.add(person.id);
        members[id] = {
            id,
            persistentId: person.id,
            name: toTitleCaseTurkish(current.display_name),
            first_name: current.given_name ? toTitleCaseTurkish(current.given_name) : undefined,
            last_name: current.family_name ? toTitleCaseTurkish(current.family_name) : undefined,
            aliases: current.aliases,
            gender: gender(current.gender),
            is_spouse: false,
            note: current.summary ?? undefined,
        };
    }

    for (const event of graph.life_events) {
        const member = members[personId(event.person_id)];
        const current = revision(event, proposalId);
        if (!member || !current) continue;
        if (current.event_type === 'birth') {
            member.birth_date = dateText(current);
            member.birthplace = current.place_text ?? undefined;
            member.birth_place = current.place_text ?? undefined;
        } else if (current.event_type === 'death') {
            member.death_date = dateText(current);
            member.death_place = current.place_text ?? undefined;
        } else if (current.event_type === 'occupation') {
            member.occupation = current.details ?? current.place_text ?? undefined;
        } else if (current.details) {
            member.note = [member.note, current.details].filter(Boolean).join('; ');
        }
    }

    const visibleMedia = graph.media.filter(media => media.status === 'approved'
        || (media.status === 'pending' && media.submission_id === proposalId));
    visibleMedia.sort((left, right) => Number(left.status === 'pending') - Number(right.status === 'pending'));
    for (const media of visibleMedia) {
        const member = members[personId(media.person_id)];
        if (member && (media.mime_type.startsWith('image/') || media.legacy_uri)) {
            member.image_path = media.legacy_uri ?? media.storage_path ?? undefined;
        }
    }

    const partnershipByPair = new Map<string, FamilyGraph['partnerships'][number]>();
    const peopleInPartnerships = new Set<string>();
    for (const partnership of graph.partnerships) {
        const current = revision(partnership, proposalId);
        if (!current || !visiblePeople.has(partnership.person1_id) || !visiblePeople.has(partnership.person2_id)) continue;
        const pair = [partnership.person1_id, partnership.person2_id].sort().join(':');
        partnershipByPair.set(pair, partnership);
        peopleInPartnerships.add(partnership.person1_id);
        peopleInPartnerships.add(partnership.person2_id);
        const unionId = `u_partnership_${partnership.id}`;
        addLink(personId(partnership.person1_id), unionId);
        addLink(personId(partnership.person2_id), unionId);
        const marriage = current.date_text ?? current.date_start;
        if (marriage) {
            for (const id of [partnership.person1_id, partnership.person2_id]) {
                const member = members[personId(id)];
                member.marriage = [member.marriage, marriage].filter(Boolean).join('; ');
            }
        }
    }

    const parentsByChild = new Map<string, string[]>();
    for (const parentLink of graph.parent_links) {
        if (!revision(parentLink, proposalId)) continue;
        if (!visiblePeople.has(parentLink.parent_id) || !visiblePeople.has(parentLink.child_id)) continue;
        if (!parentsByChild.has(parentLink.child_id)) parentsByChild.set(parentLink.child_id, []);
        parentsByChild.get(parentLink.child_id)!.push(parentLink.parent_id);
    }
    for (const [child, rawParents] of parentsByChild) {
        const parents = [...new Set(rawParents)].sort();
        const partnership = parents.length === 2 ? partnershipByPair.get(parents.join(':')) : undefined;
        const unionId = partnership ? `u_partnership_${partnership.id}` : `u_parents_${parents.join('_')}`;
        for (const parent of parents) addLink(personId(parent), unionId);
        addLink(unionId, personId(child));
    }

    const generations = new Map<string, number>();
    const visiting = new Set<string>();
    const generation = (id: string): number => {
        if (generations.has(id)) return generations.get(id)!;
        if (visiting.has(id)) return 1;
        visiting.add(id);
        const value = Math.max(0, ...(parentsByChild.get(id) ?? []).map(generation)) + 1;
        visiting.delete(id);
        generations.set(id, value);
        return value;
    };
    for (const id of visiblePeople) members[personId(id)].gen = generation(id);

    const connected = new Set([...links].flatMap(link => link.split('\0')));
    for (const id of visiblePeople) {
        if (!connected.has(personId(id))) addLink(personId(id), `u_isolated_${id}`);
    }

    const root = graph.families.find(family => family.root_person_id && visiblePeople.has(family.root_person_id))?.root_person_id
        ?? [...visiblePeople].sort()[0];

    const isSpouseMap = new Set<string>();
    for (const partnership of graph.partnerships) {
        const p1 = partnership.person1_id;
        const p2 = partnership.person2_id;
        if (!visiblePeople.has(p1) || !visiblePeople.has(p2)) continue;

        const current = revision(partnership, proposalId);
        if (current?.primary_person_id && (current.primary_person_id === p1 || current.primary_person_id === p2)) {
            const spouseId = current.primary_person_id === p1 ? p2 : p1;
            isSpouseMap.add(spouseId);
        }
    }

    for (const id of visiblePeople) {
        members[personId(id)].is_spouse = id !== root && isSpouseMap.has(id);
    }

    return {
        start: root ? personId(root) : '',
        members,
        links: [...links].sort().map(link => link.split('\0') as [string, string]),
    };
}

export function selectedFamilySlugs(search: string, configuredSlugs = ''): string[] {
    const params = new URLSearchParams(search);
    const values = params.getAll('family').length ? params.getAll('family') : [configuredSlugs];
    return normalizeFamilySlugs(values);
}

export function proposalFrame(graph: FamilyGraph, data: FamilyData, proposalId: string) {
    const proposedPeople = graph.people.filter(person =>
        person.pending_revisions.some(revision => revision.submission_id === proposalId));
    const newPerson = proposedPeople.find(person => !person.current_revision) ?? proposedPeople[0];
    const eventPerson = graph.life_events.find(event =>
        event.pending_revisions.some(revision => revision.submission_id === proposalId))?.person_id;
    const partnership = graph.partnerships.find(item =>
        item.pending_revisions.some(revision => revision.submission_id === proposalId));
    const parentLink = graph.parent_links.find(item =>
        item.pending_revisions.some(revision => revision.submission_id === proposalId));
    const membershipPerson = graph.memberships.find(item =>
        item.pending_revisions.some(revision => revision.submission_id === proposalId))?.person_id;
    const person = newPerson?.id ?? eventPerson ?? partnership?.person2_id ?? parentLink?.child_id ?? membershipPerson;
    if (!person) return undefined;

    const focusId = personId(person);
    const visibleNodes = new Set([focusId]);
    for (let depth = 0; depth < 2; depth++) {
        for (const [source, target] of data.links) {
            if (visibleNodes.has(source) || visibleNodes.has(target)) {
                visibleNodes.add(source);
                visibleNodes.add(target);
            }
        }
    }
    return { focusId, visibleNodes };
}

export async function loadRendererFamilyData(
    familySlugs: string[],
    includePending = false,
    loadGraph = getFamilyGraphBySlugs,
    proposalId?: string,
): Promise<FamilyData> {
    if (!familySlugs.length) throw new Error('No families configured. Set VITE_FAMILY_SLUGS or use ?family=family-slug.');
    const data = familyGraphToFamilyData(await loadGraph(familySlugs, includePending), proposalId);
    if (!Object.keys(data.members).length) throw new Error('The selected families contain no visible people.');
    return data;
}
