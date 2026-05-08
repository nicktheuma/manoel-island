#!/usr/bin/env node
/**
 * One-shot: fetch CloudIsle tiles for a bbox, then bake the GLB.
 * Forwards CLI args to both child scripts. Skips fetch if the cache
 * folder is already populated.
 *
 * Usage:
 *   npm run build-manoel -- --bbox 14.502,35.895,14.519,35.905
 *
 * Optional flags (passed straight through to the underlying scripts):
 *   --output       (default data/cloudisle for fetch, public/models/manoel-island.glb for build)
 *   --grid         (default 256)
 *   --max-depth    (default 14)
 *   --concurrency  (default 4)
 *   --skip-fetch   (don't re-run the scraper even if dir is empty)
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) {
        args[key] = true
      } else {
        args[key] = next
        i++
      }
    }
  }
  return args
}

function run(scriptPath, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...argv], { stdio: 'inherit' })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

async function isPopulated(dir) {
  try {
    const stat = await fs.stat(dir)
    if (!stat.isDirectory()) return false
    // Crude check — has at least one .laz somewhere?
    async function* walk(d) {
      const entries = await fs.readdir(d, { withFileTypes: true })
      for (const e of entries) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) yield* walk(p)
        else if (e.isFile() && e.name.toLowerCase().endsWith('.laz')) yield p
      }
    }
    for await (const _f of walk(dir)) return true
    return false
  } catch {
    return false
  }
}

async function main() {
  const args = parseArgs(process.argv)
  const bbox = args.bbox || '14.498,35.892,14.522,35.910'
  const tilesDir = args['tiles-dir'] || 'data/cloudisle'
  const meshOut = args.output || 'public/models/manoel-island.glb'
  const grid = args.grid || '256'
  const maxDepth = args['max-depth'] || '14'
  const concurrency = args.concurrency || '4'
  const skipFetch = !!args['skip-fetch']

  const __dirname = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))
  const fetchScript = path.join(__dirname, 'fetch-cloudisle.mjs')
  const buildScript = path.join(__dirname, 'build-base-mesh.mjs')

  const tilesAbs = path.resolve(process.cwd(), tilesDir)
  const populated = await isPopulated(tilesAbs)

  if (skipFetch) {
    if (!populated) {
      console.log(`! --skip-fetch set but ${tilesDir} has no .laz files — build will fail.`)
    } else {
      console.log(`▶ skipping fetch (--skip-fetch). Using existing tiles in ${tilesDir}.`)
    }
  } else if (populated) {
    console.log(`▶ ${tilesDir} already has tiles cached. Re-running fetch to fill any gaps for this bbox…`)
    await run(fetchScript, ['--bbox', bbox, '--output', tilesDir, '--concurrency', concurrency, '--max-depth', maxDepth])
  } else {
    console.log(`▶ ${tilesDir} is empty — fetching tiles for bbox ${bbox}.`)
    await run(fetchScript, ['--bbox', bbox, '--output', tilesDir, '--concurrency', concurrency, '--max-depth', maxDepth])
  }

  console.log(`\n▶ Baking GLB → ${meshOut}`)
  const buildArgs = ['--input', tilesDir, '--bbox', bbox, '--grid', grid, '--output', meshOut]
  // forward optional build flags if supplied
  for (const k of ['outline', 'exaggeration', 'scale', 'ground-class']) {
    if (args[k]) buildArgs.push(`--${k}`, args[k])
  }
  await run(buildScript, buildArgs)
  console.log(`\n✓ Manoel base mesh ready at ${meshOut}`)
}

main().catch((err) => {
  console.error('✗ build-manoel failed:', err.message)
  process.exit(1)
})
