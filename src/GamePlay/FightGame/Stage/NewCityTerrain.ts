/**
 * NewCity Terrain — SimplePoly City (3ds Max voxelized).
 * Pure prototype-based: 111 prototypes voxelized once, 1382 placements via
 * Babylon thin instances. No "base" voxel layer.
 */

import { Scene, Mesh, Matrix } from '@babylonjs/core';
import { loadChunkedVoxelModel, type ModelProgress } from '@/GamePlay/FightGame/Stage/VoxelModelLoader';
import { createUnlitMaterial } from '@/lib/voxel-skeleton';
import type { CityBuildingEntry } from '@/GamePlay/FightGame/Stage/CityTerrain';

interface PrototypeInstance {
  name: string;
  offset: [number, number, number];
}

interface PrototypeManifestEntry {
  id: string;
  category: string;
  meta_path: string;
  instance_count: number;
  voxel_count: number;
  instances: PrototypeInstance[];
}

interface PrototypesManifest {
  voxel_size: number;
  raw_to_meters: number;
  total_grid: [number, number, number];
  bounds_meters: [number, number, number];
  prototypes: PrototypeManifestEntry[];
}

const BASE_URL = '/api/game-assets/field/newcity';
const MANIFEST_URL = `${BASE_URL}/prototypes_manifest.json`;

export interface NewCityResult {
  meshes: Mesh[];
  buildings: CityBuildingEntry[]; // reuse panel — one entry per prototype
}

export async function buildNewCityTerrain(
  scene: Scene,
  onProgress?: (p: ModelProgress) => void,
): Promise<NewCityResult> {
  onProgress?.({ stage: 'meta', done: 0, total: 1 });
  const resp = await fetch(`${MANIFEST_URL}?v=${Date.now()}`);
  if (!resp.ok) throw new Error(`Failed to load newcity manifest: ${resp.status}`);
  const manifest: PrototypesManifest = await resp.json();
  console.log(
    `[newcity] manifest: ${manifest.prototypes.length} prototypes, ` +
    `bbox ${manifest.bounds_meters.join(' × ')} m`
  );

  // One shared unlit material across all 111 prototypes — they all read the
  // baked vertex color, so the shader is the same. Saves 110 redundant shader
  // material objects + state changes.
  const sharedMat = createUnlitMaterial(scene, 'newcityShared');

  const meshes: Mesh[] = [];
  const buildings: CityBuildingEntry[] = [];
  const total = manifest.prototypes.length;
  for (let i = 0; i < manifest.prototypes.length; i++) {
    const entry = manifest.prototypes[i];
    onProgress?.({ stage: 'mesh', done: i, total });

    const dirSegments = entry.meta_path.split('/').slice(0, -1).join('/');
    const metaName = entry.meta_path.split('/').pop()!;
    const protoMeshes = await loadChunkedVoxelModel(scene, {
      baseUrl: `${BASE_URL}/${dirSegments}`,
      metaName,
      materialName: `newcity_${entry.id}`,
      logTag: `newcity:${entry.id}`,
    });
    if (protoMeshes.length === 0) {
      console.warn(`[newcity] prototype ${entry.id} produced no mesh`);
      continue;
    }

    // Pre-compute thin instance matrix buffer for this prototype.
    // Identity is included for the canonical (offset [0,0,0] entry).
    const buffer = new Float32Array(entry.instances.length * 16);
    for (let j = 0; j < entry.instances.length; j++) {
      const [dx, dy, dz] = entry.instances[j].offset;
      Matrix.Translation(dx, dy, dz).copyToArray(buffer, j * 16);
    }

    // Apply thin instances to EACH returned mesh. Normally MergeMeshes
    // returns a single merged mesh, but for prototypes where merge fails
    // (e.g. 6-15 chunks for big buildings) loadChunkedVoxelModel returns
    // the unmerged chunk list. Each chunk needs its own thin-instance
    // buffer so the canonical AND every sibling render as a complete
    // canonical-shaped piece. Vertices in each chunk are already in
    // canonical-world coords (baked), so the same translation buffer
    // works for all.
    const primary = protoMeshes[0];
    for (let k = 0; k < protoMeshes.length; k++) {
      const m = protoMeshes[k];
      m.name = `newcity_${entry.id}_${k}`;
      const protoMat = m.material;
      m.material = sharedMat;
      if (protoMat && protoMat !== sharedMat) protoMat.dispose();
      m.thinInstanceSetBuffer('matrix', buffer, 16, true);
      m.alwaysSelectAsActiveMesh = true;
      // Parent additional pieces under the primary so setEnabled() on the
      // primary toggles the whole prototype group.
      if (k > 0) m.parent = primary;
      meshes.push(m);
    }
    buildings.push({
      id: entry.id,
      name_ja: `${entry.id} (×${entry.instance_count})`,
      name_en: `${entry.id} (×${entry.instance_count})`,
      category: entry.category,
      mesh: primary,
      defaultEnabled: true,
    });
    console.log(
      `[newcity:${entry.id}] ${entry.instance_count} instances × ${protoMeshes.length} ` +
      `mesh piece(s), canonical voxels=${entry.voxel_count.toLocaleString()}`
    );
  }
  onProgress?.({ stage: 'done', done: total, total });
  return { meshes, buildings };
}
