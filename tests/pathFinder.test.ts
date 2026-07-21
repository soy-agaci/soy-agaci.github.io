import { describe, expect, it } from 'vitest';
import { dag_with_family_data } from '../src/components/Tree/dagWithFamilyData';
import { shortestLineagePath } from '../src/components/Tree/Familienbaum';

describe('shortestLineagePath', () => {
    it('uses a display-only shortcut only when its family is enabled', () => {
        const members = {
            me: { id: 'me', name: 'Me', lineage_member: true },
            mom: { id: 'mom', name: 'Mom', lineage_member: false },
            grandma: { id: 'grandma', name: 'Grandma', lineage_member: true },
            relative1: { id: 'relative1', name: 'Relative 1', lineage_member: true },
            relative2: { id: 'relative2', name: 'Relative 2', lineage_member: true },
        };
        const dag = dag_with_family_data([
            ['me', 'u_direct1'], ['u_direct1', 'mom'], ['mom', 'u_direct2'], ['u_direct2', 'grandma'],
            ['me', 'u_long1'], ['u_long1', 'relative1'], ['relative1', 'u_long2'],
            ['u_long2', 'relative2'], ['relative2', 'u_long3'], ['u_long3', 'grandma'],
        ], members);

        expect(shortestLineagePath(dag, 'me', 'grandma')?.map(node => node.data)).toEqual([
            'me', 'u_long1', 'relative1', 'u_long2', 'relative2', 'u_long3', 'grandma',
        ]);

        members.mom.lineage_member = true;
        expect(shortestLineagePath(dag, 'me', 'grandma')?.map(node => node.data)).toEqual([
            'me', 'u_direct1', 'mom', 'u_direct2', 'grandma',
        ]);
    });
});
