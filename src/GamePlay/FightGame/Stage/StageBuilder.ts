/**
 * Stage builder for the fighting game open field.
 * Combines voxel objects (trees, rocks, flowers, grass) with
 * a ground plane, zone markers, and natural lighting.
 */

import {
  Scene, MeshBuilder, StandardMaterial, Color3, Vector3,
  PointLight, GlowLayer, Mesh,
} from '@babylonjs/core';
import { STAGE_CONFIG } from '@/GamePlay/FightGame/Config/FighterConfig';
import { buildVoxelTerrain } from '@/GamePlay/FightGame/Stage/TerrainBuilder';
import type { FieldLayout } from '@/GamePlay/FightGame/Stage/TerrainObjectRegistry';

export interface StageElements {
  meshes: Mesh[];
  lights: PointLight[];
  glowLayer: GlowLayer;
}

/**
 * Build the open field stage with voxel objects.
 * Optionally accepts a FieldLayout for custom object placement.
 * Call once after scene creation.
 */
export async function buildStage(scene: Scene, layout?: FieldLayout): Promise<StageElements> {
  const fhx = STAGE_CONFIG.fieldHalfX;
  const fhz = STAGE_CONFIG.fieldHalfZ;
  const zone = STAGE_CONFIG.activeZone;
  const meshes: Mesh[] = [];
  const lights: PointLight[] = [];

  // === GROUND PLANE (grass-colored) ===
  const ground = MeshBuilder.CreateGround('ground', {
    width: fhx * 2 + 4,
    height: fhz * 2 + 4,
    subdivisions: 1,
  }, scene);
  ground.position.y = STAGE_CONFIG.groundY;
  const gMat = new StandardMaterial('gMat', scene);
  gMat.diffuseColor = new Color3(0.25, 0.55, 0.20);
  gMat.specularColor = new Color3(0.05, 0.05, 0.05);
  ground.material = gMat;
  ground.isPickable = false;
  meshes.push(ground);

  // === VOXEL OBJECTS (trees, rocks, flowers, grass) ===
  const voxelObjects = await buildVoxelTerrain(scene, layout);
  meshes.push(...voxelObjects);

  // === ACTIVE ZONE BORDER ===
  const zoneBorderThickness = 0.06;
  const zoneBorderHeight = 0.015;
  const zoneMat = new StandardMaterial('zoneMat', scene);
  zoneMat.diffuseColor = new Color3(0.5, 0.18, 0.18);
  zoneMat.emissiveColor = new Color3(0.35, 0.08, 0.08);

  const zoneEdges = [
    { w: zone.halfX * 2 + zoneBorderThickness, d: zoneBorderThickness, x: 0, z: zone.halfZ },
    { w: zone.halfX * 2 + zoneBorderThickness, d: zoneBorderThickness, x: 0, z: -zone.halfZ },
    { w: zoneBorderThickness, d: zone.halfZ * 2, x: zone.halfX, z: 0 },
    { w: zoneBorderThickness, d: zone.halfZ * 2, x: -zone.halfX, z: 0 },
  ];
  zoneEdges.forEach((e, i) => {
    const edge = MeshBuilder.CreateBox(`zoneBorder_${i}`, {
      width: e.w, height: zoneBorderHeight, depth: e.d,
    }, scene);
    edge.position.set(e.x, STAGE_CONFIG.groundY + zoneBorderHeight / 2 + 0.005, e.z);
    edge.material = zoneMat;
    edge.isPickable = false;
    meshes.push(edge);
  });

  // === ARENA FLOOR (covers the full active zone) ===
  const arenaFloor = MeshBuilder.CreateGround('arenaFloor', {
    width: zone.halfX * 2,
    height: zone.halfZ * 2,
    subdivisions: 1,
  }, scene);
  arenaFloor.position.y = STAGE_CONFIG.groundY + 0.005;
  const arenaMat = new StandardMaterial('arenaMat', scene);
  arenaMat.diffuseColor = new Color3(0.55, 0.45, 0.30);
  arenaMat.specularColor = new Color3(0.05, 0.05, 0.05);
  arenaFloor.material = arenaMat;
  arenaFloor.isPickable = false;
  meshes.push(arenaFloor);

  // === LIGHTING (natural outdoor) ===
  const sunLight = new PointLight('sun', new Vector3(10, 20, 5), scene);
  sunLight.diffuse = new Color3(1.0, 0.95, 0.85);
  sunLight.intensity = 1.5;
  sunLight.range = 80;
  lights.push(sunLight);

  const fillLight = new PointLight('fill', new Vector3(-10, 12, -8), scene);
  fillLight.diffuse = new Color3(0.5, 0.6, 0.9);
  fillLight.intensity = 0.5;
  fillLight.range = 60;
  lights.push(fillLight);

  // === GLOW LAYER ===
  const glowLayer = new GlowLayer('glow', scene, {
    mainTextureFixedSize: 256,
    blurKernelSize: 32,
  });
  glowLayer.intensity = 0.3;

  return { meshes, lights, glowLayer };
}
