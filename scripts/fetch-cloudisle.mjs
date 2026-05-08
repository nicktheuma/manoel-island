#!/usr/bin/env node
/**
 * Politely scrape the CloudIsle Potree v1.x octree, downloading only the
 * .laz tiles that intersect the requested WGS84 bbox.
 *
 * Usage:
 *   node scripts/fetch-cloudisle.mjs \
 *     --bbox 14.498,35.892,14.522,35.910 \
 *     --output data/cloudisle \
 *     --concurrency 4 \
 *     --max-depth 14
 *
 * Then feed the downloaded directory to scripts/build-base-mesh.mjs.
 *
 * Respects the source: low concurrency, retry-with-backoff, skips files
 * already present, and identifies itself in the User-Agent string.
 *
 * Reference:
 *   https://cloudisle.org
 *   http://www.um.edu.mt/projects/cloudisle/DATA1/webpublish/pointclouds/MalteseIslands/cloud.js
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const DEFAULT_ROOT =
  'http://www.um.edu.mt/projects/cloudisle/DATA1/webpublish/pointclouds/MalteseIslands'

const UA = 'ManoelIslandSandbox/0.1 (CloudIsle bbox scraper; https://cloudisle.org)'

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

function bboxFromString(s) {
  const [west, south, east, north] = s.split(',').map(Number)
  if ([west, south, east, north].some((v) => !Number.isFinite(v))) {
    throw new Error(`Invalid --bbox "${s}". Expected "west,south,east,north" in WGS84 degrees.`)
  }
  return { west, south, east, north }
}

// WGS84 lat/lon → UTM zone 33N (EPSG:32633). Snyder's standard formulas.
function latLonToUtm33(lat, lon) {
  const a = 6378137
  const f = 1 / 298.257223563
  const k0 = 0.9996
  const e2 = f * (2 - f)
  const ep2 = e2 / (1 - e2)
  const lon0 = (15 * Math.PI) / 180
  const phi = (lat * Math.PI) / 180
  const lam = (lon * Math.PI) / 180
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi))
  const T = Math.tan(phi) * Math.tan(phi)
  const C = ep2 * Math.cos(phi) * Math.cos(phi)
  const A = Math.cos(phi) * (lam - lon0)
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * phi))
  const easting =
    k0 * N * (A + ((1 - T + C) * A * A * A) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5)) / 120) +
    500000
  const northing =
    k0 *
    (M +
      N *
        Math.tan(phi) *
        ((A * A) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6)) / 720))
  return { easting, northing }
}

function bboxLatLonToUtm(bbox) {
  // The four corners aren't axis-aligned in UTM — take the AABB of all four projected corners.
  const corners = [
    latLonToUtm33(bbox.south, bbox.west),
    latLonToUtm33(bbox.south, bbox.east),
    latLonToUtm33(bbox.north, bbox.west),
    latLonToUtm33(bbox.north, bbox.east),
  ]
  const xs = corners.map((c) => c.easting)
  const ys = corners.map((c) => c.northing)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

function bboxesIntersect(a, b) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)
}

// Compute a child node's bbox given the parent and Potree octant index.
// PotreeConverter v1 packs the octant as: (mx << 2) | (my << 1) | mz
// so bit 0 of the index = Z, bit 1 = Y, bit 2 = X.
function childBBox(parent, octant) {
  const cx = (parent.minX + parent.maxX) / 2
  const cy = (parent.minY + parent.maxY) / 2
  const cz = (parent.minZ + parent.maxZ) / 2
  return {
    minX: octant & 4 ? cx : parent.minX,
    maxX: octant & 4 ? parent.maxX : cx,
    minY: octant & 2 ? cy : parent.minY,
    maxY: octant & 2 ? parent.maxY : cy,
    minZ: octant & 1 ? cz : parent.minZ,
    maxZ: octant & 1 ? parent.maxZ : cz,
  }
}

/**
 * Compute the disk path within `--output` for a Potree node `path` (empty string = root).
 * Files are grouped into folders of `hierarchyStepSize` characters.
 */
function nodePaths(rootHttp, octreeDir, hierarchyStepSize, nodePath, ext) {
  const segments = []
  for (let i = 0; i < nodePath.length; i += hierarchyStepSize) {
    segments.push(nodePath.slice(i, Math.min(nodePath.length, i + hierarchyStepSize)))
  }
  // Last segment isn't a folder if it doesn't fill a full step (it stays alongside the file).
  // Filename is always `r{nodePath}.{ext}` (root is just `r.{ext}`).
  let folderRel = ''
  // Folders correspond to every full step boundary EXCEPT the leaf step that contains the file.
  // Easier: filename folder = path of length floor(L/step)*step, broken into step-sized chunks.
  const folderLen = Math.floor(nodePath.length / hierarchyStepSize) * hierarchyStepSize
  for (let i = 0; i < folderLen; i += hierarchyStepSize) {
    folderRel = path.join(folderRel, nodePath.slice(i, i + hierarchyStepSize))
  }
  const fileName = `r${nodePath}.${ext}`
  const url = `${rootHttp}/${octreeDir}/r/${folderRel ? folderRel.replaceAll(path.sep, '/') + '/' : ''}${fileName}`
  const localFolder = folderRel ? path.join('r', folderRel) : 'r'
  const localFile = path.join(localFolder, fileName)
  return { url, localFolder, localFile }
}

async function httpGet(url, { binary = false, retries = 3 } = {}) {
  let lastErr = null
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (res.status === 404) {
        return { ok: false, status: 404 }
      }
      if (!res.ok) {
        lastErr = new Error(`${url} → HTTP ${res.status}`)
        await sleep(500 * (attempt + 1))
        continue
      }
      if (binary) {
        const buf = Buffer.from(await res.arrayBuffer())
        return { ok: true, status: res.status, body: buf }
      }
      const text = await res.text()
      return { ok: true, status: res.status, body: text }
    } catch (e) {
      lastErr = e
      await sleep(500 * (attempt + 1))
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastErr?.message || 'unknown error'}`)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Parse a Potree v1.x .hrc file. Returns BFS-ordered array of
 * { childMask, numPoints }. The first entry is the hrc's root node.
 */
function parseHrc(buf) {
  const entries = []
  for (let i = 0; i + 5 <= buf.length; i += 5) {
    const childMask = buf[i]
    const numPoints = buf.readUInt32LE(i + 1)
    entries.push({ childMask, numPoints })
  }
  return entries
}

/**
 * Walk a hrc subtree starting at `rootNodePath` (string of digits, "" for root).
 *
 * The hrc file is a pure BFS dump of all nodes within the subtree (down to
 * `hierarchyStepSize` levels). To stay in sync with that BFS, we MUST enqueue
 * every existing child regardless of whether it intersects our target — the
 * pruning happens at visit time, not at enqueue time. Pruning at enqueue
 * would offset queue indices from hrc entry indices and corrupt the walk.
 *
 * Calls `visit({ nodePath, bbox, numPoints, hasChildren })` for every node.
 * If a node sits at the bottom step boundary AND has children AND its bbox
 * intersects our target, we fetch its child hrc and recurse.
 */
async function walkHrc({
  rootHttp,
  octreeDir,
  hierarchyStepSize,
  rootNodePath,
  rootNodeBBox,
  hrcBuf,
  visit,
  shouldRecurse,
  fetchHrc,
}) {
  const entries = parseHrc(hrcBuf)
  if (entries.length === 0) return

  const queue = [{ nodePath: rootNodePath, bbox: rootNodeBBox, depthFromRoot: 0 }]
  for (let i = 0; i < entries.length; i++) {
    const node = queue[i]
    if (!node) {
      // hrc has more entries than our queue — a sign the file was truncated
      // or the BFS reconstruction got out of sync. Bail out gracefully.
      break
    }
    const { childMask, numPoints } = entries[i]
    const isStepBottom = node.depthFromRoot === hierarchyStepSize - 1
    const hasChildren = childMask !== 0

    visit({ nodePath: node.nodePath, bbox: node.bbox, numPoints, hasChildren })

    if (!hasChildren) continue

    if (isStepBottom) {
      // Children live in a separate hrc file. Only fetch+recurse for octants
      // that intersect our target; we don't have to keep BFS sync here.
      if (!shouldRecurse(node.bbox)) continue
      for (let oct = 0; oct < 8; oct++) {
        if (!(childMask & (1 << oct))) continue
        const childBox = childBBox(node.bbox, oct)
        if (!shouldRecurse(childBox)) continue
        const childPath = node.nodePath + String(oct)
        const childHrc = await fetchHrc(childPath)
        if (!childHrc) continue
        await walkHrc({
          rootHttp,
          octreeDir,
          hierarchyStepSize,
          rootNodePath: childPath,
          rootNodeBBox: childBox,
          hrcBuf: childHrc,
          visit,
          shouldRecurse,
          fetchHrc,
        })
      }
    } else {
      // Children are in the same hrc — enqueue ALL of them in octant order so
      // queue indices stay aligned with hrc BFS order.
      for (let oct = 0; oct < 8; oct++) {
        if (!(childMask & (1 << oct))) continue
        const childPath = node.nodePath + String(oct)
        const childBox = childBBox(node.bbox, oct)
        queue.push({ nodePath: childPath, bbox: childBox, depthFromRoot: node.depthFromRoot + 1 })
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv)
  const root = (args.root || DEFAULT_ROOT).replace(/\/$/, '')
  const outDir = path.resolve(process.cwd(), args.output || 'data/cloudisle')
  const concurrency = parseInt(args.concurrency || '4', 10)
  const maxDepth = parseInt(args['max-depth'] || '14', 10)
  const bbox = bboxFromString(args.bbox || '14.498,35.892,14.522,35.910')

  console.log('▶ CloudIsle scraper')
  console.log('  root        :', root)
  console.log('  bbox (WGS84):', bbox)
  console.log('  output      :', outDir)
  console.log('  concurrency :', concurrency)
  console.log('  max depth   :', maxDepth)

  // 1) Fetch cloud.js
  const cloudRes = await httpGet(`${root}/cloud.js`)
  if (!cloudRes.ok) throw new Error(`cloud.js not reachable (HTTP ${cloudRes.status})`)
  const cloud = JSON.parse(cloudRes.body)
  console.log(
    `  dataset     : ${cloud.points.toLocaleString()} pts, spacing ${cloud.spacing.toFixed(2)}, fmt ${cloud.pointAttributes}`,
  )
  if (cloud.pointAttributes !== 'LAZ') {
    console.warn(`! pointAttributes is "${cloud.pointAttributes}" — only LAZ is wired up here.`)
  }
  const ext = cloud.pointAttributes === 'LAZ' ? 'laz' : cloud.pointAttributes === 'LAS' ? 'las' : 'bin'
  const stepSize = cloud.hierarchyStepSize ?? 5

  // 2) Convert WGS84 bbox to UTM 33N
  const targetUtm = bboxLatLonToUtm(bbox)
  // pad by half a metre to absorb any boundary precision issues
  targetUtm.minX -= 0.5
  targetUtm.minY -= 0.5
  targetUtm.maxX += 0.5
  targetUtm.maxY += 0.5
  console.log(
    `  utm bbox    : E ${targetUtm.minX.toFixed(1)}–${targetUtm.maxX.toFixed(1)}, N ${targetUtm.minY.toFixed(1)}–${targetUtm.maxY.toFixed(1)}`,
  )

  const rootBox = {
    minX: cloud.boundingBox.lx,
    maxX: cloud.boundingBox.ux,
    minY: cloud.boundingBox.ly,
    maxY: cloud.boundingBox.uy,
    minZ: cloud.boundingBox.lz,
    maxZ: cloud.boundingBox.uz,
  }

  await fs.mkdir(outDir, { recursive: true })

  // 3) Walk the octree and collect tile URLs
  const targets = []
  let tilesScanned = 0

  const fetchHrcCached = async (nodePath) => {
    const hrcPath = nodePaths(root, cloud.octreeDir, stepSize, nodePath, 'hrc')
    const localPath = path.join(outDir, hrcPath.localFile)
    try {
      const cached = await fs.readFile(localPath)
      return cached
    } catch {
      // not cached, fetch
    }
    const res = await httpGet(hrcPath.url, { binary: true })
    if (!res.ok) return null
    await fs.mkdir(path.join(outDir, hrcPath.localFolder), { recursive: true })
    await fs.writeFile(localPath, res.body)
    return res.body
  }

  const shouldRecurse = (b) => {
    return bboxesIntersect(b, targetUtm)
  }

  const rootHrc = await fetchHrcCached('')
  if (!rootHrc) throw new Error('Could not fetch root .hrc')

  await walkHrc({
    rootHttp: root,
    octreeDir: cloud.octreeDir,
    hierarchyStepSize: stepSize,
    rootNodePath: '',
    rootNodeBBox: rootBox,
    hrcBuf: rootHrc,
    visit: ({ nodePath, bbox: nodeBox, numPoints }) => {
      tilesScanned++
      if (numPoints === 0) return
      if (nodePath.length > maxDepth) return
      if (!bboxesIntersect(nodeBox, targetUtm)) return
      const lazPaths = nodePaths(root, cloud.octreeDir, stepSize, nodePath, ext)
      targets.push({ ...lazPaths, numPoints })
    },
    shouldRecurse,
    fetchHrc: fetchHrcCached,
  })

  console.log(`  scanned     : ${tilesScanned} tree nodes`)
  console.log(`  to download : ${targets.length} tiles`)
  const totalPoints = targets.reduce((s, t) => s + t.numPoints, 0)
  console.log(`  total pts   : ${totalPoints.toLocaleString()}`)

  // 4) Download tiles with limited concurrency, skipping existing files
  let done = 0
  let skipped = 0
  let downloaded = 0
  let failed = 0
  let bytes = 0

  async function downloadTile(t) {
    const localPath = path.join(outDir, t.localFile)
    try {
      const stat = await fs.stat(localPath)
      if (stat.size > 0) {
        skipped++
        bytes += stat.size
        return
      }
    } catch {
      // not present
    }
    const res = await httpGet(t.url, { binary: true })
    if (!res.ok) {
      failed++
      return
    }
    await fs.mkdir(path.join(outDir, t.localFolder), { recursive: true })
    await fs.writeFile(localPath, res.body)
    downloaded++
    bytes += res.body.length
  }

  const queue = [...targets]
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const t = queue.shift()
      if (!t) return
      try {
        await downloadTile(t)
      } catch (e) {
        failed++
        console.warn(`  ! ${t.url}: ${e.message}`)
      }
      done++
      if (done % 10 === 0 || done === targets.length) {
        process.stdout.write(
          `\r  progress    : ${done}/${targets.length}  (downloaded ${downloaded}, cached ${skipped}, failed ${failed})  `,
        )
      }
    }
  })
  await Promise.all(workers)
  process.stdout.write('\n')

  console.log(`  total bytes : ${(bytes / (1024 * 1024)).toFixed(1)} MB`)
  console.log(`✓ done. Output: ${outDir}`)
  console.log('  Next: npm run build-base-mesh -- --input', outDir, '--bbox', args.bbox || '14.498,35.892,14.522,35.910')
}

main().catch((err) => {
  console.error('✗ fetch-cloudisle failed:', err)
  process.exit(1)
})
