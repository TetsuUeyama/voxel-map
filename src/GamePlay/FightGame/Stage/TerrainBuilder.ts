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

/** IDs of tree .vox files converted from Low-Poly Tree Collection (001–200) */
const VOX_TREE_IDS = Array.from({ length: 200 }, (_, i) =>
  String(i + 1).padStart(3, '0'),
);

/** Broadleaf tree .vox file names (maple, poplar, whitePoplar) */
const VOX_BROADLEAF_IDS = [
  'maple1', 'maple2', 'maple3',
  'poplar1', 'poplar2', 'poplar3', 'poplar4',
  'whitePoplar1', 'whitePoplar2', 'whitePoplar3', 'whitePoplar4',
];

/** Tree3 .vox file names (maple + generic trees) */
const VOX_TREE3_IDS = [
  'mapleTree_small_1', 'mapleTree_small_2', 'mapleTree_small_3',
  'treeBase_simple',
  'generic_tree1', 'generic_tree2', 'generic_tree3',
];

/** Farm/Building .vox file names from Low-Poly Farm Mega Pack */
const VOX_BUILDING_IDS = [
  'farm_001','farm_002','farm_003','farm_004','farm_005','farm_006','farm_007','farm_008',
  'farm_009','farm_010','farm_011','farm_012','farm_013',
  'sheep_014','donkey_015','goat_016','cow_017','rooster_018','horse_019','hen_020',
  'harvest_021','plants_022','grass_023','rock_024','Stoneroad_025',
  'field_b_ready_026','field_027','farm_028','farm_029','farm_030',
  'field_031','field_b_ready_032','field_a_ready_033',
  'mailbox_034','fence_035','fence_036','fence_037','fence_038','fence_039',
  'brick_040','logs_041','fence_042','timber_043','shovel_044','farmsign_045',
  'fence_046','gate_047','fence_048','laddertriangle_049',
  'farm_050','farm_051','logs_052','ladder_along_053',
  'farm_054','farm_055','farm_056','farm_057','farm_058','farm_059','farm_060',
  'farm_061','farm_062','farm_063','farm_064','farm_065','farm_066','farm_067',
  'farm_068','farm_069','farm_070','farm_071',
  'structures_a_072','structures_073','structures_074',
  'toilet_a_075','bridge_a_076',
  'greenhouse_b_077','greenhouse_a_078','greenhouse_a_079','greenhouse_b_080',
  'structures_a03_002__081','structures_a_082','bridge_a_083',
  'farm_084','cratebox_085','cratebox_086',
  'milktank_087','watersprinkler_088',
  'bench_089','table_090','table_091',
  'cart_092','cart_093','cart_094','cart_095',
  'bench_096','streetsign_097','barrel_098','streetsign_099',
  'cratebox_100','cratebox_101','barrel_102',
  'streetlight_103','streetlight_104',
  'chair_105','chair_106','chair_107','chair_108',
  'strawpack_109','fooddish_110','cart_111','littlefoodholder_112',
  'bench_113','table_114','cratebox_115',
  'streetlight_116','streetlight_117','littlefoodholder_118',
  'lawn_mower_119','lawn_mower_120',
  'tree_121','tree_122','tree_123','tree_124','tree_125','tree_126','tree_127',
  'tree_128','tree_129','tree_130','tree_131','tree_132','tree_133','tree_134',
  'tree_135','tree_136','tree_137','tree_138',
];

/** Park .vox file names — field parts, objects, and tree */
const VOX_PARK_FIELD_IDS = ['field_grass_001', 'field_water_002'];
const VOX_PARK_OBJECT_IDS = [
  'obj_basketball_red_001', 'obj_basketball_red_012',
  'obj_basketball_red_013', 'obj_basketball_red_014',
  'obj_bench_011', 'obj_bridge_006', 'obj_ground_002', 'obj_line_003',
  'obj_material_005', 'obj_picnic_table_010', 'obj_sand_004',
  'obj_swings02_009', 'obj_swings1_008', 'obj_tennis_table_007',
];
const VOX_PARK_TREE_ID = 'park_tree';

/** Village Southern Europe — tile IDs (4×4 grid) and asset IDs */
const VOX_VILLAGE_TILE_IDS = Array.from({ length: 16 }, (_, i) =>
  `tile_${Math.floor(i / 4)}_${i % 4}`,
);
const VOX_VILLAGE_ASSET_IDS = [
  'window_1','window_2','window_3','window_4','window_5','window_6',
  'door_1','door_2','door_3','brick','pole_1','pole_2',
  'roof_1','roof_2','chimney','stairs','gate_1','gate_2','fence','light',
  'tree_1','tree_2','tree_3','tree_4','tree_5','tree_6',
  'flower_1','flower_2','rock_1','rock_2','rock_3','rock_4','rock_5','rock_6','rock_7',
  'chair','table_1','table_2','table_3','table_4','table_5','table_6','pot',
  'house_1','house_2','house_3','house_4',
];

/** Mushroom .vox file names converted from Low-Poly Mushroom Collection */
const VOX_MUSHROOM_IDS = [
  'amanita', 'brown-cap_boletus', 'cep', 'chanterelle', 'green_russule',
  'honey_mushroom', 'milk_mushroom', 'moss-fly_mushroom', 'oily_mushroom',
  'orange-cap_boletus', 'oyster_mushroom', 'purple_russule',
  'saffron_milk_cap', 'umbrella_mushroom', 'yellow_mushroom',
];

function registerDefaults(): void {
  // .vox file objects (from 3D models)
  registerObject({ id: 'tree_190', type: 'tree', source: { kind: 'vox', url: '/field/190.vox' } });

  // Low-Poly Tree Collection .vox trees
  for (const tid of VOX_TREE_IDS) {
    registerObject({
      id: `tree_${tid}`,
      type: 'tree',
      source: { kind: 'vox', url: `/api/game-assets/field/tree/tree_${tid}.vox` },
    });
  }

  // Broadleaf trees (maple, poplar, whitePoplar)
  for (const bid of VOX_BROADLEAF_IDS) {
    registerObject({
      id: `tree2_${bid}`,
      type: 'tree',
      source: { kind: 'vox', url: `/api/game-assets/field/tree2/${bid}.vox` },
    });
  }

  // Tree3 (maple + generic trees)
  for (const t3id of VOX_TREE3_IDS) {
    registerObject({
      id: `tree3_${t3id}`,
      type: 'tree',
      source: { kind: 'vox', url: `/api/game-assets/field/tree3/${t3id}.vox` },
    });
  }

  // Low-Poly Mushroom Collection .vox mushrooms
  for (const mid of VOX_MUSHROOM_IDS) {
    registerObject({
      id: `mushroom_${mid}`,
      type: 'mushroom',
      source: { kind: 'vox', url: `/api/game-assets/field/mushroom/${mid}.vox` },
    });
  }

  // Farm/Building .vox objects
  for (const bid of VOX_BUILDING_IDS) {
    registerObject({
      id: `building_${bid}`,
      type: 'building',
      source: { kind: 'vox', url: `/api/game-assets/field/building/${bid}.vox` },
    });
  }

  // Park field parts
  for (const pid of VOX_PARK_FIELD_IDS) {
    registerObject({
      id: `park_${pid}`,
      type: 'field',
      source: { kind: 'vox', url: `/api/game-assets/field/park/${pid}.vox` },
    });
  }

  // Park objects
  for (const pid of VOX_PARK_OBJECT_IDS) {
    registerObject({
      id: `park_${pid}`,
      type: 'structure',
      source: { kind: 'vox', url: `/api/game-assets/field/park/${pid}.vox` },
    });
  }

  // Park tree
  registerObject({
    id: `park_${VOX_PARK_TREE_ID}`,
    type: 'tree',
    source: { kind: 'vox', url: `/api/game-assets/field/park/${VOX_PARK_TREE_ID}.vox` },
  });

  // Village Southern Europe — field tiles
  for (const tid of VOX_VILLAGE_TILE_IDS) {
    registerObject({
      id: `village_${tid}`,
      type: 'field',
      source: { kind: 'vox', url: `/api/game-assets/field/village/tiles/${tid}.vox` },
    });
  }

  // Village Southern Europe — assets
  for (const aid of VOX_VILLAGE_ASSET_IDS) {
    registerObject({
      id: `village_${aid}`,
      type: 'structure',
      source: { kind: 'vox', url: `/api/game-assets/field/village/objects/${aid}.vox` },
    });
  }

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

  // Showcase placements: place several converted trees near the arena
  const showcaseTrees: ObjectPlacement[] = [
    { objectId: 'tree_001', x: 10, z: 0 },
    { objectId: 'tree_003', x: -10, z: 5 },
    { objectId: 'tree_050', x: 8, z: -8 },
    { objectId: 'tree_060', x: -8, z: -6 },
    { objectId: 'tree_090', x: 12, z: 6 },
    { objectId: 'tree_120', x: -12, z: -3 },
  ];

  // Scatter rules using converted tree variety
  const treeScatterRules: ScatterRule[] = VOX_TREE_IDS.map((tid, i) => ({
    objectId: `tree_${tid}`,
    density: 0.003,
    gridStep: 3,
    minDistFromCenter: zone.halfX + 3,
    seed: 5000 + i * 137,
  }));

  // Scatter rules for broadleaf trees
  const broadleafScatterRules: ScatterRule[] = VOX_BROADLEAF_IDS.map((bid, i) => ({
    objectId: `tree2_${bid}`,
    density: 0.003,
    gridStep: 3,
    minDistFromCenter: zone.halfX + 3,
    seed: 7000 + i * 113,
  }));

  // Scatter rules for tree3 (maple + generic)
  const tree3ScatterRules: ScatterRule[] = VOX_TREE3_IDS.map((t3id, i) => ({
    objectId: `tree3_${t3id}`,
    density: 0.003,
    gridStep: 3,
    minDistFromCenter: zone.halfX + 3,
    seed: 9000 + i * 151,
  }));

  // Scatter rules for buildings (low density, spread out)
  const buildingScatterRules: ScatterRule[] = VOX_BUILDING_IDS.map((bid, i) => ({
    objectId: `building_${bid}`,
    density: 0.001,
    gridStep: 5,
    minDistFromCenter: zone.halfX + 5,
    seed: 10000 + i * 73,
  }));

  // Scatter rules for park objects
  const parkScatterRules: ScatterRule[] = VOX_PARK_OBJECT_IDS.map((pid, i) => ({
    objectId: `park_${pid}`,
    density: 0.002,
    gridStep: 4,
    minDistFromCenter: zone.halfX + 4,
    seed: 11000 + i * 89,
  }));

  // Scatter rules for mushrooms
  const mushroomScatterRules: ScatterRule[] = VOX_MUSHROOM_IDS.map((mid, i) => ({
    objectId: `mushroom_${mid}`,
    density: 0.004,
    gridStep: 2,
    minDistFromCenter: zone.halfX + 1,
    seed: 8000 + i * 97,
  }));

  return {
    placements: showcaseTrees,
    scatterRules: [
      ...treeScatterRules,
      ...broadleafScatterRules,
      ...tree3ScatterRules,
      ...buildingScatterRules,
      ...parkScatterRules,
      ...mushroomScatterRules,
      { objectId: 'rock_default',   density: 0.02, gridStep: 3, minDistFromCenter: zone.halfX + 2 },
      { objectId: 'flower_default', density: 0.015, gridStep: 1, minDistFromCenter: 0, seed: 2000 },
      { objectId: 'grass_default',  density: 0.04,  gridStep: 1, minDistFromCenter: 0, seed: 3000 },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════
// Voxel mesh builder (greedy meshing — combines adjacent same-color
// voxel faces into single rectangular quads to minimize triangle count).
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a voxel mesh using greedy meshing.
 * Returns a single Mesh with vertex colors and exposed-face culling.
 */
export function buildVoxelObjectMesh(
  voxels: VoxelEntry[], scene: Scene, name: string, scale: number,
): Mesh {
  const mesh = new Mesh(name, scene);
  if (voxels.length === 0) {
    mesh.material = createUnlitMaterial(scene, name + '_mat');
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    return mesh;
  }

  // ── Compute voxel bounds ─────────────────────────────────────────
  let minVX = Infinity, minVY = Infinity, minVZ = Infinity;
  let maxVX = -Infinity, maxVY = -Infinity, maxVZ = -Infinity;
  for (const v of voxels) {
    if (v.x < minVX) minVX = v.x; if (v.x > maxVX) maxVX = v.x;
    if (v.y < minVY) minVY = v.y; if (v.y > maxVY) maxVY = v.y;
    if (v.z < minVZ) minVZ = v.z; if (v.z > maxVZ) maxVZ = v.z;
  }
  const dimX = maxVX - minVX + 1;
  const dimY = maxVY - minVY + 1;
  const dimZ = maxVZ - minVZ + 1;

  // ── Build palette + color-indexed grid ───────────────────────────
  const palette: { r: number; g: number; b: number }[] = [];
  const colorMap = new Map<number, number>();
  const grid = new Uint16Array(dimX * dimY * dimZ); // 0 = empty, 1+ = palette index

  for (const v of voxels) {
    const k = (Math.round(v.r * 255) << 16) | (Math.round(v.g * 255) << 8) | Math.round(v.b * 255);
    let idx = colorMap.get(k);
    if (idx === undefined) {
      idx = palette.length + 1;
      palette.push({ r: v.r, g: v.g, b: v.b });
      colorMap.set(k, idx);
    }
    const lx = v.x - minVX, ly = v.y - minVY, lz = v.z - minVZ;
    grid[lx + ly * dimX + lz * dimX * dimY] = idx;
  }

  // ── Greedy meshing ───────────────────────────────────────────────
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const dims = [dimX, dimY, dimZ];

  // Voxel-local vertex coords (vox0, vox1, vox2) → viewer-space position
  // Convention: viewer X = voxel X, viewer Y = voxel Z, viewer Z = -voxel Y
  const pushViewerPos = (vox0: number, vox1: number, vox2: number) => {
    positions.push(
      (vox0 + minVX) * scale,
      (vox2 + minVZ) * scale,
      -(vox1 + minVY) * scale,
    );
  };

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const vAxis = (d + 2) % 3;
    const sliceU = dims[u];
    const sliceV = dims[vAxis];
    const mask = new Int32Array(sliceU * sliceV);

    const x = [0, 0, 0];
    const q = [0, 0, 0]; q[d] = 1;

    // Sweep slice planes from -1 (just before grid) to dims[d]-1
    for (x[d] = -1; x[d] < dims[d]; ) {
      // Build mask: positive = +d-facing voxel, negative = -d-facing voxel
      let n = 0;
      for (x[vAxis] = 0; x[vAxis] < sliceV; x[vAxis]++) {
        for (x[u] = 0; x[u] < sliceU; x[u]++) {
          const a = (x[d] >= 0)
            ? grid[x[0] + x[1] * dimX + x[2] * dimX * dimY]
            : 0;
          const bx = x[0] + q[0], by = x[1] + q[1], bz = x[2] + q[2];
          const b = (x[d] < dims[d] - 1)
            ? grid[bx + by * dimX + bz * dimX * dimY]
            : 0;
          if (a !== 0 && b === 0) mask[n] = a;
          else if (a === 0 && b !== 0) mask[n] = -b;
          else mask[n] = 0;
          n++;
        }
      }

      x[d]++;

      // Greedy rectangle extraction
      n = 0;
      for (let j = 0; j < sliceV; j++) {
        for (let i = 0; i < sliceU; ) {
          const c = mask[n];
          if (c !== 0) {
            // Determine width along u
            let w = 1;
            while (i + w < sliceU && mask[n + w] === c) w++;
            // Determine height along v
            let h = 1;
            outer: while (j + h < sliceV) {
              for (let k = 0; k < w; k++) {
                if (mask[n + k + h * sliceU] !== c) break outer;
              }
              h++;
            }

            // Emit quad
            x[u] = i; x[vAxis] = j;
            const du = [0, 0, 0]; du[u] = w;
            const dv = [0, 0, 0]; dv[vAxis] = h;

            const colorIdx = c > 0 ? c : -c;
            const col = palette[colorIdx - 1];
            const sign = c > 0 ? 1 : -1;

            // Normal (in viewer space): voxel axis d w/ sign → viewer
            //   d=0 → viewer X, d=1 → viewer -Z, d=2 → viewer Y
            let nx = 0, ny = 0, nz = 0;
            if (d === 0) nx = sign;
            else if (d === 1) nz = -sign;
            else ny = sign;

            const baseIndex = positions.length / 3;
            pushViewerPos(x[0], x[1], x[2]);
            pushViewerPos(x[0] + du[0], x[1] + du[1], x[2] + du[2]);
            pushViewerPos(x[0] + du[0] + dv[0], x[1] + du[1] + dv[1], x[2] + du[2] + dv[2]);
            pushViewerPos(x[0] + dv[0], x[1] + dv[1], x[2] + dv[2]);

            for (let k = 0; k < 4; k++) {
              normals.push(nx, ny, nz);
              colors.push(col.r, col.g, col.b, 1);
            }
            indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
            indices.push(baseIndex, baseIndex + 2, baseIndex + 3);

            // Clear mask cells covered by this rectangle
            for (let k = 0; k < w; k++) {
              for (let m = 0; m < h; m++) {
                mask[n + k + m * sliceU] = 0;
              }
            }
            i += w; n += w;
          } else {
            i++; n++;
          }
        }
      }
    }
  }

  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.colors = colors;
  vd.indices = indices;
  vd.applyToMesh(mesh);
  mesh.material = createUnlitMaterial(scene, name + '_mat');
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
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
