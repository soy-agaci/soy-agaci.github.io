import type { SearchIndexEntry } from './searchIndex';
import { uniqueSearchEntries } from './searchIndex';
import type { DagWithFamilyData } from '../../components/Tree/dagWithFamilyData';
import { get_name, is_member } from '../../components/Tree/dagWithFamilyData';

export function normalizePersonSearch(value: string): string {
    return value.toLowerCase()
        .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
        .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
        .replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
        .replace(/[^a-z0-9]/g, '');
}

export function rankPersonSearchEntries(entries: SearchIndexEntry[], query: string): SearchIndexEntry[] {
    const normalized = normalizePersonSearch(query.trim());
    if (normalized.length < 2) return [];

    return entries.filter(entry => entry.normalized.includes(normalized)).sort((a, b) => {
        const aName = a.display.split(/ \(|- Baba:/)[0].trim();
        const bName = b.display.split(/ \(|- Baba:/)[0].trim();
        const aNameMatches = normalizePersonSearch(aName).includes(normalized);
        const bNameMatches = normalizePersonSearch(bName).includes(normalized);
        return Number(bNameMatches) - Number(aNameMatches);
    });
}

export function personSearchEntries(dag: DagWithFamilyData): SearchIndexEntry[] {
    return uniqueSearchEntries(dag.nodes().filter(is_member).map(node => {
        let detail = node.added_data.input?.birth_date ? ` (d. ${node.added_data.input.birth_date})` : '';
        const union = dag.parents(node)[0];
        const parents = union ? dag.parents(union) : [];
        const father = parents.find(parent => parent.added_data.input?.gender === 'E') ?? parents[0];
        if (father) detail += ` - Baba: ${get_name(father)}`;
        return { id: node.data, display: `${get_name(node)}${detail}` };
    }), normalizePersonSearch);
}
