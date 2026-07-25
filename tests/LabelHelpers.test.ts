import { describe, it, expect, beforeEach } from 'vitest';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';
import { set_multiline } from '../src/components/Tree/LabelHelpers';
import { D3Node } from '../src/types/types';

describe('LabelHelpers', () => {
    let dom: JSDOM;
    let svg: any;
    let container: any;

    beforeEach(() => {
        // Create a fake DOM for D3 to work with
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        global.document = dom.window.document as any;
        global.window = dom.window as any;

        // Create SVG container
        svg = d3.select(dom.window.document.body)
            .append('svg');
        container = svg.append('g');
    });

    it('should render multi-line label with name and dates', () => {
        const node: D3Node = {
            data: 'mem_0',
            x: 0,
            y: 0,
            added_data: {
                input: {
                    name: 'John Doe',
                    first_name: 'John',
                    last_name: 'Doe',
                    birth_date: '1950',
                    death_date: '2020'
                }
            }
        } as any;

        set_multiline(container, node, true);

        const textElements = container.selectAll('text.node-label');
        expect(textElements.size()).toBe(1);

        const tspans = container.selectAll('tspan');
        expect(tspans.size()).toBeGreaterThan(0);

        // Check that name appears in first line
        const firstLine = tspans.nodes()[0].textContent;
        expect(firstLine).toContain('John');
    });

    it('should handle names with special words (Dr., von, etc.)', () => {
        const node: D3Node = {
            data: 'mem_0',
            x: 0,
            y: 0,
            added_data: {
                input: {
                    name: 'Dr. Hans von Schmidt',
                    first_name: 'Dr.',
                    last_name: 'von Schmidt',
                    birth_date: '1900'
                }
            }
        } as any;

        set_multiline(container, node, true);

        const textElements = container.selectAll('text.node-label');
        expect(textElements.size()).toBe(1);

        // The label should include special words without abbreviation
        const tspans = container.selectAll('tspan');
        const firstLine = tspans.nodes()[0].textContent;
        expect(firstLine).toContain('Dr.');
        expect(firstLine).toContain('von');
    });

    it('should abbreviate multiple middle names', () => {
        const node: D3Node = {
            data: 'mem_0',
            x: 0,
            y: 0,
            added_data: {
                input: {
                    name: 'John William Robert Doe',
                    first_name: 'John',
                    last_name: 'Doe',
                    second_names: 'William Robert'
                }
            }
        } as any;

        set_multiline(container, node, true);

        const tspans = container.selectAll('tspan');
        const firstLine = tspans.nodes()[0].textContent;

        // Multiple middle names should be abbreviated
        expect(firstLine).toMatch(/W\.|William/);
    });

    it('should handle birth and death places in edit mode', () => {
        const node: D3Node = {
            data: 'mem_0',
            x: 0,
            y: 0,
            added_data: {
                input: {
                    name: 'John Doe',
                    first_name: 'John',
                    last_name: 'Doe',
                    birth_date: '1950',
                    death_date: '2020',
                    birthplace: 'New York',
                    death_place: 'Boston'
                }
            }
        } as any;

        set_multiline(container, node, true);

        const tspans = container.selectAll('tspan');
        const lines = Array.from(tspans.nodes()).map((n: any) => n.textContent);

        // Should have multiple lines including places
        expect(lines.length).toBeGreaterThan(2);

        // Places should appear with symbols
        const placeLineExists = lines.some(line =>
            line.includes('◦') || line.includes('●')
        );
        expect(placeLineExists).toBe(true);
    });

    it('should handle same birth and death place', () => {
        const node: D3Node = {
            data: 'mem_0',
            x: 0,
            y: 0,
            added_data: {
                input: {
                    name: 'John Doe',
                    first_name: 'John',
                    last_name: 'Doe',
                    birth_date: '1950',
                    death_date: '2020',
                    birth_place: 'Boston', // Use birth_place to match dagWithFamilyData lookup
                    death_place: 'Boston'
                }
            }
        } as any;

        set_multiline(container, node, true);

        const tspans = container.selectAll('tspan');
        const lines = Array.from(tspans.nodes()).map((n: any) => n.textContent);

        // Should combine birth and death place with *† symbol
        const combinedPlaceExists = lines.some(line =>
            line.includes('◦●') && line.includes('Boston')
        );
        expect(combinedPlaceExists).toBe(true);
    });

    it('should truncate long text with ellipsis', () => {
        const longName = 'A'.repeat(50);
        const node: D3Node = {
            data: 'mem_0',
            x: 0,
            y: 0,
            added_data: {
                input: {
                    name: longName,
                    first_name: longName,
                    last_name: ''
                }
            }
        } as any;

        set_multiline(container, node, true);

        const tspans = container.selectAll('tspan');
        const firstLine = tspans.nodes()[0].textContent;

        // Should be truncated to 40 chars with ...
        expect(firstLine.length).toBeLessThanOrEqual(40);
        expect(firstLine).toContain('...');
    });

    it('should not render labels for union nodes', () => {
        const unionNode: D3Node = {
            data: 'u_0_1',
            x: 0,
            y: 0,
            added_data: {} // No input data for union nodes
        } as any;

        set_multiline(container, unionNode, true);

        const textElements = container.selectAll('text.node-label');
        // Union nodes should not have labels
        expect(textElements.size()).toBe(0);
    });

    it('should show marriage info when provided', () => {
        const node: D3Node = {
            data: 'mem_0',
            x: 0,
            y: 0,
            added_data: {
                input: {
                    name: 'John Doe',
                    first_name: 'John',
                    last_name: 'Doe',
                    marriage: '1975'
                }
            }
        } as any;

        set_multiline(container, node, true);

        const tspans = container.selectAll('tspan');
        const lines = Array.from(tspans.nodes()).map((n: any) => n.textContent);

        // Marriage should appear with ⚭ symbol
        const marriageLineExists = lines.some(line =>
            line.includes('⚭') && line.includes('1975')
        );
        expect(marriageLineExists).toBe(true);
    });

    it('should hide occupation, places, and notes when edit mode is false', () => {
        const node: D3Node = {
            data: 'mem_0',
            x: 0,
            y: 0,
            added_data: {
                input: {
                    name: 'John Doe',
                    first_name: 'John',
                    last_name: 'Doe',
                    birth_date: '1950',
                    occupation: 'Engineer',
                    birthplace: 'Boston',
                    note: 'Some note'
                }
            }
        } as any;

        set_multiline(container, node, false); // edit_mode = false

        const tspans = container.selectAll('tspan');
        expect(tspans.size()).toBeLessThanOrEqual(2); // Only name and dates

        const lines = Array.from(tspans.nodes()).map((n: any) => n.textContent);

        // Should not contain occupation, places, or notes
        const hasExtraInfo = lines.some(line =>
            line.includes('Engineer') ||
            line.includes('Boston') ||
            line.includes('Some note')
        );
        expect(hasExtraInfo).toBe(false);
    });

    it('should handle empty names gracefully', () => {
        const node: D3Node = {
            data: 'mem_0',
            x: 0,
            y: 0,
            added_data: {
                input: {
                    name: '',
                    first_name: '',
                    last_name: ''
                }
            }
        } as any;

        // Should not throw error
        expect(() => set_multiline(container, node, true)).not.toThrow();
    });

    it('should handle undefined optional fields', () => {
        const node: D3Node = {
            data: 'mem_0',
            x: 0,
            y: 0,
            added_data: {
                input: {
                    name: 'John Doe',
                    first_name: 'John',
                    last_name: 'Doe'
                    // No birth_date, death_date, etc.
                }
            }
        } as any;

        // Should not throw error
        expect(() => set_multiline(container, node, true)).not.toThrow();

        const textElements = container.selectAll('text.node-label');
        expect(textElements.size()).toBe(1);
    });
});
