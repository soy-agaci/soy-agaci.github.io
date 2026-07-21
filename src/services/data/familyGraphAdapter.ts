import type { FamilyData, Member } from '../../types/types';
import { getFamilyGraphBySlugs, normalizeFamilySlugs, type FamilyGraph } from './familyRepository';
import { localSupabaseUrl } from '../supabase/localUrl';
import { REMOVED_PHOTO_URL } from '../../constants/media';
import { paternalLineage } from './familyLineage';

type RevisionEntity<T> = { current_revision: T | null; pending_revisions: T[] };

function revision<T extends { submission_id: string | null }>(
    entity: RevisionEntity<T>,
    proposalId?: string,
): T | null {
    if (proposalId === '*') return entity.pending_revisions[entity.pending_revisions.length - 1] ?? entity.current_revision;
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
    return str.toLocaleLowerCase('tr-TR').replace(/(^|[^\p{L}])(\p{L})/gu,
        (_match, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase('tr-TR'));
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
        || (media.status === 'pending' && (proposalId === '*' || media.submission_id === proposalId)));
    visibleMedia.sort((left, right) => Number(left.status === 'pending') - Number(right.status === 'pending')
        || left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
    for (const media of visibleMedia) {
        const member = members[personId(media.person_id)];
        if (member && media.legacy_uri === REMOVED_PHOTO_URL) {
            member.image_path = undefined;
            continue;
        }
        if (member && (media.mime_type.startsWith('image/') || media.legacy_uri)) {
            let path = media.legacy_uri ?? media.storage_path ?? undefined;
            if (path) path = localSupabaseUrl(path, 'http:');
            member.image_path = path;
        }
    }

    const partnershipByPair = new Map<string, FamilyGraph['partnerships'][number]>();
    const partnershipGroups: Record<string, [string, string]> = {};
    const peopleInPartnerships = new Set<string>();
    for (const partnership of graph.partnerships) {
        const current = revision(partnership, proposalId);
        if (!current || !visiblePeople.has(partnership.person1_id) || !visiblePeople.has(partnership.person2_id)) continue;
        const pair = [partnership.person1_id, partnership.person2_id].sort().join(':');
        partnershipByPair.set(pair, partnership);
        peopleInPartnerships.add(partnership.person1_id);
        peopleInPartnerships.add(partnership.person2_id);
        const unionId = `u_partnership_${partnership.id}`;
        partnershipGroups[unionId] = [personId(partnership.person1_id), personId(partnership.person2_id)];
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
        if (parents.length === 2 && !partnership) {
            throw new Error(`Missing persisted partnership for parents of ${child}`);
        }
        const unionId = partnership ? `u_partnership_${partnership.id}` : `u_parents_${parents[0]}`;
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

    const lineagePeople = new Set((graph.lineage_memberships ?? []).map(item => item.person_id));
    const assignedPeople = new Set((graph.all_lineage_memberships ?? graph.lineage_memberships ?? [])
        .map(item => item.person_id));
    const pendingLineageByFamily = new Map<string, Set<string>>();
    if (proposalId) {
        for (const membership of graph.memberships) {
            if (membership.pending_revisions.some(item => proposalId === '*' || item.submission_id === proposalId)) {
                const pendingLineage = pendingLineageByFamily.get(membership.family_id) ?? new Set<string>();
                for (const person of paternalLineage(graph, membership.person_id, proposalId)) {
                    pendingLineage.add(person);
                    assignedPeople.add(person);
                }
                pendingLineageByFamily.set(membership.family_id, pendingLineage);
            }
        }
        for (const proposal of graph.family_creation_proposals ?? []) {
            if (proposalId === '*' || proposal.submission_id === proposalId) {
                for (const person of paternalLineage(graph, proposal.root_person_id, proposalId)) assignedPeople.add(person);
            }
        }
    }
    const familySizes = new Map<string, number>();
    for (const membership of graph.memberships) {
        familySizes.set(membership.family_id, (familySizes.get(membership.family_id) ?? 0) + 1);
    }
    const displayFamily = graph.families[0] && graph.families.reduce((largest, family) =>
        (familySizes.get(family.id) ?? 0) > (familySizes.get(largest.id) ?? 0) ? family : largest);
    const displayLineage = new Set((graph.lineage_memberships ?? [])
        .filter(item => !displayFamily || item.family_id === displayFamily.id).map(item => item.person_id));
    const selectedFamilyIds = new Set(graph.families.map(family => family.id));
    for (const [familyId, pendingLineage] of pendingLineageByFamily) {
        if (selectedFamilyIds.has(familyId)) for (const person of pendingLineage) lineagePeople.add(person);
    }
    if (displayFamily) {
        for (const person of pendingLineageByFamily.get(displayFamily.id) ?? []) {
            displayLineage.add(person);
        }
    }
    const root = [...visiblePeople].sort((left, right) => {
        const leftMember = members[personId(left)];
        const rightMember = members[personId(right)];
        return Number(!displayLineage.has(left)) - Number(!displayLineage.has(right))
            || (leftMember.gen ?? Infinity) - (rightMember.gen ?? Infinity)
            || Number(rightMember.gender === 'E') - Number(leftMember.gender === 'E')
            || left.localeCompare(right);
    })[0];

    const isSpouseMap = new Set<string>();
    for (const partnership of graph.partnerships) {
        const p1 = partnership.person1_id;
        const p2 = partnership.person2_id;
        if (!visiblePeople.has(p1) || !visiblePeople.has(p2)) continue;

        if (lineagePeople.has(p1) !== lineagePeople.has(p2)) {
            isSpouseMap.add(lineagePeople.has(p1) ? p2 : p1);
        }
    }
    for (const parents of parentsByChild.values()) {
        if (parents.some(parent => lineagePeople.has(parent))) {
            for (const parent of parents) if (!lineagePeople.has(parent)) isSpouseMap.add(parent);
        }
    }

    for (const id of visiblePeople) {
        members[personId(id)].is_spouse = id !== root && isSpouseMap.has(id);
        members[personId(id)].lineage_member = lineagePeople.has(id);
        members[personId(id)].has_family = assignedPeople.has(id);
    }

    const data: FamilyData = {
        start: root ? personId(root) : '',
        members,
        links: [...links].sort().map(link => link.split('\0') as [string, string]),
        partnershipGroups,
    };

    return data;
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
