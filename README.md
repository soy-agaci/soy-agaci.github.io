# Çamakoğlu Sülalesi - Family Tree

Interactive family tree visualization built with D3.js and TypeScript.

## 🌐 Live Site

The family tree is deployed at: [https://camakoglu.github.io/aile/](https://camakoglu.github.io/aile/)

## 🛠️ Development

### Prerequisites

- Node.js 22.12 or higher
- npm
- Docker with Compose support
- Google Chrome (`/usr/bin/google-chrome`) or `CHROME_PATH` set to a Chromium-compatible executable

### Setup

```bash
npm install
cp .env.example .env
```

Start Supabase locally, then copy only the API URL and publishable key from the status output into `.env`:

```bash
npm run supabase:start
npm run supabase:status
```

Stop the local stack with `npm run supabase:stop`. Docker is required for local Supabase.
`VITE_FAMILY_SLUGS` selects one or more comma-separated families. A URL can override it with
`?family=demo-alpha&family=demo-beta`.

### Running Locally

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Running Tests

```bash
npm test
```

Run the fail-closed local release gate from Docker and a clean checkout with:

```bash
PRIMARY_CSV=.local/selcuk.csv npm run verify:local
```

`PRIMARY_CSV` is optional when the published source is reachable. Primary parity is
always required for release verification; retrieval or parity failure makes the
gate fail. `ALLOW_PARITY_SKIP=1` is a non-release diagnostic override and must
never be used for a release decision. Supplying the private local capture makes
520/145/664 parity deterministic without logging rows.
The gate starts and resets Supabase, runs pgTAP and HTTP/JWT integration tests,
checks generated types, frontend tests, production build/security scans, and
the Chrome workflow, then resets and checks synthetic residue. The legacy
`npm run test:local-step7` alias runs the same gate.

### Google Admin Review

The public app needs only `VITE_SUPABASE_URL` and the publishable key. Admin sign-in is Google OAuth only; Supabase persists the browser session. With Google credentials unset the public tree still works and the sign-in button reports the provider error.

For local Supabase, export `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` before starting the stack. In Google Cloud, register this authorized redirect URI:

```text
http://127.0.0.1:54321/auth/v1/callback
```

For a hosted project, configure the same Google client ID/secret in Supabase Dashboard under Authentication > Providers > Google. Register `https://<project-ref>.supabase.co/auth/v1/callback` in Google Cloud, and add the deployed app URL/path to Supabase Authentication URL Configuration. Do not put the Google secret or service-role key in any `VITE_` variable.

Bootstrap the first admin out of band after that user has signed in with Google once. The CLI refuses non-Google users and succeeds exactly once for the lifetime of the database:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run admin -- bootstrap admin@example.com
```

Run this once from a trusted operator shell. A durable, inaccessible marker records completion; an upgraded database with any historical admin row starts completed. Disabling the only admin does not reopen bootstrap or reactivate that account. After bootstrap, active Google admins invite and revoke invitations in the review dialog, which is the only path for a disabled admin to return. Invitees sign in with Google and are activated automatically; there is no open signup. The service-role key is never used by browser code.

### Importing a Sheet

The local importer defaults new person revisions to `family` privacy. Choose public visibility explicitly for public-site data:

```bash
npm run import:sheet -- --file .local/selcuk.csv --family-slug selcuk --family-name "Selçuk" --privacy public
```

To replace local genealogy data with a normalized copy of the configured hosted
database (approved data only; no production auth or admin records):

```bash
npm run supabase:reset -- --no-seed
npm run reseed:local
```

Set `PRIMARY_CSV=.local/selcuk.csv` to use the ignored private capture for the required aggregate-only production parity test.

For the safe hosted migration sequence, follow
[Production handoff: Safe migration checklist](docs/production-handoff.md#safe-migration-checklist).
It covers source freeze, local proof, hosted Supabase, Google OAuth, admin
bootstrap, production import, frontend cutover, smoke, and rollback points.

### Adding a family name

An unassigned visible person has **Aile adı ekle**. Choose an existing family or enter a new
name and slug. After approval, the assignment propagates through the person's father: their
paternal ancestors, the children of those family-line men, and descendants through sons are
assigned together. People who already have a family assignment cannot be reassigned from
this control. Families have no special root person.

## 📦 Deployment to GitHub Pages

### Automatic Deployment

Simply run the deployment script:

```bash
./deploy.sh
```

This will:
1. Create the `public` folder with all static assets (photos, CSS, favicon)
2. Build the production version with correct paths for GitHub Pages
3. Deploy to the `gh-pages` branch
4. Push to GitHub

### Manual Deployment

If you prefer to deploy manually:

```bash
# 1. Ensure public folder exists with assets
mkdir -p public
cp -r fotograf public/
cp -r css public/
cp favicon.ico public/

# 2. Build the project
npm run build

# 3. Deploy to gh-pages
git checkout gh-pages
find . -maxdepth 1 ! -name '.git' ! -name '.' ! -name '..' -exec rm -rf {} +
cp -r dist/* .
git add -A
git commit -m "Deploy: $(date '+%Y-%m-%d %H:%M:%S')"
git push origin gh-pages
git checkout master
```

## 📁 Project Structure

```
soyagaci/
├── src/              # TypeScript source files
├── css/              # Stylesheets
├── fotograf/         # Family photos
├── public/           # Public assets (generated)
├── supabase/         # Local Supabase configuration
├── dist/             # Production build (generated)
├── index.html        # Main HTML file
├── vite.config.ts    # Vite configuration
└── deploy.sh         # Deployment script
```

## ⚙️ Configuration

The project is configured to deploy to GitHub Pages at `/aile/` base path. This is set in `vite.config.ts`:

```typescript
export default defineConfig({
  base: '/aile/',
  // ...
})
```

## 🔧 Important Notes

- The `public` folder is generated from source files and should not be committed to the master branch
- Static assets (photos, CSS, favicon) are automatically copied to `public` during deployment
- The `gh-pages` branch contains only the built files for deployment
- All paths in the production build are relative to `/aile/` for GitHub Pages compatibility

## 📝 License

ISC
