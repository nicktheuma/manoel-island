#!/usr/bin/env node
/**
 * Bootstrap a fresh Supabase project for the Manoel Island sandbox.
 *
 * What it does (idempotent):
 *   1. Resolves or creates an admin auth.users row (email + password).
 *   2. Ensures a `profiles` row exists for that user.
 *   3. Upserts the canonical "Manoel Island" world (UUID from VITE_WORLD_ID
 *      or the project default), owned by the admin, visibility=public.
 *   4. Initialises an empty `world_admin_configs` row so the front-end's
 *      first save can UPSERT cleanly.
 *
 * Pre-requisites (run ONCE):
 *   npx supabase login
 *   npx supabase link --project-ref <your-project-ref>
 *   npx supabase db push        # applies supabase/migrations/*.sql
 *
 * Then, with the env vars below populated in `.env.local`:
 *   npm run bootstrap-supabase
 *
 * Required env (loaded from .env.local; never commit it):
 *   SUPABASE_URL                  https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY     service_role key  (Project → Settings → API)
 *   ADMIN_EMAIL                   email of the human who will own the world
 *   ADMIN_PASSWORD                password for that admin (>= 6 chars)
 *
 * Optional:
 *   VITE_WORLD_ID                 override the default world UUID
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

// ─── Lightweight .env loader (no extra deps) ────────────────────────────
function loadEnvFile(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

// Prefer .env.local for secrets (gitignored); fall back to .env for shared.
loadEnvFile(resolve(repoRoot, '.env.local'))
loadEnvFile(resolve(repoRoot, '.env'))

// ─── Config ─────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ADMIN_EMAIL = process.env.ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const WORLD_ID = process.env.VITE_WORLD_ID || '11111111-1111-4111-8111-111111111111'
const WORLD_NAME = process.env.WORLD_NAME || 'Manoel Island (Public Base)'

const missing = []
if (!SUPABASE_URL) missing.push('SUPABASE_URL (or VITE_SUPABASE_URL)')
if (!SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (!ADMIN_EMAIL) missing.push('ADMIN_EMAIL')
if (!ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD')

if (missing.length) {
  console.error(`✗ Missing required env vars:\n  - ${missing.join('\n  - ')}`)
  console.error(`\nSet them in .env.local (gitignored) — see .env.example for the full schema.`)
  process.exit(1)
}

// Catch the common case where someone copied .env.example to .env.local
// but forgot to overwrite the placeholders. Without this check the script
// crashes deep inside @supabase/auth-js with a cryptic ENOTFOUND.
const PLACEHOLDERS = [
  /your-project\.supabase\.co/i,
  /your[-_]?(anon|service[-_]?role)[-_]?key/i,
  /change[-_]?me/i,
  /^you@example\.com$/i,
  /^at-least-six-chars$/i,
]
const placeholderHits = []
for (const [name, value] of [
  ['SUPABASE_URL', SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY],
  ['ADMIN_EMAIL', ADMIN_EMAIL],
  ['ADMIN_PASSWORD', ADMIN_PASSWORD],
]) {
  if (PLACEHOLDERS.some((rx) => rx.test(value))) placeholderHits.push(name)
}
if (placeholderHits.length) {
  console.error(`✗ The following env vars still hold placeholder values from .env.example:`)
  for (const n of placeholderHits) console.error(`  - ${n}`)
  console.error(`\nReplace them in .env.local with real values:`)
  console.error(`  • SUPABASE_URL          → Project Settings → API → "Project URL"`)
  console.error(`  • SUPABASE_SERVICE_ROLE_KEY → Project Settings → API → "service_role" (secret)`)
  console.error(`  • ADMIN_EMAIL / ADMIN_PASSWORD → the human who will own the world`)
  process.exit(1)
}

try {
  const u = new URL(SUPABASE_URL)
  if (!/\.supabase\.(co|in)$/i.test(u.hostname) && u.hostname !== 'localhost') {
    console.warn(`! SUPABASE_URL host "${u.hostname}" doesn't look like a Supabase project URL.`)
    console.warn('  Continuing anyway, but expect a DNS error if this is wrong.')
  }
} catch {
  console.error(`✗ SUPABASE_URL is not a valid URL: "${SUPABASE_URL}"`)
  process.exit(1)
}

if (ADMIN_PASSWORD.length < 6) {
  console.error('✗ ADMIN_PASSWORD must be at least 6 characters (Supabase requirement).')
  process.exit(1)
}

// service_role bypasses RLS — only ever run this on a trusted machine.
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ─── 1. Resolve or create the admin auth user ───────────────────────────
async function findUserByEmail(email) {
  // listUsers paginates; for fresh projects this single page is plenty.
  let page = 1
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (hit) return hit
    if (data.users.length < 200) return null
    page++
  }
}

console.log(`▶ Checking auth.users for "${ADMIN_EMAIL}"…`)
let admin = await findUserByEmail(ADMIN_EMAIL)
if (admin) {
  console.log(`  · already exists (id=${admin.id})`)
} else {
  console.log('  · creating with email_confirm=true…')
  const { data, error } = await sb.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
  })
  if (error) {
    console.error('✗ createUser failed:', error.message)
    process.exit(1)
  }
  admin = data.user
  console.log(`  · created id=${admin.id}`)
}

// ─── 2. Ensure a profile row exists ─────────────────────────────────────
console.log('▶ Upserting public.profiles row…')
{
  const { error } = await sb
    .from('profiles')
    .upsert({ id: admin.id, display_name: 'Manoel Admin' }, { onConflict: 'id' })
  if (error) {
    console.error('✗ profiles upsert failed:', error.message)
    if (/relation .* does not exist/i.test(error.message)) {
      console.error('  Did you run `supabase db push` to apply the migrations?')
    }
    process.exit(1)
  }
}

// ─── 3. Upsert the canonical Manoel Island world ────────────────────────
console.log(`▶ Upserting world ${WORLD_ID}…`)
{
  const { error } = await sb.from('worlds').upsert(
    {
      id: WORLD_ID,
      owner_id: admin.id,
      name: WORLD_NAME,
      visibility: 'public',
    },
    { onConflict: 'id' },
  )
  if (error) {
    console.error('✗ worlds upsert failed:', error.message)
    process.exit(1)
  }
}

// ─── 4. Initialise an empty admin_config row ────────────────────────────
console.log('▶ Initialising public.world_admin_configs row…')
{
  const { error } = await sb
    .from('world_admin_configs')
    .upsert(
      { world_id: WORLD_ID, config: {}, updated_by: admin.id },
      { onConflict: 'world_id', ignoreDuplicates: true },
    )
  if (error) {
    console.error('✗ world_admin_configs upsert failed:', error.message)
    process.exit(1)
  }
}

console.log('\n✓ Bootstrap complete!\n')
console.log('  Admin email   :', ADMIN_EMAIL)
console.log('  World id      :', WORLD_ID)
console.log('  Visibility    : public  (anyone can read, only owner/editors can write)')
console.log('\nNext steps:')
console.log('  • Add VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_WORLD_ID to Vercel env vars.')
console.log('  • Sign in to the live site as the admin email — the Admin button will appear in the toolbar.')
