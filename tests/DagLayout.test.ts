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
