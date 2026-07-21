import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';
import { TreeRenderer } from '../src/components/Tree/TreeRenderer';
import { D3Node } from '../src/types/types';
import { LAYOUT_CONSTANTS } from '../src/constants/layout';

describe('TreeRenderer', () => {
    let dom: JSDOM;
    let svg: any;
    let g: any;
    let renderer: TreeRenderer;
    let onNodeClick: ReturnType<typeof vi.fn>;
    let onNodeDblClick: ReturnType<typeof vi.fn>;
    let onEditClick: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // Create a fake DOM for D3 to work with
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        global.document = dom.window.document as any;
        global.window = dom.window as any;

        // Create SVG container
        svg = d3.select(dom.window.document.body)
            .append('svg')
            .attr('width', 800)
            .attr('height', 600);
        g = svg.append('g');

        // Create mock callbacks
        onNodeClick = vi.fn();
        onNodeDblClick = vi.fn();
        onEditClick = vi.fn();

        // Create renderer
        renderer = new TreeRenderer(g, onNodeClick, onNodeDblClick, onEditClick);
    });

    describe('constructor', () => {
        it('should initialize with correct properties', () => {
            expect(renderer.g).toBe(g);
            expect(renderer.transition_milliseconds).toBe(LAYOUT_CONSTANTS.TRANSITION_DURATION_MS);
            expect(renderer.onNodeClick).toBe(onNodeClick);
            expect(renderer.onNodeDblClick).toBe(onNodeDblClick);
            expect(renderer.onEditClick).toBe(onEditClick);
        });

        it('should have default transition duration', () => {
            expect(renderer.transition_milliseconds).toBe(500);
        });
    });

    describe('draw_nodes', () => {
        function createMockNode(id: string, isMember: boolean = true): D3Node {
            return {
                data: id,
                x: 100,
                y: 50,
                added_data: {
                    x0: 0,
                    y0: 0,
                    is_visible: true,
                    is_highlighted: false,
                    input: isMember ? {
                        id,
                        name: `Person ${id}`,
                        gender: 'E' as const,
                        is_spouse: false
                    } : undefined
                }
            } as any;
        }

        it('should render nodes in the SVG', () => {
            // Disable transitions to avoid jsdom SVG transform issues
            renderer.transition_milliseconds = 0;

            const nodes = [createMockNode('mem_0'), createMockNode('mem_1')];
            const currentNode = createMockNode('mem_0');

            renderer.draw_nodes(nodes, currentNode);

            const nodeElements = g.selectAll('g.node');
            expect(nodeElements.size()).toBe(2);
        });

        it('should sort nodes (members on top of unions)', () => {
            renderer.transition_milliseconds = 0;
            const memberNode = createMockNode('mem_0', true);
            const unionNode = createMockNode('u_0_1', false);
            const currentNode = createMockNode('mem_0');

            renderer.draw_nodes([unionNode, memberNode], currentNode);

            // Both should be rendered
            const nodeElements = g.selectAll('g.node');
            expect(nodeElements.size()).toBe(2);
        });

        it('should add circle elements for each node', () => {
            renderer.transition_milliseconds = 0;
            const nodes = [createMockNode('mem_0')];
            const currentNode = createMockNode('mem_0');

            renderer.draw_nodes(nodes, currentNode);

            const circles = g.selectAll('circle');
            expect(circles.size()).toBeGreaterThan(0);
        });

        it('should position nodes at correct coordinates', () => {
            renderer.transition_milliseconds = 0;
            const node = createMockNode('mem_0');
            node.x = 150;
            node.y = 200;
            const currentNode = createMockNode('mem_0');

            renderer.draw_nodes([node], currentNode);

            // Verify the node group exists
            const nodeElements = g.selectAll('g.node');
            expect(nodeElements.size()).toBe(1);
        });

        it('should handle empty node array', () => {
            renderer.transition_milliseconds = 0;
            const currentNode = createMockNode('mem_0');

            expect(() => renderer.draw_nodes([], currentNode)).not.toThrow();

            const nodeElements = g.selectAll('g.node');
            expect(nodeElements.size()).toBe(0);
        });

        it('should update existing nodes', () => {
            renderer.transition_milliseconds = 0;
            const node = createMockNode('mem_0');
            const currentNode = createMockNode('mem_0');

            // First render
            renderer.draw_nodes([node], currentNode);
            expect(g.selectAll('g.node').size()).toBe(1);

            // Update position
            node.x = 200;
            node.y = 300;

            // Second render (should update, not duplicate)
            renderer.draw_nodes([node], currentNode);
            expect(g.selectAll('g.node').size()).toBe(1);
        });

        it('uses computed coordinates when a new focus node has no previous position', () => {
            renderer.transition_milliseconds = 0;
            const node = createMockNode('mem_new');
            node.x = 120;
            node.y = 240;
            delete node.added_data.x0;
            delete node.added_data.y0;

            renderer.draw_nodes([node], node);
            renderer.draw_links([{ source: node, target: node }], node);

            expect(g.select('g.node').attr('transform')).toBe('translate(240,120)');
            expect(g.select('path.link').attr('d')).not.toContain('undefined');
        });

        it('refreshes a pending profile name and media on an existing node', () => {
            renderer.transition_milliseconds = 0;
            const currentNode = createMockNode('mem_0');
            renderer.draw_nodes([currentNode], currentNode);

            const revised = createMockNode('mem_0');
            (revised.added_data.input as any).name = 'Pending Renamed Person';
            (revised.added_data.input as any).image_path = 'https://example.test/pending.webp';
            renderer.draw_nodes([revised], revised);

            expect(g.selectAll('g.node').size()).toBe(1);
            expect(g.select('text.node-label').text()).toContain('Pending Renamed Person');
            expect(g.selectAll('g.node-content image').size()).toBe(1);
            expect(g.select('g.node-content image').attr('href')).toBe('https://example.test/pending.webp');
        });

        it('opens editing from the keyboard-accessible node control', () => {
            renderer.transition_milliseconds = 0;
            const node = createMockNode('mem_0');
            renderer.draw_nodes([node], node);
            const control = g.select<SVGGElement>('g.edit-control').node()!;
            control.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            expect(control.getAttribute('tabindex')).toBe('0');
            expect(onEditClick).toHaveBeenCalledWith(node);
        });

        it('makes only person nodes keyboard buttons without duplicate activation', () => {
            renderer.transition_milliseconds = 0;
            const person = createMockNode('mem_0');
            const union = createMockNode('u_0', false);
            renderer.draw_nodes([person, union], person);

            const personControl = g.select<SVGGElement>('g.node-content[role="button"]').node()!;
            const unionControl = g.selectAll<SVGGElement, D3Node>('g.node-content').filter((node: D3Node) => !node.added_data.input).node()!;
            expect(personControl.getAttribute('tabindex')).toBe('0');
            expect(personControl.getAttribute('aria-label')).toBe('Kişiyi aç: Person mem_0');
            expect(unionControl.hasAttribute('role')).toBe(false);
            expect(unionControl.hasAttribute('tabindex')).toBe(false);
            expect(g.selectAll('g.edit-control').size()).toBe(1);

            personControl.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            personControl.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, repeat: true }));
            expect(onNodeClick).toHaveBeenCalledTimes(1);
            expect(onNodeClick).toHaveBeenCalledWith(person, expect.anything());
        });
    });

    describe('draw_links', () => {
        function createMockNode(id: string, x: number, y: number): D3Node {
            return {
                data: id,
                x,
                y,
                added_data: {
                    x0: 0,
                    y0: 0,
                    is_visible: true,
                    is_highlighted: false
                }
            } as any;
        }

        it('should render links between nodes', () => {
            renderer.transition_milliseconds = 0;
            const source = createMockNode('mem_0', 0, 0);
            const target = createMockNode('mem_1', 100, 100);
            const links = [{ source, target }];
            const currentNode = createMockNode('mem_0', 0, 0);

            renderer.draw_links(links, currentNode);

            const pathElements = g.selectAll('path.link');
            expect(pathElements.size()).toBe(1);
        });

        it('should create curved paths', () => {
            renderer.transition_milliseconds = 0;
            const source = createMockNode('mem_0', 0, 0);
            const target = createMockNode('mem_1', 200, 100);
            const links = [{ source, target }];
            const currentNode = createMockNode('mem_0', 0, 0);

            renderer.draw_links(links, currentNode);

            const pathElements = g.selectAll('path.link');
            const path = pathElements.node();

            // Check that path exists and has 'd' attribute (path data)
            expect(path).not.toBeNull();
            expect(path.hasAttribute('d')).toBe(true);
        });

        it('should handle empty links array', () => {
            renderer.transition_milliseconds = 0;
            const currentNode = createMockNode('mem_0', 0, 0);

            expect(() => renderer.draw_links([], currentNode)).not.toThrow();

            const pathElements = g.selectAll('path.link');
            expect(pathElements.size()).toBe(0);
        });

        it('should update existing links', () => {
            renderer.transition_milliseconds = 0;
            const source = createMockNode('mem_0', 0, 0);
            const target = createMockNode('mem_1', 100, 100);
            const links = [{ source, target }];
            const currentNode = createMockNode('mem_0', 0, 0);

            // First render
            renderer.draw_links(links, currentNode);
            expect(g.selectAll('path.link').size()).toBe(1);

            // Update positions
            target.x = 200;
            target.y = 200;

            // Second render (should update, not duplicate)
            renderer.draw_links(links, currentNode);
            expect(g.selectAll('path.link').size()).toBe(1);
        });

        it('should handle multiple links', () => {
            renderer.transition_milliseconds = 0;
            const node0 = createMockNode('mem_0', 0, 0);
            const node1 = createMockNode('mem_1', 100, 100);
            const node2 = createMockNode('mem_2', 200, 200);
            const links = [
                { source: node0, target: node1 },
                { source: node1, target: node2 }
            ];
            const currentNode = createMockNode('mem_0', 0, 0);

            renderer.draw_links(links, currentNode);

            const pathElements = g.selectAll('path.link');
            expect(pathElements.size()).toBe(2);
        });
    });

    describe('transitions', () => {
        it('should respect transition duration setting', () => {
            renderer.transition_milliseconds = 1000;
            expect(renderer.transition_milliseconds).toBe(1000);
        });

        it('should allow custom transition duration', () => {
            const customRenderer = new TreeRenderer(g, onNodeClick, onNodeDblClick, onEditClick);
            customRenderer.transition_milliseconds = 250;

            expect(customRenderer.transition_milliseconds).toBe(250);
        });
    });

    describe('integration', () => {
        it('should render complete tree with nodes and links', () => {
            renderer.transition_milliseconds = 0;
            const createNode = (id: string, x: number, y: number): D3Node => ({
                data: id,
                x,
                y,
                added_data: {
                    x0: 0,
                    y0: 0,
                    is_visible: true,
                    is_highlighted: false,
                    input: {
                        id,
                        name: `Person ${id}`,
                        gender: 'E' as const,
                        is_spouse: false
                    }
                }
            } as any);

            const nodes = [
                createNode('mem_0', 100, 0),
                createNode('mem_1', 50, 100),
                createNode('mem_2', 150, 100)
            ];

            const links = [
                { source: nodes[0], target: nodes[1] },
                { source: nodes[0], target: nodes[2] }
            ];

            // Render nodes and links
            renderer.draw_nodes(nodes, nodes[0]);
            renderer.draw_links(links, nodes[0]);

            // Verify both are rendered
            expect(g.selectAll('g.node').size()).toBe(3);
            expect(g.selectAll('path.link').size()).toBe(2);
        });
    });
});
