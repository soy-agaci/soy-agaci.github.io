import { FamilyData } from '../types/types';

// Filter data to show only patrilineal descendants
export function filterPatrilineal(data: FamilyData): FamilyData {
    const filtered: FamilyData = {
        start: "", // Will be set after determining lineage
        members: {},
        links: [],
        partnershipGroups: data.partnershipGroups,
    };

    // Build parent-child relationships
    const unionToParents: { [key: string]: string[] } = {};
    const childToUnion: { [key: string]: string } = {};

    for (const link of data.links) {
        const [from, to] = link;
        if (from.startsWith('u_')) {
            childToUnion[to] = from;
        } else if (to.startsWith('u_')) {
            if (!unionToParents[to]) unionToParents[to] = [];
            unionToParents[to].push(from);
        }
    }

    // Track which members are in the male lineage (Strictly Father -> Son)
    const maleLineage = new Set<string>();
    const processed = new Set<string>();

    // Find the actual tree root (lowest generation number)
    let actualRoot = data.start;
    let lowestGen = Infinity;
    for (const memberId in data.members) {
        const member = data.members[memberId];
        // Assuming member.gen is available and numeric
        const gen = (member as any).gen;
        if (!member.is_spouse && typeof gen === 'number' && gen < lowestGen) {
            lowestGen = gen;
            actualRoot = memberId;
        }
    }

    // Helper to get blood parent (prioritize Father for patrilineal check)
    function getBloodParent(memberId: string): string | null {
        const parentUnion = childToUnion[memberId];
        if (!parentUnion) return null;

        const parents = unionToParents[parentUnion] || [];
        let fatherId: string | null = null;
        let motherId: string | null = null;

        for (const parentId of parents) {
            const parent = data.members[parentId];
            if (parent) {
                if (parent.gender === 'E') fatherId = parentId;
                else motherId = parentId;
            }
        }
        // Return father if available, otherwise mother (though for patrilineal, we mostly care about father)
        return fatherId || motherId;
    }

    // Recursively check if someone is in male lineage
    function isInMaleLineage(memberId: string): boolean {
        if (processed.has(memberId)) {
            return maleLineage.has(memberId);
        }
        processed.add(memberId);

        const member = data.members[memberId];
        if (!member) {
            return false;
        }

        // Actual tree root is always in lineage
        if (memberId === actualRoot) {
            maleLineage.add(memberId);
            return true;
        }

        // Spouses are not in lineage (they'll be added separately)
        if (member.is_spouse) {
            return false;
        }

        // Check if descended from male lineage
        const bloodParentId = getBloodParent(memberId);
        if (!bloodParentId) {
            return false; // No parent, not in lineage
        }

        const bloodParent = data.members[bloodParentId];

        // Must be male AND parent must be male AND parent must be in male lineage
        if (member.gender === 'E' && bloodParent.gender === 'E' && isInMaleLineage(bloodParentId)) {
            maleLineage.add(memberId);
            return true;
        }

        return false;
    }

    // First pass: identify all male lineage members
    for (const memberId in data.members) {
        isInMaleLineage(memberId);
    }

    // If the displayed root is not in male lineage, switch to actual root
    const displayRoot = maleLineage.has(data.start) ? data.start : actualRoot;

    // Second pass: Identify who to DISPLAY
    // Rule:
    // 1. Members in Male Lineage
    // 2. Children of Members in Male Lineage (includes daughters)
    // 3. Spouses of anyone in 1 or 2

    const displayedMembers = new Set<string>();

    for (const memberId in data.members) {
        const member = data.members[memberId];

        if (maleLineage.has(memberId)) {
            displayedMembers.add(memberId);
        } else if (!member.is_spouse) {
            // Check if parent is in male lineage
            const bloodParentId = getBloodParent(memberId);
            if (bloodParentId && maleLineage.has(bloodParentId)) {
                displayedMembers.add(memberId);
            }
        }
    }

    // Add spouses of displayed members
    for (const memberId in data.members) {
        const member = data.members[memberId];
        if (member.is_spouse) {
            // Check if partner is displayed
            const parentUnion = childToUnion[memberId];
            if (parentUnion) {
                const parents = unionToParents[parentUnion] || [];
                for (const parentId of parents) {
                    if (displayedMembers.has(parentId)) {
                        displayedMembers.add(memberId);
                        break;
                    }
                }
            } else {
                // Spouse without parent union - check unions they're part of
                for (const link of data.links) {
                    const [from, to] = link;
                    if (from === memberId && to.startsWith('u_')) {
                        // This spouse is in a union
                        const partners = unionToParents[to] || [];
                        for (const partnerId of partners) {
                            if (partnerId !== memberId && displayedMembers.has(partnerId)) {
                                displayedMembers.add(memberId);
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    // Populate filtered members
    for (const memberId of displayedMembers) {
        filtered.members[memberId] = data.members[memberId];
    }

    // Filter links
    for (const link of data.links) {
        const [from, to] = link;

        if (to.startsWith('u_') || from.startsWith('u_')) {
            // Union link - include if at least one end is included
            const fromIncluded = from.startsWith('u_') || filtered.members[from];
            const toIncluded = to.startsWith('u_') || filtered.members[to];

            if (fromIncluded && toIncluded) {
                filtered.links.push(link);
            }
        } else {
            // Direct link
            if (filtered.members[from] && filtered.members[to]) {
                filtered.links.push(link);
            }
        }
    }

    // SAFEGUARD: Ensure display root is in members
    if (!filtered.members[displayRoot]) {
        console.warn("Display root", displayRoot, "was missing from filtered members! Adding it forcibly.");
        filtered.members[displayRoot] = data.members[displayRoot];
    }

    // DEBUG: Check if display root is in any link
    const rootInLinks = filtered.links.some(link => link[0] === displayRoot || link[1] === displayRoot);
    if (!rootInLinks) {
        console.warn("Display root", displayRoot, "is NOT in any filtered link! This will cause 'Node not found' error.");
    }

    filtered.start = displayRoot;
    return filtered;
}
