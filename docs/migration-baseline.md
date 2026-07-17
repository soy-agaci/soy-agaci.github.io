# Migration baseline

Captured 2026-07-16 for the local-first Supabase migration. This describes current behavior; it does not design the migration.

## Verification

- `npm test -- --run`: 11/11 test files and 155/155 tests passed, but Vitest reported one unhandled exception and the process exited 1. Loader edge-case tests also log failed fire-and-forget writes to `script.google.com` when generated IDs are exercised.
- `npm run build`: exit 0. Vite built 602 modules; it warned that `/css/familienbaum.css` is unresolved at build time and left the URL for runtime resolution.
- No watch or development process was started or left running.
- This document is the only new artifact from this step. `.agents/`, `repomix-output.xml`, and `skills-lock.json` were already untracked at the initial `git status --short` observation and were left untouched; that observation does not establish their Git history.

## Published CSV snapshot

Read-only fetch of the public URL in `src/main.ts` succeeded without credentials. Aggregates only:

| Metric | Count |
| --- | ---: |
| CSV data rows (header excluded) | 520 |
| Accepted rows / members | 520 |
| Directed links | 664 |
| Union nodes | 145 |
| Orphan members | 0 |
| Duplicate ID values / excess rows | 0 / 0 |
| Missing or invalid IDs | 0 |

An orphan means a processed member ID absent from every link endpoint. Counts replay `processSheetData` rules without invoking its write-back side effect; no personal row values were retained or printed.

## Current contract and invariants

- CSV columns are positional A-M: generation, first name, surname, father, mother, birth date, birthplace, death date, image path, marriage, gender, note, numeric ID. The first CSV row is always discarded as the header; rows with blank generation are skipped; values are trimmed.
- A nonblank, nonnumeric generation is not rejected: it passes the initial check and is processed as a regular member with a null-ish generation. This is current parity behavior to preserve or explicitly reconcile, not a desired validation rule.
- `FamilyData` is `{ start, members, links }`. Members are keyed as `mem_<numeric ID>`; `start` is the first processed member. Runtime member fields are `id`, `numeric_id`, `name`, `first_name`, optional `last_name`, `birth_date`, `birthplace`, `death_date`, `image_path`, `marriage`, `note`, normalized `gender` (`E`, `K`, or `U`), `gen`, `is_spouse`, and one-based `row_index` including the header.
- Source row order is structural. A numeric generation row replaces the current member for that generation. An `E` row is a spouse of the most recent regular member and inherits that generation. Children attach through the most recent regular member at generation `gen - 1`; father/mother text selects a known spouse by first name, otherwise the current spouse is used.
- Relationships are directed `member -> union -> child`. A couple's union ID is deterministic from its sorted member IDs and reused for siblings. The DAG contains only link endpoints, requires at least one link, and identifies members by attached input data; therefore `start` and every member needed by the UI must occur in links.
- Sheet numeric IDs are the persistent identity. Duplicate or absent IDs are replaced from the module-scoped `highestId` counter, which is reset at the start of each `processSheetData` run, and trigger asynchronous Google Apps Script write-back. Zod validation is advisory: the raw constructed member is retained even if validation fails.

## Blockers before migration parity

- The test command is not green at process level: all 11 files and 155 tests passed, but one unhandled exception caused exit 1. Resolve the unhandled test exception before using it as a migration gate.
- `Member` types and runtime data disagree: runtime allows gender `U` and writes `birthplace`, while the interface allows only `E | K` and declares `birth_place`. Preserve observed runtime data or reconcile this explicitly before schema generation.
- `processSheetData` mixes parsing with remote ID mutation. Baseline/fixture tooling must avoid calling it on rows with missing or duplicate IDs unless `fetch` is stubbed.
