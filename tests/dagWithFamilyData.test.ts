import { describe, it, expect, vi } from 'vitest';
import { dag_with_family_data, get_name, is_member, get_birth_date } from '../src/components/Tree/dagWithFamilyData';
import { Familienbaum } from '../src/components/Tree/Familienbaum';
import { D3Node } from '../src/types/types';

describe('dagWithFamilyData helpers', () => {
    it('should extract name correctly', () => {
        const node: D3Node = {
            data: 'mem_0',
            added_data: {
                input: { name: 'John Doe', first_name: 'John', last_name: 'Doe' }
            }
        } as any;

        expect(get_name(node)).toBe('John Doe');
    });

    it('ignores explicitly undefined optional label fields', () => {
        const node = { data: 'person', added_data: { input: { name: undefined } } } as any;
        expect(get_name(node)).toBe('?');
    });

    it('should identify members vs unions', () => {
        const memberNode: D3Node = {
            data: 'mem_0',
            added_data: { input: {} }
        } as any;
        const unionNode: D3Node = {
            data: 'u_0_1',
            added_data: {} // Unions don't have 'input'
        } as any;

        expect(is_member(memberNode)).toBe(true);
        expect(is_member(unionNode)).toBe(false);
    });

    it('should extract birth date', () => {
        const node: D3Node = {
            data: 'mem_0',
            added_data: {
                input: { birth_date: '1990' }
            }
        } as any;

        expect(get_birth_date(node)).toBe('1990');
        expect(get_birth_date({ data: 'unknown', added_data: { input: {} } } as any)).toBe('');
    });

    it('preserves layout coordinates and visibility while accepting refreshed member data', () => {
        const links: Array<[string, string]> = [['parent', 'union'], ['union', 'child']];
        const oldData = {
            start: 'parent', links,
            members: {
                parent: { id: 'parent', name: 'Old name' },
                child: { id: 'child', name: 'Child' },
            },
        };
        const oldDag = dag_with_family_data(links, oldData.members);
        for (const node of oldDag.nodes()) node.added_data.is_visible = true;
        oldDag.find_node('parent').x = 100;
        oldDag.find_node('parent').y = 200;
        const tree = Object.assign(Object.create(Familienbaum.prototype), {
            data: oldData, dag: oldDag, dag_all: oldDag,
            draw: vi.fn(), ensureNodeVisible: vi.fn(),
        }) as Familienbaum;

        tree.updateData({ ...oldData, members: { ...oldData.members, parent: { id: 'parent', name: 'Pending name' } } });

        const parent = tree.dag_all.find_node('parent');
        expect(parent.added_data).toMatchObject({ x0: 100, y0: 200, is_visible: true });
        expect(parent.added_data.input?.name).toBe('Pending name');
    });

    it('reset restores the default root view before fitting it', () => {
        const tree = Object.assign(Object.create(Familienbaum.prototype), {
            data: { start: 'root' }, viewAnchorId: 'child', viewMode: 3,
            reset_dags: vi.fn(), draw: vi.fn(), fitVisibleNodes: vi.fn(),
        }) as any;

        const resetData = { start: 'canonical-root' };
        tree.resetView(resetData);

        expect(tree.reset_dags).toHaveBeenCalledOnce();
        expect(tree.data).toBe(resetData);
        expect(tree.draw).toHaveBeenCalledWith(false, 'canonical-root', false);
        expect(tree.fitVisibleNodes).toHaveBeenCalledOnce();
        expect(tree.viewAnchorId).toBeNull();
    });
});
