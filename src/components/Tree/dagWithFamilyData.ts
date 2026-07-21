import { DagWithRelations } from './dagWithRelations';
import { D3Node, Member } from '../../types/types';
import { FIELD_MAPPINGS } from '../../constants/fieldMappings';

export class DagWithFamilyData extends DagWithRelations {
    partnershipGroups: Record<string, [string, string]>;

    constructor(
        links: Array<[string, string]>,
        input_per_node_id: { [key: string]: Member } = {},
        partnershipGroups: Record<string, [string, string]> = {},
    ) {
        super(links);
        this.partnershipGroups = partnershipGroups;
        // Transfer input data if available
        for (let node of this.nodes()) {
            node.added_data = {
                is_visible: false,
                is_highlighted: false
            };
            if (node.data in input_per_node_id) {
                node.added_data.input = input_per_node_id[node.data];
            }
        }
    }

    get_data_and_xy(from_dag: DagWithFamilyData) {
        get_data_and_xy(from_dag, this);
    }
}

export function dag_with_family_data(
    links: Array<[string, string]>,
    input_per_node_id: { [key: string]: Member } = {},
    partnershipGroups: Record<string, [string, string]> = {},
) {
    return new DagWithFamilyData(links, input_per_node_id, partnershipGroups);
}

/**
 * Generic field getter that handles multi-language field name lookup
 * @param node - The D3Node to extract data from
 * @param keys - Array of possible field names (e.g., German and English variants)
 * @param defaultValue - Value to return if field not found
 * @param checkEmpty - If true, skip empty string values and continue searching
 * @returns The field value or defaultValue
 */
function getField(
    node: D3Node,
    keys: readonly string[],
    defaultValue: string = "",
    checkEmpty: boolean = false
): string {
    if (!node.added_data.input) return defaultValue;
    const input = node.added_data.input;

    for (let key of keys) {
        if (input.hasOwnProperty(key)) {
            const value = input[key];
            if (typeof value !== 'string') continue;
            if (!checkEmpty || value !== "") {
                return value;
            }
        }
    }
    return defaultValue;
}

/**
 * Generic field getter for Member objects (bypasses node wrapper)
 */
function getFieldFromMember(
    member: Member,
    keys: readonly string[],
    defaultValue: string = "",
    checkEmpty: boolean = false
): string {
    for (let key of keys) {
        if (member.hasOwnProperty(key)) {
            const value = (member as any)[key];
            if (typeof value !== 'string') continue;
            if (!checkEmpty || value !== "") {
                return value;
            }
        }
    }
    return defaultValue;
}

export function get_name(node: D3Node): string {
    return getField(node, FIELD_MAPPINGS.name, "?", true);
}

export function get_second_names(node: D3Node): string {
    return getField(node, FIELD_MAPPINGS.secondNames, "", true);
}

export function get_birth_date_of_member(member: Member): string {
    return getFieldFromMember(member, FIELD_MAPPINGS.birthDate, "?", true);
}

export function get_birth_date(node: D3Node): string {
    if (!node.added_data.input) return "?";
    return get_birth_date_of_member(node.added_data.input);
}

export function get_death_date(node: D3Node): string {
    return getField(node, FIELD_MAPPINGS.deathDate, "", false);
}

export function get_birth_place(node: D3Node): string {
    // Note: Returns empty string (not "?") if not found, despite "?" for missing input
    const result = getField(node, FIELD_MAPPINGS.birthPlace, "", true);
    return result || (!node.added_data.input ? "?" : "");
}

export function get_death_place(node: D3Node): string {
    return getField(node, FIELD_MAPPINGS.deathPlace, "", false);
}

export function get_marriage(node: D3Node): string {
    return getField(node, FIELD_MAPPINGS.marriage, "", false);
}

export function get_occupation(node: D3Node): string {
    return getField(node, FIELD_MAPPINGS.occupation, "", false);
}

export function get_note(node: D3Node): string {
    return getField(node, FIELD_MAPPINGS.note, "", false);
}

export function get_year_from_string(date_string: string, default_year: number): number {
    if (date_string == "?") return default_year;
    let numbers = String(date_string).match(/\d+/gi);
    if (!numbers) return default_year;
    const validNumbers = numbers.filter(x => Number(x) > 31);
    if (validNumbers.length <= 0) {
        return default_year;
    } else {
        return Number(validNumbers[0]);
    }
}

export function get_year_of_birth_date(node: D3Node): number | undefined {
    const date_string = get_birth_date(node);
    if (date_string === "?" || date_string === "") return undefined;

    let numbers = String(date_string).match(/\d+/gi);
    if (!numbers) return undefined;

    const validNumbers = numbers.filter(x => Number(x) > 31);
    if (validNumbers.length <= 0) {
        return undefined;
    } else {
        return Number(validNumbers[0]);
    }
}

export function get_image_path(node: D3Node): string {
    return getField(node, FIELD_MAPPINGS.imagePath, "", false);
}

function get_data_and_xy(dag_1: DagWithFamilyData, dag_2: DagWithFamilyData) {
    // If one of the DAGs are not yet defined, return
    if ((!dag_1) || (!dag_2)) return;

    // Use a Map for O(1) lookup
    const nodeMap1 = new Map<string, D3Node>();
    for (let node of dag_1.nodes()) {
        nodeMap1.set(node.data, node);
    }

    for (let node_2 of dag_2.nodes()) {
        let node_1 = nodeMap1.get(node_2.data);
        if (!node_1) continue;

        // Transfer coordinates
        // Use ux/uy if available (custom preserved state), otherwise standard x/y
        node_2.x = (node_1 as any).ux !== undefined ? (node_1 as any).ux : node_1.x;
        node_2.y = (node_1 as any).uy !== undefined ? (node_1 as any).uy : node_1.y;

        // Transfer shared data
        node_2.added_data = node_1.added_data;
    }
}

export function is_member(node: D3Node): boolean {
    return node.added_data.input !== undefined;
}

export function get_gender(node: D3Node): 'E' | 'K' | 'U' | undefined {
    if (!node.added_data.input) return undefined;
    return node.added_data.input.gender;
}
