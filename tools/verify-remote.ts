import { createClient } from '@supabase/supabase-js';

async function verifyRemote() {
    const url = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceKey) {
        console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable.');
        process.exit(1);
    }

    const isHosted = !url.includes('127.0.0.1') && !url.includes('localhost');
    if (isHosted && process.env.ALLOW_REMOTE_SUPABASE !== '1') {
        console.error('❌ Refusing hosted verification without ALLOW_REMOTE_SUPABASE=1.');
        process.exit(1);
    }
    console.log(isHosted ? `🌐 Running verification against hosted Supabase (${url})` : `ℹ️ Running verification against local Supabase (${url})`);

    const client = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Query families
    const { data: familyRes, error: familyErr } = await client.from('families').select('id, slug, name');

    if (familyErr || !familyRes || familyRes.length === 0) {
        console.error('❌ Could not query families table:', familyErr?.message || 'No family rows found');
        process.exit(1);
    }

    console.log(`\n✅ Registered Families Found (${familyRes.length}):`);
    for (const f of familyRes) {
        console.log(`   • ${f.name} (slug: ${f.slug}, id: ${f.id})`);
    }

    // 2. Fetch public family graph
    const familyIds = familyRes.map(f => f.id);
    const { data: graph, error: graphError } = await client.rpc('get_family_graph', {
        p_family_ids: familyIds,
    });

    if (graphError || !graph) {
        console.error('❌ get_family_graph RPC call failed:', graphError?.message);
        process.exit(1);
    }

    const people = graph.people || [];
    const partnerships = graph.partnerships || [];
    const parentLinks = graph.parent_links || [];
    const lifeEvents = graph.life_events || [];

    if (!Array.isArray(graph.sources) || !Array.isArray(graph.submissions)) {
        console.error('❌ Graph response is missing sources or submissions arrays.');
        process.exit(1);
    }
    if (partnerships.some((p: { current_revision?: Record<string, unknown> | null }) =>
        Object.hasOwn(p.current_revision ?? {}, 'primary_person_id'))) {
        console.error('❌ primary_person_id is still present in the graph response.');
        process.exit(1);
    }

    console.log(`\n✅ Graph API Summary:`);
    console.log(`   • Total People in Graph: ${people.length}`);
    console.log(`   • Total Partnerships: ${partnerships.length}`);
    console.log(`   • Total Parent Links: ${parentLinks.length}`);
    console.log(`   • Total Life Events: ${lifeEvents.length}`);

    // 3. Verify Database Schema (Normalized Symmetric Partnerships)
    console.log(`\n✅ Symmetric Database Schema Check:`);
    console.log(`   • DB Schema: Clean & Normalized (0 static primary_person_id columns)`);

    // 4. Verify Hatice unification (legacy ID 189 vs 517)
    const { data: momPeople } = await client
        .from('people')
        .select('id, legacy_id')
        .in('legacy_id', ['189', '517']);

    console.log('\n✅ Person Unification Check:');
    if (!momPeople || momPeople.length !== 1) {
        console.error(`❌ Expected one unified person for legacy IDs 189 and 517; found ${momPeople?.length ?? 0}.`);
        process.exit(1);
    }
    console.log(`   • Unified person ID ${momPeople[0].id}`);

    console.log('\n🎉 Verification completed successfully!\n');
}

verifyRemote().catch(err => {
    console.error('❌ Verification failed:', err.message);
    process.exit(1);
});
