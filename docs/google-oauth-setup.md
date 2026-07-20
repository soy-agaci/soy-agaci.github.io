# Google OAuth setup

This guide sets up Google OAuth for this repo's Supabase-backed admin flow.

It is written for the current deployment shape:

- production app: `https://soy-agaci.github.io`
- local app: `http://localhost:5173`
- Supabase project ref: `pvvxzpwxjvzkzrzrkbaj`
- Supabase callback URL: `https://pvvxzpwxjvzkzrzrkbaj.supabase.co/auth/v1/callback`

If you change the frontend URL later, update both Google Cloud and Supabase.

## What this app expects

The app already starts Google sign-in here:

- [src/ui/admin.ts](/home/sselcuk/projects/soyagaci/src/ui/admin.ts)

It calls `supabase.auth.signInWithOAuth({ provider: 'google' })` and sets
`redirectTo` to the current page URL.

That means:

1. Google must trust your frontend origins.
2. Supabase must have Google enabled.
3. Supabase must allow redirects back to your frontend URLs.
4. The first admin must sign in once before bootstrap.

## Step 1: Create or pick a Google Cloud project

1. Open Google Cloud Console.
2. Pick an existing project or create a new one for this family tree app.
3. Make sure billing / org policy does not block OAuth client creation.

Google docs:

- Google OAuth client management: https://support.google.com/cloud/answer/15549257?hl=en

## Step 2: Configure the OAuth consent screen

1. In Google Cloud Console, go to `APIs & Services -> OAuth consent screen`.
2. Choose the appropriate audience:
   - `Internal` if this must stay inside one Google Workspace.
   - `External` if personal Google accounts should be able to sign in.
3. Fill in the app name and support email.
4. Set the app homepage URL to:

```text
https://soy-agaci.github.io
```

5. Add developer contact email(s).
6. Save.

Notes:

- If Google asks for app domain details, use the real frontend domain, not the
  Supabase callback domain.
- For this app, standard Google profile/email sign-in is enough. No extra API
  scopes are needed for admin auth itself.

Google reference:

- OAuth consent screen homepage requirements: https://support.google.com/cloud/answer/13807376?hl=en

## Step 3: Create the Google OAuth client

1. In Google Cloud Console, go to `APIs & Services -> Credentials`.
2. Click `Create credentials -> OAuth client ID`.
3. Choose application type `Web application`.
4. Name it something clear, for example:

```text
soy-agaci-supabase-web
```

5. Under `Authorized JavaScript origins`, add:

```text
https://soy-agaci.github.io
http://localhost:5173
```

6. Under `Authorized redirect URIs`, add:

```text
https://pvvxzpwxjvzkzrzrkbaj.supabase.co/auth/v1/callback
```

7. Create the client.
8. Copy the `Client ID` and `Client secret`.

Important:

- The redirect URI above is set in Google Cloud, not in this repo.
- That URI belongs to Supabase Auth. Google redirects there first; Supabase
  then redirects back to your site.

Google reference:

- OAuth client setup and redirect URI rules: https://support.google.com/cloud/answer/15549257?hl=en

## Step 4: Enable Google in Supabase

1. Open Supabase Dashboard for project `pvvxzpwxjvzkzrzrkbaj`.
2. Go to `Authentication -> Providers`.
3. Open `Google`.
4. Enable the provider.
5. Paste the Google `Client ID`.
6. Paste the Google `Client secret`.
7. Save.

If Supabase shows you its callback URL on that page, it should match:

```text
https://pvvxzpwxjvzkzrzrkbaj.supabase.co/auth/v1/callback
```

Supabase reference:

- Google provider setup: https://supabase.com/docs/guides/auth/social-login/auth-google

## Step 5: Configure Supabase URL settings

1. In Supabase Dashboard, go to `Authentication -> URL Configuration`.
2. Set `Site URL` to:

```text
https://soy-agaci.github.io
```

3. Add these redirect URLs:

```text
https://soy-agaci.github.io/**
http://localhost:5173/**
```

Why both:

- production login needs the GitHub Pages URL
- local login needs localhost
- this app uses the current page as `redirectTo`, so the allowlist must cover
  the paths you actually open

Supabase reference:

- Redirect URL allowlist and wildcard rules: https://supabase.com/docs/guides/auth/redirect-urls

## Step 6: Verify frontend environment

The browser needs only the public Supabase values.

For local development, set [`.env.local`](/home/sselcuk/projects/soyagaci/.env.local) to:

```dotenv
VITE_SUPABASE_URL=https://pvvxzpwxjvzkzrzrkbaj.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<your-publishable-key>
VITE_FAMILY_SLUGS=selcuk
```

Do not put these in frontend env:

- service role key
- Google client secret
- database password

For GitHub Pages, set the same `VITE_*` values in the build environment used by
the Pages workflow.

## Step 7: Test Google sign-in locally

1. Start the app:

```bash
npm run dev
```

2. Open:

```text
http://localhost:5173
```

3. Click the admin button.
4. Click `Google ile giriş yap`.
5. Confirm that:
   - Google opens
   - Google redirects back to `localhost:5173`
   - the app no longer shows `Unsupported provider`

If you see:

```text
Unsupported provider: provider is not enabled
```

then Google is still disabled in `Supabase -> Authentication -> Providers`.

If you see:

```text
origin_mismatch
```

then your Google `Authorized JavaScript origins` are wrong.

If you see a redirect URL error, your Google `Authorized redirect URIs` or
Supabase redirect allowlist is wrong.

## Step 8: Test Google sign-in in production

1. Open:

```text
https://soy-agaci.github.io
```

2. Click the admin button.
3. Click `Google ile giriş yap`.
4. Confirm that:
   - Google opens
   - the browser returns to `https://soy-agaci.github.io`
   - the app session exists after redirect

If production redirects somewhere unexpected, check:

1. Supabase `Site URL`
2. Supabase redirect allowlist
3. the exact page URL you opened before starting login

## Step 9: Bootstrap the first admin

Google OAuth only creates the user identity. It does not make the user an app
admin by itself.

After the intended admin signs in once with Google, run:

```bash
SUPABASE_URL=https://pvvxzpwxjvzkzrzrkbaj.supabase.co \
SUPABASE_SERVICE_ROLE_KEY='<service-role-key>' \
npm run admin -- bootstrap your-google-email@example.com
```

You can also use the Supabase Auth user UUID instead of the email.

This script:

- looks up the auth user
- checks that the user really signed in via Google
- calls the one-time bootstrap RPC

The implementation is here:

- [tools/admin.ts](/home/sselcuk/projects/soyagaci/tools/admin.ts)

Expected result:

```json
{
  "email": "your-google-email@example.com",
  "user_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "is_admin": true
}
```

Important:

- this is intentionally one-way
- after the first bootstrap, future admins should be invited from the app
- do not expose the service-role key to the browser

## Step 10: Verify admin access

After bootstrap:

1. Sign out if needed.
2. Sign back in with the same Google account.
3. Open the admin dialog.
4. Confirm you can access review tools and admin invitation actions.

## Troubleshooting

### `Unsupported provider: provider is not enabled`

Cause:

- Google provider is disabled in Supabase

Fix:

- enable `Authentication -> Providers -> Google`

### `origin_mismatch`

Cause:

- wrong `Authorized JavaScript origins` in Google Cloud

Fix:

- add:
  - `https://soy-agaci.github.io`
  - `http://localhost:5173`

### Redirect URL mismatch

Cause:

- wrong Google redirect URI or wrong Supabase redirect allowlist

Fix:

1. Google `Authorized redirect URIs` must include:

```text
https://pvvxzpwxjvzkzrzrkbaj.supabase.co/auth/v1/callback
```

2. Supabase redirect URLs must include:

```text
https://soy-agaci.github.io/**
http://localhost:5173/**
```

### Bootstrap says the user does not exist

Cause:

- the user never completed Google sign-in

Fix:

- sign in with Google once first, then rerun the bootstrap command

### Bootstrap refuses the user

Cause:

- the auth user metadata does not prove Google provider usage

Fix:

- sign in with Google, not email/password or magic link

## Latest references used

- Supabase Google sign-in docs: https://supabase.com/docs/guides/auth/social-login/auth-google
- Supabase redirect URL docs: https://supabase.com/docs/guides/auth/redirect-urls
- Supabase Auth overview: https://supabase.com/docs/guides/auth
- Google Cloud OAuth client docs: https://support.google.com/cloud/answer/15549257?hl=en
- Google consent screen homepage requirements: https://support.google.com/cloud/answer/13807376?hl=en
