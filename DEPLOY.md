# Deploying Manoel Island

End-to-end: from `git clone` to a public site on Vercel with a Supabase
backend that persists every admin change to a shared, world-readable
Manoel Island base map.

The whole flow is automated through two npm commands plus a short Vercel
click-through. Total time: about 10 minutes, no SQL copy-paste.

```
1. Create Supabase project          (2 min, dashboard click-through)
2. npm run supabase:setup           (1 min, idempotent CLI script)
3. Deploy on Vercel                 (5 min, click-through + env vars)
```

---

## 1. Create the Supabase project

1. Sign up / log in at <https://supabase.com>.
2. **New project** → pick a region close to your users (Frankfurt for
   EU, Singapore for Asia, US-East for the Americas) and a strong
   **database password** (you'll need it once for the CLI link).
3. Wait ~2 min for the cluster to come up.
4. Note these from **Project Settings → API**:
   - **Project URL** → `https://<ref>.supabase.co`
   - **anon public** key
   - **service_role** key (**secret**, never commit)
5. Note the **Project ref** (the `<ref>` from the URL above —
   also visible in Settings → General).

### Disable email confirmation while testing (optional)

**Authentication → Providers → Email** → toggle **Confirm email** off
if you don't want to wire up SMTP for the admin signup. You can re-enable
it later. The bootstrap script creates the admin user with
`email_confirm=true` already, so even with confirmation on, the admin
can log in immediately — the toggle only affects subsequent self-signups.

---

## 2. Run the local automated setup

### 2a. Fill in `.env.local`

```powershell
cp .env.example .env.local
```

Edit `.env.local` and fill in **the server-only block at the bottom**:

```dotenv
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...   # service_role, NOT anon
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=at-least-six-chars
```

You can also fill in the public `VITE_SUPABASE_*` values at the top
right now — they're what `npm run dev` reads.

> `.env.local` is gitignored. The `service_role` key has unrestricted
> access to your project — never paste it into Vercel env vars, never
> commit it, never expose it to a browser bundle.

### 2b. Link the Supabase CLI to your project (one-time)

The CLI is bundled in `devDependencies`, so just:

```powershell
npm install
npx supabase login                    # opens your browser
npx supabase link --project-ref <ref>
# It will prompt for the database password from step 1.2.
```

### 2c. Apply schema + seed in one shot

```powershell
npm run supabase:setup
```

This wraps two steps:

1. `supabase db push` — applies every migration under
   [`supabase/migrations/`](supabase/migrations/) (sandbox schema, RLS,
   token RPC, admin-config table). Idempotent.
2. `node scripts/bootstrap-supabase.mjs` — using the `service_role`
   key from `.env.local`:
   - Creates (or finds) your admin auth user with email + password.
   - Inserts a `profiles` row for them.
   - Upserts the canonical Manoel Island world
     (`id = 11111111-1111-4111-8111-111111111111`,
     `visibility = 'public'`, `owner_id = <you>`).
   - Initialises an empty `world_admin_configs` row.

You should see:

```
▶ Checking auth.users for "you@example.com"…
  · creating with email_confirm=true…
  · created id=…
▶ Upserting public.profiles row…
▶ Upserting world 11111111-1111-4111-8111-111111111111…
▶ Initialising public.world_admin_configs row…

✓ Bootstrap complete!
```

Re-running it is safe — every step is `upsert`/`on conflict do nothing`.

### 2d. Verify locally

```powershell
npm run dev
```

Open <http://localhost:5173>, sign in with your admin email/password,
the **Admin** button should appear in the toolbar. Toggle a setting and
reload — your change persists.

---

## 3. Deploy to Vercel

### 3a. Push the repo

If it isn't on GitHub yet:

```powershell
git init
git add .
git commit -m "Initial Manoel Island sandbox"
gh repo create manoel-island --public --source=. --push
```

### 3b. Connect on Vercel

1. <https://vercel.com> → **Add New… → Project**.
2. Pick the GitHub repo. Vercel auto-detects Vite (the bundled
   [`vercel.json`](vercel.json) confirms framework + caching headers).
3. **Environment Variables** — add **only the public ones**:

   | Name                     | Value                                                     |
   | ------------------------ | --------------------------------------------------------- |
   | `VITE_SUPABASE_URL`      | `https://<ref>.supabase.co`                               |
   | `VITE_SUPABASE_ANON_KEY` | the anon public key (NOT service_role)                    |
   | `VITE_WORLD_ID`          | `11111111-1111-4111-8111-111111111111` (or your fork's)   |

   **Do not** add `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, etc.
   to Vercel — those are bootstrap-only and stay on your machine.

4. **Deploy**. First build takes ~2 min. The output is `dist/`.

### 3c. Tell Supabase about the live URL

Back in Supabase **Authentication → URL Configuration**:

- **Site URL**: `https://<your-project>.vercel.app` (or your custom
  domain).
- **Redirect URLs**: add the same URL plus `https://*.vercel.app/**`
  for preview deploys.

Without this, the email-link auth flow returns to `localhost` and the
session won't persist on the live site.

---

## 4. Done — try it out

Visit your Vercel URL. Manoel Island loads from
`/models/manoel-island.glb` plus the OSM layers — **read-only** for
anonymous visitors.

Sign in with your admin account. The **Admin** button appears. Every
change in the admin panel debounces 400 ms then upserts into
`public.world_admin_configs`. Open the same URL in a private window —
your changes are already there.

### Where the data lives

| What you tweak in the panel              | Persisted in Supabase                                                |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Mesh URL / colour / scale / Y-offset     | `world_admin_configs.config` (jsonb)                                 |
| OSM layer toggles + sea colour           | `world_admin_configs.config` (jsonb)                                 |
| Sculpting + placed objects (token-gated) | `world_events`, `placed_objects`, `terrain_chunks`                   |
| Admin/Editor membership                  | `world_members` (insert via `npm run supabase:setup` or SQL editor)  |

### Promoting more people to editor

Add them as world members. Quickest is the SQL Editor:

```sql
insert into public.world_members (world_id, user_id, role)
select
  '11111111-1111-4111-8111-111111111111'::uuid,
  u.id,
  'editor'
from auth.users u
where lower(u.email) = lower('teammate@example.com')
on conflict (world_id, user_id) do update set role = excluded.role;
```

Or extend `scripts/bootstrap-supabase.mjs` — same approach via
`sb.from('world_members').upsert(...)`.

---

## Forking the world (private deployment)

Want a private copy that doesn't share state with the public Manoel?

1. Generate a fresh UUID:
   ```powershell
   node -e "console.log(crypto.randomUUID())"
   ```
2. In `.env.local`, set `VITE_WORLD_ID=<that-uuid>`.
3. `npm run supabase:setup` — re-runs idempotently and seeds the new
   world owned by you.
4. Set the same `VITE_WORLD_ID` in your Vercel env vars and redeploy.

You now have a separately-persisted world running off the same code,
hosting, and base mesh.

---

## Troubleshooting

| Symptom                                                       | Likely cause / fix                                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npx supabase link` fails with "command not found"            | Run `npm install` first to fetch the bundled CLI under `node_modules/.bin`.                                       |
| Bootstrap reports `relation "profiles" does not exist`        | `supabase db push` didn't run (or you're linked to the wrong project). Run `npm run supabase:push`.                |
| Bootstrap reports `Missing required env vars`                 | The values in `.env.local` aren't picked up — check spelling and make sure the file is at the repo root.          |
| Banner says *"Demo mode (no Supabase env)"*                   | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` missing in Vercel env vars; redeploy after adding.                  |
| Admin button never appears after signing in                   | Your auth user isn't the world's `owner_id` and isn't in `world_members`. Re-run `npm run bootstrap-supabase`.    |
| Changes don't persist across reloads                          | Open the network tab — look for a 4xx on `world_admin_configs`. Almost always a missing seed row or RLS mismatch. |
| `invalid input syntax for type uuid: "demo-world"`            | You're on an older build that hardcoded `'demo-world'`. Pull latest, redeploy.                                    |
| `manoel-island.glb` 404s on the live site                     | Run `npm run build-base-mesh` locally and commit `public/models/manoel-island.glb` + `.json`.                     |
