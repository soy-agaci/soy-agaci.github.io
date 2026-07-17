import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { csvFormatRows, csvParseRows } from 'd3';
import { processSheetData } from '../src/services/data/sheetLoader';

const IMAGE_COLUMN = 8;
const ID_COLUMN = 12;

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

function slug(value: string): string {
    return value.toLocaleLowerCase('tr-TR')
        .replace(/[çğıöşü]/g, letter => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[letter]!)
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'photo';
}

function driveId(url: string): string | null {
    return url.match(/googleusercontent\.com\/d\/([-_\w]+)/)?.[1]
        ?? url.match(/drive\.google\.com\/file\/d\/([-_\w]+)/)?.[1]
        ?? url.match(/drive\.google\.com\/open\?id=([-_\w]+)/)?.[1]
        ?? null;
}

function downloadUrl(url: string): string {
    const id = driveId(url);
    return id ? `https://lh3.googleusercontent.com/d/${id}=w1600` : url;
}

function extension(contentType: string | null, url: string): string {
    if (contentType?.includes('png')) return 'png';
    if (contentType?.includes('webp')) return 'webp';
    if (contentType?.includes('gif')) return 'gif';
    if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return 'jpg';
    const ext = extname(new URL(url).pathname).replace(/^\./, '').toLowerCase();
    return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext.replace('jpeg', 'jpg') : 'jpg';
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const file = args.file ?? '/tmp/soyagaci-sheet.csv';
    const outDir = args.out ?? 'public/fotograf';
    const publicPrefix = args.prefix ?? '/aile/fotograf';
    const manifestPath = args.manifest ?? '.local/selcuk-photo-manifest.json';
    const csvOut = args['csv-out'] ?? '.local/selcuk-photo-names.csv';

    const rows = csvParseRows(await readFile(file, 'utf8'));
    const warnings: string[] = [];
    const graph = processSheetData(rows.slice(1), {
        writeBackGeneratedIds: false,
        onWarning: message => warnings.push(message),
    });
    await mkdir(outDir, { recursive: true });
    await mkdir('.local', { recursive: true });

    const rowByLegacyId = new Map<string, string[]>();
    for (const row of rows.slice(1)) {
        const id = row[ID_COLUMN]?.trim();
        if (id) rowByLegacyId.set(`mem_${id}`, row);
    }

    const manifest = [];
    for (const member of Object.values(graph.members)) {
        const original = member.image_path?.trim();
        if (!original) continue;

        const response = await fetch(downloadUrl(original));
        if (!response.ok) throw new Error(`Download failed ${response.status}: ${member.name} ${original}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length) throw new Error(`Downloaded empty image: ${member.name}`);

        const ext = extension(response.headers.get('content-type'), original);
        const numericId = member.numeric_id ?? Number(member.id.replace(/^mem_/, ''));
        const filename = `${String(numericId).padStart(4, '0')}-${slug(member.name ?? member.id)}.${ext}`;
        const localPath = `${publicPrefix}/${filename}`;
        await writeFile(join(outDir, filename), bytes);

        const row = rowByLegacyId.get(member.id);
        if (row) row[IMAGE_COLUMN] = localPath;

        manifest.push({
            person_legacy_id: member.id,
            numeric_id: numericId,
            display_name: member.name,
            original_uri: original,
            drive_id: driveId(original),
            local_path: localPath,
            filename,
            bytes: bytes.length,
            content_type: response.headers.get('content-type'),
        });
    }

    await writeFile(manifestPath, `${JSON.stringify({ warnings, media: manifest }, null, 2)}\n`);
    await writeFile(csvOut, csvFormatRows(rows));
    console.log(JSON.stringify({ downloaded: manifest.length, outDir, manifestPath, csvOut }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
