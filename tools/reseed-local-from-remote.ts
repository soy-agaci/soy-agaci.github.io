import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { importFamily, titleCaseName, type ImportPayload } from './import-sheet';
import { unifyPeople } from './unify-people';

type Json = Record<string, any>;

function localCredentials(): { url: string; key: string } {
    const output = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
        encoding: 'utf8',
        env: {
            ...process.env,
            XDG_CONFIG_HOME: '/tmp/sselcuk/supabase-config',
            SUPABASE_TELEMETRY_DISABLED: '1',
        },
    });
    const values = Object.fromEntries([...output.matchAll(/^(\w+)="([^"]*)"$/gm)].map(match => [match[1], match[2]]));
    if (!values.API_URL || !values.SERVICE_ROLE_KEY) throw new Error('Local Supabase is not running');
    return { url: values.API_URL, key: values.SERVICE_ROLE_KEY };
}

function canonicalGender(value: unknown): 'E' | 'K' | 'U' {
    const gender = String(value ?? '').trim().toLocaleLowerCase('tr-TR');
    if (['e', 'erkek', 'm', 'male'].includes(gender)) return 'E';
    if (['k', 'kadın', 'kadin', 'f', 'female'].includes(gender)) return 'K';
    return 'U';
}

function importedPersonId(familySlug: string, legacyId: string): string {
    const hex = createHash('md5').update(`soyagaci:${familySlug}:person:${legacyId}`).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function current(entity: Json): Json {
    if (!entity.current_revision) throw new Error(`Entity ${entity.id} has no approved revision`);
    return entity.current_revision;
}

function validateExplicitPartnerships(graph: Json): void {
    const pairs = new Set(graph.partnerships.map((item: Json) => [item.person1_id, item.person2_id].sort().join(':')));
    const parents = new Map<string, string[]>();
    for (const link of graph.parent_links) {
        const list = parents.get(link.child_id) ?? [];
        list.push(link.parent_id);
        parents.set(link.child_id, list);
    }
    for (const [child, ids] of parents) {
        const unique = [...new Set(ids)];
        if (unique.length === 2 && !pairs.has(unique.sort().join(':'))) {
            throw new Error(`Child ${child} has two parents without an explicit partnership`);
        }
    }
}

function payload(graph: Json, personIds = new Set<string>(graph.people.map((person: Json) => person.id))): ImportPayload {
    const people = graph.people.filter((person: Json) => personIds.has(person.id));
    return {
        source_rows: people.length,
        root_person_legacy_id: graph.families[0].root_person_id,
        union_count: graph.partnerships.length,
        warnings: [],
        people: people.map((person: Json) => {
            const revision = current(person);
            return {
                legacy_id: person.id,
                legacy_numeric_id: null,
                given_name: titleCaseName(revision.given_name),
                family_name: titleCaseName(revision.family_name),
                display_name: titleCaseName(revision.display_name) ?? 'Bilinmiyor',
                aliases: (revision.aliases ?? []).map((alias: string) => titleCaseName(alias)!),
                gender: canonicalGender(revision.gender),
                is_living: revision.is_living,
                summary: revision.summary,
                privacy: 'public',
            };
        }),
        partnerships: graph.partnerships
            .filter((item: Json) => personIds.has(item.person1_id) && personIds.has(item.person2_id))
            .map((item: Json) => ({
                key: item.id,
                person1_legacy_id: item.person1_id,
                person2_legacy_id: item.person2_id,
                date_start: current(item).date_start,
                date_text: current(item).date_text,
            })),
        parent_links: graph.parent_links
            .filter((item: Json) => personIds.has(item.parent_id) && personIds.has(item.child_id))
            .map((item: Json) => ({ parent_legacy_id: item.parent_id, child_legacy_id: item.child_id })),
        life_events: graph.life_events.filter((item: Json) => personIds.has(item.person_id)).map((item: Json) => {
            const revision = current(item);
            return {
                key: item.id,
                person_legacy_id: item.person_id,
                event_type: revision.event_type,
                date_start: revision.date_start,
                date_text: revision.date_text,
                place_text: revision.place_text,
                details: revision.details,
            };
        }),
        media: graph.media.filter((item: Json) => personIds.has(item.person_id)).map((item: Json) => ({
            person_legacy_id: item.person_id,
            legacy_uri: item.storage_path ?? item.legacy_uri,
        })),
    };
}

async function main(): Promise<void> {
    const remoteUrl = process.env.SUPABASE_URL;
    const remoteKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!remoteUrl || !remoteKey || new URL(remoteUrl).hostname === '127.0.0.1') {
        throw new Error('Hosted SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    }
    const remote = createClient(remoteUrl, remoteKey, { auth: { persistSession: false } });
    const { data: families, error: familiesError } = await remote.from('families').select('id,slug,name');
    if (familiesError) throw familiesError;
    const graphs: Record<string, Json> = {};
    for (const family of families) {
        const { data, error } = await remote.rpc('get_family_graph', {
            p_family_ids: [family.id], p_include_pending: false,
        });
        if (error) throw error;
        graphs[family.slug] = data;
    }
    const selcuk = graphs.selcuk;
    const agiralioglu = graphs.agiralioglu;
    if (!selcuk || !agiralioglu) throw new Error('Hosted Selçuk and Ağıralioğlu families are required');
    validateExplicitPartnerships(selcuk);

    const localCredentialsValue = localCredentials();
    const local = createClient(localCredentialsValue.url, localCredentialsValue.key, { auth: { persistSession: false } });
    const selcukReport = await importFamily(local, payload(selcuk), 'selcuk', 'Selçuk');

    const agirPersonId = agiralioglu.people[0]?.id;
    if (!agirPersonId || !selcuk.people.some((person: Json) => person.id === agirPersonId)) {
        throw new Error('Hosted Ağıralioğlu person is not the canonical Selçuk person');
    }
    const agirPayload = payload({ ...selcuk, families: [{ root_person_id: agirPersonId }] }, new Set([agirPersonId]));
    const agirReport = await importFamily(local, agirPayload, 'agiralioglu', 'Ağıralioğlu');
    await unifyPeople(local, {
        sourcePersonId: importedPersonId('agiralioglu', agirPersonId),
        targetPersonId: importedPersonId('selcuk', agirPersonId),
    });
    const { data: lineage, error: lineageError } = await local.rpc('initialize_imported_family_lineage', {
        p_family_slug: 'agiralioglu', p_root_person_legacy_id: agirPersonId,
    });
    if (lineageError) throw lineageError;

    console.log(JSON.stringify({ selcuk: selcukReport, agiralioglu: agirReport, agiralioglu_lineage: lineage }, null, 2));
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
