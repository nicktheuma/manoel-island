#!/usr/bin/env node
/**
 * Build the Manoel Island base mesh from CloudIsle LiDAR tiles.
 *
 * Usage:
 *   node scripts/build-base-mesh.mjs \
 *     --input data/cloudisle \
 *     --bbox 14.502,35.895,14.519,35.905 \
 *     --grid 256 \
 *     --output public/models/manoel-island.glb
 *
 * Reads every *.laz file under --input, decodes ground returns, bins them
 * into a regular grid clipped to --bbox (and optionally --outline GeoJSON
 * polygon), and writes a Draco-compressed GLB.
 *
 * See docs/CLOUDISLE_PIPELINE.md for the full design rationale.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Document, NodeIO } from '@gltf-transform/core'
import draco3d from 'draco3dgltf'
import { KHRDracoMeshCompression } from '@gltf-transform/extensions'

// laz-perf is a CommonJS Emscripten WASM module — load it via createRequire
// so we get the real exports rather than a default-only ESM wrapper.
const require = createRequire(import.meta.url)
const { createLazPerf } = require('laz-perf')

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

// LiDAR for Malta is published in EPSG:23033 / UTM 33N. Convert UTM 33N
// to WGS84 lat/lon using the inverse Mercator projection.
function utm33ToLatLon(easting, northing) {
  // WGS84
  const a = 6378137
  const f = 1 / 298.257223563
  const k0 = 0.9996
  const e2 = f * (2 - f)
  const ep2 = e2 / (1 - e2)
  const lon0 = (15 * Math.PI) / 180
  const N0 = 0
  const E0 = 500000

  const x = easting - E0
  const y = northing - N0
  const M = y / k0
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256))
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 * e1 * e1) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 * e1 * e1 * e1) / 32) * Math.sin(4 * mu) +
    ((151 * e1 * e1 * e1) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 * e1 * e1 * e1) / 512) * Math.sin(8 * mu)

  const sinPhi1 = Math.sin(phi1)
  const cosPhi1 = Math.cos(phi1)
  const tanPhi1 = Math.tan(phi1)
  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1)
  const T1 = tanPhi1 * tanPhi1
  const C1 = ep2 * cosPhi1 * cosPhi1
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5)
  const D = x / (N1 * k0)

  const phi =
    phi1 -
    ((N1 * tanPhi1) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D * D * D * D) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D * D * D * D * D * D) / 720)
  const lon =
    lon0 +
    (D -
      ((1 + 2 * T1 + C1) * D * D * D) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D * D * D * D * D) / 120) /
      cosPhi1

  return { lat: (phi * 180) / Math.PI, lon: (lon * 180) / Math.PI }
}

// LAS header parsing — we read header offsets manually rather than relying
// on laz-perf's full header for portability.
function parseLasHeader(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const sig = String.fromCharCode(buf[0], buf[1], buf[2], buf[3])
  if (sig !== 'LASF') throw new Error('Not a LAS/LAZ file')
  const versionMajor = buf[24]
  const versionMinor = buf[25]
  const headerSize = view.getUint16(94, true)
  const offsetToPointData = view.getUint32(96, true)
  const pointDataFormat = buf[104] & 0x3f
  const pointDataRecordLength = view.getUint16(105, true)
  const numPointRecordsLegacy = view.getUint32(107, true)
  const xScale = view.getFloat64(131, true)
  const yScale = view.getFloat64(139, true)
  const zScale = view.getFloat64(147, true)
  const xOffset = view.getFloat64(155, true)
  const yOffset = view.getFloat64(163, true)
  const zOffset = view.getFloat64(171, true)
  let numPoints = numPointRecordsLegacy
  if (versionMajor === 1 && versionMinor >= 4) {
    numPoints = Number(view.getBigUint64(247, true)) || numPointRecordsLegacy
  }
  return {
    headerSize,
    offsetToPointData,
    pointDataFormat,
    pointDataRecordLength,
    numPoints,
    xScale,
    yScale,
    zScale,
    xOffset,
    yOffset,
    zOffset,
  }
}

// Classification field offset within a point record (LAS 1.0–1.4)
function classificationOffset(format) {
  // Common formats in CloudIsle: 1 or 3
  if (format <= 5) return 15
  return 16
}

// Lazily-instantiated single WASM module shared across every tile.
let _lazPerfPromise = null
function getLazPerf() {
  if (!_lazPerfPromise) {
    // Suppress emscripten's noisy "warning: ..." chatter on stdout/stderr.
    _lazPerfPromise = createLazPerf({
      print: () => {},
      printErr: () => {},
    })
  }
  return _lazPerfPromise
}

/**
 * Decode every point in a LAZ file using laz-perf WASM bindings.
 * Returns an array of { x, y, z, classification } in source CRS units (UTM 33N for CloudIsle).
 * Uses my manually-parsed LAS header for scale/offset values since laz-perf
 * doesn't expose the header through its JS API.
 */
async function decodeLazFile(buf) {
  const header = parseLasHeader(buf)
  const lazPerf = await getLazPerf()

  // Copy the .laz file into WASM-managed memory.
  const filePtr = lazPerf._malloc(buf.length)
  lazPerf.HEAPU8.set(buf, filePtr)

  const decoder = new lazPerf.LASZip()
  try {
    decoder.open(filePtr, buf.length)
  } catch (e) {
    decoder.delete()
    lazPerf._free(filePtr)
    throw new Error(`laz-perf could not open file: ${e?.message || e}`)
  }

  const recLen = header.pointDataRecordLength
  const numPoints = header.numPoints
  const cls = classificationOffset(header.pointDataFormat)
  const pointPtr = lazPerf._malloc(recLen)

  const points = new Array(numPoints)
  try {
    for (let i = 0; i < numPoints; i++) {
      decoder.getPoint(pointPtr)
      // Re-acquire the view each iteration — Emscripten can grow memory which
      // would detach earlier buffer references.
      const v = new DataView(lazPerf.HEAPU8.buffer, pointPtr, recLen)
      const classification = lazPerf.HEAPU8[pointPtr + cls] & 0x1f
      const x = v.getInt32(0, true) * header.xScale + header.xOffset
      const y = v.getInt32(4, true) * header.yScale + header.yOffset
      const z = v.getInt32(8, true) * header.zScale + header.zOffset
      points[i] = { x, y, z, classification }
    }
  } finally {
    decoder.delete()
    lazPerf._free(filePtr)
    lazPerf._free(pointPtr)
  }
  return points
}

async function* walkLazFiles(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walkLazFiles(p)
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.laz')) yield p
  }
}

function pointInPolygon(px, py, polygon) {
  if (polygon.length < 3) return true
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0]
    const yi = polygon[i][1]
    const xj = polygon[j][0]
    const yj = polygon[j][1]
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi
    if (intersects) inside = !inside
  }
  return inside
}

async function loadOutline(filePath) {
  if (!filePath) return null
  const txt = await fs.readFile(filePath, 'utf8')
  const json = JSON.parse(txt)
  // Accept either GeoJSON Polygon or array of [lon, lat] pairs
  if (Array.isArray(json) && Array.isArray(json[0])) return json
  const geom = json.geometry || json
  if (geom?.type === 'Polygon') return geom.coordinates[0]
  if (geom?.type === 'MultiPolygon') return geom.coordinates[0][0]
  throw new Error('Outline file must be a GeoJSON Polygon or a [[lon,lat], …] array')
}

async function main() {
  const args = parseArgs(process.argv)
  const inputDir = path.resolve(process.cwd(), args.input || 'data/cloudisle')
  const output = path.resolve(process.cwd(), args.output || 'public/models/manoel-island.glb')
  const grid = parseInt(args.grid || '256', 10)
  // Exaggeration MUST match worldScale.ts ELEVATION_EXAGGERATION so OSM
  // features (which sample the same heightmap metadata) line up with the
  // baked GLB. 1.0 = true to scale.
  const exaggeration = parseFloat(args.exaggeration || '1.0')
  const scale = parseFloat(args.scale || '0.05') // must match worldScale.ts METERS_TO_WORLD
  const groundClass = parseInt(args['ground-class'] || '2', 10)
  const bbox = bboxFromString(args.bbox || '14.502,35.895,14.519,35.905')
  const outline = await loadOutline(args.outline)

  console.log('▶ Manoel Island base-mesh build')
  console.log('  input  :', inputDir)
  console.log('  bbox   :', bbox)
  console.log('  grid   :', `${grid}×${grid}`)
  console.log('  output :', output)

  // Bin storage
  const sums = new Float64Array(grid * grid)
  const counts = new Uint32Array(grid * grid)
  const inv = (idx) => ({ x: idx % grid, y: Math.floor(idx / grid) })

  let totalPoints = 0
  let usedPoints = 0
  const tiles = []
  try {
    for await (const f of walkLazFiles(inputDir)) tiles.push(f)
  } catch (e) {
    if (e?.code === 'ENOENT') {
      throw new Error(
        `Input directory "${inputDir}" does not exist.\n` +
          `Run the scraper first to populate it:\n` +
          `  npm run fetch-cloudisle -- --bbox ${args.bbox || '14.498,35.892,14.522,35.910'} --output ${path.relative(process.cwd(), inputDir) || 'data/cloudisle'}\n` +
          `Or use the combined command: npm run build-manoel -- --bbox <bbox>`,
      )
    }
    throw e
  }
  if (tiles.length === 0) {
    throw new Error(
      `No .laz files found under "${inputDir}". Did the scraper finish? Try re-running:\n` +
        `  npm run fetch-cloudisle -- --bbox ${args.bbox || '14.498,35.892,14.522,35.910'} --output ${path.relative(process.cwd(), inputDir) || 'data/cloudisle'}`,
    )
  }
  console.log(`  tiles  : ${tiles.length}`)

  for (const file of tiles) {
    process.stdout.write(`  · ${path.relative(inputDir, file)} … `)
    const buf = await fs.readFile(file)
    let points
    try {
      points = await decodeLazFile(new Uint8Array(buf))
    } catch (e) {
      console.log(`SKIP (${e.message})`)
      continue
    }
    let kept = 0
    for (const p of points) {
      totalPoints++
      if (groundClass >= 0 && p.classification !== groundClass) continue
      const { lat, lon } = utm33ToLatLon(p.x, p.y)
      if (lon < bbox.west || lon > bbox.east || lat < bbox.south || lat > bbox.north) continue
      if (outline && !pointInPolygon(lon, lat, outline)) continue
      const u = (lon - bbox.west) / (bbox.east - bbox.west)
      const v = (lat - bbox.south) / (bbox.north - bbox.south)
      const gx = Math.min(grid - 1, Math.max(0, Math.floor(u * grid)))
      const gy = Math.min(grid - 1, Math.max(0, Math.floor(v * grid)))
      const k = gy * grid + gx
      sums[k] += p.z
      counts[k] += 1
      kept++
      usedPoints++
    }
    console.log(`${points.length.toLocaleString()} pts, ${kept.toLocaleString()} kept`)
  }
  console.log(`  · total kept: ${usedPoints.toLocaleString()} of ${totalPoints.toLocaleString()}`)

  if (usedPoints === 0) {
    throw new Error('No ground points landed inside the bbox. Check --input, --bbox, and --ground-class.')
  }

  // Fill empty cells by nearest-neighbour spread (small kernel)
  const heights = new Float32Array(grid * grid)
  let zMin = Infinity
  let zMax = -Infinity
  for (let i = 0; i < heights.length; i++) {
    if (counts[i] > 0) {
      const v = sums[i] / counts[i]
      heights[i] = v
      if (v < zMin) zMin = v
      if (v > zMax) zMax = v
    } else {
      heights[i] = NaN
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) {
        const i = y * grid + x
        if (!Number.isNaN(heights[i])) continue
        let s = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xi = x + dx
            const yi = y + dy
            if (xi < 0 || xi >= grid || yi < 0 || yi >= grid) continue
            const v = heights[yi * grid + xi]
            if (!Number.isNaN(v)) {
              s += v
              n++
            }
          }
        }
        if (n) heights[i] = s / n
      }
    }
  }
  const seaFloor = zMin - (zMax - zMin) * 0.4
  for (let i = 0; i < heights.length; i++) {
    if (Number.isNaN(heights[i])) heights[i] = seaFloor
  }
  console.log(`  · z range: ${zMin.toFixed(2)}m → ${zMax.toFixed(2)}m`)

  // Build a plane geometry sized to the bbox in world units
  const centerLat = (bbox.north + bbox.south) / 2
  const widthMeters = (bbox.east - bbox.west) * 111320 * Math.cos((centerLat * Math.PI) / 180)
  const depthMeters = (bbox.north - bbox.south) * 110540
  const widthWorld = widthMeters * scale
  const depthWorld = depthMeters * scale

  const segX = grid - 1
  const segY = grid - 1
  const verts = (segX + 1) * (segY + 1)
  const positions = new Float32Array(verts * 3)
  const indices = new Uint32Array(segX * segY * 6)

  // Map heightmap rows so south (gy=0, low lat) lands at -Z and
  // north (gy=segY, high lat) lands at +Z. This matches the OSM
  // convention used by `latLonToWorld` so the LiDAR mesh and OSM
  // features share an axis (north = +Z, east = +X).
  for (let y = 0; y <= segY; y++) {
    for (let x = 0; x <= segX; x++) {
      const i = y * (segX + 1) + x
      const wx = -widthWorld / 2 + (x / segX) * widthWorld
      const wz = -depthWorld / 2 + (y / segY) * depthWorld
      const wy = (heights[y * grid + x] - zMin) * scale * exaggeration
      positions[i * 3 + 0] = wx
      positions[i * 3 + 1] = wy
      positions[i * 3 + 2] = wz
    }
  }
  // Counter-clockwise winding when viewed from above (+Y),
  // so face normals point in +Y for a flat plane (terrain "up").
  // With +X = east and +Z = north, the upward triangle is (a, c, b).
  let t = 0
  for (let y = 0; y < segY; y++) {
    for (let x = 0; x < segX; x++) {
      const a = y * (segX + 1) + x
      const b = a + 1
      const c = a + (segX + 1)
      const d = c + 1
      indices[t++] = a
      indices[t++] = c
      indices[t++] = b
      indices[t++] = b
      indices[t++] = c
      indices[t++] = d
    }
  }

  // Compute normals
  const normals = new Float32Array(positions.length)
  const v0 = [0, 0, 0]
  const v1 = [0, 0, 0]
  const v2 = [0, 0, 0]
  const e1 = [0, 0, 0]
  const e2 = [0, 0, 0]
  const n = [0, 0, 0]
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3
    const ib = indices[i + 1] * 3
    const ic = indices[i + 2] * 3
    for (let k = 0; k < 3; k++) {
      v0[k] = positions[ia + k]
      v1[k] = positions[ib + k]
      v2[k] = positions[ic + k]
      e1[k] = v1[k] - v0[k]
      e2[k] = v2[k] - v0[k]
    }
    n[0] = e1[1] * e2[2] - e1[2] * e2[1]
    n[1] = e1[2] * e2[0] - e1[0] * e2[2]
    n[2] = e1[0] * e2[1] - e1[1] * e2[0]
    for (const idx of [ia, ib, ic]) {
      normals[idx + 0] += n[0]
      normals[idx + 1] += n[1]
      normals[idx + 2] += n[2]
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const m = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
    normals[i] /= m
    normals[i + 1] /= m
    normals[i + 2] /= m
  }

  // Compose the GLB document
  const doc = new Document()
  const buffer = doc.createBuffer()
  const positionAcc = doc
    .createAccessor('POSITION')
    .setArray(positions)
    .setType('VEC3')
    .setBuffer(buffer)
  const normalAcc = doc
    .createAccessor('NORMAL')
    .setArray(normals)
    .setType('VEC3')
    .setBuffer(buffer)
  const indexAcc = doc.createAccessor('INDEX').setArray(indices).setType('SCALAR').setBuffer(buffer)
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', positionAcc)
    .setAttribute('NORMAL', normalAcc)
    .setIndices(indexAcc)
  const mesh = doc.createMesh('manoel-island').addPrimitive(prim)
  const node = doc.createNode('manoel-island').setMesh(mesh)
  doc.createScene('default').addChild(node)

  await fs.mkdir(path.dirname(output), { recursive: true })
  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      'draco3d.encoder': await draco3d.createEncoderModule(),
      'draco3d.decoder': await draco3d.createDecoderModule(),
    })
  await io.write(output, doc)
  const stat = await fs.stat(output)
  console.log(`✓ wrote ${path.relative(process.cwd(), output)} (${(stat.size / 1024).toFixed(1)} KB)`)

  // Sidecar metadata so the frontend can sample the same heightmap
  // and snap OSM features (roads/buildings/trees) onto the LiDAR terrain
  // exactly. We base64-encode the Float32 heights for compact transport.
  const metaPath = output.replace(/\.glb$/i, '') + '.json'
  const heightsBase64 = Buffer.from(heights.buffer, heights.byteOffset, heights.byteLength).toString('base64')
  const meta = {
    version: 1,
    bbox,
    grid,
    zMin,
    zMax,
    scale,
    exaggeration,
    widthWorld,
    depthWorld,
    heightsBase64,
  }
  await fs.writeFile(metaPath, JSON.stringify(meta))
  const metaStat = await fs.stat(metaPath)
  console.log(`✓ wrote ${path.relative(process.cwd(), metaPath)} (${(metaStat.size / 1024).toFixed(1)} KB)`)
}

main().catch((err) => {
  console.error('✗ build-base-mesh failed:', err)
  process.exit(1)
})
