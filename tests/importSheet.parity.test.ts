import { readFile } from 'node:fs/promises';
import { csvParseRows } from 'd3';
import { describe, expect, it } from 'vitest';
import { processSheetData } from '../src/services/data/sheetLoader';
import { buildImportPayload } from '../tools/import-sheet';

const run = process.env.PRIMARY_CSV ? describe : describe.skip;

run('selcuk aggregate parity', () => {
    it('matches the approved baseline and relational formulas', async () => {
        const rows = csvParseRows(await readFile(process.env.PRIMARY_CSV!, 'utf8'));
        const graph = processSheetData(rows.slice(1), {
            writeBackGeneratedIds: false,
            onWarning: () => undefined,
        });
        const payload = buildImportPayload(graph, rows.length - 1, [], 'public');
        const unionIds = [...new Set(graph.links.flatMap(([source, target]) =>
            [source, target].filter(id => id.startsWith('u_'))
        ))];
        const unions = unionIds.map(id => ({
            parents: graph.links.filter(([, target]) => target === id).length,
            children: graph.links.filter(([source]) => source === id).length,
        }));
        const parentIncidences = unions.reduce((total, union) => total + union.parents, 0);
        const childEdges = unions.reduce((total, union) => total + union.children, 0);

        expect(Object.keys(graph.members)).toHaveLength(520);
        expect(unions).toHaveLength(145);
        expect(graph.links).toHaveLength(664);
        expect(graph.links.length).toBe(parentIncidences + childEdges);
        expect(payload.partnerships).toHaveLength(unions.filter(union => union.parents === 2).length);
        expect(payload.parent_links).toHaveLength(
            unions.reduce((total, union) => total + union.parents * union.children, 0),
        );
        expect(payload.life_events).toHaveLength(Object.values(graph.members).reduce((total, member) => total
            + Number(Boolean(member.birth_date || member.birthplace || member.birth_place))
            + Number(Boolean(member.death_date || member.death_place))
            + Number(Boolean(member.occupation)), 0));
        expect(payload.media).toHaveLength(Object.values(graph.members).filter(member => member.image_path).length);
        expect(payload.partnerships.every(partnership => partnership.person1_legacy_id !== partnership.person2_legacy_id)).toBe(true);
        expect(payload.parent_links.every(link => link.parent_legacy_id !== link.child_legacy_id)).toBe(true);
    });
});
