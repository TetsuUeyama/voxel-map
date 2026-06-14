/**
 * City Terrain — voxelized NEW+CITY.1blend.blend ("CLUB TROPIX" beach resort city).
 * Loads the base city (without toggleable buildings), then each toggleable
 * building as its own separate merged mesh so the UI can show/hide individuals.
 * Also overlays the cafe on the AB17 south lot.
 *
 * Per-building voxels share the global city bbox, so each building lands in the
 * right world position automatically.
 */

import {
  Scene, Mesh, MeshBuilder, StandardMaterial,
  DynamicTexture, Color3, Vector3, Matrix,
} from '@babylonjs/core';
import { loadChunkedVoxelModel, type ModelProgress } from '@/GamePlay/FightGame/Stage/VoxelModelLoader';
import { STAGE_CONFIG } from '@/GamePlay/FightGame/Config/FighterConfig';

export interface CityBuildingEntry {
  id: string;
  name_ja: string;
  name_en: string;
  category: string;
  mesh: Mesh;
  /** Initial visibility — false for ab17_south and the cafe overlay's covered building. */
  defaultEnabled: boolean;
}

export interface CityTerrainResult {
  meshes: Mesh[];
  buildings: CityBuildingEntry[];
}

interface BuildingManifestEntry {
  id: string;
  name_ja: string;
  name_en: string;
  category: string;
  meta_path: string;
  voxel_count: number;
}

interface BuildingsManifest {
  voxel_size: number;
  total_grid: [number, number, number];
  buildings: BuildingManifestEntry[];
}

interface PrototypeInstance {
  name: string;
  offset: [number, number, number]; // viewer-space (ΔX, ΔY, ΔZ) relative to canonical
}

interface PrototypeManifestEntry {
  id: string;
  name_ja: string;
  name_en: string;
  category: string;
  meta_path: string;
  instance_count: number;
  instances: PrototypeInstance[];
}

interface PrototypesManifest {
  voxel_size: number;
  total_grid: [number, number, number];
  prototypes: PrototypeManifestEntry[];
}

const CITY_BASE_URL = '/api/game-assets/field/city';
const BUILDINGS_MANIFEST_URL = `${CITY_BASE_URL}/buildings_manifest.json`;
const PROTOTYPES_MANIFEST_URL = `${CITY_BASE_URL}/prototypes_manifest.json`;

// Buildings that should be hidden by default.
const DEFAULT_DISABLED = new Set<string>();

export async function buildCityTerrain(
  scene: Scene,
  onProgress?: (p: ModelProgress) => void,
): Promise<CityTerrainResult> {
  // 1. Base city (largest model) — show its progress to the user.
  const cityMeshes = await loadChunkedVoxelModel(scene, {
    baseUrl: CITY_BASE_URL,
    metaName: 'city_meta.json',
    materialName: 'cityShared',
    logTag: 'city',
  }, onProgress);

  // 2. Building manifest + each building (silent, fast).
  const buildingsManifest = await fetchJson<BuildingsManifest>(BUILDINGS_MANIFEST_URL);
  const buildings: CityBuildingEntry[] = [];
  const buildingMeshes: Mesh[] = [];
  for (const entry of buildingsManifest.buildings) {
    const dirSegments = entry.meta_path.split('/').slice(0, -1).join('/');
    const metaName = entry.meta_path.split('/').pop()!;
    const meshes = await loadChunkedVoxelModel(scene, {
      baseUrl: `${CITY_BASE_URL}/${dirSegments}`,
      metaName,
      materialName: `cityBuilding_${entry.id}`,
      logTag: `city:${entry.id}`,
    });
    const m = meshes[0];
    if (!m) {
      console.warn(`[city] building ${entry.id} produced no mesh`);
      continue;
    }
    m.name = `cityBuilding_${entry.id}`;
    const enabled = !DEFAULT_DISABLED.has(entry.id);
    m.setEnabled(enabled);
    buildings.push({
      id: entry.id,
      name_ja: entry.name_ja,
      name_en: entry.name_en,
      category: entry.category,
      mesh: m,
      defaultEnabled: enabled,
    });
    buildingMeshes.push(m);
  }

  // 3. Prototype manifest + each prototype with thin instances.
  // Each prototype is voxelized once at its canonical Blender position; siblings
  // are GPU-instanced via thinInstanceSetBuffer at viewer-space offsets.
  const protoManifest = await fetchJson<PrototypesManifest>(PROTOTYPES_MANIFEST_URL);
  const protoMeshes: Mesh[] = [];
  for (const entry of protoManifest.prototypes) {
    if (entry.instance_count === 0) continue;
    const dirSegments = entry.meta_path.split('/').slice(0, -1).join('/');
    const metaName = entry.meta_path.split('/').pop()!;
    const meshes = await loadChunkedVoxelModel(scene, {
      baseUrl: `${CITY_BASE_URL}/${dirSegments}`,
      metaName,
      materialName: `cityProto_${entry.id}`,
      logTag: `city:proto:${entry.id}`,
    });
    const m = meshes[0];
    if (!m) {
      console.warn(`[city] prototype ${entry.id} produced no mesh`);
      continue;
    }
    m.name = `cityProto_${entry.id}`;
    // Build matrix buffer: one matrix per instance (including canonical at identity).
    const buffer = new Float32Array(entry.instances.length * 16);
    for (let i = 0; i < entry.instances.length; i++) {
      const [dx, dy, dz] = entry.instances[i].offset;
      Matrix.Translation(dx, dy, dz).copyToArray(buffer, i * 16);
    }
    m.thinInstanceSetBuffer('matrix', buffer, 16, false);
    buildings.push({
      id: entry.id,
      name_ja: entry.name_ja,
      name_en: entry.name_en,
      category: entry.category,
      mesh: m,
      defaultEnabled: true,
    });
    protoMeshes.push(m);
    console.log(`[city:proto:${entry.id}] ${entry.instance_count} thin instances applied`);
  }

  const compass = createCompassLabels(scene);

  return {
    meshes: [...cityMeshes, ...buildingMeshes, ...protoMeshes, ...compass],
    buildings,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(`${url}?v=${Date.now()}`);
  if (!resp.ok) throw new Error(`Failed to load ${url}: ${resp.status}`);
  return await resp.json();
}

function createCompassLabels(scene: Scene): Mesh[] {
  // City bbox is ~25×33×6m centered at origin. Place labels just outside.
  const RADIUS = 22;
  const TEXT_SIZE = 4;
  const Y = STAGE_CONFIG.groundY + 3;

  const labels: Array<{ text: string; pos: Vector3; color: string }> = [
    { text: 'N', pos: new Vector3(0, Y, +RADIUS), color: '#ff4444' },
    { text: 'S', pos: new Vector3(0, Y, -RADIUS), color: '#ffffff' },
    { text: 'E', pos: new Vector3(+RADIUS, Y, 0), color: '#ffffff' },
    { text: 'W', pos: new Vector3(-RADIUS, Y, 0), color: '#ffffff' },
  ];

  return labels.map(({ text, pos, color }) => buildLabelMesh(scene, text, pos, TEXT_SIZE, color));
}

function buildLabelMesh(
  scene: Scene,
  text: string,
  position: Vector3,
  size: number,
  color: string,
): Mesh {
  const tex = new DynamicTexture(`compassTex_${text}`, { width: 256, height: 256 }, scene, true);
  tex.hasAlpha = true;
  const font = 'bold 200px sans-serif';
  // Use drawText: centers approximately via x/y; backed by black border + colored fill
  tex.drawText(text, null, null, font, '#000000', 'transparent', true, false);
  tex.drawText(text, null, null, font, color, 'transparent', true, true);

  const plane = MeshBuilder.CreatePlane(`compass_${text}`, { width: size, height: size }, scene);
  const mat = new StandardMaterial(`compassMat_${text}`, scene);
  mat.diffuseTexture = tex;
  mat.opacityTexture = tex;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  plane.material = mat;
  plane.position = position;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.isPickable = false;
  plane.alwaysSelectAsActiveMesh = true;
  return plane;
}
