import * as d3 from 'd3';
import { z } from 'zod';
import { FamilyData, Member } from '../../types/types';
import { UPLOAD_SCRIPT_URL, COLUMN_MAPPING } from '../../ui/editor/config';

// --- Zod Schemas ---

const GenderSchema = z.enum(['E', 'K', 'U']).default('U');

// Schema for a processed member object (internal use)
const MemberSchema = z.object({
    id: z.string(),
    name: z.string(),
    first_name: z.string(),
    last_name: z.string().optional(),
    birth_date: z.string().optional(),
    birthplace: z.string().optional(),
    death_date: z.string().optional(),
    image_path: z.string().optional(),
    marriage: z.string().optional(),
    note: z.string().optional(),
    gender: GenderSchema,
    gen: z.number().optional(),
    is_spouse: z.boolean(),
});

// --- Constants ---
const COL_GEN = 0;
const COL_NAME = 1;
const COL_SURNAME = 2;
const COL_FATHER = 3;
const COL_MOTHER = 4;
const COL_BIRTH_DATE = 5;
const COL_BIRTHPLACE = 6;
const COL_DEATH_DATE = 7;
const COL_IMAGE_PATH = 8;
const COL_MARRIAGE = 9;
const COL_GENDER = 10;
const COL_NOTE = 11;
const COL_ID = 12;

// --- Helpers ---

function clean(txt: any): string {
    return (txt || "").toString().trim();
}

function parseGen(val: any): number | "E" | null {
    const s = clean(val).toUpperCase();
    if (s === "E") return "E";
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
}

function convertDriveLink(url: string): string {
    if (!url) return "";
    let driveRegex = /drive\.google\.com\/file\/d\/([-_\w]+)/;
    let match = url.match(driveRegex);
    if (match && match[1]) return "https://lh3.googleusercontent.com/d/" + match[1] + "=w1000";

    driveRegex = /drive\.google\.com\/open\?id=([-_\w]+)/;
    match = url.match(driveRegex);
    if (match && match[1]) return "https://lh3.googleusercontent.com/d/" + match[1] + "=w1000";

    return url;
}

// Track highest ID for generating new IDs
let highestId = 0;

export function getNextId(): number {
    return ++highestId;
}

export function getHighestId(): number {
    return highestId;
}

export function processSheetData(
    rows: string[][],
    options: {
        writeBackGeneratedIds?: boolean;
        onWarning?: (message: string, detail?: unknown) => void;
    } = {}
): FamilyData {
    const members: { [key: string]: Member } = {};
    const links: Array<[string, string]> = [];
    const unions: { [key: string]: string } = {};

    let lastRegularMember: string | null = null;
    let lastRegularMemberGen = 0;
    const genMap: { [key: number]: string } = {};
    const spouseMap: { [key: number]: string | null } = {};
    const spouseNameMap: { [key: number]: { [key: string]: string } } = {};
    const seenIds = new Set<number>();
    const warn = options.onWarning ?? console.warn;

    // Reset highest ID
    highestId = 0;

    function getUnion(p1: string, p2: string | null) {
        const uKey = [p1, p2 || "unknown"].sort().join("_");
        if (!unions[uKey]) {
            const uID = "u_" + uKey;
            unions[uKey] = uID;
            if (members[p1]) links.push([p1, uID]);
            if (p2 && members[p2]) links.push([p2, uID]);
        }
        return unions[uKey];
    }

    function normalizeGender(g: string): "E" | "K" | "U" {
        g = g.toUpperCase();
        if (g.startsWith("E") || g === "M") return "E";
        if (g.startsWith("K") || g === "F" || g === "W") return "K";
        return "U";
    }

    rows.forEach((row, index) => {
        // Basic row validation
        if (row.length === 0 || clean(row[COL_GEN]) === "") return;

        const rawGen = row[COL_GEN];
        const genType = parseGen(rawGen);
        if (genType === null && rawGen === "") return;

        const firstName = clean(row[COL_NAME]);
        const lastName = clean(row[COL_SURNAME]);
        const birthDate = clean(row[COL_BIRTH_DATE]);

        // Read ID from column M, or generate next ID if not present
        let numericId: number;
        const idFromSheet = clean(row[COL_ID]);
        
        if (idFromSheet && !isNaN(parseInt(idFromSheet, 10))) {
            const parsedId = parseInt(idFromSheet, 10);
            
            // Check for collision
            if (seenIds.has(parsedId)) {
                // Collision detected! Generate new ID
                numericId = ++highestId;
                warn(`Row ${index + 2}: duplicate ID; assigned a generated ID`);
                if (options.writeBackGeneratedIds !== false) writeAssignedId(index + 2, numericId);
            } else {
                // ID is valid and new
                numericId = parsedId;
                if (numericId > highestId) {
                    highestId = numericId;
                }
            }
        } else {
            // No ID in sheet, generate one
            numericId = ++highestId;
            warn(`Row ${index + 2}: missing ID; assigned a generated ID`);
            
            // Attempt to write the assigned ID back to the sheet
            if (options.writeBackGeneratedIds !== false) writeAssignedId(index + 2, numericId);
        }

        // Mark ID as seen to prevent future collisions (if we just generated it, it's definitely new)
        seenIds.add(numericId);

        const id = `mem_${numericId}`;

        let fullName = firstName;
        if (lastName) fullName += " " + lastName;
        if (!fullName) fullName = "Unknown";

        const img = convertDriveLink(clean(row[COL_IMAGE_PATH]).replace(/\\/g, "/"));

        // Construct raw member object
        const rawMember = {
            id,
            numeric_id: numericId,
            name: fullName,
            first_name: firstName,
            last_name: lastName || undefined,
            birth_date: birthDate || undefined,
            birthplace: clean(row[COL_BIRTHPLACE]) || undefined,
            death_date: clean(row[COL_DEATH_DATE]) || undefined,
            image_path: img || undefined,
            marriage: clean(row[COL_MARRIAGE]) || undefined,
            note: clean(row[COL_NOTE]) || undefined,
            gender: normalizeGender(clean(row[COL_GENDER])),
            gen: undefined, // Placeholder
            is_spouse: (genType === "E"),
            row_index: index + 2 // Store 1-based row index (accounting for header)
        };

        // Validate with Zod
        const result = MemberSchema.safeParse(rawMember);

        if (!result.success) {
            warn(`Row ${index + 2}: validation failed`, result.error.format());
            // We can choose to skip or use a fallback. For now, we'll try to use what we have but log it.
            // In a strict mode, we might want to skip.
        }

        // Use the validated data or fall back to raw (if partial failure is acceptable)
        // For now, we trust our construction but Zod helps catch unexpected types if we change logic.
        members[id] = rawMember as Member;

        // Logic for linking (same as before, but cleaner)
        const fatherNameData = clean(row[COL_FATHER]);
        const motherNameData = clean(row[COL_MOTHER]);

        if (genType === "E") {
            if (!lastRegularMember) {
                warn(`Row ${index + 2}: spouse row has no preceding partner`);
                return;
            }
            const partnerID = lastRegularMember;
            const partnerGen = lastRegularMemberGen;
            members[id].gen = partnerGen;
            spouseMap[partnerGen] = id;
            if (!spouseNameMap[partnerGen]) spouseNameMap[partnerGen] = {};
            spouseNameMap[partnerGen][firstName] = id;
            getUnion(partnerID, id);
        } else {
            const gen = genType as number;
            members[id].gen = gen;
            lastRegularMember = id;
            lastRegularMemberGen = gen;
            genMap[gen] = id;
            spouseMap[gen] = null;
            spouseNameMap[gen] = {};

            if (gen > 1) {
                const parentID = genMap[gen - 1];
                let spouseID: string | null = null;
                if (fatherNameData && spouseNameMap[gen - 1]?.[fatherNameData]) {
                    spouseID = spouseNameMap[gen - 1][fatherNameData];
                } else if (motherNameData && spouseNameMap[gen - 1]?.[motherNameData]) {
                    spouseID = spouseNameMap[gen - 1][motherNameData];
                } else {
                    spouseID = spouseMap[gen - 1];
                }

                if (parentID) {
                    const uID = getUnion(parentID, spouseID);
                    links.push([uID, id]);
                }
            }
        }
    });

    const startID = Object.keys(members)[0];
    return { start: startID, members, links };
}

export async function loadFromGoogleSheet(url: string): Promise<FamilyData> {
    try {
        const rawText = await d3.text(url);
        const allRows = d3.csvParseRows(rawText);
        if (!allRows || allRows.length <= 1) throw new Error("No data rows found.");
        const dataRows = allRows.slice(1);
        return processSheetData(dataRows);
    } catch (error) {
        console.error("Error loading sheet:", error);
        alert("Error loading data. Check console.");
        throw error;
    }
}

async function writeAssignedId(rowIndex: number, newId: number) {
    if (typeof fetch === 'undefined') return;

    try {
        const payload = {
            row: rowIndex,
            updates: {
                [COLUMN_MAPPING['id']]: newId
            }
        };

        // Fire and forget
        fetch(UPLOAD_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        }).then(() => {
            console.log(`Successfully requested ID write for row ${rowIndex} (ID: ${newId})`);
        }).catch(err => {
            console.warn(`Failed to write ID for row ${rowIndex}`, err);
        });

    } catch (e) {
        console.warn("Error preparing ID write", e);
    }
}
