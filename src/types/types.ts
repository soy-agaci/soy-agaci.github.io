export interface Member {
    id: string;
    numeric_id?: number; // ID from column M
    first_name?: string;
    last_name?: string;
    birth_date?: string;
    birthplace?: string;
    death_date?: string;
    birth_place?: string;
    death_place?: string;
    is_spouse?: boolean;
    gender?: 'E' | 'K' | 'U';
    gen?: number;
    persistentId?: string;
    name?: string;
    row_index?: number;
    [key: string]: any; // Allow other properties for now
}

export interface Link {
    source: string | D3Node;
    target: string | D3Node;
}

export interface FamilyData {
    members: { [key: string]: Member };
    links: Array<[string, string]>; // Array of [sourceId, targetId]
    start: string;
}

/**
 * Data added to D3 nodes during family tree processing
 */
export interface AddedData {
    /** Previous x coordinate (for animations) */
    x0?: number;
    /** Previous y coordinate (for animations) */
    y0?: number;
    /** Whether this node is currently visible in the tree */
    is_visible: boolean;
    /** Whether this node is highlighted (e.g., in search results) */
    is_highlighted: boolean;
    /** Whether this node should be rendered with "ugly" styling (Easter egg) */
    is_ugly?: boolean;
    /** Calculated age/birth year for layout sorting */
    age?: number;
    /** The member data associated with this node (undefined for union nodes) */
    input?: Member;
}

export interface D3Node {
    data: string; // The ID
    x: number;
    y: number;
    added_data: AddedData;
    added_relations?: {
        parents?: D3Node[];
        first_level_adjacency?: Set<D3Node>;
        second_level_adjacency?: Set<D3Node>;
        layout?: any;
        [key: string]: any;
    };
    parent?: D3Node;
    children?: () => D3Node[];
}

export interface D3Link {
    source: D3Node;
    target: D3Node;
}
