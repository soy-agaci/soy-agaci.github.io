export type SearchIndexEntry = { id: string; display: string; normalized: string };

export function uniqueSearchEntries(
    entries: Array<{ id: string; display: string }>,
    normalize: (value: string) => string,
): SearchIndexEntry[] {
    const seenIds = new Set<string>();
    const seenDisplays = new Set<string>();
    const result: SearchIndexEntry[] = [];

    for (const entry of entries) {
        if (seenIds.has(entry.id)) continue;
        seenIds.add(entry.id);

        const base = entry.display;
        let display = base;
        for (let counter = 2; seenDisplays.has(display); counter++) display = `${base} (${counter})`;
        seenDisplays.add(display);
        result.push({ ...entry, display, normalized: normalize(display) });
    }
    return result;
}
