/**
 * Village Terrain
 *
 * Loads pre-built voxel village tiles from game-assets/field/village/.
 * Each tile (201×201×143 voxels) already contains terrain elevation,
 * so no procedural heightmap is needed — we just load and place.
 */

import { Scene, Mesh } from '@babylonjs/core';
import { loadVoxFile } from '@/lib/vox-parser';
import { buildVoxelObjectMesh } from '@/GamePlay/FightGame/Stage/TerrainBuilder';
import { STAGE_CONFIG } from '@/GamePlay/FightGame/Config/FighterConfig';

export interface VillageTileMeta {
  id: string;
  gridX: number;
  gridZ: number;
  objBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  voxelSize: number;
  expectedGrid: { x: number; y: number };
  gamePosition: { x: number; z: number };
  terrainScale: number;
}

export interface VillageLayout {
  tileGrid: number;        // e.g. 4 (4×4 tiles)
  tileResolution: number;  // e.g. 200 (voxels per tile edge)
  fieldBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  tiles: VillageTileMeta[];
}

export interface VillageTerrainOptions {
  /** Limit number of tiles loaded (for performance testing). Omit for all. */
  maxTiles?: number;
  /** Viewer-units per voxel. Default 0.05 (4×4 tile grid → 40 viewer units). */
  voxelScale?: number;
}

const VILLAGE_LAYOUT_URL = '/api/game-assets/field/village/layout.json';
const VILLAGE_TILE_URL = (id: string) =>
  `/api/game-assets/field/village/tiles/${id}.vox`;

/**
 * Build village terrain meshes and add them to the scene.
 * Returns the created meshes.
 */
export async function buildVillageTerrain(
  scene: Scene,
  options: VillageTerrainOptions = {},
): Promise<Mesh[]> {
  const resp = await fetch(`${VILLAGE_LAYOUT_URL}?v=${Date.now()}`);
  if (!resp.ok) throw new Error(`Failed to load village layout: ${resp.status}`);
  const layout: VillageLayout = await resp.json();

  const scale = options.voxelScale ?? 0.05;
  const tilesToLoad = options.maxTiles
    ? layout.tiles.slice(0, options.maxTiles)
    : layout.tiles;

  // tile occupies (tileResolution × scale) viewer units per axis
  const tileSize = layout.tileResolution * scale;
  const fieldSize = layout.tileGrid * tileSize;
  const fieldMin = -fieldSize / 2;

  const meshes: Mesh[] = [];
  for (const tile of tilesToLoad) {
    const { voxels } = await loadVoxFile(VILLAGE_TILE_URL(tile.id));

    // buildVoxelObjectMesh emits local coords:
    //   X = voxel.x  * scale         range [0, tileSize]
    //   Y = voxel.z  * scale         range [0, heightVoxels * scale]
    //   Z = -voxel.y * scale         range [-tileSize, 0]
    const mesh = buildVoxelObjectMesh(voxels, scene, `village_${tile.id}`, scale);

    // Position so tile occupies viewer X,Z range
    //   X: [fieldMin + gridX*tileSize, fieldMin + (gridX+1)*tileSize]
    //   Z: [fieldMin + gridZ*tileSize, fieldMin + (gridZ+1)*tileSize]
    const tileMinX = fieldMin + tile.gridX * tileSize;
    const tileMaxZ = fieldMin + (tile.gridZ + 1) * tileSize;
    mesh.position.set(tileMinX, STAGE_CONFIG.groundY, tileMaxZ);
    meshes.push(mesh);
  }

  return meshes;
}
