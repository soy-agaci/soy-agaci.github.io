import { FamilyData, Member } from '../../types/types';
import { normalizeFamilySlugs } from '../data/familyRepository';

// Map between persistent IDs and mem_X IDs
export const persistentIdMap = new Map<string, string>(); // persistentId -> mem_X
export const reverseIdMap = new Map<string, string>();    // mem_X -> persistentId
const idIndexMap = new Map<string, string>();             // mem_X -> short index
const indexIdMap = new Map<string, string>();             // short index -> mem_X

// Generate persistent ID from member data (human-readable)
function getPersistentId(member: Member): string {
    if (member.persistentId) return member.persistentId;

    // Extract first 3 chars of first name, first 3 of last name, last 2 of birth year
    const firstName = (member.first_name || 'unk').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 3);
    const lastName = (member.last_name || 'unk').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 3);

    // Extract last 2 digits of birth year
    let yearDigits = '00';
    if (member.birth_date) {
        const yearMatch = member.birth_date.match(/\d{4}/);
        if (yearMatch) {
            yearDigits = yearMatch[0].slice(-2);
        }
    }

    member.persistentId = `${firstName}_${lastName}_${yearDigits}`;
    return member.persistentId;
}

export function buildIdMaps(familyData: FamilyData) {
    persistentIdMap.clear();
    reverseIdMap.clear();
    idIndexMap.clear();
    indexIdMap.clear();

    const counts = new Map<string, number>(); // Track duplicates

    // Sort keys to ensure deterministic order for duplicate handling
    const memberIds = Object.keys(familyData.members).sort();

    memberIds.forEach((memId, index) => {
        const member = familyData.members[memId];
        if (!member.is_spouse || member.first_name) {
            let persistentId = getPersistentId(member);

            // Handle duplicates by appending a counter
            const baseId = persistentId;
            let counter = counts.get(baseId) || 0;
            if (counter > 0) {
                persistentId = `${baseId}_${counter}`;
            }
            counts.set(baseId, counter + 1);

            member.persistentId = persistentId; // Update with deduplicated ID
            persistentIdMap.set(persistentId, memId);
            reverseIdMap.set(memId, persistentId);
            const shortId = index.toString(36);
            idIndexMap.set(memId, shortId);
            indexIdMap.set(shortId, memId);
        }
    });
}

function encodeNodeId(id: string | null) {
    return id ? idIndexMap.get(id) ?? reverseIdMap.get(id) ?? null : null;
}

function decodeNodeId(id: unknown) {
    if (typeof id !== 'string') return null;
    return indexIdMap.get(id) ?? persistentIdMap.get(id) ?? null;
}

// Encode state to URL-friendly base64 string
export function encodeState(currentNode: string | null, transform: any, patrilineal: boolean, visibleNodes?: Set<string>): string | null {
    const state = {
        n: encodeNodeId(currentNode),
        t: transform ? [Math.round(transform.k * 100) / 100, Math.round(transform.x), Math.round(transform.y)] : null,
        p: patrilineal ? 1 : 0,
        v: visibleNodes ? Array.from(visibleNodes).map(encodeNodeId).filter(Boolean).join('.') : '',
    };

    try {
        const json = JSON.stringify(state);
        return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    } catch (e) {
        console.error('Error encoding state:', e);
        return null;
    }
}

// Decode state from URL hash
export function decodeState(): any {
    try {
        const hash = window.location.hash.slice(1);
        if (!hash) return null;

        // Add padding back
        const base64 = hash.replace(/-/g, '+').replace(/_/g, '/');
        const padding = (4 - base64.length % 4) % 4;
        const padded = base64 + '='.repeat(padding);

        const json = atob(padded);
        const state = JSON.parse(json);

        // Validate state structure
        if (!state || typeof state !== 'object') {
            console.warn('Invalid URL state: not an object');
            return null;
        }

        // Convert persistent IDs back to mem_X IDs
        const decoded = {
            currentNode: null as string | null,
            transform: null as { k: number, x: number, y: number } | null,
            patrilineal: false,
            visibleNodes: undefined as Set<string> | undefined,
        };

        // Restore current node
        decoded.currentNode = decodeNodeId(state.n);

        // Restore transform
        if (Array.isArray(state.t) && state.t.length === 3 && state.t.every((value: unknown) => typeof value === 'number')) {
            decoded.transform = { k: state.t[0], x: state.t[1], y: state.t[2] };
        } else if (state.t && typeof state.t.k === 'number' && typeof state.t.x === 'number' && typeof state.t.y === 'number') {
            decoded.transform = state.t;
        }

        // Restore patrilineal mode
        decoded.patrilineal = state.p === 1;

        // Restore visible nodes
        if (typeof state.v === 'string' && state.v) {
            decoded.visibleNodes = new Set<string>();
            for (const id of state.v.split('.')) {
                const memId = decodeNodeId(id);
                if (memId) decoded.visibleNodes.add(memId);
            }
        } else if (Array.isArray(state.v)) {
            decoded.visibleNodes = new Set<string>();
            for (const pid of state.v) {
                const memId = decodeNodeId(pid);
                if (memId) {
                    decoded.visibleNodes.add(memId);
                }
            }
        }

        return decoded;
    } catch (e) {
        console.warn('Error decoding state from URL, falling back to localStorage:', e);
        // Clear invalid hash
        if (window.location.hash) {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        return null;
    }
}

// Update URL hash with current state
export function updateURL(state: any) {
    if (!state) return;

    const transform = state.transform;
    const visibleNodes = state.visibleNodes;
    const currentNode = state.selectedNodeId || (state.familyData ? state.familyData.start : null);
    const patrilineal = state.isPatrilineal;

    const encoded = encodeState(currentNode, transform, patrilineal, visibleNodes);
    if (encoded) {
        history.replaceState(null, '', '#' + encoded);
    }
}

export function updateDataQuery(
    families: string[],
    includePending: boolean,
    proposalId?: string,
    mode: 'replace' | 'push' = 'replace',
) {
    const url = new URL(window.location.href);
    url.searchParams.delete('family');
    for (const family of normalizeFamilySlugs(families)) url.searchParams.append('family', family);
    if (includePending) url.searchParams.set('view', 'pending');
    else url.searchParams.delete('view');
    if (includePending && proposalId) url.searchParams.set('proposal', proposalId);
    else url.searchParams.delete('proposal');
    history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', url.pathname + url.search + url.hash);
}

// Share functionality with TinyURL
export async function shareCurrentState(state: any) {
    const shareBtn = document.getElementById('share-btn');
    if (!shareBtn) return;
    const originalContent = shareBtn.innerHTML;

    try {
        const currentNode = state.selectedNodeId || (state.familyData ? state.familyData.start : null);
        const shareHash = encodeState(currentNode, null, state.isPatrilineal, state.visibleNodes);
        const shareURL = new URL(window.location.href);
        if (shareHash) shareURL.hash = shareHash;
        const fullURL = shareURL.href;

        // Show loading state
        shareBtn.innerHTML = '<span style="font-size: 1.2em;">⏳</span>';
        (shareBtn as HTMLButtonElement).disabled = true;

        // Try TinyURL API (Old API, Deprecated but working without CORS)
        const shortenerApi = `https://tinyurl.com/api-create.php?url=${encodeURIComponent(fullURL)}`;
        const response = await fetch(shortenerApi);

        if (!response.ok) throw new Error('TinyURL failed');

        const shortURL = await response.text();

        // Copy to clipboard
        await navigator.clipboard.writeText(shortURL);

        // Show success
        shareBtn.innerHTML = '<span style="font-size: 1.2em;">✅</span>';
        setTimeout(() => {
            shareBtn.innerHTML = originalContent;
            (shareBtn as HTMLButtonElement).disabled = false;
        }, 2000);

    } catch (error) {
        console.warn('TinyURL failed, copying full URL:', error);

        try {
            // Fallback: copy full URL
            await navigator.clipboard.writeText(window.location.href);
            shareBtn.innerHTML = '<span style="font-size: 1.2em;">✅</span>';
            setTimeout(() => {
                shareBtn.innerHTML = originalContent;
                (shareBtn as HTMLButtonElement).disabled = false;
            }, 2000);
        } catch (clipboardError) {
            shareBtn.innerHTML = '<span style="font-size: 1.2em;">❌</span>';
            setTimeout(() => {
                shareBtn.innerHTML = originalContent;
                (shareBtn as HTMLButtonElement).disabled = false;
            }, 2000);
        }
    }
}
