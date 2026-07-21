/// <reference types="vite/client" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';

let client: SupabaseClient<Database> | undefined;

export function getSupabaseClient(): SupabaseClient<Database> {
    let url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
        throw new Error(
            'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
        );
    }

    if (typeof window !== 'undefined' && (url.includes('127.0.0.1') || url.includes('localhost'))) {
        const hostname = window.location.hostname;
        if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
            url = url.replace('127.0.0.1', hostname).replace('localhost', hostname);
        }
    }

    return client ??= createClient<Database>(url, key);
}
