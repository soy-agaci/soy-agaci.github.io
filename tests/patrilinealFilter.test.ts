import { describe, it, expect } from 'vitest';
import { filterPatrilineal } from '../src/utils/patrilinealFilter';
import { FamilyData } from '../src/types/types';

describe('patrilinealFilter', () => {
    it('should include the root node', () => {
        const data: FamilyData = {
            start: 'mem_0',
            members: {
                'mem_0': { id: 'mem_0', name: 'Root', gen: 1, gender: 'E', is_spouse: false } as any
            },
            links: []
        };

        const filtered = filterPatrilineal(data);
        expect(filtered.members['mem_0']).toBeDefined();
    });

    it('should include male descendants', () => {
        const data: FamilyData = {
            start: 'mem_0',
            members: {
                'mem_0': { id: 'mem_0', name: 'Root', gen: 1, gender: 'E', is_spouse: false } as any,
                'mem_1': { id: 'mem_1', name: 'Son', gen: 2, gender: 'E', is_spouse: false } as any,
                'mem_2': { id: 'mem_2', name: 'Daughter', gen: 2, gender: 'K', is_spouse: false } as any
            },
            links: [
                ['mem_0', 'u_0'],
                ['u_0', 'mem_1'],
                ['u_0', 'mem_2']
            ]
        };

        const filtered = filterPatrilineal(data);
        expect(filtered.members['mem_1']).toBeDefined(); // Son should be there
        // Daughter might be there as a child of root, but her children won't be if she had any.
        // The filter logic is: "Male Lineage" usually means men and their children.
        // Let's verify the exact logic in patrilinealFilter.ts:
        // "Track which members are in the male lineage (Strictly Father -> Son)"
        // "Recursively check if someone is in male lineage"

        // If Root is E, Son is E -> Son is in male lineage.
        // Daughter is K -> Daughter is NOT in male lineage (as a propagator), but might be shown as a child?
        // The code says: "if (memberId === actualRoot) ... return true"
        // "if (bloodParent is in lineage AND bloodParent is Male AND member is Male) -> True"

        // So Daughter (K) will return False for isInMaleLineage.
        // BUT, the display logic might include children of male lineage members even if they aren't male lineage themselves?
        // "for (const h in t.members) if (r.has(h)) c.add(h); else if (!y.is_spouse) { const f = l(h); f && r.has(f) && c.add(h) }"
        // This means: If parent is in male lineage, child is added to display set 'c'.

        expect(filtered.members['mem_2']).toBeDefined(); // Daughter should be displayed
    });

    it('should exclude children of female descendants', () => {
        const data: FamilyData = {
            start: 'mem_0',
            members: {
                'mem_0': { id: 'mem_0', name: 'Root', gen: 1, gender: 'E', is_spouse: false } as any,
                'mem_1': { id: 'mem_1', name: 'Daughter', gen: 2, gender: 'K', is_spouse: false } as any,
                'mem_2': { id: 'mem_2', name: 'Grandchild', gen: 3, gender: 'E', is_spouse: false } as any
            },
            links: [
                ['mem_0', 'u_0'],
                ['u_0', 'mem_1'],
                ['mem_1', 'u_1'],
                ['u_1', 'mem_2']
            ]
        };

        const filtered = filterPatrilineal(data);
        expect(filtered.members['mem_1']).toBeDefined(); // Daughter is child of Root
        expect(filtered.members['mem_2']).toBeUndefined(); // Grandchild via Daughter should be excluded
    });

    it('keeps a mother who has her own recorded parents', () => {
        const data: FamilyData = {
            start: 'son',
            members: {
                father: { id: 'father', name: 'Father', gen: 1, gender: 'E', is_spouse: false },
                mother: { id: 'mother', name: 'Mother', gen: 1, gender: 'K', is_spouse: true },
                son: { id: 'son', name: 'Son', gen: 2, gender: 'E', is_spouse: false },
                maternalGrandfather: { id: 'maternalGrandfather', name: 'Grandfather', gen: 0, gender: 'E', is_spouse: true },
            },
            links: [
                ['maternalGrandfather', 'u_maternal'], ['u_maternal', 'mother'],
                ['father', 'u_parents'], ['mother', 'u_parents'], ['u_parents', 'son'],
            ],
        };

        const filtered = filterPatrilineal(data);

        expect(filtered.start).toBe('son');
        expect(filtered.members.mother).toBeDefined();
        expect(filtered.members.maternalGrandfather).toBeUndefined();
    });

    it('treats a daughter as family but not her son', () => {
        const data: FamilyData = {
            start: 'daughter',
            members: {
                father: { id: 'father', name: 'Father', gen: 1, gender: 'E' },
                mother: { id: 'mother', name: 'Mother', gen: 1, gender: 'K' },
                daughter: { id: 'daughter', name: 'Daughter', gen: 2, gender: 'K' },
                son: { id: 'son', name: 'Son', gen: 3, gender: 'E' },
            },
            links: [
                ['father', 'u_parents'], ['mother', 'u_parents'], ['u_parents', 'daughter'],
                ['daughter', 'u_child'], ['u_child', 'son'],
            ],
        };

        const filtered = filterPatrilineal(data);

        expect(filtered.members.father).toBeDefined();
        expect(filtered.members.mother).toBeDefined();
        expect(filtered.members.daughter).toBeDefined();
        expect(filtered.members.son).toBeUndefined();

        const lineageOnly = filterPatrilineal(data, false);
        expect(lineageOnly.members.mother).toBeUndefined();
        expect(lineageOnly.members.daughter).toBeDefined();
    });
});
