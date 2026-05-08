# Manoel Island — Multiplayer 3D Sandbox (MVP)

React + Vite + React Three Fiber + Zustand + Tailwind + Supabase (optional).

## Quick start

```bash
npm install
npm run dev
```

Without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, the app runs in **demo mode**: local event bus, local token refill (`VITE_DEMO_REFILL_MS`, default 10 minutes).

## Deploying publicly

See [`DEPLOY.md`](DEPLOY.md) for an end-to-end walkthrough — Supabase
project from scratch, schema migrations, seeding the public Manoel
Island base world, then a one-click connect on Vercel. Once deployed,
admin changes (mesh URL, colours, OSM toggles, sea colour, …) auto-save
to `public.world_admin_configs` and are visible to every visitor.

## Supabase (one-off setup)

1. Create a project and apply the migrations under
   [`supabase/migrations/`](supabase/migrations/).
2. Sign up the admin account, then run
   [`supabase/seed_base_world.sql`](supabase/seed_base_world.sql)
   (with your email substituted in) to create the public base world.
3. Copy `.env.example` → `.env` and fill in the Supabase + world id keys.

Realtime on `world_events` is added automatically by the init migration.

## CloudIsle base mesh

The schematic LiDAR mesh of Manoel Island lives at
`public/models/manoel-island.glb` (+ a `.json` heightmap sidecar). To
re-bake it from the upstream point cloud:

```powershell
npm run fetch-cloudisle -- --bbox 14.502,35.895,14.519,35.905
npm run build-base-mesh  -- --bbox 14.502,35.895,14.519,35.905
```

See [`docs/PROMPT_BIBLE.md`](docs/PROMPT_BIBLE.md) for the full pipeline.

## Controls

- **Orbit** — navigate.
- **Sculpt** — paint terrain (hold drag), then **Commit sculpt** (costs 1 pt).
- **Place** — pick an asset, move ghost, click to lock, **Move/Rotate** gizmo, **OK** (costs 1 pt).
- **Admin** (owners/editors only) — load custom mesh, toggle OSM layers,
  pick sea colour, sketch the OSM import bbox.

## Docs

- Deployment guide: [`DEPLOY.md`](DEPLOY.md)
- Prompt / contracts: [`docs/PROMPT_BIBLE.md`](docs/PROMPT_BIBLE.md)
- Drop GLB models under `public/models/` and wire `useGLTF` when ready.

## Performance notes

- Terrain is **chunked** (4×4 × 32 m) with instanced trees and an optional **worker** merge helper (`src/hooks/useTerrainWorker.ts`).
- The LiDAR base mesh is a Draco-compressed GLB (~3 MB) cached for a year by `vercel.json`.
- OSM features sample the LiDAR heightmap sidecar so they sit on the real ground without an extra elevation API call.
