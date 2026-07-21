import { DagWithFamilyData, get_year_of_birth_date, is_member } from './dagWithFamilyData';
import { get_roots } from './dagWithRelations';
import { DagRelaxation } from './dagRelaxation';
import { D3Node } from '../../types/types';
import { LAYOUT_CONSTANTS } from '../../constants/layout';

export class DagLayout {
    dag: DagWithFamilyData;
    generations: Map<number, D3Node[]>;
    groupings: { partners: any[], siblings: any[] };
    node_size: [number, number];

    constructor(dag_with_family_data: DagWithFamilyData, node_size: [number, number]) {
        this.dag = dag_with_family_data;
        this.generations = new Map();
        this.groupings = { "partners": [], "siblings": [] };
        this.node_size = node_size;
    }

    run() {
        this.add_object_to_nodes("added_relations.layout");
        this.assign_generation();
        this.assign_grouping();
        this.assign_ages();
        this.align_all();
    }

    assign_generation() {
        // Add generation ID to node, and add the node to the map
        let add_generation = (node: D3Node, generation_id: number, is_partner: boolean) => {
            let layout = node.added_relations!.layout;
            let added = this.add_to_object(layout, "generation_id", generation_id);
            if (added) {
                this.add_to_map(this.generations, generation_id, new Array());
                let generation = this.generations.get(generation_id)!;
                if (is_partner) {
                    let child = node.children!()[0];
                    if (child !== undefined) {
                        let elems = this.dag.parents(child);
                        let partner = elems[+(elems[0] == node)];
                        generation.splice(generation.indexOf(partner) + 1, 0, node);
                    } else {
                        generation.push(node);
                    }
                } else {
                    generation.push(node);
                }
            }
            return added;
        };
        // Determine generation using an advancing front approach
        for (let starting_node of get_roots(this.dag)) {
            add_generation(starting_node, 0, false);
            let border = [starting_node];
            while (border.length > 0) {
                let next: D3Node[] = [];
                for (let node of border) {
                    let generation_id = node.added_relations!.layout.generation_id;
                    for (let parent of this.dag.parents(node)) {
                        let gp = this.dag.parents(parent);
                        if (add_generation(parent, generation_id - 1, gp.length === 0)) {
                            next.push(parent);
                        }
                    }
                    for (let child of node.children!()) {
                        if (add_generation(child, generation_id + 1, false)) {
                            next.push(child);
                        }
                    }
                }
                border = next;
            }
        }

        const visibleNodes = new Set(this.dag.nodes().map(node => node.data));
        for (const pair of Object.values(this.dag.partnershipGroups)) {
            if (!pair.every(id => visibleNodes.has(id))) continue;
            const partners = pair.map(id => this.dag.find_node(id));
            const primary = partners.find(node => !node.added_data.input?.is_spouse);
            if (!primary) continue;
            const targetGeneration = primary.added_relations!.layout.generation_id;
            for (const spouse of partners.filter(node => node.added_data.input?.is_spouse)) {
                const layout = spouse.added_relations!.layout;
                if (layout.generation_id === targetGeneration) continue;
                const previous = this.generations.get(layout.generation_id)!;
                previous.splice(previous.indexOf(spouse), 1);
                layout.generation_id = targetGeneration;
                const generation = this.generations.get(targetGeneration)!;
                generation.splice(generation.indexOf(primary) + 1, 0, spouse);
            }
        }
    }

    assign_grouping() {
        // Groups can be "partnership" or "siblings"
        let add_new_group = (group_name: "partners" | "siblings") => {
            let group: any = {};
            group.added_data = {};
            group.nodes = [];
            group.id = this.groupings[group_name].length;
            this.groupings[group_name].push(group);
            return group;
        };
        // Accumulate all of a group to node
        let accumulate = (group_name: "partners" | "siblings", node: D3Node) => {
            let layout = node.added_relations!.layout;
            layout[group_name] = layout[group_name + "_ids"].reduce((all: any[], id: number) => {
                let nodes_of_id = this.groupings[group_name][id].nodes;
                return all.concat(nodes_of_id);
            }, []);
        };
        // Add objects to store group IDs
        for (let node of this.dag.nodes()) {
            let layout = node.added_relations!.layout;
            this.add_to_object(layout, "partners_ids", []);
            this.add_to_object(layout, "siblings_ids", []);
        }
        // Assign partnership and siblings
        for (let node of this.dag.nodes()) {
            if (is_member(node)) continue; // skip members
            let partnership = add_new_group("partners");
            for (let parent of this.dag.parents(node)) {
                let layout = parent.added_relations!.layout;
                layout.partners_ids.push(partnership.id);
                partnership.nodes.push(parent);
            }
            let siblings = add_new_group("siblings");
            for (let child of node.children!()) {
                let layout = child.added_relations!.layout;
                layout.siblings_ids.push(siblings.id);
                siblings.nodes.push(child);
            }
        }
        // Assign partners and siblings
        for (let node of this.dag.nodes()) {
            accumulate("partners", node);
            accumulate("siblings", node);
        }
        // Extend dag interface to return the partners
        (this.dag as any).get_partners = function (node: D3Node) {
            let layout = node.added_relations!.layout;
            return layout.partners;
        };
        // Extend dag interface to return the number of siblings
        (this.dag as any).get_number_of_siblings = function (node: D3Node) {
            let layout = node.added_relations!.layout;
            return layout.siblings.length;
        };
    }

    assign_ages() {
        // Set the age of all nodes (family nodes will be adjusted)
        for (let node of this.dag.nodes()) {
            node.added_data.age = get_year_of_birth_date(node);
        }
        // Set the age of family nodes
        for (let node of this.dag.nodes()) {
            if (is_member(node)) continue; // only family nodes
            let parent_age = this.get_oldest_age(this.dag.parents(node));
            if (parent_age !== undefined) {
                node.added_data.age = parent_age;
                continue;
            }
            // let layout = node.added_relations!.layout;
            let children_age = this.get_average_age(node.children!());
            if (children_age !== undefined) {
                node.added_data.age = children_age;
            }
        }
        // Extend dag interface to return the age
        (this.dag as any).get_age = function (node: D3Node) {
            return node.added_data.age;
        };
    }

    align_all() {
        // Sort generations by ID
        let generations = Array.from(this.generations).sort((g_1, g_2) => {
            return g_1[0] > g_2[0] ? 1 : -1;
        });
        // Iterate all generations in order to assign coordinates
        for (const [index, [generation_id, nodes]] of generations.entries()) {
            this.align_generation(generation_id, nodes);
            if (index === 0) {
                const limits = nodes.reduce(([minimum, maximum], node) =>
                    [Math.min(minimum, node.x), Math.max(maximum, node.x)],
                [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
                const offset = -(limits[0] + limits[1]) / 2;
                for (const node of nodes) node.x += offset;
            }
        }
        // Perform a relaxation of coordinates
        let relaxation = new DagRelaxation(this.dag, this.node_size);
        for (let _pass = 0; _pass < LAYOUT_CONSTANTS.RELAXATION_PASSES; _pass++) {
            for (let [_generation_id, nodes] of generations) {
                relaxation.run(nodes);
            }
        }
        for (const [, nodes] of generations) this.center_generation_on_parents(nodes);
    }

    center_generation_on_parents(nodes: D3Node[]) {
        if (!nodes.length) return;
        const desired = nodes.map(node => {
            const parentX = this.get_average_x(this.dag.parents(node));
            if (parentX !== undefined) return parentX;
            const pair = Object.values(this.dag.partnershipGroups).find(ids => ids.includes(node.data));
            if (!pair) return node.x;
            const partners = pair.map(id => this.dag.find_node(id)).sort((a, b) => a.x - b.x);
            const anchored = partners.find(partner => this.dag.parents(partner).length);
            if (!anchored) return node.x;
            const anchorX = this.get_average_x(this.dag.parents(anchored));
            return anchorX === undefined ? node.x
                : anchorX + (partners.indexOf(node) - partners.indexOf(anchored)) * this.node_size[0];
        });
        const blocks: Array<{ start: number; end: number; sum: number; count: number }> = [];
        for (let index = 0; index < nodes.length; index++) {
            blocks.push({ start: index, end: index, sum: desired[index] - index * this.node_size[0], count: 1 });
            while (blocks.length > 1) {
                const right = blocks[blocks.length - 1];
                const left = blocks[blocks.length - 2];
                if (left.sum / left.count <= right.sum / right.count) break;
                blocks.splice(-2, 2, {
                    start: left.start, end: right.end,
                    sum: left.sum + right.sum, count: left.count + right.count,
                });
            }
        }
        for (const block of blocks) {
            const offset = block.sum / block.count;
            for (let index = block.start; index <= block.end; index++) {
                nodes[index].x = offset + index * this.node_size[0];
            }
        }
    }

    align_generation(generation_id: number, nodes: D3Node[]) {
        const generationMembers = new Set(nodes.filter(is_member).map(node => node.data));

        const parentKey = (node: D3Node) => this.dag.parents(node).map(parent => parent.data).sort().join('|');
        const siblingCounts = new Map<string, number>();
        for (const node of nodes.filter(is_member)) {
            const key = parentKey(node);
            if (key) siblingCounts.set(key, (siblingCounts.get(key) ?? 0) + 1);
        }

        // Partnership groups come from explicit union edges, not global person roles.
        const get_primary = (n: D3Node) => {
            if (is_member(n)) {
                const adjacentUnions = [...this.dag.parents(n), ...n.children!()];
                for (const union of adjacentUnions) {
                    const pair = this.dag.partnershipGroups[union.data];
                    if (pair && pair.includes(n.data) && pair.every(id => generationMembers.has(id))) {
                        return pair.map(id => this.dag.find_node(id)).sort((a, b) =>
                            (siblingCounts.get(parentKey(b)) ?? 0) - (siblingCounts.get(parentKey(a)) ?? 0)
                            || Number(!!a.added_data.input?.is_spouse) - Number(!!b.added_data.input?.is_spouse)
                            || a.data.localeCompare(b.data)
                        )[0];
                    }
                }
            }
            return n;
        };

        const get_primary_parent_order = (n: D3Node): number | undefined => {
            const parents = this.dag.parents(n);
            if (parents.length === 0) return undefined;
            const orders = parents.map(parent => {
                const generation = this.generations.get(parent.added_relations!.layout.generation_id);
                return generation?.indexOf(parent) ?? -1;
            }).filter(order => order >= 0);
            return orders.length ? orders.reduce((sum, order) => sum + order, 0) / orders.length : undefined;
        };

        // Assign coordinates to all nodes of one generation
        for (const pass of [1]) {
            // 1. Group nodes by Primary
            const groups = new Map<D3Node, D3Node[]>();
            for (let node of nodes) {
                const primary = get_primary(node);
                if (!groups.has(primary)) groups.set(primary, []);
                groups.get(primary)!.push(node);
            }

            // 2. Keep siblings in contiguous family blocks; age only sorts inside a block.
            const familyBlocks = new Map<string, D3Node[]>();
            for (const primary of groups.keys()) {
                const parents = parentKey(primary);
                const key = is_member(primary) && parents ? `siblings:${parents}` : `single:${primary.data}`;
                familyBlocks.set(key, [...(familyBlocks.get(key) ?? []), primary]);
            }
            const byName = (a: D3Node, b: D3Node) => {
                const names = [a, b].map(node => node.added_data.input?.name || '');
                return names[0].localeCompare(names[1]) || a.data.localeCompare(b.data);
            };
            for (const block of familyBlocks.values()) {
                block.sort((a, b) => {
                    const ageA = (this.dag as any).get_age(a);
                    const ageB = (this.dag as any).get_age(b);
                    if (ageA !== undefined && ageB !== undefined && ageA !== ageB) return ageA - ageB;
                    if (ageA !== undefined && ageB === undefined) return -1;
                    if (ageA === undefined && ageB !== undefined) return 1;
                    return byName(a, b);
                });
            }
            const orderedBlocks = [...familyBlocks.values()].sort((a, b) => {
                const parentOrderA = get_primary_parent_order(a[0]);
                const parentOrderB = get_primary_parent_order(b[0]);
                if (parentOrderA !== undefined && parentOrderB !== undefined && parentOrderA !== parentOrderB) return parentOrderA - parentOrderB;
                if (parentOrderA !== undefined && parentOrderB === undefined) return 1;
                if (parentOrderA === undefined && parentOrderB !== undefined) return -1;
                return byName(a[0], b[0]);
            });
            const primaries = orderedBlocks.flat();

            // 3. Reconstruct Sorted List & Assign X
            let position = {
                "x": 0.0,
                "y": generation_id * this.node_size[1]
            };

            for (let p of primaries) {
                const group = groups.get(p)!;
                
                // Ensure Primary is first in group, spouses follow
                group.sort((x, y) => {
                    const xParents = this.dag.parents(x);
                    const yParents = this.dag.parents(y);
                    if (xParents.length && yParents.length) {
                        const byParent = this.get_average_x(xParents)! - this.get_average_x(yParents)!;
                        if (byParent !== 0) return byParent;
                    }
                    if (x === p) return -1;
                    if (y === p) return 1;
                    // Sort spouses by data/ID for consistency
                    return x.data.localeCompare(y.data);
                });

                // Assign positions
                for (let node of group) {
                    node.x = position.x;
                    node.y = position.y;
                    position.x += this.node_size[0];
                }
            }

            if (pass == 1) { // re-alignment toward parents
                for (let p of primaries) {
                    // Align primary to parents
                    let parents = this.dag.parents(p);
                    this.align_to_parents(p, parents);
                    
                    // Shift spouses to stay attached to primary
                    const group = groups.get(p)!;
                    let startX = p.x;
                    let i = 0;
                    for (let node of group) {
                         node.x = startX + (i * this.node_size[0]);
                         i++;
                    }
                }
            }
            nodes.splice(0, nodes.length, ...primaries.flatMap(primary => groups.get(primary)!));
            // Pass 2 (align_partners) is implicit in our grouping logic.
        }
    }

    add_to_map(object: Map<any, any>, key: any, value: any) {
        let added = false;
        if (!object.has(key)) {
            object.set(key, value);
            added = true;
        }
        return added;
    }

    add_to_object(object: any, key: string, value: any) {
        let added = false;
        if (!object.hasOwnProperty(key)) {
            object[key] = value;
            added = true;
        }
        return added;
    }

    add_object_to_nodes(keys: string) {
        let added = false;
        let key_array = keys.split(".");
        for (let node of this.dag.nodes()) {
            let target: any = node;
            for (let key of key_array) {
                if (!target.hasOwnProperty(key)) {
                    target[key] = {};
                    added = true;
                }
                target = target[key];
            }
        }
        return added;
    }

    align_partners(partners: D3Node[]) {
        if (partners.length < 2) return;
        partners.sort((node_1, node_2) => {
            let node_pair = [node_1, node_2];
            let compare = node_pair.map((this.dag as any).get_number_of_siblings) as number[];
            if (compare[0] != compare[1]) {
                return compare[0] < compare[1] ? 1 : -1;
            }
            // If equal, fall-back to the age
            compare = node_pair.map((this.dag as any).get_age) as number[];
            return compare[0] > compare[1] ? 1 : -1;
        });
        let node_1 = partners[0];
        let node_partners = partners.filter(node => node != node_1);
        let i = 1;
        for (let node_2 of node_partners) {
            node_2.x = node_1.x + (this.node_size[0] * i);
            i++;
        }
    }

    align_to_parents(node: D3Node, parents: D3Node[]) {
        if (parents.length < 1) return;

        node.x = this.get_average_x(parents)!;
    }

    get_average_x(objects: D3Node[]) {
        if (objects.length <= 0) return undefined;
        return objects.reduce((sum, object) => {
            return sum + object.x;
        }, 0.0) / objects.length;
    }

    get_average_age(objects: D3Node[]) {
        if (objects.length <= 0) return undefined;
        return objects.reduce((sum, object) => {
            return sum + (object.added_data.age || 0);
        }, 0) / objects.length;
    }

    get_oldest_age(objects: D3Node[]) {
        if (objects.length <= 0) return undefined;
        return objects.reduce((minimum, object) => {
            return Math.min(minimum, object.added_data.age || Number.POSITIVE_INFINITY);
        }, Number.POSITIVE_INFINITY);
    }

    is_member(node: D3Node) {
        return is_member(node);
    };
}
