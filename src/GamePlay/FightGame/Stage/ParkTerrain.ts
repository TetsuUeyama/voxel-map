/**
 * Park Terrain
 *
 * Loads park assets from game-assets/field/park/.
 * Park is FLAT (field tiles are 2 voxels high) so no elevation —
 * just two field tiles (grass + water) and a hand-placed object set.
 */

import { Scene, Mesh } from '@babylonjs/core';
import { loadVoxFile } from '@/lib/vox-parser';
import { buildVoxelObjectMesh } from '@/GamePlay/FightGame/Stage/TerrainBuilder';
import { STAGE_CONFIG } from '@/GamePlay/FightGame/Config/FighterConfig';

export interface ParkTerrainOptions {
  /** Viewer-units per voxel for field tiles. Default 0.2 → grass ≈ 16×13 viewer. */
  fieldScale?: number;
  /** Viewer-units per voxel for objects. Default 0.05. */
  objectScale?: number;
}

interface ParkPlacement {
  voxFile: string;
  x: number;
  z: number;
  rotationY?: number;
  scale?: number;
}

const PARK_BASE_URL = '/api/game-assets/field/park';

const FIELD_PLACEMENTS: ParkPlacement[] = [
  { voxFile: 'field_grass_001.vox', x: 4, z: 0 },
  { voxFile: 'field_water_002.vox', x: -12, z: 0 },
];

const OBJECT_PLACEMENTS: ParkPlacement[] = [
  { voxFile: 'obj_bench_011.vox', x: 8, z: 5, rotationY: Math.PI },
  { voxFile: 'obj_bench_011.vox', x: 0, z: 5 },
  { voxFile: 'obj_picnic_table_010.vox', x: 4, z: -4 },
  { voxFile: 'obj_tennis_table_007.vox', x: 9, z: 0 },
  { voxFile: 'obj_basketball_red_001.vox', x: 1, z: 1 },
  { voxFile: 'obj_swings1_008.vox', x: 11, z: 6 },
  { voxFile: 'obj_swings02_009.vox', x: 11, z: -6 },
  { voxFile: 'obj_sand_004.vox', x: -2, z: -4 },
  { voxFile: 'obj_bridge_006.vox', x: -4, z: 0, rotationY: Math.PI / 2 },
  { voxFile: 'obj_line_003.vox', x: 6, z: 6 },
  { voxFile: 'park_tree.vox', x: 12, z: 6 },
  { voxFile: 'park_tree.vox', x: 12, z: -6 },
  { voxFile: 'park_tree.vox', x: -2, z: 6 },
  { voxFile: 'park_tree.vox', x: -4, z: -6 },
];

async function placeOne(
  scene: Scene,
  p: ParkPlacement,
  defaultScale: number,
  baseY: number,
  meshNamePrefix: string,
): Promise<Mesh> {
  const { voxels, model } = await loadVoxFile(`${PARK_BASE_URL}/${p.voxFile}`);
  const scale = p.scale ?? defaultScale;
  const mesh = buildVoxelObjectMesh(
    voxels, scene, `${meshNamePrefix}_${p.voxFile}_${p.x}_${p.z}`, scale,
  );
  // Center the mesh on (x, z): local extent is X[0, sizeX*scale], Z[-sizeY*scale, 0]
  const halfX = (model.sizeX * scale) / 2;
  const halfZ = (model.sizeY * scale) / 2;
  mesh.position.set(p.x - halfX, baseY, p.z + halfZ);
  if (p.rotationY) mesh.rotation.y = p.rotationY;
  return mesh;
}

export async function buildParkTerrain(
  scene: Scene,
  options: ParkTerrainOptions = {},
): Promise<Mesh[]> {
  const fieldScale = options.fieldScale ?? 0.2;
  const objectScale = options.objectScale ?? 0.05;
  const meshes: Mesh[] = [];

  for (const p of FIELD_PLACEMENTS) {
    meshes.push(await placeOne(scene, p, fieldScale, STAGE_CONFIG.groundY, 'park_field'));
  }

  // Objects sit on top of the field (field is 2 voxels tall × fieldScale)
  const fieldTopY = STAGE_CONFIG.groundY + 2 * fieldScale;
  for (const p of OBJECT_PLACEMENTS) {
    meshes.push(await placeOne(scene, p, objectScale, fieldTopY, 'park_obj'));
  }

  return meshes;
}
