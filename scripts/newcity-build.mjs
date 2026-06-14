/**
 * Voxelize SimplePoly City (Scene_City.obj) — a 3ds Max Wavefront export with
 * 1382 groups, 111 unique prototypes, 69 textured materials. Heavy reuse →
 * thin-instancing is mandatory.
 *
 * Output (under game-assets/field/newcity/):
 *   prototypes/<id>/<id>_meta.json + chunks   — canonical voxelized once
 *   prototypes_manifest.json                  — id + instance offsets list
 *
 * Conventions
 *   • Source uses Y-up, 1 raw unit ≈ 0.025 m (see work-record 2026-05-13).
 *   • We pre-scale verts to meters and convert axes to Babylon Y-up viewer
 *     coordinates inside this script.
 *   • Per-face color = centroid UV sample of the material's PNG texture
 *     (PNG decode via sharp). Quantized & merged into ≤256-entry palette.
 *
 * Coordinate transform (raw 3ds Max Y-up → viewer Y-up):
 *   vert.x =  raw.x * 0.025
 *   vert.y = -raw.z * 0.025     (raw Z = depth → -viewer Z)
 *   vert.z =  raw.y * 0.025     (raw Y = up → viewer Y after Y/Z swap)
 *   (voxelizer then treats vert.y as grid Y which the loader maps to -viewer Z)
 *
 * Usage:
 *   node scripts/newcity-build.mjs <voxelSize>
 * Default voxelSize = 0.05 m.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOURCE_DIR = 'C:/Users/user/Downloads/NewCity/uploads_files_6462436_uploads_files_328363_SimplePoly_City.OBJ/SimplePoly City.FBX';
const OBJ_PATH = path.join(SOURCE_DIR, 'Scene/Scene_City.obj');
const MTL_PATH = path.join(SOURCE_DIR, 'Scene/Scene_City.mtl');
const TEXTURES_DIR = path.join(SOURCE_DIR, 'Scene/Scene_City.fbm');

const OUT_BASE = 'C:/Users/user/developsecond/game-assets/field/newcity';
const PROTOTYPES_DIR = path.join(OUT_BASE, 'prototypes');
const MANIFEST_PATH = path.join(OUT_BASE, 'prototypes_manifest.json');

const RAW_TO_METERS = 0.025;
const VOXEL_SIZE = parseFloat(process.argv[2] ?? '0.05');
if (!VOXEL_SIZE || !isFinite(VOXEL_SIZE)) {
  console.error('Usage: node newcity-build.mjs <voxelSize>');
  process.exit(1);
}
const VOX_MAX_DIM = 256;

console.log(`SimplePoly City voxelizer`);
console.log(`  voxelSize = ${VOXEL_SIZE} m`);
console.log(`  raw→meters = ${RAW_TO_METERS}`);

// ============================================================
// MTL: material name → texture filename (basename, in fbm folder)
// ============================================================
const mtlText = fs.readFileSync(MTL_PATH, 'utf-8');
const materialTexture = new Map(); // matName → texture file basename
const materialKd = new Map();       // matName → [r, g, b] fallback
let curMat = null;
for (const line of mtlText.split('\n')) {
  const trimmed = line.trim();
  if (trimmed.startsWith('newmtl ')) {
    curMat = trimmed.substring(7).trim();
  } else if (curMat && trimmed.startsWith('map_Kd ')) {
    const winPath = trimmed.substring(7).trim();
    const basename = winPath.split(/[\\/]/).pop();
    materialTexture.set(curMat, basename);
  } else if (curMat && trimmed.startsWith('Kd ')) {
    const p = trimmed.split(/\s+/);
    materialKd.set(curMat, [+p[1], +p[2], +p[3]]);
  }
}
console.log(`Materials in MTL: ${materialTexture.size}`);

// ============================================================
// Load all textures with sharp → RGB Uint8Array + width/height
// ============================================================
const textureCache = new Map(); // matName → { data: Uint8Array, w: number, h: number }
const uniqueTextures = new Set(materialTexture.values());
console.log(`Loading ${uniqueTextures.size} unique PNG textures...`);
const tCacheData = new Map(); // basename → { data, w, h }
for (const tex of uniqueTextures) {
  const fp = path.join(TEXTURES_DIR, tex);
  if (!fs.existsSync(fp)) {
    console.warn(`  missing texture: ${tex}`);
    continue;
  }
  const img = sharp(fp);
  const meta = await img.metadata();
  const data = await img.removeAlpha().raw().toBuffer();
  tCacheData.set(tex, { data, w: meta.width, h: meta.height });
}
for (const [mat, tex] of materialTexture) {
  const d = tCacheData.get(tex);
  if (d) textureCache.set(mat, d);
}
console.log(`  ${textureCache.size} materials with textures loaded`);

function sampleTexture(matName, u, v) {
  const tex = textureCache.get(matName);
  if (!tex) {
    const kd = materialKd.get(matName) ?? [0.5, 0.5, 0.5];
    return [kd[0], kd[1], kd[2]];
  }
  // OBJ V coordinate convention: 0 at bottom. Image (0,0) is top-left.
  let uu = u - Math.floor(u);
  let vv = v - Math.floor(v);
  const px = Math.min(tex.w - 1, Math.max(0, Math.floor(uu * tex.w)));
  const py = Math.min(tex.h - 1, Math.max(0, Math.floor((1 - vv) * tex.h)));
  const idx = (py * tex.w + px) * 3;
  return [tex.data[idx] / 255, tex.data[idx + 1] / 255, tex.data[idx + 2] / 255];
}

// ============================================================
// PASS 1: parse OBJ verts + vts + groups (with face vertex idx sets)
//   verts stored TWICE:
//     vertsRaw     — original 3ds Max units (Y-up) — for group bbox / offsets
//     vertsViewer  — pre-scaled to meters + axis-swapped for the voxelizer
// ============================================================
console.log(`\nReading ${OBJ_PATH} (${(fs.statSync(OBJ_PATH).size / 1024 / 1024).toFixed(1)} MB)...`);
const objText = fs.readFileSync(OBJ_PATH, 'utf-8');

const vertsRaw = [];
const vertsViewer = [];
const uvs = [];
const rawLines = objText.split('\n');

for (const line of rawLines) {
  const c0 = line.charCodeAt(0);
  const c1 = line.charCodeAt(1);
  if (c0 === 118 && c1 === 32) {
    // v
    const p = line.split(/\s+/);
    const rx = +p[1], ry = +p[2], rz = +p[3];
    vertsRaw.push(rx, ry, rz);
    // raw Y-up → viewer (x, -z, y) in meters
    vertsViewer.push(rx * RAW_TO_METERS, -rz * RAW_TO_METERS, ry * RAW_TO_METERS);
  } else if (c0 === 118 && c1 === 116) {
    // vt
    const p = line.split(/\s+/);
    uvs.push(+p[1], +p[2]);
  }
}
console.log(`  verts: ${(vertsRaw.length / 3).toLocaleString()}, UVs: ${(uvs.length / 2).toLocaleString()}`);

// Parse groups (g) and faces. Each face: triangulate fan, store
// [v0, v1, v2, faceColorIdx, groupIdx]
const groups = [];
const groupByName = new Map();
let curGroupIdx = -1;
let curMatName = null;
const faces = [];           // [v0, v1, v2, ci, groupIdx]
const facePerGroup = new Map();
const faceColors = [];      // ci → [r, g, b] (per face! unique sampled colors)
let faceColorCounter = 0;

// Reuse same ci for identical colors to keep palette manageable.
// Key = quantized (qr, qg, qb).
const colorIndexCache = new Map();
function getColorIdx(rgb) {
  const qr = Math.round(rgb[0] * 255);
  const qg = Math.round(rgb[1] * 255);
  const qb = Math.round(rgb[2] * 255);
  const k = (qr << 16) | (qg << 8) | qb;
  let i = colorIndexCache.get(k);
  if (i !== undefined) return i;
  i = faceColors.length;
  faceColors.push([rgb[0], rgb[1], rgb[2]]);
  colorIndexCache.set(k, i);
  return i;
}

for (const line of rawLines) {
  const c0 = line.charCodeAt(0);
  if (c0 === 103 && line.charCodeAt(1) === 32) {
    // g
    const name = line.substring(2).trim();
    let info = groupByName.get(name);
    if (!info) {
      info = { name, idx: groups.length, vertIdxs: new Set() };
      groups.push(info);
      groupByName.set(name, info);
    }
    curGroupIdx = info.idx;
  } else if (c0 === 117 && line.startsWith('usemtl ')) {
    curMatName = line.substring(7).trim();
  } else if (c0 === 102 && line.charCodeAt(1) === 32 && curGroupIdx >= 0) {
    // f v/vt/vn v/vt/vn ...
    const parts = line.split(/\s+/);
    // Collect (vIdx, vtIdx) pairs
    const indices = [];
    for (let i = 1; i < parts.length; i++) {
      if (!parts[i]) continue;
      const seg = parts[i].split('/');
      const vi = parseInt(seg[0]) - 1;
      const ti = parseInt(seg[1]) - 1;
      if (!isNaN(vi)) indices.push([vi, isNaN(ti) ? -1 : ti]);
    }
    if (indices.length < 3) continue;
    // Triangulate fan
    const groupInfo = groups[curGroupIdx];
    for (let i = 2; i < indices.length; i++) {
      const a = indices[0], b = indices[i - 1], c = indices[i];
      // centroid UV
      let cu = 0, cv = 0, n = 0;
      for (const [vi, ti] of [a, b, c]) {
        groupInfo.vertIdxs.add(vi);
        if (ti >= 0) { cu += uvs[ti * 2]; cv += uvs[ti * 2 + 1]; n++; }
      }
      let rgb;
      if (n === 3 && curMatName) {
        rgb = sampleTexture(curMatName, cu / 3, cv / 3);
      } else if (curMatName) {
        rgb = materialKd.get(curMatName) ?? [0.5, 0.5, 0.5];
      } else {
        rgb = [0.5, 0.5, 0.5];
      }
      const ci = getColorIdx(rgb);
      faces.push(a[0], b[0], c[0], ci, curGroupIdx);
      facePerGroup.set(curGroupIdx, (facePerGroup.get(curGroupIdx) ?? 0) + 1);
      faceColorCounter++;
    }
  }
}
const numFaces = faces.length / 5;
console.log(`  groups: ${groups.length}, faces: ${numFaces.toLocaleString()}, unique colors: ${faceColors.length}`);

// Compute Raw-space bbox per group
for (const g of groups) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const vi of g.vertIdxs) {
    for (let k = 0; k < 3; k++) {
      const v = vertsRaw[vi * 3 + k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
  }
  g.bcRaw = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  g.size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  g.vc = g.vertIdxs.size;
}

// ============================================================
// PROTOTYPE GROUPING by name (strip trailing _NNN)
// ============================================================
function protoName(name) { return name.replace(/_\d+$/, ''); }
const protoMap = new Map(); // protoName → array of groups
for (const g of groups) {
  if (g.vc === 0) continue;
  const pn = protoName(g.name);
  let arr = protoMap.get(pn);
  if (!arr) { arr = []; protoMap.set(pn, arr); }
  arr.push(g);
}
console.log(`\nPrototype types: ${protoMap.size}`);
const prototypes = [];
let protoIdx = 0;
const groupToProto = new Map(); // groupIdx → { protoIdx, isCanonical }
for (const [pn, gs] of protoMap) {
  // Canonical = the SMALLEST instance (by max bbox dimension). Picking the
  // first-in-OBJ-order can grab a huge "master" object that combines many
  // segments (e.g. one Road_Lane_01_NNN that spans 200m of road), making
  // every "placement" of that prototype overlap the entire scene.
  const canonical = gs.reduce((best, g) => {
    const bestMax = Math.max(best.size[0], best.size[2]);
    const gMax = Math.max(g.size[0], g.size[2]);
    return gMax < bestMax ? g : best;
  }, gs[0]);
  const instances = gs.map((g) => {
    // viewer-space offset relative to canonical.
    // Verified by chaining: viewer.x = rx*K + C, viewer.y = ry*K + C, viewer.z = rz*K + C
    // (the script's vert.y = -rz pre-flip cancels with the loader's viewer.z = -gy mapping).
    const drx = g.bcRaw[0] - canonical.bcRaw[0];
    const dry = g.bcRaw[1] - canonical.bcRaw[1];
    const drz = g.bcRaw[2] - canonical.bcRaw[2];
    return {
      name: g.name,
      offset: [drx * RAW_TO_METERS, dry * RAW_TO_METERS, drz * RAW_TO_METERS],
    };
  });
  prototypes.push({
    pn, idx: protoIdx, canonicalGroupIdx: canonical.idx, instances,
    canonicalRawCenter: canonical.bcRaw, sizeRaw: canonical.size,
  });
  for (const g of gs) {
    groupToProto.set(g.idx, { protoIdx, isCanonical: g === canonical });
  }
  protoIdx++;
}

// ============================================================
// Global bbox of all verts (viewer-meters) — defines the loader's
// total_grid which is shared by every prototype output.
// ============================================================
let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
for (let i = 0; i < vertsViewer.length; i += 3) {
  if (vertsViewer[i] < minX) minX = vertsViewer[i];
  if (vertsViewer[i] > maxX) maxX = vertsViewer[i];
  if (vertsViewer[i + 1] < minY) minY = vertsViewer[i + 1];
  if (vertsViewer[i + 1] > maxY) maxY = vertsViewer[i + 1];
  if (vertsViewer[i + 2] < minZ) minZ = vertsViewer[i + 2];
  if (vertsViewer[i + 2] > maxZ) maxZ = vertsViewer[i + 2];
}
const sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
const totalGridX = Math.ceil(sizeX / VOXEL_SIZE) + 1;
const totalGridY = Math.ceil(sizeY / VOXEL_SIZE) + 1;
const totalGridZ = Math.ceil(sizeZ / VOXEL_SIZE) + 1;
console.log(`Global bbox: ${sizeX.toFixed(2)} × ${sizeY.toFixed(2)} × ${sizeZ.toFixed(2)} m`);
console.log(`Total grid : ${totalGridX} × ${totalGridY} × ${totalGridZ} (voxels @ ${VOXEL_SIZE} m)`);

// ============================================================
// Voxelize each CANONICAL group (only those faces). Each prototype
// gets its own voxelMap.
// ============================================================
const voxelMaps = prototypes.map(() => new Map());
const VS = VOXEL_SIZE;
const verts = vertsViewer;

console.log(`\nVoxelizing ${prototypes.length} canonicals...`);
const t0 = Date.now();
const reportEvery = Math.max(1, Math.floor(numFaces / 20));
let kept = 0, skipped = 0;
for (let fi = 0; fi < numFaces; fi++) {
  const base = fi * 5;
  const i0 = faces[base] * 3;
  const i1 = faces[base + 1] * 3;
  const i2 = faces[base + 2] * 3;
  const ci = faces[base + 3];
  const groupIdx = faces[base + 4];
  const link = groupToProto.get(groupIdx);
  if (!link || !link.isCanonical) { skipped++; continue; }
  kept++;
  const m = voxelMaps[link.protoIdx];
  const x0 = verts[i0],     y0 = verts[i0 + 1], z0 = verts[i0 + 2];
  const x1 = verts[i1],     y1 = verts[i1 + 1], z1 = verts[i1 + 2];
  const x2 = verts[i2],     y2 = verts[i2 + 1], z2 = verts[i2 + 2];
  const dx01 = (x1 - x0) / VS, dy01 = (y1 - y0) / VS, dz01 = (z1 - z0) / VS;
  const dx02 = (x2 - x0) / VS, dy02 = (y2 - y0) / VS, dz02 = (z2 - z0) / VS;
  const e01 = Math.sqrt(dx01 ** 2 + dy01 ** 2 + dz01 ** 2);
  const e02 = Math.sqrt(dx02 ** 2 + dy02 ** 2 + dz02 ** 2);
  const steps = Math.max(4, Math.ceil(Math.max(e01, e02)) * 2);
  const inv = 1 / steps;
  for (let i = 0; i <= steps; i++) {
    const u = i * inv;
    const jmax = steps - i;
    for (let j = 0; j <= jmax; j++) {
      const v = j * inv;
      const w = 1 - u - v;
      const px = w * x0 + u * x1 + v * x2;
      const py = w * y0 + u * y1 + v * y2;
      const pz = w * z0 + u * z1 + v * z2;
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
    const total = voxelMaps.reduce((a, b) => a + b.size, 0);
    console.log(`  ${pct}% kept=${kept.toLocaleString()} skipped=${skipped.toLocaleString()} voxels=${total.toLocaleString()} t=${elapsed}s`);
  }
}
const totalVoxels = voxelMaps.reduce((a, b) => a + b.size, 0);
console.log(`Voxelized: ${totalVoxels.toLocaleString()} voxels in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ============================================================
// Build shared palette (≤256 entries)
// ============================================================
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
      const d = (palette[i][0] - qr) ** 2 + (palette[i][1] - qg) ** 2 + (palette[i][2] - qb) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best + 1;
  }
  palette.push([qr, qg, qb]);
  pi = palette.length;
  paletteMap.set(pkey, pi);
  return pi;
}
for (const m of voxelMaps) for (const ci of m.values()) paletteIndexFor(ci);
while (palette.length < 256) palette.push([0, 0, 0]);
console.log(`Palette: ${paletteMap.size} unique entries (of ${faceColors.length} pre-quantized)`);

// ============================================================
// Chunk planning + .vox writing (reused from existing pipeline)
// ============================================================
function planChunks(n, max) {
  if (n <= max) return [[0, n]];
  const ranges = [];
  for (let s = 0; s < n; s += max) ranges.push([s, Math.min(s + max, n)]);
  return ranges;
}
function chunkIndex(g, ranges) {
  for (let i = 0; i < ranges.length; i++) if (g >= ranges[i][0] && g < ranges[i][1]) return i;
  return ranges.length - 1;
}
const chunksX = planChunks(totalGridX, VOX_MAX_DIM);
const chunksY = planChunks(totalGridY, VOX_MAX_DIM);
const chunksZ = planChunks(totalGridZ, VOX_MAX_DIM);
console.log(`Global chunks: X=${chunksX.length}, Y=${chunksY.length}, Z=${chunksZ.length}`);

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
    const o = 4 + i * 4;
    xyziContent.writeUInt8(v.x, o);
    xyziContent.writeUInt8(v.y, o + 1);
    xyziContent.writeUInt8(v.z, o + 2);
    xyziContent.writeUInt8(v.ci, o + 3);
  }
  const rgbaContent = Buffer.alloc(256 * 4);
  for (let i = 0; i < 256; i++) {
    rgbaContent.writeUInt8(palette[i] ? palette[i][0] : 0, i * 4);
    rgbaContent.writeUInt8(palette[i] ? palette[i][1] : 0, i * 4 + 1);
    rgbaContent.writeUInt8(palette[i] ? palette[i][2] : 0, i * 4 + 2);
    rgbaContent.writeUInt8(255, i * 4 + 3);
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
        writeVoxFile(path.join(outDir, fname), w, h, d, voxels);
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

// Categorize from name prefix for UI grouping later
function categoryOf(pn) {
  if (pn.startsWith('Building_')) return 'building';
  if (pn.startsWith('Natures_')) return 'nature';
  if (pn.startsWith('Props_')) return 'props';
  if (pn.startsWith('Road_')) return 'road';
  if (pn.startsWith('Vehicle_')) return 'vehicle';
  return 'other';
}

// ============================================================
// Write each prototype
// ============================================================
if (!fs.existsSync(PROTOTYPES_DIR)) fs.mkdirSync(PROTOTYPES_DIR, { recursive: true });
const keepDirs = new Set(prototypes.map((p) => p.pn));
for (const dir of fs.readdirSync(PROTOTYPES_DIR)) {
  if (!keepDirs.has(dir)) {
    fs.rmSync(path.join(PROTOTYPES_DIR, dir), { recursive: true, force: true });
    console.log(`  removed stale prototype dir: ${dir}`);
  }
}

const manifest = {
  voxel_size: VOXEL_SIZE,
  raw_to_meters: RAW_TO_METERS,
  total_grid: [totalGridX, totalGridY, totalGridZ],
  bounds_meters: [+sizeX.toFixed(3), +sizeY.toFixed(3), +sizeZ.toFixed(3)],
  source: OBJ_PATH,
  prototypes: [],
};
console.log(`\nWriting prototypes to ${PROTOTYPES_DIR}/...`);
for (const proto of prototypes) {
  const outDir = path.join(PROTOTYPES_DIR, proto.pn);
  const chunks = writeBucket(voxelMaps[proto.idx], outDir, proto.pn);
  const meta = {
    name: proto.pn,
    voxel_size: VOXEL_SIZE,
    total_grid: [totalGridX, totalGridY, totalGridZ],
    total_voxel_count: voxelMaps[proto.idx].size,
    palette_size: paletteMap.size,
    bounds_meters: [+sizeX.toFixed(3), +sizeY.toFixed(3), +sizeZ.toFixed(3)],
    canonical_size_raw: proto.sizeRaw,
    canonical_size_meters: proto.sizeRaw.map((s) => +(s * RAW_TO_METERS).toFixed(3)),
    instance_count: proto.instances.length,
    chunks,
  };
  fs.writeFileSync(path.join(outDir, `${proto.pn}_meta.json`), JSON.stringify(meta, null, 2));
  manifest.prototypes.push({
    id: proto.pn,
    category: categoryOf(proto.pn),
    meta_path: `prototypes/${proto.pn}/${proto.pn}_meta.json`,
    instance_count: proto.instances.length,
    voxel_count: voxelMaps[proto.idx].size,
    instances: proto.instances,
  });
}
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

// Summary
console.log(`\nDone.`);
console.log(`  prototypes: ${prototypes.length}`);
console.log(`  total voxels: ${totalVoxels.toLocaleString()}`);
console.log(`  total instances placed: ${manifest.prototypes.reduce((a, p) => a + p.instance_count, 0).toLocaleString()}`);
const totalSize = manifest.prototypes.reduce((a, p) => {
  const dir = path.join(PROTOTYPES_DIR, p.id);
  let s = 0;
  for (const f of fs.readdirSync(dir)) s += fs.statSync(path.join(dir, f)).size;
  return a + s;
}, 0);
console.log(`  total .vox + meta size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
console.log(`  manifest: ${MANIFEST_PATH}`);
