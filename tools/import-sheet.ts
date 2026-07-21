import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { csvParseRows } from 'd3';
import { processSheetData } from '../src/services/data/sheetLoader';
import type { FamilyData, Member } from '../src/types/types';

export type ImportPrivacy = 'public' | 'family' | 'private';

type ImportPerson = {
    legacy_id: string;
    legacy_numeric_id: number | null;
    given_name: string | null;
    family_name: string | null;
    display_name: string;
    aliases: string[];
    gender: string | null;
    is_living: boolean | null;
    summary: string | null;
    privacy: ImportPrivacy;
};

export type ImportPayload = {
    source_rows: number;
    root_person_legacy_id: string;
    union_count: number;
    warnings: string[];
    people: ImportPerson[];
    partnerships: Array<{
        key: string;
        person1_legacy_id: string;
        person2_legacy_id: string;
        date_start: string | null;
        date_text: string | null;
    }>;
    parent_links: Array<{ parent_legacy_id: string; child_legacy_id: string }>;
    life_events: Array<{
        key: string;
        person_legacy_id: string;
        event_type: 'birth' | 'death' | 'occupation';
        date_start: string | null;
        date_text: string | null;
        place_text: string | null;
        details: string | null;
    }>;
    media: Array<{ person_legacy_id: string; legacy_uri: string }>;
};

function text(value: unknown): string | null {
    const result = typeof value === 'string' ? value.trim() : '';
    return result || null;
}

export function titleCaseName(value: string | null): string | null {
    if (!value) return null;
    return value.toLocaleLowerCase('tr-TR').replace(/(^|[^\p{L}])(\p{L})/gu,
        (_match, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase('tr-TR'));
}

function exactDate(value: string | null): string | null {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function aliases(member: Member): string[] {
    if (Array.isArray(member.aliases)) {
        return member.aliases.filter((value): value is string => typeof value === 'string' && value.trim() !== '').map(value => value.trim());
    }
    return text(member.second_names)?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
}

export function buildImportPayload(
    data: FamilyData,
    sourceRows: number,
    parserWarnings: string[] = [],
    privacy: ImportPrivacy = 'family'
): ImportPayload {
    if (!data.start || !data.members[data.start]) throw new Error('Sheet has no importable root person');

    const people = Object.values(data.members);
    const unionIds = [...new Set(data.links.flatMap(([source, target]) =>
        [source, target].filter(id => id.startsWith('u_'))
    ))];
    const partnerships: ImportPayload['partnerships'] = [];
    const parentLinks: ImportPayload['parent_links'] = [];
    const warnings = [...parserWarnings];
    const seenParentLinks = new Set<string>();

    unionIds.forEach((unionId, index) => {
        const parents = data.links.filter(([, target]) => target === unionId).map(([source]) => source);
        const children = data.links.filter(([source]) => source === unionId).map(([, target]) => target);
        if (parents.length > 2) throw new Error(`Union ${index + 1} has ${parents.length} parents; maximum is 2`);

        if (parents.length === 2) {
            const marriageTexts = [...new Set(parents.map(id => text(data.members[id]?.marriage)).filter((value): value is string => value !== null))];
            if (marriageTexts.length > 1) warnings.push(`Union ${index + 1} has conflicting partnership dates`);
            const dateText = marriageTexts[0] ?? null;
            partnerships.push({
                key: unionId,
                person1_legacy_id: parents[0],
                person2_legacy_id: parents[1],
                date_start: exactDate(dateText),
                date_text: dateText,
            });
        }

        for (const parent of parents) {
            for (const child of children) {
                const key = `${parent}\0${child}`;
                if (!seenParentLinks.has(key)) {
                    seenParentLinks.add(key);
                    parentLinks.push({ parent_legacy_id: parent, child_legacy_id: child });
                }
            }
        }
    });

    const lifeEvents: ImportPayload['life_events'] = [];
    const media: ImportPayload['media'] = [];
    for (const member of people) {
        const birthDate = text(member.birth_date);
        const birthPlace = text(member.birthplace ?? member.birth_place);
        if (birthDate || birthPlace) lifeEvents.push({
            key: `${member.id}:birth`, person_legacy_id: member.id, event_type: 'birth',
            date_start: exactDate(birthDate), date_text: birthDate, place_text: birthPlace, details: null,
        });

        const deathDate = text(member.death_date);
        const deathPlace = text(member.death_place);
        if (deathDate || deathPlace) lifeEvents.push({
            key: `${member.id}:death`, person_legacy_id: member.id, event_type: 'death',
            date_start: exactDate(deathDate), date_text: deathDate, place_text: deathPlace, details: null,
        });

        const occupation = text(member.occupation);
        if (occupation) lifeEvents.push({
            key: `${member.id}:occupation`, person_legacy_id: member.id, event_type: 'occupation',
            date_start: null, date_text: null, place_text: null, details: occupation,
        });

        const image = text(member.image_path);
        if (image) media.push({ person_legacy_id: member.id, legacy_uri: image });
    }

    return {
        source_rows: sourceRows,
        root_person_legacy_id: data.start,
        union_count: unionIds.length,
        warnings,
        people: people.map(member => ({
            legacy_id: member.id,
            legacy_numeric_id: member.numeric_id ?? null,
            given_name: titleCaseName(text(member.first_name)),
            family_name: titleCaseName(text(member.last_name)),
            display_name: titleCaseName(text(member.name)) ?? 'Bilinmiyor',
            aliases: aliases(member).map(alias => titleCaseName(alias)!),
            gender: member.gender === 'E' ? 'E' : member.gender === 'K' ? 'K' : 'U',
            is_living: text(member.death_date) ? false : null,
            summary: text(member.note),
            privacy,
        })),
        partnerships,
        parent_links: parentLinks,
        life_events: lifeEvents,
        media,
    };
}

export async function importFamily(
    client: SupabaseClient,
    payload: ImportPayload,
    familySlug: string,
    familyName: string
): Promise<Record<string, unknown>> {
    const { data, error } = await client.rpc('import_family_sheet', {
        p_payload: payload,
        p_family_slug: familySlug,
        p_family_name: familyName,
    });
    if (error) throw new Error(error.message);
    const lineage = await client.rpc('initialize_imported_family_lineage', {
        p_family_slug: familySlug,
        p_root_person_legacy_id: payload.root_person_legacy_id,
    });
    if (lineage.error) throw new Error(lineage.error.message);
    return { ...(data as Record<string, unknown>), lineage_members: lineage.data };
}

function parseArgs(argv: string[]): Record<string, string> {
    const args: Record<string, string> = {};
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument: ${key ?? ''}`);
        args[key.slice(2)] = value;
    }
    return args;
}

export function importSupabaseUrl(value: string | undefined, allowRemote = false): string {
    if (!value) throw new Error('SUPABASE_URL is required');
    const url = new URL(value);
    if (!allowRemote && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
        throw new Error('SUPABASE_URL must point to local Supabase unless ALLOW_REMOTE_SUPABASE=1');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('SUPABASE_URL must use HTTP or HTTPS');
    return url.toString().replace(/\/$/, '');
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if ((!args.url && !args.file) || (args.url && args.file)) throw new Error('Pass exactly one of --url or --file');
    if (!args['family-slug'] || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args['family-slug'])) throw new Error('A valid --family-slug is required');
    if (!args['family-name']) throw new Error('--family-name is required');
    const privacy = args.privacy ?? 'family';
    if (!['public', 'family', 'private'].includes(privacy)) {
        throw new Error('--privacy must be public, family, or private');
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
    const rawCsv = args.file ? await readFile(args.file, 'utf8') : await fetch(args.url).then(response => {
        if (!response.ok) throw new Error(`Sheet download failed with HTTP ${response.status}`);
        return response.text();
    });
    const rows = csvParseRows(rawCsv);
    if (rows.length <= 1) throw new Error('No data rows found');
    const warnings: string[] = [];
    const graph = processSheetData(rows.slice(1), {
        writeBackGeneratedIds: false,
        onWarning: message => warnings.push(message),
    });
    const payload = buildImportPayload(graph, rows.length - 1, warnings, privacy as ImportPrivacy);
    const client = createClient(importSupabaseUrl(process.env.SUPABASE_URL, process.env.ALLOW_REMOTE_SUPABASE === '1'), serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log(JSON.stringify(await importFamily(client, payload, args['family-slug'], args['family-name']), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
