import * as THREE from 'three'

export const PAPER_WHITE = '#ffffff'

export function createPaperCraftMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: PAPER_WHITE,
    roughness: 1,
    metalness: 0,
    flatShading: false,
  })
}
