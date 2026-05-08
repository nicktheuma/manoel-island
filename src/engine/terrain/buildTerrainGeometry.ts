import * as THREE from 'three'

export function buildTerrainGeometry(
  chunkSize: number,
  resolution: number,
  heights: Float32Array,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  const count = resolution * resolution
  const pos = new Float32Array(count * 3)
  const half = chunkSize / 2
  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const i = z * resolution + x
      pos[i * 3] = (x / (resolution - 1)) * chunkSize - half
      pos[i * 3 + 1] = heights[i] ?? 0
      pos[i * 3 + 2] = (z / (resolution - 1)) * chunkSize - half
    }
  }
  const indices: number[] = []
  for (let z = 0; z < resolution - 1; z++) {
    for (let x = 0; x < resolution - 1; x++) {
      const a = z * resolution + x
      const b = a + 1
      const c = a + resolution
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  geo.setIndex(indices)
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.computeVertexNormals()
  return geo
}
