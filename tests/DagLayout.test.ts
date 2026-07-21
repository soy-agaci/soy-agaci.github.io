import { describe, it, expect } from 'vitest';
import { DagLayout } from '../src/components/Tree/DagLayout';
import { DagWithFamilyData } from '../src/components/Tree/dagWithFamilyData';
import { D3Node } from '../src/types/types';
import { LAYOUT_CONSTANTS } from '../src/constants/layout';

describe('DagLayout', () => {
    function createSimpleDag(): DagWithFamilyData {
        const links: Array<[string, string]> = [
            ['mem_0', 'u_0'],
            ['u_0', 'mem_1'],
            ['u_0', 'mem_2']
        ];

        const members = {
            'mem_0': {
                id: 'mem_0',
                name: 'Parent',
                birth_date: '1950',
                gender: 'E' as const,
                is_spouse: false,
                gen: 1
            },
            'mem_1': {
                id: 'mem_1',
                name: 'Child1',
                birth_date: '1980',
                gender: 'E' as const,
                is_spouse: false,
                gen: 2
            },
            'mem_2': {
                id: 'mem_2',
                name: 'Child2',
                birth_date: '1982',
                gender: 'K' as const,
                is_spouse: false,
                gen: 2
            }
        };

        return new DagWithFamilyData(links, members);
    }

    describe('constructor', () => {
        it('should initialize with dag and node_size', () => {
            const dag = createSimpleDag();
            const nodeSize: [number, number] = [100, 100];

            const layout = new DagLayout(dag, nodeSize);

            expect(layout.dag).toBe(dag);
            expect(layout.node_size).toBe(nodeSize);
        });

        it('should initialize with empty generations map', () => {
            const dag = createSimpleDag();
            const layout = new DagLayout(dag, [100, 100]);

            expect(layout.generations).toBeInstanceOf(Map);
            expect(layout.generations.size).toBe(0);
        });

        it('should initialize groupings object', () => {
            const dag = createSimpleDag();
            const layout = new DagLayout(dag, [100, 100]);

            expect(layout.groupings).toHaveProperty('partners');
            expect(layout.groupings).toHaveProperty('siblings');
            expect(Array.isArray(layout.groupings.partners)).toBe(true);
            expect(Array.isArray(layout.groupings.siblings)).toBe(true);
        });
    });

    describe('run', () => {
        it('should execute layout algorithm without errors', () => {
            const dag = createSimpleDag();
            const layout = new DagLayout(dag, [100, 100]);

            expect(() => layout.run()).not.toThrow();
        });

        it('should populate generations map', () => {
            const dag = createSimpleDag();
            const layout = new DagLayout(dag, [100, 100]);

            layout.run();

            expect(layout.generations.size).toBeGreaterThan(0);
        });

        it('should assign x,y coordinates to all nodes', () => {
            const dag = createSimpleDag();
            const layout = new DagLayout(dag, [100, 100]);

            layout.run();

            for (const node of dag.nodes()) {
                expect(typeof node.x).toBe('number');
                expect(typeof node.y).toBe('number');
                expect(isNaN(node.x)).toBe(false);
                expect(isNaN(node.y)).toBe(false);
            }
        });

        it('centers a small child branch around its parents in a dense generation', () => {
            const members: Record<string, any> = {
                root: { id: 'root', name: 'Root', gender: 'E', birth_date: '1940', is_spouse: false },
                spouse: { id: 'spouse', name: 'Spouse', gender: 'K', birth_date: '1962', is_spouse: true },
                kid1: { id: 'kid1', name: 'Kid 1', birth_date: '2000', is_spouse: false },
                kid2: { id: 'kid2', name: 'Kid 2', birth_date: '2002', is_spouse: false },
            };
            const links: Array<[string, string]> = [['root', 'u0']];
            for (let index = 0; index < 10; index++) {
                const id = `child${index}`;
                members[id] = { id, name: `Child ${index}`, birth_date: String(1960 + index), is_spouse: false };
                links.push(['u0', id]);
            }
            links.push(['child0', 'u1'], ['spouse', 'u1'], ['u1', 'kid1'], ['u1', 'kid2']);
            const dag = new DagWithFamilyData(links, members, { u1: ['child0', 'spouse'] });
            new DagLayout(dag, [100, 100]).run();

            const parentCenter = (dag.find_node('child0').x + dag.find_node('spouse').x) / 2;
            const childCenter = (dag.find_node('kid1').x + dag.find_node('kid2').x) / 2;
            expect(Math.abs(childCenter - parentCenter)).toBeLessThanOrEqual(100);
            expect(dag.find_node('spouse').x - dag.find_node('child0').x).toBe(100);
            expect(Array.from({ length: 10 }, (_, index) => dag.find_node(`child${index}`).x))
                .toEqual([...Array.from({ length: 10 }, (_, index) => dag.find_node(`child${index}`).x)].sort((a, b) => a - b));
        });

        it('sorts siblings by age without sorting cousins against each other', () => {
            const links: Array<[string, string]> = [
                ['grandparent', 'grandUnion'], ['grandUnion', 'parentA'], ['grandUnion', 'parentB'],
                ['parentA', 'zUnion'], ['zUnion', 'aYoung'], ['zUnion', 'aOld'],
                ['parentB', 'aUnion'], ['aUnion', 'bYoung'], ['aUnion', 'bOld'],
            ];
            const member = (id: string, birth_date: string) => ({ id, name: id, birth_date, is_spouse: false });
            const dag = new DagWithFamilyData(links, {
                grandparent: member('grandparent', '1940'), parentA: member('parentA', '1960'),
                parentB: member('parentB', '1962'), aYoung: member('aYoung', '2010'),
                aOld: member('aOld', '2000'), bYoung: member('bYoung', '1910'), bOld: member('bOld', '1900'),
            });
            new DagLayout(dag, [100, 100]).run();

            expect(['aOld', 'aYoung', 'bOld', 'bYoung'].map(id => dag.find_node(id).x))
                .toEqual([...['aOld', 'aYoung', 'bOld', 'bYoung'].map(id => dag.find_node(id).x)].sort((a, b) => a - b));
        });

        it('keeps a partnered person with the larger visible sibling group', () => {
            const links: Array<[string, string]> = [
                ['parentA', 'familyA'], ['familyA', 'a'], ['familyA', 'a2'], ['familyA', 'a3'],
                ['parentB', 'familyB'], ['familyB', 'b'], ['a', 'couple'], ['b', 'couple'], ['couple', 'child'],
            ];
            const member = (id: string, birth_date: string, is_spouse = false) =>
                ({ id, name: id, birth_date, is_spouse });
            const dag = new DagWithFamilyData(links, {
                parentA: member('parentA', '1940'), parentB: member('parentB', '1941'),
                a: member('a', '1960', true), a2: member('a2', '1962'), a3: member('a3', '1964'),
                b: member('b', '1961'), child: member('child', '1990'),
            }, { couple: ['a', 'b'] });
            new DagLayout(dag, [100, 100]).run();

            expect(['a', 'b', 'a2', 'a3'].map(id => dag.find_node(id).x))
                .toEqual([...['a', 'b', 'a2', 'a3'].map(id => dag.find_node(id).x)].sort((x, y) => x - y));
        });

        it('does not let relaxation reverse child-family blocks', () => {
            const dag = new DagWithFamilyData([
                ['parentA', 'unionA'], ['unionA', 'childA'],
                ['parentB', 'unionB'], ['unionB', 'childB'],
            ], {
                parentA: { id: 'parentA', name: 'Parent A', is_spouse: false },
                parentB: { id: 'parentB', name: 'Parent B', is_spouse: false },
                childA: { id: 'childA', name: 'Child A', is_spouse: false },
                childB: { id: 'childB', name: 'Child B', is_spouse: false },
            });
            const layout = new DagLayout(dag, [100, 100]);
            dag.find_node('unionA').x = 0;
            dag.find_node('unionB').x = 100;
            dag.find_node('childA').x = 100;
            dag.find_node('childB').x = 0;

            layout.center_generation_on_parents([dag.find_node('childA'), dag.find_node('childB')]);

            expect(dag.find_node('childA').x).toBeLessThan(dag.find_node('childB').x);
        });
    });

    describe('assign_generation', () => {
        it('should assign generation IDs to nodes', () => {
            const dag = createSimpleDag();
            const layout = new DagLayout(dag, [100, 100]);

            layout.add_object_to_nodes("added_relations.layout");
            layout.assign_generation();

            // Check that nodes have generation_id
            for (const node of dag.nodes()) {
                if (node.added_relations?.layout) {
                    expect(node.added_relations.layout).toHaveProperty('generation_id');
                }
            }
        });

        it('should group nodes by generation', () => {
            const dag = createSimpleDag();
            const layout = new DagLayout(dag, [100, 100]);

            layout.add_object_to_nodes("added_relations.layout");
            layout.assign_generation();

            expect(layout.generations.size).toBeGreaterThan(0);

            // Each generation should have nodes
            for (const [_, nodes] of layout.generations) {
                expect(Array.isArray(nodes)).toBe(true);
                expect(nodes.length).toBeGreaterThan(0);
            }
        });
    });

    describe('assign_ages', () => {
        it('should assign ages to member nodes', () => {
            const dag = createSimpleDag();
            const layout = new DagLayout(dag, [100, 100]);

            layout.add_object_to_nodes("added_relations.layout");
            layout.assign_generation();
            layout.assign_ages();

            // Check that member nodes have ages
            for (const node of dag.nodes()) {
                if (node.added_data.input) {
                    expect(typeof node.added_data.age).toBe('number');
                }
            }
        });

        it('should assign ages to union nodes based on parents', () => {
            const dag = createSimpleDag();
            const layout = new DagLayout(dag, [100, 100]);

            layout.add_object_to_nodes("added_relations.layout");
            layout.assign_generation();
            layout.assign_ages();

            // Union nodes should also have ages assigned
            for (const node of dag.nodes()) {
                if (!node.added_data.input) {
                    // Union node - age should be set based on parents/children
                    expect(typeof node.added_data.age).toBe('number');
                }
            }
        });
    });

    describe('helper methods', () => {
        describe('add_to_map', () => {
            it('should add new key to map', () => {
                const dag = createSimpleDag();
                const layout = new DagLayout(dag, [100, 100]);
                const map = new Map<string, number>();

                const added = layout.add_to_map(map, 'key1', 42);

                expect(added).toBe(true);
                expect(map.get('key1')).toBe(42);
            });

            it('should not overwrite existing key', () => {
                const dag = createSimpleDag();
                const layout = new DagLayout(dag, [100, 100]);
                const map = new Map<string, number>();

                map.set('key1', 42);
                const added = layout.add_to_map(map, 'key1', 100);

                expect(added).toBe(false);
                expect(map.get('key1')).toBe(42);
            });
        });

        describe('add_to_object', () => {
            it('should add new property to object', () => {
                const dag = createSimpleDag();
                const layout = new DagLayout(dag, [100, 100]);
                const obj: any = {};

                const added = layout.add_to_object(obj, 'prop1', 42);

                expect(added).toBe(true);
                expect(obj.prop1).toBe(42);
            });

            it('should not overwrite existing property', () => {
                const dag = createSimpleDag();
                const layout = new DagLayout(dag, [100, 100]);
                const obj: any = { prop1: 42 };

                const added = layout.add_to_object(obj, 'prop1', 100);

                expect(added).toBe(false);
                expect(obj.prop1).toBe(42);
            });
        });

        describe('get_average_x', () => {
            it('should calculate average x coordinate', () => {
                const dag = createSimpleDag();
                const layout = new DagLayout(dag, [100, 100]);

                const nodes: D3Node[] = [
                    { x: 0, y: 0 } as any,
                    { x: 100, y: 0 } as any,
                    { x: 200, y: 0 } as any
                ];

                const avg = layout.get_average_x(nodes);

                expect(avg).toBe(100);
            });

            it('should return undefined for empty array', () => {
                const dag = createSimpleDag();
                const layout = new DagLayout(dag, [100, 100]);

                const avg = layout.get_average_x([]);

                expect(avg).toBeUndefined();
            });
        });

        describe('get_average_age', () => {
            it('should calculate average age', () => {
                const dag = createSimpleDag();
                const layout = new DagLayout(dag, [100, 100]);

                const nodes: D3Node[] = [
                    { added_data: { age: 1950, is_visible: true, is_highlighted: false } } as any,
                    { added_data: { age: 1960, is_visible: true, is_highlighted: false } } as any,
                    { added_data: { age: 1970, is_visible: true, is_highlighted: false } } as any
                ];

                const avg = layout.get_average_age(nodes);

                expect(avg).toBe(1960);
            });

            it('should return undefined for empty array', () => {
                const dag = createSimpleDag();
                const layout = new DagLayout(dag, [100, 100]);

                const avg = layout.get_average_age([]);

                expect(avg).toBeUndefined();
            });

            it('should handle undefined ages with fallback to 0', () => {
                const dag = createSimpleDag();
                const layout = new DagLayout(dag, [100, 100]);

                const nodes: D3Node[] = [
                    { added_data: { age: undefined, is_visible: true, is_highlighted: false } } as any,
                    { added_data: { age: 100, is_visible: true, is_highlighted: false } } as any
                ];

                const avg = layout.get_average_age(nodes);

                expect(avg).toBe(50); // (0 + 100) / 2
            });
        });

        describe('get_oldest_age', () => {
            it('should find minimum age', () => {
                const dag = createSimpleDag();
                const layout = new DagLayout(dag, [100, 100]);

                const nodes: D3Node[] = [
                    { added_data: { age: 1970, is_visible: true, is_highlighted: false } } as any,
                    { added_data: { age: 1950, is_visible: true, is_highlighted: false } } as any,
                    { added_data: { age: 1960, is_visible: true, is_highlighted: false } } as any
                ];

                const oldest = layout.get_oldest_age(nodes);

                expect(oldest).toBe(1950);
            });

            it('should return undefined for empty array', () => {
                const dag = createSimpleDag();
                const layout = new DagLayout(dag, [100, 100]);

                const oldest = layout.get_oldest_age([]);

                expect(oldest).toBeUndefined();
            });
        });
    });

    describe('node spacing', () => {
        it('should use NODE_SPACING from constants', () => {
            const dag = createSimpleDag();
            const nodeSize: [number, number] = [
                LAYOUT_CONSTANTS.NODE_SPACING_X,
                LAYOUT_CONSTANTS.NODE_SPACING_Y
            ];
            const layout = new DagLayout(dag, nodeSize);

            expect(layout.node_size[0]).toBe(100);
            expect(layout.node_size[1]).toBe(100);
        });

        it('should separate generations vertically', () => {
            const dag = createSimpleDag();
            const layout = new DagLayout(dag, [100, 100]);

            layout.run();

            // Get nodes from different generations
            const gen0Nodes: D3Node[] = [];
            const gen1Nodes: D3Node[] = [];

            for (const node of dag.nodes()) {
                if (node.added_data.input) {
                    const gen = (node.added_data.input as any).gen;
                    if (gen === 1) gen0Nodes.push(node);
                    if (gen === 2) gen1Nodes.push(node);
                }
            }

            if (gen0Nodes.length > 0 && gen1Nodes.length > 0) {
                // Different generations should have different y coordinates
                const y0 = gen0Nodes[0].y;
                const y1 = gen1Nodes[0].y;
                expect(y0).not.toBe(y1);
            }
        });
    });

    describe('edge cases', () => {
        it('should handle single parent with child', () => {
            // DAG requires at least one link, so test with minimal structure
            const links: Array<[string, string]> = [
                ['mem_0', 'u_0'],
                ['u_0', 'mem_1']
            ];
            const members = {
                'mem_0': {
                    id: 'mem_0',
                    name: 'Parent',
                    birth_date: '1950',
                    gender: 'E' as const,
                    is_spouse: false,
                    gen: 1
                },
                'mem_1': {
                    id: 'mem_1',
                    name: 'Child',
                    birth_date: '1980',
                    gender: 'E' as const,
                    is_spouse: false,
                    gen: 2
                }
            };

            const dag = new DagWithFamilyData(links, members);
            const layout = new DagLayout(dag, [100, 100]);

            expect(() => layout.run()).not.toThrow();
        });

        it('should handle complex family structures', () => {
            const links: Array<[string, string]> = [
                ['mem_0', 'u_0'],
                ['mem_1', 'u_0'],
                ['u_0', 'mem_2'],
                ['u_0', 'mem_3'],
                ['mem_2', 'u_1'],
                ['u_1', 'mem_4']
            ];

            const members = {
                'mem_0': { id: 'mem_0', name: 'Father', birth_date: '1950', gender: 'E' as const, is_spouse: false, gen: 1 },
                'mem_1': { id: 'mem_1', name: 'Mother', birth_date: '1952', gender: 'K' as const, is_spouse: true, gen: 1 },
                'mem_2': { id: 'mem_2', name: 'Child1', birth_date: '1980', gender: 'E' as const, is_spouse: false, gen: 2 },
                'mem_3': { id: 'mem_3', name: 'Child2', birth_date: '1982', gender: 'K' as const, is_spouse: false, gen: 2 },
                'mem_4': { id: 'mem_4', name: 'Grandchild', birth_date: '2010', gender: 'E' as const, is_spouse: false, gen: 3 }
            };

            const dag = new DagWithFamilyData(links, members);
            const layout = new DagLayout(dag, [100, 100]);

            expect(() => layout.run()).not.toThrow();

            // All nodes should have coordinates
            for (const node of dag.nodes()) {
                expect(isFinite(node.x)).toBe(true);
                expect(isFinite(node.y)).toBe(true);
            }
        });

        it('orders a lineage member before a spouse even when the stored pair is reversed', () => {
            const links: Array<[string, string]> = [
                ['spouse', 'union'], ['primary', 'union'], ['union', 'child'],
            ];
            const members = {
                primary: { id: 'primary', name: 'Primary', birth_date: '1950', is_spouse: false },
                spouse: { id: 'spouse', name: 'Spouse', birth_date: '1952', is_spouse: true },
                child: { id: 'child', name: 'Child', birth_date: '1980', is_spouse: false },
            };
            const dag = new DagWithFamilyData(links, members, { union: ['spouse', 'primary'] });

            new DagLayout(dag, [100, 100]).run();

            expect(dag.find_node('primary').x).toBeLessThan(dag.find_node('spouse').x);
        });

        it('keeps two parented partners aligned with their incoming branches', () => {
            const links: Array<[string, string]> = [
                ['upperParent', 'upperFamily'], ['upperFamily', 'spouse'],
                ['lowerParent', 'lowerFamily'], ['lowerFamily', 'primary'],
                ['primary', 'couple'], ['spouse', 'couple'], ['couple', 'child'],
            ];
            const members = {
                upperParent: { id: 'upperParent', name: 'A', birth_date: '1900', is_spouse: false },
                lowerParent: { id: 'lowerParent', name: 'B', birth_date: '1910', is_spouse: false },
                primary: { id: 'primary', name: 'Primary', birth_date: '1940', is_spouse: false },
                spouse: { id: 'spouse', name: 'Spouse', birth_date: '1940', is_spouse: true },
                child: { id: 'child', name: 'Child', birth_date: '1970', is_spouse: false },
            };
            const dag = new DagWithFamilyData(links, members, { couple: ['primary', 'spouse'] });

            new DagLayout(dag, [100, 100]).run();

            expect(dag.find_node('spouse').x).toBeLessThan(dag.find_node('primary').x);
        });
    });
});
