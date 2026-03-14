/**
 * Terrain Object Registry
 *
 * Manages voxel object types (trees, rocks, flowers, etc.) that can be
 * placed on the field. Each object type can be sourced from:
 *   1. A .vox file (loaded at runtime)
 *   2. A procedural generator (built-in fallback)
 *
 * Usage:
 *   // Register a .vox-based object
 *   registry.register({
 *     id: 'oak_tree',
 *     type: 'tree',
 *     source: { kind: 'vox', url: '/field/oak_tree.vox' },
 *     scale: 0.10,
 *   });
 *
 *   // Register with procedural fallback
 *   registry.register({
 *     id: 'rock_small',
 *     type: 'rock',
 *     source: { kind: 'procedural', generator: 'rock' },
 *     scale: 0.10,
 *   });
 */

import type { VoxelEntry } from '@/lib/vox-parser';
import { loadVoxFile, SCALE } from '@/lib/vox-parser';

// ── Types ───────────────────────────────────────────────────────────

/** How the voxel data is sourced */
export type ObjectSource =
  | { kind: 'vox'; url: string }
  | { kind: 'procedural'; generator: string; seed?: number }
  | { kind: 'inline'; voxels: VoxelEntry[] };

/** Registration entry for a terrain object type */
export interface TerrainObjectDef {
  id: string;               // unique identifier (e.g. 'oak_tree', 'mossy_rock')
  type: string;              // category (e.g. 'tree', 'rock', 'flower', 'grass', 'structure')
  source: ObjectSource;
  scale?: number;            // voxel scale override (default: DEFAULT_TERRAIN_SCALE)
  pivotY?: number;           // Y offset so object sits on the ground (default: 0)
}

/** Placement of an object on the field */
export interface ObjectPlacement {
  objectId: string;          // references TerrainObjectDef.id
  x: number;                 // world X
  z: number;                 // world Z
  rotationY?: number;        // Y rotation in radians (default: 0)
  scale?: number;            // per-instance scale multiplier (default: 1)
}

/** Auto-scatter rule for filling the field */
export interface ScatterRule {
  objectId: string;          // which object to scatter
  density: number;           // probability per grid cell (0-1)
  gridStep: number;          // grid spacing in world units
  minDistFromCenter: number; // keep clear of fight zone
  seed?: number;             // deterministic seed offset
}

/** Full field layout configuration */
export interface FieldLayout {
  placements: ObjectPlacement[];   // manually placed objects
  scatterRules: ScatterRule[];     // auto-fill rules
}

// ── Default scale ───────────────────────────────────────────────────
export const DEFAULT_TERRAIN_SCALE = SCALE * 2; // 0.02 (2× character voxel size)

// ── Registry ────────────────────────────────────────────────────────

const objectDefs = new Map<string, TerrainObjectDef>();

export function registerObject(def: TerrainObjectDef): void {
  objectDefs.set(def.id, def);
}

export function getObjectDef(id: string): TerrainObjectDef | undefined {
  return objectDefs.get(id);
}

export function getAllObjectDefs(): TerrainObjectDef[] {
  return [...objectDefs.values()];
}

export function getObjectsByType(type: string): TerrainObjectDef[] {
  return [...objectDefs.values()].filter(d => d.type === type);
}

// ── Voxel data loading ──────────────────────────────────────────────

/** Resolve voxel data for a registered object */
export async function loadObjectVoxels(
  def: TerrainObjectDef,
  proceduralGenerators: Map<string, (seed: number) => VoxelEntry[]>,
): Promise<VoxelEntry[]> {
  switch (def.source.kind) {
    case 'vox': {
      const { voxels } = await loadVoxFile(def.source.url);
      return voxels;
    }
    case 'procedural': {
      const gen = proceduralGenerators.get(def.source.generator);
      if (!gen) throw new Error(`Unknown procedural generator: ${def.source.generator}`);
      return gen(def.source.seed ?? 0);
    }
    case 'inline':
      return def.source.voxels;
  }
}
