import { describe, expect, it } from 'vitest';
import { normalizePersonSearch, rankPersonSearchEntries } from '../src/services/data/personSearch';

describe('person search', () => {
    it('matches Turkish characters with their ASCII spelling', () => {
        const display = 'Ağıralioglu';
        expect(rankPersonSearchEntries([{ id: 'person', display, normalized: normalizePersonSearch(display) }], 'agir'))
            .toHaveLength(1);
    });
});
