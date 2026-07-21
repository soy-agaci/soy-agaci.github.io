import type { FamilyGraph } from './familyRepository';

export function paternalLineage(graph: FamilyGraph, seed: string, proposalId = '*'): Set<string> {
    const selected = <T extends { submission_id: string | null }>(entity: { current_revision: T | null; pending_revisions: T[] }) => {
        const pending = entity.pending_revisions.filter(item => proposalId === '*' || item.submission_id === proposalId);
        return pending[pending.length - 1] ?? entity.current_revision;
    };
    const genders = new Map(graph.people.map(person => [person.id, selected(person)?.gender?.toLocaleLowerCase('tr') ?? '']));
    const male = (id: string) => ['male', 'm', 'erkek', 'e'].includes(genders.get(id) ?? '');
    const parents = new Map<string, string[]>();
    const children = new Map<string, string[]>();
    for (const link of graph.parent_links) {
        if (!selected(link)) continue;
        parents.set(link.child_id, [...(parents.get(link.child_id) ?? []), link.parent_id]);
        children.set(link.parent_id, [...(children.get(link.parent_id) ?? []), link.child_id]);
    }
    const ancestors = new Set([seed]);
    for (const child of ancestors) for (const parent of parents.get(child) ?? []) if (male(parent)) ancestors.add(parent);
    const maleLine = new Set([...ancestors].filter(male));
    for (const father of maleLine) for (const child of children.get(father) ?? []) if (male(child)) maleLine.add(child);
    const lineage = new Set([seed, ...maleLine]);
    for (const father of maleLine) for (const child of children.get(father) ?? []) lineage.add(child);
    return lineage;
}

export function familyTreePeople(graph: FamilyGraph, seed: string, proposalId = '*'): Set<string> {
    const active = <T extends { submission_id: string | null }>(entity: { current_revision: T | null; pending_revisions: T[] }) =>
        entity.current_revision || entity.pending_revisions.some(item => proposalId === '*' || item.submission_id === proposalId);
    const genders = new Map(graph.people.map(person => [person.id,
        (person.current_revision ?? person.pending_revisions[person.pending_revisions.length - 1])?.gender?.toLocaleLowerCase('tr') ?? '']));
    const parents = new Map<string, string[]>();
    const children = new Map<string, string[]>();
    for (const link of graph.parent_links) {
        if (!active(link)) continue;
        parents.set(link.child_id, [...(parents.get(link.child_id) ?? []), link.parent_id]);
        children.set(link.parent_id, [...(children.get(link.parent_id) ?? []), link.child_id]);
    }
    const ancestors = new Set([seed]);
    for (const child of ancestors) for (const parent of parents.get(child) ?? []) {
        if (['male', 'm', 'erkek', 'e'].includes(genders.get(parent) ?? '')) ancestors.add(parent);
    }
    const descendants = new Set(ancestors);
    for (const parent of descendants) for (const child of children.get(parent) ?? []) descendants.add(child);
    const related = new Set(descendants);
    for (const person of descendants) {
        for (const parent of parents.get(person) ?? []) related.add(parent);
        for (const partnership of graph.partnerships) {
            if (!active(partnership)) continue;
            if (partnership.person1_id === person) related.add(partnership.person2_id);
            if (partnership.person2_id === person) related.add(partnership.person1_id);
        }
    }
    return related;
}
