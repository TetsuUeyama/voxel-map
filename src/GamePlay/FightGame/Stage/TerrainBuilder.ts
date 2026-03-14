/**
 * Terrain Builder
 *
 * Builds voxel objects on the field using the same rendering approach
 * as voxel characters (unlit shader + vertex colors + exposed-face culling).
 *
 * Object types are defined in TerrainObjectRegistry.
 * Placement is controlled by FieldLayout (manual placements + scatter rules).
 *
 * Built-in procedural generators (tree, rock, flower, grass) serve as
 * defaults until custom .vox models are created.
 */

import { Scene, Mesh, VertexData } from '@babylonjs/core';
import { FACE_DIRS, FACE_VERTS, FACE_NORMALS } from '@/lib/vox-parser';
import { createUnlitMaterial } from '@/lib/voxel-skeleton';
import type { VoxelEntry } from '@/lib/vox-parser';
import { STAGE_CONFIG } from '@/GamePlay/FightGame/Config/FighterConfig';
import {
  registerObject, getObjectDef, loadObjectVoxels,
  DEFAULT_TERRAIN_SCALE,
} from '@/GamePlay/FightGame/Stage/TerrainObjectRegistry';
import type {
  FieldLayout, ObjectPlacement, ScatterRule,
} from '@/GamePlay/FightGame/Stage/TerrainObjectRegistry';

// ── Deterministic hash ──────────────────────────────────────────────
function hash2d(x: number, z: number): number {
  let h = (x * 374761393 + z * 668265263 + 1013904223) | 0;
  h = ((h >> 13) ^ h) | 0;
  h = (h * 1274126177 + 1013904223) | 0;
  return ((h >> 16) & 0x7fff) / 0x7fff;
}

// ═══════════════════════════════════════════════════════════════════
// Built-in procedural generators
// ═══════════════════════════════════════════════════════════════════

function generateTree(seed: number): VoxelEntry[] {
  const voxels: VoxelEntry[] = [];
  const trunkH = 8 + Math.floor(hash2d(seed, seed * 3) * 6);
  for (let y = 0; y < trunkH; y++) {
    for (let tx = 0; tx < 2; tx++) {
      for (let tz = 0; tz < 2; tz++) {
        const shade = hash2d(seed + tx + y * 7, seed + tz) * 0.15;
        voxels.push({
          x: tx - 1, y: tz - 1, z: y,
          r: 0.35 + shade, g: 0.22 + shade * 0.5, b: 0.10 + shade * 0.3,
        });
      }
    }
  }
  const crx = 4 + Math.floor(hash2d(seed * 5, seed * 7) * 3);
  const cry = 3 + Math.floor(hash2d(seed * 11, seed * 13) * 2);
  const ccz = trunkH + cry - 1;
  for (let dx = -crx; dx <= crx; dx++) {
    for (let dz = -crx; dz <= crx; dz++) {
      for (let dy = -cry; dy <= cry; dy++) {
        const d = (dx / crx) ** 2 + (dz / crx) ** 2 + (dy / cry) ** 2;
        if (d > 1.0) continue;
        if (d > 0.7 && hash2d(seed + dx * 7 + dy, seed + dz * 11) < 0.3) continue;
        const s = hash2d(seed + dx * 3 + dy * 5, seed + dz * 7);
        voxels.push({
          x: dx, y: dz, z: ccz + dy,
          r: s < 0.3 ? 0.14 : s < 0.6 ? 0.18 : 0.22,
          g: s < 0.3 ? 0.48 : s < 0.6 ? 0.55 : 0.42,
          b: s < 0.3 ? 0.12 : s < 0.6 ? 0.16 : 0.10,
        });
      }
    }
  }
  return voxels;
}

function generateRock(seed: number): VoxelEntry[] {
  const voxels: VoxelEntry[] = [];
  const rw = 2 + Math.floor(hash2d(seed * 3, seed * 5) * 3);
  const rh = 2 + Math.floor(hash2d(seed * 7, seed * 11) * 3);
  const rd = 2 + Math.floor(hash2d(seed * 13, seed * 17) * 2);
  for (let x = -rw; x <= rw; x++) {
    for (let y = -rd; y <= rd; y++) {
      for (let z = 0; z <= rh; z++) {
        const t = 1 - z / (rh + 1) * 0.4;
        const d = (x / (rw * t)) ** 2 + (y / (rd * t)) ** 2 + (z / rh) ** 2;
        if (d > 1.1) continue;
        if (d > 0.8 && hash2d(seed + x * 13 + z, seed + y * 19) < 0.25) continue;
        const s = hash2d(seed + x + z * 3, seed + y * 5) * 0.15;
        voxels.push({ x, y, z, r: 0.42 + s, g: 0.42 + s, b: 0.40 + s });
      }
    }
  }
  return voxels;
}

function generateFlower(seed: number): VoxelEntry[] {
  const voxels: VoxelEntry[] = [];
  const stemH = 2 + Math.floor(hash2d(seed, seed * 2) * 3);
  for (let z = 0; z < stemH; z++) {
    voxels.push({ x: 0, y: 0, z, r: 0.18, g: 0.45, b: 0.12 });
  }
  const ci = Math.floor(hash2d(seed * 41, seed * 59) * 4);
  const fcs = [
    { r: 0.85, g: 0.20, b: 0.18 },
    { r: 0.90, g: 0.82, b: 0.20 },
    { r: 0.30, g: 0.35, b: 0.80 },
    { r: 0.90, g: 0.88, b: 0.85 },
  ];
  const fc = fcs[ci];
  voxels.push({ x: 0, y: 0, z: stemH, r: 0.90, g: 0.80, b: 0.20 });
  for (const [px, py] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
    if (hash2d(seed + px * 9, seed + py * 13) > 0.3) {
      voxels.push({ x: px, y: py, z: stemH, ...fc });
    }
  }
  voxels.push({ x: 0, y: 0, z: stemH + 1, ...fc });
  return voxels;
}

function generateGrass(seed: number): VoxelEntry[] {
  const voxels: VoxelEntry[] = [];
  const blades = 3 + Math.floor(hash2d(seed * 23, seed * 29) * 4);
  for (let i = 0; i < blades; i++) {
    const bx = Math.floor(hash2d(seed + i * 7, seed + i * 11) * 3) - 1;
    const by = Math.floor(hash2d(seed + i * 13, seed + i * 17) * 3) - 1;
    const bh = 2 + Math.floor(hash2d(seed + i * 19, seed + i * 23) * 3);
    for (let z = 0; z < bh; z++) {
      const s = hash2d(seed + i + z, seed) * 0.12;
      voxels.push({ x: bx, y: by, z, r: 0.20 + s, g: 0.50 + s, b: 0.15 + s * 0.5 });
    }
  }
  return voxels;
}

/** Map of built-in procedural generators */
const PROCEDURAL_GENERATORS = new Map<string, (seed: number) => VoxelEntry[]>([
  ['tree', generateTree],
  ['rock', generateRock],
  ['flower', generateFlower],
  ['grass', generateGrass],
]);

// ═══════════════════════════════════════════════════════════════════
// Default object registrations (procedural fallbacks)
// ═══════════════════════════════════════════════════════════════════

function registerDefaults(): void {
  // .vox file objects (from 3D models)
  registerObject({ id: 'tree_190', type: 'tree', source: { kind: 'vox', url: '/field/190.vox' } });

  // Procedural fallbacks
  registerObject({ id: 'tree_default', type: 'tree', source: { kind: 'procedural', generator: 'tree' } });
  registerObject({ id: 'rock_default', type: 'rock', source: { kind: 'procedural', generator: 'rock' } });
  registerObject({ id: 'flower_default', type: 'flower', source: { kind: 'procedural', generator: 'flower' } });
  registerObject({ id: 'grass_default', type: 'grass', source: { kind: 'procedural', generator: 'grass' } });
}

// ═══════════════════════════════════════════════════════════════════
// Default field layout
// ═══════════════════════════════════════════════════════════════════

function createDefaultLayout(): FieldLayout {
  const zone = STAGE_CONFIG.activeZone;
  return {
    placements: [
      // Test: place a .vox tree near the arena
      { objectId: 'tree_190', x: 10, z: 0 },
      { objectId: 'tree_190', x: -10, z: 5 },
      { objectId: 'tree_190', x: 8, z: -8 },
    ],
    scatterRules: [
      { objectId: 'tree_default',   density: 0.03, gridStep: 2, minDistFromCenter: zone.halfX + 3 },
      { objectId: 'rock_default',   density: 0.02, gridStep: 3, minDistFromCenter: zone.halfX + 2 },
      { objectId: 'flower_default', density: 0.015, gridStep: 1, minDistFromCenter: 0, seed: 2000 },
      { objectId: 'grass_default',  density: 0.04,  gridStep: 1, minDistFromCenter: 0, seed: 3000 },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════
// Voxel mesh builder (same technique as characters)
// ═══════════════════════════════════════════════════════════════════

export function buildVoxelObjectMesh(
  voxels: VoxelEntry[], scene: Scene, name: string, scale: number,
): Mesh {
  const occupied = new Set<string>();
  for (const v of voxels) occupied.add(`${v.x},${v.y},${v.z}`);

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const voxel of voxels) {
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = FACE_DIRS[f];
      if (occupied.has(`${voxel.x + dx},${voxel.y + dy},${voxel.z + dz}`)) continue;

      const bi = positions.length / 3;
      const fv = FACE_VERTS[f];
      const fn = FACE_NORMALS[f];
      for (let vi = 0; vi < 4; vi++) {
        positions.push(
          (voxel.x + fv[vi][0]) * scale,
          (voxel.z + fv[vi][2]) * scale,
          -(voxel.y + fv[vi][1]) * scale,
        );
        normals.push(fn[0], fn[2], -fn[1]);
        colors.push(voxel.r, voxel.g, voxel.b, 1);
      }
      indices.push(bi, bi + 1, bi + 2, bi, bi + 2, bi + 3);
    }
  }

  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.colors = colors;
  vd.indices = indices;
  vd.applyToMesh(mesh);
  mesh.material = createUnlitMaterial(scene, name + '_mat');
  mesh.isPickable = false;
  return mesh;
}

// ═══════════════════════════════════════════════════════════════════
// Scatter engine
// ═══════════════════════════════════════════════════════════════════

function generateScatterPlacements(rules: ScatterRule[]): ObjectPlacement[] {
  const fieldHalf = STAGE_CONFIG.fieldHalfX;
  const placements: ObjectPlacement[] = [];

  for (const rule of rules) {
    const seedOff = rule.seed ?? 0;
    for (let gx = -fieldHalf; gx < fieldHalf; gx += rule.gridStep) {
      for (let gz = -fieldHalf; gz < fieldHalf; gz += rule.gridStep) {
        // Distance check from center
        if (Math.abs(gx) < rule.minDistFromCenter && Math.abs(gz) < rule.minDistFromCenter) continue;

        const v = hash2d(Math.floor(gx * 10) + seedOff, Math.floor(gz * 10) + seedOff);
        if (v > rule.density) continue;

        placements.push({
          objectId: rule.objectId,
          x: gx + hash2d(Math.floor(gx * 7) + seedOff, Math.floor(gz * 9) + seedOff) * rule.gridStep * 0.5,
          z: gz + hash2d(Math.floor(gx * 11) + seedOff, Math.floor(gz * 13) + seedOff) * rule.gridStep * 0.5,
          rotationY: hash2d(Math.floor(gx * 17) + seedOff, Math.floor(gz * 19) + seedOff) * Math.PI * 2,
        });
      }
    }
  }

  return placements;
}

// ═══════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════

/**
 * Build all voxel terrain objects and return as meshes.
 * Accepts an optional FieldLayout; uses default if omitted.
 */
export async function buildVoxelTerrain(
  scene: Scene,
  layout?: FieldLayout,
): Promise<Mesh[]> {
  // Ensure defaults are registered
  registerDefaults();

  const fieldLayout = layout ?? createDefaultLayout();
  const meshes: Mesh[] = [];

  // Combine manual placements + scattered placements
  const allPlacements = [
    ...fieldLayout.placements,
    ...generateScatterPlacements(fieldLayout.scatterRules),
  ];

  // Cache loaded voxel data per objectId to avoid redundant loads
  const voxelCache = new Map<string, VoxelEntry[]>();
  let meshId = 0;

  for (const placement of allPlacements) {
    const def = getObjectDef(placement.objectId);
    if (!def) continue;

    // Load voxels (cached)
    let voxels = voxelCache.get(def.id);
    if (!voxels) {
      // For procedural objects, use unique seed per instance
      const seedDef = { ...def };
      if (seedDef.source.kind === 'procedural') {
        seedDef.source = { ...seedDef.source, seed: meshId };
      }
      voxels = await loadObjectVoxels(seedDef, PROCEDURAL_GENERATORS);
      // Only cache .vox and inline sources (procedural varies per instance)
      if (def.source.kind !== 'procedural') {
        voxelCache.set(def.id, voxels);
      }
    }

    const scale = (def.scale ?? DEFAULT_TERRAIN_SCALE) * (placement.scale ?? 1);
    const mesh = buildVoxelObjectMesh(voxels, scene, `${def.id}_${meshId}`, scale);
    mesh.position.set(placement.x, STAGE_CONFIG.groundY + (def.pivotY ?? 0), placement.z);
    if (placement.rotationY) {
      mesh.rotation.y = placement.rotationY;
    }
    meshes.push(mesh);
    meshId++;
  }

  return meshes;
}
