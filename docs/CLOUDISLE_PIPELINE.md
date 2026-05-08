# Manoel Island Base Mesh — CloudIsle LiDAR Pipeline

The public sandbox starts from a single highly-optimised mesh of Manoel Island
generated **once** from the 2018 University of Malta LiDAR survey
([CloudIsle](https://cloudisle.org/)). The mesh is committed to
`public/models/manoel-island.glb` and loaded as the default custom mesh.

This pipeline is **offline-only**. We never decode LiDAR in the browser,
because:

- a single LAZ tile is multi-MB of compressed binary
- Potree octrees span thousands of tiles across the Maltese Islands
- the public sandbox is rendered on phones; clients must stay light

## Data source

CloudIsle publishes the LiDAR data as a [Potree v1.x](https://potree.org)
octree of `.laz` tiles. The Maltese Islands dataset root is here:

```
http://www.um.edu.mt/projects/cloudisle/DATA1/webpublish/pointclouds/MalteseIslands/
```

with `cloud.js` (octree metadata) at the root and tiles arranged under
`data/r/{node-path}/r{node-path}.laz`.

The ground sampling distance is roughly 0.5 m — vastly higher resolution than
any open elevation API.

## High-level workflow

1. **Identify the bounds of Manoel Island.** Approximate WGS84 bbox:
   `west=14.502, south=35.895, east=14.519, north=35.905` (≈ 1.6 km × 1.1 km).
2. **Download the Potree tiles intersecting that bbox.** The script walks the
   octree, downloading only nodes whose AABB overlaps the bbox.
3. **Decode each LAZ tile** with [`laz-perf`](https://www.npmjs.com/package/laz-perf)
   (WASM, no native deps).
4. **Bin classified ground returns into a heightmap.** Use only LAS class 2
   (ground) points to avoid building/canopy noise. Bin into a regular grid
   (e.g. 256×256) by averaging Z per cell.
5. **Clip the heightmap to a polygon outline.** Cells outside the island
   outline get a sea-floor height. Outline can be an SVG-style sketch
   exported from the in-app admin map picker.
6. **Build a Three.js `PlaneGeometry`** displaced by the heightmap.
7. **Decimate** with `meshoptimizer` (target ~30k tris) — paper-craft style
   doesn't need 65k tris.
8. **Export as a Draco-compressed GLB** with `@gltf-transform/core`.
9. **Drop the GLB** at `public/models/manoel-island.glb` and commit it.

## Running the pipeline

Two steps. Both scripts are pure Node ESM with WASM (no native deps).

### Step 1 — fetch the LiDAR tiles for your bbox

```powershell
npm install

# walk the CloudIsle Potree octree and only download tiles that
# intersect your WGS84 bbox (Manoel Island fits in <50 MB of LAZ).
npm run fetch-cloudisle -- `
  --bbox 14.498,35.892,14.522,35.910 `
  --output data/cloudisle `
  --concurrency 4 `
  --max-depth 14
```

The scraper is intentionally polite: low concurrency, retry-with-backoff,
caches `.hrc` files locally, and resumes by skipping any `.laz` already on
disk. Re-run safely.

What it does internally:

1. Fetches `cloud.js`. Reads the dataset bbox, hierarchy step (5), CRS info.
2. Converts the WGS84 bbox to UTM 33N (the dataset's source projection).
3. Walks the octree, fetching `.hrc` (hierarchy) files and computing each
   octant's AABB by subdivision. Prunes anything that doesn't intersect.
4. Downloads the `.laz` tiles for surviving nodes into `data/cloudisle/`.

### Step 2 — bake the optimised base mesh

```powershell
npm run build-base-mesh -- `
  --input data/cloudisle `
  --bbox 14.498,35.892,14.522,35.910 `
  --grid 256 `
  --output public/models/manoel-island.glb
```

Use the **same bbox** in both steps — the build script clips to that bbox
again, since the scraper may include tiles that overlap the bbox edge.

Optional flags:

- `--outline path/to/outline.geojson` — clip heightmap to a precise polygon
- `--exaggeration 1.4` — vertical scale multiplier (paper-craft default)
- `--scale 0.05` — meters→world conversion (must match `worldScale.ts`)
- `--ground-class 2` — LAS classification value for ground returns

## Loading the mesh in the app

After the GLB is committed:

1. Open the admin panel.
2. Tick **Enable custom mesh**.
3. Set **GLB/GLTF URL** to `/models/manoel-island.glb` (already pre-set by the
   "Use Manoel Base Mesh" preset).
4. Adjust mesh color, roughness, and Y-offset to taste.

The base mesh is purely visual; the editable sculpt terrain still drives all
multiplayer changes. The base GLB only renders to provide the realistic island
silhouette as the starting backdrop.

## Why offline rather than client-side LAZ decoding?

| Concern              | Offline pipeline     | Browser pipeline                |
|----------------------|----------------------|---------------------------------|
| First-load size      | ~1–3 MB GLB          | 50+ MB raw tiles                |
| Cold-start time      | <500 ms              | 30+ s with WASM warmup          |
| Mobile feasibility   | Yes                  | Likely OOM on small phones      |
| Data source friendly | One-shot download    | Hammers the host on every load  |
| Rebuild cadence      | When LiDAR refreshed | Every page load                 |

If a future LiDAR survey is published, simply re-run the script and commit
the new GLB.

## Attribution

The 2018 LiDAR survey was conducted by the Malta Environment and Planning
Authority in partnership with Terraimaging, hosted by the University of Malta
under Prof. Saviour Formosa's CloudIsle project, and published under the
European Regional Development Fund. Please respect the original license terms
(`https://cloudisle.org/`).
