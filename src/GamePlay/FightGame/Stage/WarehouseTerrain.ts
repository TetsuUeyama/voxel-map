/**
 * Warehouse Terrain — voxelized warehouse6.blend.
 * Thin wrapper around the generic chunked voxel model loader.
 */

import { Scene, Mesh } from '@babylonjs/core';
import { loadChunkedVoxelModel, type ModelProgress } from '@/GamePlay/FightGame/Stage/VoxelModelLoader';

export type WarehouseProgress = ModelProgress;

export async function buildWarehouseTerrain(
  scene: Scene,
  onProgress?: (p: ModelProgress) => void,
): Promise<Mesh[]> {
  return loadChunkedVoxelModel(scene, {
    baseUrl: '/api/game-assets/field/warehouse',
    metaName: 'warehouse6_meta.json',
    materialName: 'warehouseShared',
    logTag: 'warehouse',
  }, onProgress);
}
