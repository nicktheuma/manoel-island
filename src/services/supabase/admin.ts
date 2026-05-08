import { getSupabase } from './client'
import type { AdminConfig } from '../../state/useUIStore'

const DEFAULT_ADMIN_CONFIG: AdminConfig = {
  terrainVisible: true,
  treesVisible: true,
  osmLayersEnabled: true,
  osmTerrainVisible: false,
  osmRoadsVisible: true,
  osmBuildingsVisible: true,
  osmVegetationVisible: true,
  osmSeaVisible: true,
  osmSeaColor: '#bcd9ec',
  customMeshEnabled: true,
  customMeshUrl: '/models/manoel-island.glb',
  customMeshColor: '#f5f5f4',
  customMeshRoughness: 1,
  customMeshMetalness: 0,
  customMeshScale: 1,
  customMeshYOffset: 0,
  customMeshFlipNormals: false,
}

function coerceAdminConfig(input: unknown): AdminConfig {
  const v = (input ?? {}) as Partial<AdminConfig>
  return {
    terrainVisible: typeof v.terrainVisible === 'boolean' ? v.terrainVisible : DEFAULT_ADMIN_CONFIG.terrainVisible,
    treesVisible: typeof v.treesVisible === 'boolean' ? v.treesVisible : DEFAULT_ADMIN_CONFIG.treesVisible,
    osmLayersEnabled: typeof v.osmLayersEnabled === 'boolean' ? v.osmLayersEnabled : DEFAULT_ADMIN_CONFIG.osmLayersEnabled,
    osmTerrainVisible:
      typeof v.osmTerrainVisible === 'boolean' ? v.osmTerrainVisible : DEFAULT_ADMIN_CONFIG.osmTerrainVisible,
    osmRoadsVisible: typeof v.osmRoadsVisible === 'boolean' ? v.osmRoadsVisible : DEFAULT_ADMIN_CONFIG.osmRoadsVisible,
    osmBuildingsVisible:
      typeof v.osmBuildingsVisible === 'boolean' ? v.osmBuildingsVisible : DEFAULT_ADMIN_CONFIG.osmBuildingsVisible,
    osmVegetationVisible:
      typeof v.osmVegetationVisible === 'boolean'
        ? v.osmVegetationVisible
        : DEFAULT_ADMIN_CONFIG.osmVegetationVisible,
    osmSeaVisible: typeof v.osmSeaVisible === 'boolean' ? v.osmSeaVisible : DEFAULT_ADMIN_CONFIG.osmSeaVisible,
    osmSeaColor: typeof v.osmSeaColor === 'string' ? v.osmSeaColor : DEFAULT_ADMIN_CONFIG.osmSeaColor,
    customMeshEnabled:
      typeof v.customMeshEnabled === 'boolean' ? v.customMeshEnabled : DEFAULT_ADMIN_CONFIG.customMeshEnabled,
    customMeshUrl: typeof v.customMeshUrl === 'string' ? v.customMeshUrl : DEFAULT_ADMIN_CONFIG.customMeshUrl,
    customMeshColor: typeof v.customMeshColor === 'string' ? v.customMeshColor : DEFAULT_ADMIN_CONFIG.customMeshColor,
    customMeshRoughness:
      typeof v.customMeshRoughness === 'number' ? v.customMeshRoughness : DEFAULT_ADMIN_CONFIG.customMeshRoughness,
    customMeshMetalness:
      typeof v.customMeshMetalness === 'number' ? v.customMeshMetalness : DEFAULT_ADMIN_CONFIG.customMeshMetalness,
    customMeshScale: typeof v.customMeshScale === 'number' ? v.customMeshScale : DEFAULT_ADMIN_CONFIG.customMeshScale,
    customMeshYOffset:
      typeof v.customMeshYOffset === 'number' ? v.customMeshYOffset : DEFAULT_ADMIN_CONFIG.customMeshYOffset,
    customMeshFlipNormals:
      typeof v.customMeshFlipNormals === 'boolean'
        ? v.customMeshFlipNormals
        : DEFAULT_ADMIN_CONFIG.customMeshFlipNormals,
  }
}

export async function getWorldAdminAccess(worldId: string): Promise<boolean> {
  const supabase = getSupabase()
  if (!supabase) return true
  const authRes = await supabase.auth.getUser()
  const uid = authRes.data.user?.id
  if (!uid) return false

  const worldRes = await supabase.from('worlds').select('owner_id').eq('id', worldId).maybeSingle()
  if (worldRes.error) throw worldRes.error
  if (worldRes.data?.owner_id === uid) return true

  const memberRes = await supabase
    .from('world_members')
    .select('role')
    .eq('world_id', worldId)
    .eq('user_id', uid)
    .maybeSingle()
  if (memberRes.error) throw memberRes.error
  const role = memberRes.data?.role
  return role === 'owner' || role === 'editor'
}

export async function loadWorldAdminConfig(worldId: string): Promise<AdminConfig> {
  const supabase = getSupabase()
  if (!supabase) return DEFAULT_ADMIN_CONFIG
  const res = await supabase.from('world_admin_configs').select('config').eq('world_id', worldId).maybeSingle()
  if (res.error) throw res.error
  return coerceAdminConfig(res.data?.config)
}

export async function saveWorldAdminConfig(worldId: string, config: AdminConfig): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  const authRes = await supabase.auth.getUser()
  const uid = authRes.data.user?.id ?? null
  const res = await supabase.from('world_admin_configs').upsert(
    {
      world_id: worldId,
      config,
      updated_by: uid,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'world_id' },
  )
  if (res.error) throw res.error
}

