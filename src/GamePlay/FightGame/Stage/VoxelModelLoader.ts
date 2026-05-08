/**
 * Generic chunked voxel model loader.
 *
 * Loads a model split into multiple .vox chunks (each ≤ 256 per axis) using
 * a master meta.json describing offsets, then merges into a single mesh.
 *
 * Convention: 1 viewer unit = 1 meter, scale = meta.voxel_size.
 */

import { Scene, Mesh } from '@babylonjs/core';
import { loadVoxFile } from '@/lib/vox-parser';
import { buildVoxelObjectMesh } from '@/GamePlay/FightGame/Stage/TerrainBuilder';
import { createUnlitMaterial } from '@/lib/voxel-skeleton';
import { STAGE_CONFIG } from '@/GamePlay/FightGame/Config/FighterConfig';

export interface ModelChunk {
  file: string;
  offset: [number, number, number];
  grid: [number, number, number];
  voxel_count: number;
}

export interface ModelMeta {
  name: string;
  voxel_size: number;
  total_grid: [number, number, number];
  total_voxel_count: number;
  bounds_meters: [number, number, number];
  chunks: ModelChunk[];
}

export interface ModelProgress {
  stage: 'meta' | 'download' | 'mesh' | 'merge' | 'done';
  done: number;
  total: number;
}

export interface LoadVoxelModelOptions {
  baseUrl: string;        // e.g. '/api/game-assets/field/warehouse'
  metaName: string;       // e.g. 'warehouse6_meta.json'
  materialName: string;   // unique material name (e.g. 'warehouseShared')
  logTag?: string;        // prefix for console logs (e.g. 'warehouse')
}

export async function loadChunkedVoxelModel(
  scene: Scene,
  options: LoadVoxelModelOptions,
  onProgress?: (p: ModelProgress) => void,
): Promise<Mesh[]> {
  const tag = options.logTag ?? 'model';
  const metaUrl = `${options.baseUrl}/${options.metaName}`;

  onProgress?.({ stage: 'meta', done: 0, total: 1 });
  // Cache-bust: API returns Cache-Control: max-age=3600
  const metaResp = await fetch(`${metaUrl}?v=${Date.now()}`);
  if (!metaResp.ok) throw new Error(`Failed to load meta: ${metaResp.status}`);
  const meta: ModelMeta = await metaResp.json();
  console.log(`[${tag}] meta: ${meta.chunks.length} chunks, ${meta.total_voxel_count.toLocaleString()} voxels, voxelSize ${meta.voxel_size}m, totalGrid ${meta.total_grid.join('×')}`);

  const s = meta.voxel_size;
  const [totGX, totGY] = meta.total_grid;
  const cx = (totGX * s) / 2;
  const cz = (totGY * s) / 2;

  // Parallel download
  const total = meta.chunks.length;
  let downloaded = 0;
  onProgress?.({ stage: 'download', done: 0, total });

  const t0 = performance.now();
  const voxDataPromises = meta.chunks.map(async (chunk) => {
    const data = await loadVoxFile(`${options.baseUrl}/${chunk.file}`);
    downloaded++;
    onProgress?.({ stage: 'download', done: downloaded, total });
    console.log(`[${tag}] downloaded ${chunk.file} (${downloaded}/${total}, ${data.voxels.length.toLocaleString()} voxels)`);
    return { chunk, voxels: data.voxels };
  });
  const loaded = await Promise.all(voxDataPromises);
  console.log(`[${tag}] all downloads done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  // Shared material so all chunks merge cleanly
  const sharedMat = createUnlitMaterial(scene, options.materialName);

  // Sequential mesh construction (yields to event loop between chunks
  // so UI / progress HUD updates while long greedy-mesh builds run)
  const partialMeshes: Mesh[] = [];
  let totalVerts = 0;
  let totalTris = 0;
  for (let i = 0; i < loaded.length; i++) {
    if (i > 0) await new Promise<void>((r) => setTimeout(r, 0));
    onProgress?.({ stage: 'mesh', done: i, total });
    const { chunk, voxels } = loaded[i];
    const tBuild = performance.now();
    const mesh = buildVoxelObjectMesh(voxels, scene, `${tag}_${chunk.file}`, s);
    mesh.material?.dispose();
    mesh.material = sharedMat;
    const [oX, oY, oZ] = chunk.offset;
    mesh.position.set(
      oX * s - cx,
      STAGE_CONFIG.groundY + oZ * s,
      -oY * s + cz,
    );
    mesh.bakeCurrentTransformIntoVertices();
    partialMeshes.push(mesh);
    const v = mesh.getTotalVertices();
    const t = mesh.getTotalIndices() / 3;
    totalVerts += v;
    totalTris += t;
    console.log(
      `[${tag}] built mesh ${i + 1}/${total} (${chunk.file}) in ${(performance.now() - tBuild).toFixed(0)}ms ` +
      `voxels=${voxels.length.toLocaleString()} → tris=${t.toLocaleString()} verts=${v.toLocaleString()}`
    );
  }
  console.log(`[${tag}] all chunks built: total verts=${totalVerts.toLocaleString()}, tris=${totalTris.toLocaleString()}`);

  // Merge into single mesh
  onProgress?.({ stage: 'merge', done: 0, total: 1 });
  const tMerge = performance.now();
  const merged = Mesh.MergeMeshes(partialMeshes, true, true);
  console.log(`[${tag}] merge done in ${(performance.now() - tMerge).toFixed(0)}ms`);

  onProgress?.({ stage: 'done', done: total, total });

  if (merged) {
    merged.name = `${tag}_merged`;
    merged.material = sharedMat;
    merged.isPickable = false;
    merged.alwaysSelectAsActiveMesh = true;
    const bbox = merged.getBoundingInfo().boundingBox;
    console.log(
      `[${tag}] merged mesh: verts=${merged.getTotalVertices().toLocaleString()} ` +
      `tris=${(merged.getTotalIndices() / 3).toLocaleString()} ` +
      `bbox=[${bbox.minimumWorld.x.toFixed(1)},${bbox.minimumWorld.y.toFixed(1)},${bbox.minimumWorld.z.toFixed(1)}] → ` +
      `[${bbox.maximumWorld.x.toFixed(1)},${bbox.maximumWorld.y.toFixed(1)},${bbox.maximumWorld.z.toFixed(1)}]`
    );
    return [merged];
  }
  console.warn(`[${tag}] MergeMeshes returned null; using individual chunks`);
  return partialMeshes;
}
