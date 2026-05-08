/**
 * Cafe Terrain — voxelized Cafe.fbx (3ds Max source).
 * Thin wrapper around the generic chunked voxel model loader.
 */

import { Scene, Mesh } from '@babylonjs/core';
import { loadChunkedVoxelModel, type ModelProgress } from '@/GamePlay/FightGame/Stage/VoxelModelLoader';

export async function buildCafeTerrain(
  scene: Scene,
  onProgress?: (p: ModelProgress) => void,
): Promise<Mesh[]> {
  return loadChunkedVoxelModel(scene, {
    baseUrl: '/api/game-assets/field/cafe',
    metaName: 'cafe_meta.json',
    materialName: 'cafeShared',
    logTag: 'cafe',
  }, onProgress);
}
