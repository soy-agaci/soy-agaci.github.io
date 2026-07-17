# Production handoff

This runbook describes operator actions. It does not authorize or perform a remote link, push, import, or deployment.

## Safe migration checklist

Use this order. Do not skip ahead, and do not point the public site at hosted
Supabase until every verification step below passes.

### 1. Freeze and capture the source data

1. Stop making sheet edits except emergency corrections.
2. Export or download the current approved sheet CSV into ignored local storage:

```bash
mkdir -p .local
# Put the approved capture here. Do not commit it.
.local/selcuk.csv
```

3. Keep serving photos from their existing Google Drive URLs. The importer
   stores those URLs; it does not copy photos into Supabase storage.
4. Record the expected public aggregate counts for this capture:

```text
people: 520
unions: 145
legacy DAG links: 664
partnerships: 143
parent links: 750
life events: 605
media: 77
warnings: 0
```

If the current sheet intentionally changed, update these counts only after
reviewing the delta.

### 2. Prove the migration locally

From a clean checkout:

```bash
npm ci
cp .env.example .env
npm run supabase:start
npm run supabase:status
```

Copy only the local API URL and publishable key into `.env`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<local-publishable-key>
VITE_FAMILY_SLUGS=selcuk
```

Run the full local gate:

```bash
PRIMARY_CSV=.local/selcuk.csv npm run verify:local
```

Pass criteria:

- the command exits `0`
- generated Supabase types are current
- pgTAP, Vitest, build, security scans, and browser smoke pass
- import parity matches the recorded counts above
- no source rows, secrets, screenshots, or tokens are printed or committed

Stop here if this fails.

### 3. Create and verify the hosted Supabase project

Create a new hosted Supabase project. Before applying migrations:

1. Confirm the project has backups/PITR appropriate for production.
2. Store the project ref, database password, API URL, publishable key, and
   service-role key in a private secret store.
3. Never put the service-role key, database password, Google secret, JWT
   secret, or refresh tokens in `.env`, `VITE_*`, hosting variables, logs, or
   committed files.

Apply schema from a trusted operator shell:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push --dry-run
npx supabase db push
```

Do not use `--include-seed` on the hosted project. `supabase/seed.sql` is
synthetic local data only.

### 4. Configure Google OAuth before admin bootstrap

In Google Cloud, create an OAuth 2.0 Web application and configure:

- JavaScript origin: your production frontend origin
- redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`

In Supabase Dashboard:

- enable Authentication > Providers > Google
- enter the Google client ID and secret
- set Site URL to the canonical deployed app URL, including `/aile/`
- add only required production/preview/local URLs to the redirect allowlist

The first admin must sign into the app once with Google before bootstrap.

### 5. Bootstrap exactly one initial admin

After that Google-backed user exists in Supabase Auth:

```bash
SUPABASE_URL=<hosted-api-url> \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
npm run admin -- bootstrap <admin-email>
```

This is intentionally one-way. After bootstrap, admins are managed only through
the in-app invitation/revocation flow.

### 6. Import production family data once

Run the production import only after schema, OAuth, and backup checks pass:

```bash
ALLOW_REMOTE_SUPABASE=1 \
SUPABASE_URL=<hosted-api-url> \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
npm run import:sheet -- \
  --file .local/selcuk.csv \
  --family-slug selcuk \
  --family-name "Selçuk" \
  --privacy public
```

Immediately repeat the exact same command. It must report `"no_op": true`.
If it inserts again, stop and investigate before deployment.

### 7. Verify hosted data before frontend cutover

Using a local frontend pointed at hosted Supabase, set:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
VITE_FAMILY_SLUGS=selcuk
```

Then run:

```bash
npm run build
npm run dev
```

Open `http://localhost:5173/aile/?family=selcuk` and verify:

- the Selçuk tree loads without Google Sheet runtime access
- photos load from Google Drive URLs
- approved mode hides pending edits
- pending mode shows pending public proposals
- reset/share/family controls work
- URL refresh preserves expanded view and pan position
- no service-role key or Google secret appears in browser devtools

### 8. Deploy frontend last

Set only these production build variables in the hosting provider:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
VITE_FAMILY_SLUGS=selcuk
```

Build and deploy `dist/`:

```bash
npm ci
npm run build
```

After deploy, run the production smoke section below. Keep the old sheet-backed
deployment available until smoke passes.

### 9. Rollback rule

Before frontend cutover, rollback is simple: do not deploy the new frontend.
After cutover, rollback the frontend to the previous release first. Do not
manually edit hosted production rows to undo a bad import. Restore into a
recovery project from backup/PITR, validate it, then perform a controlled
provider-approved restore or cutover.

## Prerequisites

- Node.js 22.12 or newer and npm.
- Docker Engine with Compose support.
- Google Chrome at `/usr/bin/google-chrome`, or `CHROME_PATH` set to a compatible Chromium executable.
- Supabase CLI from this repository's dev dependencies; use `npx supabase`, not a separately pinned global CLI.
- A Google Cloud project and a hosted Supabase project for production.

Install from a clean checkout:

```bash
npm ci
cp .env.example .env
```

## Local verification

The browser receives only the local URL and publishable key. Service credentials stay in the operator shell created inside the gate.

```bash
npm run supabase:start
npm run supabase:status
npm run dev
```

Set these browser variables in `.env`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<local-publishable-key>
VITE_FAMILY_SLUGS=demo-alpha,demo-beta
```

Run the complete release gate. Keep private CSV files under ignored `.local/` and never attach their rows to logs or issues.

```bash
PRIMARY_CSV=.local/selcuk.csv npm run verify:local
npm run supabase:stop
```

Without `PRIMARY_CSV`, the gate attempts the existing published read-only CSV. Retrieval or parity failure exits nonzero. `ALLOW_PARITY_SKIP=1` exists only for non-release diagnostics; release verification forbids it. Use the captured file before production approval so exact 520 people, 145 unions, and 664 legacy links do not depend on network availability.

## Hosted Supabase

1. Create the project in the Supabase Dashboard and record its project ref, database password, API URL, and publishable key in the deployment secret store.
2. Review every file under `supabase/migrations/`. Migrations are forward-only; do not edit a migration already applied remotely.
3. Link from a trusted operator checkout, then inspect the proposed database changes before pushing:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push --dry-run
npx supabase db push
```

Do not run those commands during local verification. Do not use `--include-seed` remotely: `supabase/seed.sql` contains synthetic local demo data. Production family data enters only through the importer after migrations and security checks pass.

## Google OAuth

Create a Google OAuth 2.0 Web application. Configure:

- Authorized JavaScript origins: the production frontend origin and local origin used for manual OAuth testing, for example `https://family.example` and `http://localhost:5173`.
- Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
- Local Supabase callback when testing the local provider: `http://127.0.0.1:54321/auth/v1/callback`.

In Supabase Dashboard, enable Authentication > Providers > Google and enter the Google client ID and secret. Under Authentication > URL Configuration set:

- Site URL: the canonical deployed application URL, including `/aile/` when hosted at that path.
- Redirect allowlist: the canonical URL and only required preview/local callback destinations.

The Google secret belongs only in Google/Supabase configuration. Never expose it, a service-role key, refresh token, or JWT secret through `VITE_*`, frontend hosting variables, logs, screenshots, or committed files. OAuth traffic should begin only after the user clicks **Google ile giriş yap**.

## Admin provisioning

The operator must first sign in through Google once so the Supabase Auth user and Google provider metadata exist. From a trusted shell, use placeholders supplied by the secret store:

```bash
SUPABASE_URL=<hosted-api-url> SUPABASE_SERVICE_ROLE_KEY=<service-role-key> npm run admin -- bootstrap <admin-email>
```

The CLI refuses identities that are not verified and Google-backed, and succeeds exactly once for the lifetime of the database. A durable marker records the first admin and completion time; an upgrade with any historical admin row initializes it as completed. Disabling an admin never reopens bootstrap or reactivates that account. After bootstrap, active Google admins create and revoke invitations in the review dialog, which is the only return path for a disabled admin. An invited user signs in through Google and is activated automatically. Invitations are audited and retained; there is no open signup or service-role invitation path.

## Family import

Run imports only from a trusted operator shell. Rehearse with `family` privacy locally or in an isolated recovery project, verify aggregates and visibility, then reset that rehearsal target. Import the approved public dataset once under its production slug; changing privacy later is a new reviewed migration, not a repeat import.

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key> npm run import:sheet -- \
  --file .local/selcuk.csv --family-slug selcuk-private --family-name "Selçuk Private" --privacy family

ALLOW_REMOTE_SUPABASE=1 SUPABASE_URL=<hosted-api-url> SUPABASE_SERVICE_ROLE_KEY=<service-role-key> npm run import:sheet -- \
  --file .local/selcuk.csv --family-slug selcuk --family-name "Selçuk" --privacy public
```

`ALLOW_REMOTE_SUPABASE=1` is required for a hosted target and has no browser equivalent. Repeat the exact production command and require `"no_op": true`. For the approved Selçuk capture also require 520 people, 145 unions, 664 legacy DAG links, 143 partnerships, 750 parent links, 605 life events, 77 media, and zero warnings. A current source change must be reviewed and recorded as a deliberate aggregate delta before publication.

Import another family or another family with its own slug and source. Equal legacy IDs in separate imports remain family-scoped and distinct. A person appears in multiple families only when the same canonical person is deliberately given approved memberships in each family; the local demo seed tests that explicit overlap behavior.

## Moderated family creation

Any public visitor can open an approved public person and submit **Aile başlat** from a
visible source family. The request stores only a pending creation proposal tied to the normal
submission audit record. It does not allocate a family, membership, person, reviewer, or
status supplied by the browser.

An active Google admin reviews the proposed family name/slug, source family, and root person
in the existing submission queue. Approval rechecks root visibility and slug availability,
then atomically creates the family and one approved root membership using the existing person
ID. Rejection or conflict creates neither row, and the slug remains available for a later
proposal. After approval, confirm the family appears in **Aileler** and that its root appears
once. Pending proposals are visible only in **Bekleyen** mode for their visible source family.

## Frontend hosting

Set only these production build variables in the hosting provider:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
VITE_FAMILY_SLUGS=selcuk,second-family
```

Build and publish `dist/` at the configured `/aile/` base path:

```bash
npm ci
npm run build
```

Do not deploy `.env`, `.local/`, source CSVs, browser storage, test screenshots, Supabase service keys, Google secrets, or JWTs.

## Backup and recovery

1. Before migrations or imports, confirm a recent hosted backup and the project's point-in-time recovery policy in Supabase Dashboard.
2. For an operator-held logical backup, use a protected workstation and encrypted destination: `npx supabase db dump --linked -f <encrypted-backup-path>`.
3. Record migration version, frontend release, family slugs, and aggregate import counts with the backup. Never place dump files in the repository.
4. Roll schema defects forward with a new corrective migration. For data loss or an unsafe import, disable publication, restore the verified backup/PITR point into a recovery project, validate RLS and aggregates, then follow the provider-approved restore or cutover procedure.
5. Rotate any credential exposed during an incident and revoke affected admin access before reopening moderation.

## Security checklist

- Anon and authenticated roles can execute only public discovery, graph read, edit submission, and family-creation proposal RPCs; they have no direct table writes.
- Service role can execute the importer and the exactly-once first-admin bootstrap RPC, but has no direct admin, bootstrap-marker, invitation, genealogy, or moderation table grants.
- Moderation RPCs require an active admin and Google identity in signed JWT metadata.
- RLS remains enabled; grants and policies match pgTAP expectations for anon, authenticated, service role, and admin paths.
- Every security-definer function has an explicit empty `search_path` and schema-qualified objects.
- Approved public revisions are public; pending private/family revisions and actor digests never enter the public graph.
- Production bundles contain only the publishable key and no Google Sheet/Apps Script write path, alternate auth method, direct table access, secret, or token logging.
- User-supplied text is rendered as text, and external links require safe HTTPS handling.

## Production smoke

1. Open Alpha, Beta, and combined views on desktop and mobile; confirm shared canonical memberships appear once and controls do not overlap.
2. Check approved and pending modes as anonymous; confirm private pending content is absent.
3. Submit profile, spouse, and child edits, including one retry after a failed request.
4. From a selected public person, submit a new-family proposal with one failed-request retry. Confirm it appears in pending mode but not approved family controls.
5. Confirm no Google request occurs before clicking sign-in. Click sign-in and complete Google OAuth on the canonical redirect.
6. As a non-invited Google user, confirm moderation is denied and logout remains available. As an active admin, create and revoke an invitation. Sign in as the invited Google user and confirm automatic activation, then inspect base/current/proposed, approve and reject family proposals, verify same-slug approval conflict, and verify stale edit approval becomes conflict.
7. Confirm the approved family is discoverable/selectable, its root is the same person exactly once, rejected/private data stays absent, and browser console, page errors, failed requests, and unexpected production Google requests are clean.
8. Revoke pending smoke invitations and delete or reject all synthetic submissions. Verify no synthetic users, invitations, families, pending submissions, screenshots, CSVs, or tokens remain.

## Known limitations

- The automated browser gate uses a locally signed Google-shaped JWT; it validates authorization and UI behavior but not Google's hosted consent screen. Production smoke must complete real OAuth once.
- Exact Primary parity requires the approved private capture or reachable published source. Release verification never permits `ALLOW_PARITY_SKIP=1`, and the gate never stores or prints source rows.
- The importer accepts aggregate genealogy/media URLs; it does not copy remote media into managed storage.
