import { describe, it, expect } from 'vitest';
import { processSheetData } from '../src/services/data/sheetLoader'; // We might need to export this for testing or test loadFromGoogleSheet via mock

// We need to export processSheetData from sheetLoader.ts to test it directly
// or we can mock d3.text and test loadFromGoogleSheet.
// Testing processSheetData is purer.

describe('sheetLoader', () => {
    it('should parse valid member rows', () => {
        const rows = [
            // Gen, Name, Surname, Father, Mother, BirthDate, BirthPlace, DeathDate, Image, Marriage, Gender, Note, ID
            ['1', 'Root', 'Family', '', '', '1900', 'Place', '', '', '', 'E', '', '1'],
            ['2', 'Child', 'Family', 'Root', 'Parent B', '1930', 'Place', '', '', '', 'E', '', '2']
        ];

        // We need to cast to any if processSheetData is not exported,
        // but better to export it in the source file.
        // Assuming I will update sheetLoader.ts to export processSheetData
        const data = processSheetData(rows);

        expect(data.start).toBe('mem_1');
        expect(Object.keys(data.members).length).toBe(2);
        expect(data.members['mem_1'].name).toBe('Root Family');
        expect(data.members['mem_2'].gen).toBe(2);
    });

    it('should handle spouses (Gen E)', () => {
        const rows = [
            ['1', 'Husband', '', '', '', '', '', '', '', '', 'E', '', '1'],
            ['E', 'Wife', '', '', '', '', '', '', '', '', 'K', '', '2']
        ];
        const data = processSheetData(rows);

        expect(data.members['mem_2'].is_spouse).toBe(true);
        expect(data.members['mem_2'].gen).toBe(1); // Should inherit gen from partner
    });

    it('should link parent and child', () => {
        const rows = [
            ['1', 'Father', '', '', '', '', '', '', '', '', 'E', '', '1'],
            ['2', 'Son', '', 'Father', '', '', '', '', '', '', 'E', '', '2']
        ];
        const data = processSheetData(rows);

        // mem_1 is father, mem_2 is son.
        // There should be a link.
        // Note: The loader creates intermediate "union" nodes.
        // Link: Father -> Union -> Son

        const links = data.links;
        expect(links.length).toBeGreaterThan(0);

        // Find union node
        const unionLink = links.find(l => l[0] === 'mem_1' && l[1].startsWith('u_'));
        expect(unionLink).toBeDefined();

        if (unionLink) {
            const unionId = unionLink[1];
            const childLink = links.find(l => l[0] === unionId && l[1] === 'mem_2');
            expect(childLink).toBeDefined();
        }
    });
});
