import { describe, expect, it, vi } from 'vitest';
import { Familienbaum } from '../src/components/Tree/Familienbaum';
import { dag_with_family_data } from '../src/components/Tree/dagWithFamilyData';
import { adaptToViewport, fitPoints, keepPointStationary, keepTreeInViewport } from '../src/components/Tree/viewport';

describe('tree viewport', () => {
    it('keeps an anchor stationary when layout coordinates change', () => {
        expect(keepPointStationary(
            { k: 2, x: 30, y: 40 },
            [100, 200],
            [150, 180],
        )).toEqual({ k: 2, x: -70, y: 80 });
    });

    it('adapts a visible active node to a smaller viewport', () => {
        const next = adaptToViewport(
            { k: 1, x: 0, y: 0, width: 1200, height: 800 },
            { width: 360, height: 640 },
            [1100, 400],
        );
        expect(next.x + 1100).toBeLessThanOrEqual(360 - 64);
        expect(next.y + 400).toBe(320);
    });

    it('does not fight a user who deliberately panned the active node away', () => {
        expect(adaptToViewport(
            { k: 1, x: -1000, y: 0, width: 1200, height: 800 },
            { width: 360, height: 640 },
            [100, 100],
        )).toEqual({ k: 1, x: -1420, y: -80, width: 360, height: 640 });
    });

    it('allows almost all of the tree offscreen but keeps 10% of the closest node visible', () => {
        const next = keepTreeInViewport(
            { k: 1, x: -1000, y: -1000 },
            { width: 800, height: 600 },
            [[100, 100], [200, 200]],
            28,
        );
        expect(next.x).toBeCloseTo(-222.4);
        expect(next.y).toBeCloseTo(-222.4);
    });

    it('brings an already-rendered search result into view', () => {
        const target = { data: 'sencer', added_data: { is_visible: true } };
        const tree = Object.create(Familienbaum.prototype) as Familienbaum;
        tree.dag_all = { find_node: () => target } as any;
        tree.draw = vi.fn();
        tree.ensureNodeVisible = vi.fn();

        tree.connectToVisible('sencer');

        expect(tree.draw).toHaveBeenCalledWith(true, 'sencer', false);
        expect(tree.ensureNodeVisible).toHaveBeenCalledWith('sencer');
        expect((tree as any).viewAnchorId).toBe('sencer');
        expect((tree as any).viewMode).toBe(0);
    });

    it('settles repeated person-view clicks without overlapping camera transitions', () => {
        const node = { data: 'sencer', added_data: { is_visible: true, input: {} } };
        const tree = Object.create(Familienbaum.prototype) as any;
        tree.dag_all = { find_node: () => node, nodes: () => [node] };
        tree.viewAnchorId = null;
        tree.viewMode = -1;
        tree.setView = vi.fn();
        tree.draw = vi.fn();

        tree.click('sencer');

        expect(tree.draw).toHaveBeenCalledWith(true, 'sencer', false);
    });

    it('skips a no-op first mode after search already revealed the ancestor path', () => {
        const self = { data: 'self', added_data: { is_visible: true, input: {} } };
        const child = { data: 'child', added_data: { is_visible: false, input: {} } };
        const union = { data: 'union', added_data: { is_visible: false } };
        const tree = Object.create(Familienbaum.prototype) as any;
        tree.dag_all = { find_node: () => self, nodes: () => [self, child, union] };
        tree.viewAnchorId = null;
        tree.viewMode = -1;
        tree.setView = vi.fn((_node, mode) => {
            self.added_data.is_visible = true;
            union.added_data.is_visible = true;
            child.added_data.is_visible = mode === 1;
        });
        tree.draw = vi.fn();

        tree.click('self');

        expect(tree.viewMode).toBe(1);
        expect(child.added_data.is_visible).toBe(true);
    });

    it('shows both parents but continues ancestors through the father only', () => {
        const dag = dag_with_family_data([
            ['paternalGrandfather', 'u_paternal'], ['u_paternal', 'father'],
            ['maternalGrandfather', 'u_maternal'], ['u_maternal', 'mother'],
            ['father', 'u_parents'], ['mother', 'u_parents'], ['u_parents', 'self'],
        ], {
            paternalGrandfather: { id: 'paternalGrandfather', name: 'Paternal grandfather', is_spouse: false },
            maternalGrandfather: { id: 'maternalGrandfather', name: 'Maternal grandfather', is_spouse: false },
            mother: { id: 'mother', name: 'Mother', gender: 'K', is_spouse: false },
            father: { id: 'father', name: 'Father', gender: 'E', is_spouse: false },
            self: { id: 'self', name: 'Self', is_spouse: false },
        });
        const tree = Object.create(Familienbaum.prototype) as any;
        tree.dag_all = dag;
        tree.viewAnchorId = null;
        tree.viewMode = -1;
        tree.draw = vi.fn();

        tree.click('self');

        expect(dag.find_node('father').added_data.is_visible).toBe(true);
        expect(dag.find_node('mother').added_data.is_visible).toBe(true);
        expect(dag.find_node('paternalGrandfather').added_data.is_visible).toBe(true);
        expect(dag.find_node('maternalGrandfather').added_data.is_visible).toBe(false);
    });

    it('restores the union nodes needed by an in-page shared URL', () => {
        const dag = dag_with_family_data([
            ['father', 'parents'], ['mother', 'parents'], ['parents', 'self'],
            ['self', 'family'], ['spouse', 'family'], ['family', 'child'],
        ], {
            father: { id: 'father' }, mother: { id: 'mother' }, self: { id: 'self' },
            spouse: { id: 'spouse' }, child: { id: 'child' },
        });
        const tree = Object.assign(Object.create(Familienbaum.prototype), { dag_all: dag, data: { start: 'self' } }) as Familienbaum;

        tree.restoreVisibility(new Set(['father', 'mother', 'self', 'spouse', 'child']));

        expect(dag.find_node('parents').added_data.is_visible).toBe(true);
        expect(dag.find_node('family').added_data.is_visible).toBe(true);
    });

    it('centers and fits visible nodes on reset', () => {
        expect(fitPoints([[0, 0], [1000, 400]], { width: 600, height: 400 })).toEqual({
            k: 0.44, x: 80, y: 112, width: 600, height: 400,
        });
    });
});
