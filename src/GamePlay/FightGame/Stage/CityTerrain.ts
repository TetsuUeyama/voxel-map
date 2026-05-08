/**
 * City Terrain — voxelized NEW+CITY.1blend.blend ("CLUB TROPIX" beach resort city).
 * Thin wrapper around the generic chunked voxel model loader, plus N/S/E/W
 * compass labels in viewer space (+Z = North).
 */

import {
  Scene, Mesh, MeshBuilder, StandardMaterial,
  DynamicTexture, Color3, Vector3,
} from '@babylonjs/core';
import { loadChunkedVoxelModel, type ModelProgress } from '@/GamePlay/FightGame/Stage/VoxelModelLoader';
import { STAGE_CONFIG } from '@/GamePlay/FightGame/Config/FighterConfig';

export async function buildCityTerrain(
  scene: Scene,
  onProgress?: (p: ModelProgress) => void,
): Promise<Mesh[]> {
  const cityMeshes = await loadChunkedVoxelModel(scene, {
    baseUrl: '/api/game-assets/field/city',
    metaName: 'city_meta.json',
    materialName: 'cityShared',
    logTag: 'city',
  }, onProgress);

  const compass = createCompassLabels(scene);
  return [...cityMeshes, ...compass];
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
