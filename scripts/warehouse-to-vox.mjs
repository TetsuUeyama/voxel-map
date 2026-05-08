/**
 * warehouse6.obj + warehouse6_colors.json → warehouse6.vox(s)
 *
 * Voxelizes the warehouse mesh at the given voxelSize (default 0.10m).
 * Auto-splits along the longest axis when any grid dimension exceeds VOX
 * format's 256 limit. Emits a master meta.json describing chunks.
 *
 * Usage: node warehouse-to-vox.mjs [voxelSize]
 *   voxelSize defaults to 0.10 (meters per voxel)
 */

import fs from 'fs';
import path from 'path';

const BASE = 'C:/Users/user/developsecond/game-assets/field/warehouse';
const OBJ_PATH = path.join(BASE, 'warehouse6.obj');
const COLOR_JSON = path.join(BASE, 'warehouse6_colors.json');
const OUT_META = path.join(BASE, 'warehouse6_meta.json');

const VOXEL_SIZE = parseFloat(process.argv[2]) || 0.10;
const VOX_MAX_DIM = 256;

// ── Load colors ─────────────────────────────────────────────────────
const colors = JSON.parse(fs.readFileSync(COLOR_JSON, 'utf-8'));
console.log(`voxelSize = ${VOXEL_SIZE} m`);
console.log(`Loaded ${Object.keys(colors).length} material colors`);

// ── Parse OBJ ───────────────────────────────────────────────────────
console.log(`Reading ${OBJ_PATH}...`);
const objText = fs.readFileSync(OBJ_PATH, 'utf-8');
console.log(`OBJ ${(objText.length / 1024 / 1024).toFixed(1)} MB, parsing...`);

const verts = [];
const faces = [];   // flat: i0, i1, i2, ci, i0, i1, i2, ci ...
const faceColors = [];
const colorByMtl = new Map();
let curColorIdx = -1;

for (const line of objText.split('\n')) {
  if (!line) continue;
  const c = line.charCodeAt(0);
  if (c === 118 && line.charCodeAt(1) === 32) {
    const p = line.split(' ');
    verts.push(+p[1], +p[2], +p[3]);
  } else if (c === 102 && line.charCodeAt(1) === 32) {
    const p = line.split(' ');
    const a = parseInt(p[1]) - 1;
    let prev = parseInt(p[2]) - 1;
    for (let i = 3; i < p.length; i++) {
      const c2 = parseInt(p[i]) - 1;
      faces.push(a, prev, c2, curColorIdx);
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

const numVerts = verts.length / 3;
const numFaces = faces.length / 4;
console.log(`Parsed: ${numVerts.toLocaleString()} verts, ${numFaces.toLocaleString()} triangles, ${faceColors.length} unique materials`);

// ── Compute bounds ──────────────────────────────────────────────────
let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
for (let i = 0; i < verts.length; i += 3) {
  if (verts[i] < minX) minX = verts[i]; if (verts[i] > maxX) maxX = verts[i];
  if (verts[i+1] < minY) minY = verts[i+1]; if (verts[i+1] > maxY) maxY = verts[i+1];
  if (verts[i+2] < minZ) minZ = verts[i+2]; if (verts[i+2] > maxZ) maxZ = verts[i+2];
}
const sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
console.log(`Bounds: ${sizeX.toFixed(2)} × ${sizeY.toFixed(2)} × ${sizeZ.toFixed(2)} m`);

const totalGridX = Math.ceil(sizeX / VOXEL_SIZE) + 1;
const totalGridY = Math.ceil(sizeY / VOXEL_SIZE) + 1;
const totalGridZ = Math.ceil(sizeZ / VOXEL_SIZE) + 1;
console.log(`Total grid: ${totalGridX} × ${totalGridY} × ${totalGridZ}`);

// ── Voxelize whole model into a single sparse map ───────────────────
console.log('Voxelizing...');
const t0 = Date.now();
const voxelMap = new Map();   // key = gx + gy*1024 + gz*1024^2  (each up to ~10 bits)
const VS = VOXEL_SIZE;
const reportEvery = Math.max(1, Math.floor(numFaces / 20));

for (let fi = 0; fi < numFaces; fi++) {
  const base = fi * 4;
  const i0 = faces[base] * 3;
  const i1 = faces[base+1] * 3;
  const i2 = faces[base+2] * 3;
  const ci = faces[base+3];
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
      const key = gx + gy * 1024 + gz * 1048576;
      if (!voxelMap.has(key)) voxelMap.set(key, ci);
    }
  }

  if (fi > 0 && fi % reportEvery === 0) {
    const pct = (fi / numFaces * 100).toFixed(0);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${pct}%  voxels=${voxelMap.size.toLocaleString()}  elapsed=${elapsed}s`);
  }
}

console.log(`Voxelized: ${voxelMap.size.toLocaleString()} voxels in ${((Date.now()-t0)/1000).toFixed(1)}s`);

// ── Decide chunking ─────────────────────────────────────────────────
function planChunks(n, max) {
  if (n <= max) return [[0, n]];
  const ranges = [];
  for (let s = 0; s < n; s += max) {
    ranges.push([s, Math.min(s + max, n)]);
  }
  return ranges;
}
const chunksX = planChunks(totalGridX, VOX_MAX_DIM);
const chunksY = planChunks(totalGridY, VOX_MAX_DIM);
const chunksZ = planChunks(totalGridZ, VOX_MAX_DIM);
console.log(`Chunks: X=${chunksX.length}, Y=${chunksY.length}, Z=${chunksZ.length}`);

// ── Build palette across all voxels ─────────────────────────────────
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

// ── Bin voxels into chunk buckets ───────────────────────────────────
function chunkIndex(g, ranges) {
  for (let i = 0; i < ranges.length; i++) {
    if (g >= ranges[i][0] && g < ranges[i][1]) return i;
  }
  return ranges.length - 1;
}

const chunkBuckets = new Map(); // key = "cx_cy_cz" → array of {x,y,z,ci}
for (const [key, rawCi] of voxelMap) {
  const gx = key & 1023;
  const gy = (key >> 10) & 1023;
  const gz = (key >> 20) & 1023;
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
while (palette.length < 256) palette.push([0, 0, 0]);
console.log(`Palette: ${paletteMap.size} unique entries`);

// ── Write each chunk as VOX file ────────────────────────────────────
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
    rgbaContent.writeUInt8(palette[i][0], i*4);
    rgbaContent.writeUInt8(palette[i][1], i*4+1);
    rgbaContent.writeUInt8(palette[i][2], i*4+2);
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

// Clean up any old chunk files first
for (const f of fs.readdirSync(BASE)) {
  if (f.startsWith('warehouse6_chunk_') && f.endsWith('.vox')) {
    fs.unlinkSync(path.join(BASE, f));
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

      const fname = chunks.length === 0 && chunksX.length === 1 && chunksY.length === 1 && chunksZ.length === 1
        ? 'warehouse6.vox'
        : `warehouse6_chunk_${cx}_${cy}_${cz}.vox`;
      const fpath = path.join(BASE, fname);
      writeVoxFile(fpath, w, h, d, voxels);

      chunks.push({
        file: fname,
        offset: [chunksX[cx][0], chunksY[cy][0], chunksZ[cz][0]],
        grid: [w, h, d],
        voxel_count: voxels.length,
      });
      console.log(`  wrote ${fname}  grid=${w}×${h}×${d}  voxels=${voxels.length.toLocaleString()}  (${(fs.statSync(fpath).size/1024).toFixed(0)} KB)`);
    }
  }
}

// Remove single-chunk warehouse6.vox if we have multi-chunk output (avoid stale file)
if (chunks.length > 1) {
  const stale = path.join(BASE, 'warehouse6.vox');
  if (fs.existsSync(stale)) fs.unlinkSync(stale);
}

fs.writeFileSync(OUT_META, JSON.stringify({
  name: 'warehouse6',
  voxel_size: VOXEL_SIZE,
  total_grid: [totalGridX, totalGridY, totalGridZ],
  total_voxel_count: voxelMap.size,
  palette_size: paletteMap.size,
  bounds_meters: [+sizeX.toFixed(3), +sizeY.toFixed(3), +sizeZ.toFixed(3)],
  source: 'F:/MAP/uploads_files_2883707_warehouse6.blend',
  chunks,
}, null, 2));

console.log(`\nWrote ${chunks.length} chunk(s) and ${OUT_META}`);
