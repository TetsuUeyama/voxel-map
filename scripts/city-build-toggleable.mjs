/**
 * Voxelizer that produces:
 *   - city "base" (full city minus all toggleable building parts AND prototype instances)
 *   - one .vox model per building in city-buildings-catalog.json
 *   - one .vox model per prototype (trees, lamps, bushes) — only the FIRST instance
 *     is voxelized; siblings are recorded as Blender offsets for runtime
 *     `mesh.thinInstanceSetBuffer('matrix', ...)` placement.
 *
 * Output layout (under field/city/):
 *   city_meta.json + city_chunk_*.vox        → base
 *   buildings/<id>/<id>_meta.json + chunks   → per-building voxels
 *   prototypes/<id>/<id>_meta.json + chunks  → canonical instance only
 *   buildings_manifest.json                  → list of buildings + their meta paths
 *   prototypes_manifest.json                 → list of prototypes + offset arrays
 *
 * Each building/prototype is voxelized against the SAME global bbox as the full
 * city, so the standard chunk-loader transform places the canonical at its
 * original world position. Thin-instance offsets are in viewer space:
 *   ΔviewerX = ΔblenderX
 *   ΔviewerY = ΔblenderZ
 *   ΔviewerZ = -ΔblenderY    (voxelizer Y-flip)
 *
 * Usage:
 *   node scripts/city-build-toggleable.mjs <voxelSize>
 * Example:
 *   node scripts/city-build-toggleable.mjs 0.025
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE = 'C:/Users/user/developsecond/game-assets/field/city';
const NAME = 'city';
const OBJ_PATH = path.join(BASE, `${NAME}.obj`);
const COLOR_JSON = path.join(BASE, `${NAME}_colors.json`);
const OUT_META = path.join(BASE, `${NAME}_meta.json`);
const BUILDINGS_DIR = path.join(BASE, 'buildings');
const PROTOTYPES_DIR = path.join(BASE, 'prototypes');
const BUILDINGS_MANIFEST_PATH = path.join(BASE, 'buildings_manifest.json');
const PROTOTYPES_MANIFEST_PATH = path.join(BASE, 'prototypes_manifest.json');
const CATALOG_PATH = path.join(__dirname, 'city-buildings-catalog.json');

const VOXEL_SIZE = parseFloat(process.argv[2] ?? '0.025');
if (!VOXEL_SIZE || !isFinite(VOXEL_SIZE)) {
  console.error('Usage: node city-build-toggleable.mjs <voxelSize>');
  process.exit(1);
}
const VOX_MAX_DIM = 256;

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
const buildings = catalog.buildings ?? [];
const prototypes = catalog.prototypes ?? [];
console.log(`voxelSize = ${VOXEL_SIZE} m`);
console.log(`Buildings:  ${buildings.length}`);
console.log(`Prototypes: ${prototypes.length}`);

// Map: OBJ object name → building bucket id (or undefined).
const buildingOwnerOf = new Map();
for (const b of buildings) {
  for (const og of b.o_groups) {
    if (buildingOwnerOf.has(og)) {
      console.error(`Duplicate 'o' group ${og} (already in ${buildingOwnerOf.get(og)})`);
      process.exit(1);
    }
    buildingOwnerOf.set(og, b.id);
  }
}

const colors = JSON.parse(fs.readFileSync(COLOR_JSON, 'utf-8'));

// ============================================================
// PASS 1: parse OBJ, compute per-group bbox + vertex count.
// Track v-line index → verts array index for offset/bbox computation.
// ============================================================
console.log(`Reading ${OBJ_PATH}...`);
const objText = fs.readFileSync(OBJ_PATH, 'utf-8');

// Two parallel vert arrays:
//   vertsFlipped — used for voxelization (y-flipped, as before)
//   vertsBlender — original (used for prototype bbox-center computation)
const vertsFlipped = [];
const vertsBlender = [];

// groupName → { vertIdxs: Set<number>, faceStartLine: number }
const groupInfo = new Map();
let curGroupName = null;
let curGroupVerts = null;
const groupOrder = []; // insertion order

// First scan: vertices + group membership (track which vert indices are used by each group's faces)
// To avoid 2 passes, we do a single pass with deferred bbox computation.
// We'll record per-line: which group is "current" for face references.
const rawLines = objText.split('\n');

// Build vertex array first; vertices are global (not group-scoped)
for (const line of rawLines) {
  if (line.charCodeAt(0) === 118 && line.charCodeAt(1) === 32) {
    const p = line.split(' ');
    const x = +p[1], y = +p[2], z = +p[3];
    vertsBlender.push(x, y, z);
    vertsFlipped.push(x, -y, z);
  }
}

// Second scan: track current group, attach face vertex indices to group
for (const line of rawLines) {
  const c0 = line.charCodeAt(0);
  if (c0 === 111 && line.charCodeAt(1) === 32) {
    const name = line.substring(2).trim();
    if (!groupInfo.has(name)) {
      groupInfo.set(name, { vertIdxs: new Set() });
      groupOrder.push(name);
    }
    curGroupName = name;
    curGroupVerts = groupInfo.get(name).vertIdxs;
  } else if (c0 === 102 && line.charCodeAt(1) === 32 && curGroupVerts) {
    const p = line.split(' ');
    for (let i = 1; i < p.length; i++) {
      const vi = parseInt(p[i].split('/')[0]) - 1;
      if (!isNaN(vi)) curGroupVerts.add(vi);
    }
  }
}

// Compute Blender-space bbox + center per group (using original verts, not flipped).
for (const [name, info] of groupInfo) {
  let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity, mnZ = Infinity, mxZ = -Infinity;
  for (const vi of info.vertIdxs) {
    const x = vertsBlender[vi * 3];
    const y = vertsBlender[vi * 3 + 1];
    const z = vertsBlender[vi * 3 + 2];
    if (x < mnX) mnX = x; if (x > mxX) mxX = x;
    if (y < mnY) mnY = y; if (y > mxY) mxY = y;
    if (z < mnZ) mnZ = z; if (z > mxZ) mxZ = z;
  }
  info.bcx = (mnX + mxX) / 2;
  info.bcy = (mnY + mxY) / 2;
  info.bcz = (mnZ + mxZ) / 2;
  info.w = mxX - mnX;
  info.d = mxY - mnY;
  info.h = mxZ - mnZ;
  info.vertCount = info.vertIdxs.size;
}

// ============================================================
// PROTOTYPE MATCHING (only for groups not already claimed by buildings)
// ============================================================
// instanceOf.get(groupName) -> { protoId, isCanonical, offset: [dvx, dvy, dvz] (viewer-space) }
const instanceOf = new Map();
const protoInstances = new Map(); // protoId → array of { name, offset_blender:[dx,dy,dz] }

function matchesPrototype(info, name, match) {
  if (match.prefix && !name.startsWith(match.prefix)) return false;
  if (match.geometry) {
    const g = match.geometry;
    const tol = g.tolerance ?? 0.02;
    if (Math.abs(info.w - g.size[0]) > tol) return false;
    if (Math.abs(info.d - g.size[1]) > tol) return false;
    if (Math.abs(info.h - g.size[2]) > tol) return false;
    if (g.vertCount && info.vertCount !== g.vertCount) return false;
  }
  return true;
}

for (const proto of prototypes) {
  const matched = [];
  for (const name of groupOrder) {
    if (buildingOwnerOf.has(name)) continue; // claimed by a building
    if (instanceOf.has(name)) continue;      // claimed by another prototype already
    const info = groupInfo.get(name);
    if (matchesPrototype(info, name, proto.match)) {
      matched.push({ name, info });
    }
  }
  if (matched.length === 0) {
    console.warn(`WARNING: prototype "${proto.id}" matched 0 instances — check catalog match rules.`);
    continue;
  }
  // Canonical = first match (deterministic since groupOrder is OBJ order)
  const canon = matched[0];
  protoInstances.set(proto.id, matched.map((m) => {
    const dx_b = m.info.bcx - canon.info.bcx;
    const dy_b = m.info.bcy - canon.info.bcy;
    const dz_b = m.info.bcz - canon.info.bcz;
    instanceOf.set(m.name, {
      protoId: proto.id,
      isCanonical: m.name === canon.name,
    });
    return {
      name: m.name,
      // viewer-space offset relative to canonical
      offset: [dx_b, dz_b, -dy_b],
    };
  }));
  console.log(`  proto "${proto.id}" matched ${matched.length} instances; canonical = ${canon.name}`);
}

// ============================================================
// Determine final bucket for each group:
//   building id  → assigned via catalog
//   proto id     → if canonical instance of a prototype
//   'skip'       → non-canonical prototype instance (excluded from voxelize entirely)
//   'base'       → everything else
// ============================================================
const buckets = ['base', ...buildings.map((b) => b.id), ...prototypes.map((p) => p.id)];
const bucketIndexOf = new Map(buckets.map((b, i) => [b, i]));
const SKIP_BUCKET = -1;
const finalBucketOf = new Map(); // name → bucketIdx or SKIP_BUCKET
for (const name of groupOrder) {
  const bldgId = buildingOwnerOf.get(name);
  if (bldgId) {
    finalBucketOf.set(name, bucketIndexOf.get(bldgId));
    continue;
  }
  const inst = instanceOf.get(name);
  if (inst) {
    finalBucketOf.set(name, inst.isCanonical ? bucketIndexOf.get(inst.protoId) : SKIP_BUCKET);
    continue;
  }
  finalBucketOf.set(name, bucketIndexOf.get('base'));
}

// ============================================================
// PASS 2: voxelize. Walk OBJ lines, emit voxels per face into its bucket.
// ============================================================
const facesPerBucket = new Array(buckets.length).fill(0);
const faceColors = [];
const colorByMtl = new Map();
let curColorIdx = -1;
let curBucketIdx = bucketIndexOf.get('base');

const faces = []; // [a, b, c, ci, bucketIdx]
for (const line of rawLines) {
  if (!line) continue;
  const c = line.charCodeAt(0);
  if (c === 111 && line.charCodeAt(1) === 32) {
    const name = line.substring(2).trim();
    const fb = finalBucketOf.get(name);
    curBucketIdx = fb;
  } else if (c === 102 && line.charCodeAt(1) === 32) {
    if (curBucketIdx === SKIP_BUCKET) continue;
    const p = line.split(' ');
    const a = parseInt(p[1]) - 1;
    let prev = parseInt(p[2]) - 1;
    for (let i = 3; i < p.length; i++) {
      const c2 = parseInt(p[i]) - 1;
      faces.push(a, prev, c2, curColorIdx, curBucketIdx);
      facesPerBucket[curBucketIdx]++;
      prev = c2;
    }
  } else if (c === 117 && line.startsWith('usemtl ')) {
    const name = line.substring(7).trim();
    let idx = colorByMtl.get(name);
    if (idx === undefined) {
      const col = colors[name] ?? [0.5, 0.5, 0.5];
      idx = faceColors.length;
      faceColors.push(col);
      colorByMtl.set(name, idx);
    }
    curColorIdx = idx;
  }
}
const numFaces = faces.length / 5;
console.log(`\nParsed: ${vertsFlipped.length / 3} verts, ${numFaces.toLocaleString()} triangles (after skip-instance filter)`);
for (let i = 0; i < buckets.length; i++) {
  console.log(`  bucket ${buckets[i].padEnd(20)} faces=${facesPerBucket[i].toLocaleString()}`);
}

// Use vertsFlipped from here on
const verts = vertsFlipped;

// Global bounds from ALL verts (so every bucket shares the same world coordinate system)
let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
for (let i = 0; i < verts.length; i += 3) {
  if (verts[i] < minX) minX = verts[i]; if (verts[i] > maxX) maxX = verts[i];
  if (verts[i+1] < minY) minY = verts[i+1]; if (verts[i+1] > maxY) maxY = verts[i+1];
  if (verts[i+2] < minZ) minZ = verts[i+2]; if (verts[i+2] > maxZ) maxZ = verts[i+2];
}
const sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
const totalGridX = Math.ceil(sizeX / VOXEL_SIZE) + 1;
const totalGridY = Math.ceil(sizeY / VOXEL_SIZE) + 1;
const totalGridZ = Math.ceil(sizeZ / VOXEL_SIZE) + 1;
console.log(`Global bounds: ${sizeX.toFixed(2)} × ${sizeY.toFixed(2)} × ${sizeZ.toFixed(2)} m`);
console.log(`Total grid:    ${totalGridX} × ${totalGridY} × ${totalGridZ}`);

const voxelMaps = buckets.map(() => new Map());
const VS = VOXEL_SIZE;

console.log('Voxelizing...');
const t0 = Date.now();
const reportEvery = Math.max(1, Math.floor(numFaces / 20));
for (let fi = 0; fi < numFaces; fi++) {
  const base = fi * 5;
  const i0 = faces[base] * 3;
  const i1 = faces[base+1] * 3;
  const i2 = faces[base+2] * 3;
  const ci = faces[base+3];
  const bidx = faces[base+4];
  if (ci < 0) continue;

  const x0 = verts[i0],   y0 = verts[i0+1], z0 = verts[i0+2];
  const x1 = verts[i1],   y1 = verts[i1+1], z1 = verts[i1+2];
  const x2 = verts[i2],   y2 = verts[i2+1], z2 = verts[i2+2];
  const dx01 = (x1-x0)/VS, dy01 = (y1-y0)/VS, dz01 = (z1-z0)/VS;
  const dx02 = (x2-x0)/VS, dy02 = (y2-y0)/VS, dz02 = (z2-z0)/VS;
  const e01 = Math.sqrt(dx01*dx01 + dy01*dy01 + dz01*dz01);
  const e02 = Math.sqrt(dx02*dx02 + dy02*dy02 + dz02*dz02);
  const steps = Math.max(4, Math.ceil(Math.max(e01, e02)) * 2);
  const inv = 1 / steps;
  const m = voxelMaps[bidx];

  for (let i = 0; i <= steps; i++) {
    const u = i * inv;
    const jmax = steps - i;
    for (let j = 0; j <= jmax; j++) {
      const v = j * inv;
      const w = 1 - u - v;
      const px = w*x0 + u*x1 + v*x2;
      const py = w*y0 + u*y1 + v*y2;
      const pz = w*z0 + u*z1 + v*z2;
      const gx = ((px - minX) / VS) | 0;
      const gy = ((py - minY) / VS) | 0;
      const gz = ((pz - minZ) / VS) | 0;
      const key = gx + gy * 4096 + gz * 16777216;
      if (!m.has(key)) m.set(key, ci);
    }
  }
  if (fi > 0 && fi % reportEvery === 0) {
    const pct = (fi / numFaces * 100).toFixed(0);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const totalVoxels = voxelMaps.reduce((a, b) => a + b.size, 0);
    console.log(`  ${pct}%  total voxels=${totalVoxels.toLocaleString()}  elapsed=${elapsed}s`);
  }
}
const totalVoxels = voxelMaps.reduce((a, b) => a + b.size, 0);
console.log(`Voxelized: ${totalVoxels.toLocaleString()} voxels across ${buckets.length} bucket(s) in ${((Date.now()-t0)/1000).toFixed(1)}s`);
for (let i = 0; i < buckets.length; i++) {
  console.log(`  ${buckets[i].padEnd(20)} voxels=${voxelMaps[i].size.toLocaleString()}`);
}

// === Shared palette across all buckets ===
const paletteMap = new Map();
const palette = [];
function paletteIndexFor(rawCi) {
  const [r, g, b] = faceColors[rawCi];
  const qr = Math.round(r * 255) & 0xFC;
  const qg = Math.round(g * 255) & 0xFC;
  const qb = Math.round(b * 255) & 0xFC;
  const pkey = (qr << 16) | (qg << 8) | qb;
  let pi = paletteMap.get(pkey);
  if (pi !== undefined) return pi;
  if (palette.length >= 255) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const d = (palette[i][0]-qr)**2 + (palette[i][1]-qg)**2 + (palette[i][2]-qb)**2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best + 1;
  }
  palette.push([qr, qg, qb]);
  pi = palette.length;
  paletteMap.set(pkey, pi);
  return pi;
}

function planChunks(n, max) {
  if (n <= max) return [[0, n]];
  const ranges = [];
  for (let s = 0; s < n; s += max) {
    ranges.push([s, Math.min(s + max, n)]);
  }
  return ranges;
}
function chunkIndex(g, ranges) {
  for (let i = 0; i < ranges.length; i++) {
    if (g >= ranges[i][0] && g < ranges[i][1]) return i;
  }
  return ranges.length - 1;
}
const chunksX = planChunks(totalGridX, VOX_MAX_DIM);
const chunksY = planChunks(totalGridY, VOX_MAX_DIM);
const chunksZ = planChunks(totalGridZ, VOX_MAX_DIM);
console.log(`Chunks: X=${chunksX.length}, Y=${chunksY.length}, Z=${chunksZ.length}`);

function makeChunk(id, content, children = Buffer.alloc(0)) {
  const h = Buffer.alloc(12);
  h.write(id, 0, 4, 'ascii');
  h.writeUInt32LE(content.length, 4);
  h.writeUInt32LE(children.length, 8);
  return Buffer.concat([h, content, children]);
}

function writeVoxFile(filePath, gridW, gridH, gridD, voxels) {
  const sizeContent = Buffer.alloc(12);
  sizeContent.writeUInt32LE(gridW, 0);
  sizeContent.writeUInt32LE(gridH, 4);
  sizeContent.writeUInt32LE(gridD, 8);

  const xyziContent = Buffer.alloc(4 + voxels.length * 4);
  xyziContent.writeUInt32LE(voxels.length, 0);
  for (let i = 0; i < voxels.length; i++) {
    const v = voxels[i];
    const o = 4 + i*4;
    xyziContent.writeUInt8(v.x, o);
    xyziContent.writeUInt8(v.y, o+1);
    xyziContent.writeUInt8(v.z, o+2);
    xyziContent.writeUInt8(v.ci, o+3);
  }
  const rgbaContent = Buffer.alloc(256 * 4);
  for (let i = 0; i < 256; i++) {
    rgbaContent.writeUInt8(palette[i] ? palette[i][0] : 0, i*4);
    rgbaContent.writeUInt8(palette[i] ? palette[i][1] : 0, i*4+1);
    rgbaContent.writeUInt8(palette[i] ? palette[i][2] : 0, i*4+2);
    rgbaContent.writeUInt8(255, i*4+3);
  }
  const main = Buffer.concat([
    makeChunk('SIZE', sizeContent),
    makeChunk('XYZI', xyziContent),
    makeChunk('RGBA', rgbaContent),
  ]);
  const header = Buffer.alloc(8);
  header.write('VOX ', 0, 4, 'ascii');
  header.writeUInt32LE(150, 4);
  fs.writeFileSync(filePath, Buffer.concat([header, makeChunk('MAIN', Buffer.alloc(0), main)]));
}

function writeBucket(voxelMap, outDir, name) {
  const chunkBuckets = new Map();
  for (const [key, rawCi] of voxelMap) {
    const gx = key % 4096;
    const tmp = Math.floor(key / 4096);
    const gy = tmp % 4096;
    const gz = Math.floor(tmp / 4096);
    const cx = chunkIndex(gx, chunksX);
    const cy = chunkIndex(gy, chunksY);
    const cz = chunkIndex(gz, chunksZ);
    const bk = `${cx}_${cy}_${cz}`;
    let arr = chunkBuckets.get(bk);
    if (!arr) { arr = []; chunkBuckets.set(bk, arr); }
    arr.push({
      x: gx - chunksX[cx][0],
      y: gy - chunksY[cy][0],
      z: gz - chunksZ[cz][0],
      ci: paletteIndexFor(rawCi),
    });
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) {
    if (f.startsWith(`${name}_chunk_`) && f.endsWith('.vox')) {
      fs.unlinkSync(path.join(outDir, f));
    }
  }
  const chunks = [];
  for (let cx = 0; cx < chunksX.length; cx++) {
    for (let cy = 0; cy < chunksY.length; cy++) {
      for (let cz = 0; cz < chunksZ.length; cz++) {
        const bk = `${cx}_${cy}_${cz}`;
        const voxels = chunkBuckets.get(bk);
        if (!voxels || voxels.length === 0) continue;
        const w = chunksX[cx][1] - chunksX[cx][0];
        const h = chunksY[cy][1] - chunksY[cy][0];
        const d = chunksZ[cz][1] - chunksZ[cz][0];
        const fname = `${name}_chunk_${cx}_${cy}_${cz}.vox`;
        const fpath = path.join(outDir, fname);
        writeVoxFile(fpath, w, h, d, voxels);
        chunks.push({
          file: fname,
          offset: [chunksX[cx][0], chunksY[cy][0], chunksZ[cz][0]],
          grid: [w, h, d],
          voxel_count: voxels.length,
        });
      }
    }
  }
  return chunks;
}

// Build palette eagerly using all buckets (deterministic).
for (const m of voxelMaps) {
  for (const ci of m.values()) paletteIndexFor(ci);
}
while (palette.length < 256) palette.push([0, 0, 0]);
console.log(`Palette: ${paletteMap.size} unique entries`);

// === Write base ===
console.log(`\nWriting base city...`);
const baseChunks = writeBucket(voxelMaps[0], BASE, NAME);
fs.writeFileSync(OUT_META, JSON.stringify({
  name: NAME,
  voxel_size: VOXEL_SIZE,
  total_grid: [totalGridX, totalGridY, totalGridZ],
  total_voxel_count: voxelMaps[0].size,
  palette_size: paletteMap.size,
  bounds_meters: [+sizeX.toFixed(3), +sizeY.toFixed(3), +sizeZ.toFixed(3)],
  source: 'C:/Users/user/Downloads/uploads_files_4731107_NEW+CİTY.1blend.blend',
  excluded_objects: [
    ...buildings.flatMap((b) => b.o_groups),
    ...[...instanceOf.keys()],
  ],
  chunks: baseChunks,
}, null, 2));
console.log(`  ${baseChunks.length} chunk(s) → ${OUT_META}`);

// === Write each building ===
if (!fs.existsSync(BUILDINGS_DIR)) fs.mkdirSync(BUILDINGS_DIR, { recursive: true });
const keepBuildingDirs = new Set(buildings.map((b) => b.id));
for (const dir of fs.readdirSync(BUILDINGS_DIR)) {
  if (!keepBuildingDirs.has(dir)) {
    fs.rmSync(path.join(BUILDINGS_DIR, dir), { recursive: true, force: true });
    console.log(`  removed stale building dir: ${dir}`);
  }
}
const buildingsManifest = { voxel_size: VOXEL_SIZE, total_grid: [totalGridX, totalGridY, totalGridZ], buildings: [] };
for (let bi = 0; bi < buildings.length; bi++) {
  const building = buildings[bi];
  const bucketIdx = bucketIndexOf.get(building.id);
  const outDir = path.join(BUILDINGS_DIR, building.id);
  const chunks = writeBucket(voxelMaps[bucketIdx], outDir, building.id);
  const meta = {
    name: building.id,
    voxel_size: VOXEL_SIZE,
    total_grid: [totalGridX, totalGridY, totalGridZ],
    total_voxel_count: voxelMaps[bucketIdx].size,
    palette_size: paletteMap.size,
    bounds_meters: [+sizeX.toFixed(3), +sizeY.toFixed(3), +sizeZ.toFixed(3)],
    source_o_groups: building.o_groups,
    chunks,
  };
  fs.writeFileSync(path.join(outDir, `${building.id}_meta.json`), JSON.stringify(meta, null, 2));
  console.log(`  building ${building.id}: ${chunks.length} chunk(s), ${voxelMaps[bucketIdx].size.toLocaleString()} voxels`);
  buildingsManifest.buildings.push({
    id: building.id,
    name_ja: building.name_ja,
    name_en: building.name_en,
    category: building.category,
    meta_path: `buildings/${building.id}/${building.id}_meta.json`,
    voxel_count: voxelMaps[bucketIdx].size,
  });
}
fs.writeFileSync(BUILDINGS_MANIFEST_PATH, JSON.stringify(buildingsManifest, null, 2));
console.log(`\nWrote buildings manifest → ${BUILDINGS_MANIFEST_PATH}`);

// === Write each prototype ===
if (!fs.existsSync(PROTOTYPES_DIR)) fs.mkdirSync(PROTOTYPES_DIR, { recursive: true });
const keepProtoDirs = new Set(prototypes.map((p) => p.id));
for (const dir of fs.readdirSync(PROTOTYPES_DIR)) {
  if (!keepProtoDirs.has(dir)) {
    fs.rmSync(path.join(PROTOTYPES_DIR, dir), { recursive: true, force: true });
    console.log(`  removed stale prototype dir: ${dir}`);
  }
}
const prototypesManifest = { voxel_size: VOXEL_SIZE, total_grid: [totalGridX, totalGridY, totalGridZ], prototypes: [] };
for (const proto of prototypes) {
  const bucketIdx = bucketIndexOf.get(proto.id);
  const outDir = path.join(PROTOTYPES_DIR, proto.id);
  const chunks = writeBucket(voxelMaps[bucketIdx], outDir, proto.id);
  const instances = protoInstances.get(proto.id) ?? [];
  // offsets[0] is identity (canonical), included so the loader treats every instance uniformly
  const offsets = instances.map((inst) => ({ name: inst.name, offset: inst.offset }));
  const meta = {
    name: proto.id,
    voxel_size: VOXEL_SIZE,
    total_grid: [totalGridX, totalGridY, totalGridZ],
    total_voxel_count: voxelMaps[bucketIdx].size,
    palette_size: paletteMap.size,
    bounds_meters: [+sizeX.toFixed(3), +sizeY.toFixed(3), +sizeZ.toFixed(3)],
    canonical_o_group: offsets[0]?.name ?? null,
    instance_count: offsets.length,
    chunks,
  };
  fs.writeFileSync(path.join(outDir, `${proto.id}_meta.json`), JSON.stringify(meta, null, 2));
  console.log(`  proto ${proto.id}: ${chunks.length} chunk(s), ${voxelMaps[bucketIdx].size.toLocaleString()} voxels, ${offsets.length} instances`);
  prototypesManifest.prototypes.push({
    id: proto.id,
    name_ja: proto.name_ja,
    name_en: proto.name_en,
    category: proto.category,
    meta_path: `prototypes/${proto.id}/${proto.id}_meta.json`,
    instance_count: offsets.length,
    instances: offsets,
  });
}
fs.writeFileSync(PROTOTYPES_MANIFEST_PATH, JSON.stringify(prototypesManifest, null, 2));
console.log(`\nWrote prototypes manifest → ${PROTOTYPES_MANIFEST_PATH}`);
console.log('Done.');
