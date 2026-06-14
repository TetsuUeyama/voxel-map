/**
 * Re-voxelize cafe.obj while excluding named OBJ objects ('o' groups).
 *
 * Usage:
 *   node scripts/cafe-revoxelize-excluding.mjs <voxelSize> <excludeName1> [excludeName2 ...]
 * Example:
 *   node scripts/cafe-revoxelize-excluding.mjs 0.05 Plane011
 */

import fs from 'fs';
import path from 'path';

const BASE = 'C:/Users/user/developsecond/game-assets/field/cafe';
const NAME = 'cafe';
const OBJ_PATH = path.join(BASE, `${NAME}.obj`);
const COLOR_JSON = path.join(BASE, `${NAME}_colors.json`);
const OUT_META = path.join(BASE, `${NAME}_meta.json`);

const VOXEL_SIZE = parseFloat(process.argv[2]);
const EXCLUDE = new Set(process.argv.slice(3));
if (!VOXEL_SIZE || !isFinite(VOXEL_SIZE)) {
  console.error('Usage: node cafe-revoxelize-excluding.mjs <voxelSize> <excludeObjName...>');
  process.exit(1);
}
const VOX_MAX_DIM = 256;

console.log(`voxelSize = ${VOXEL_SIZE} m`);
console.log(`Excluding ${EXCLUDE.size} objects: ${[...EXCLUDE].join(', ')}`);

const colors = JSON.parse(fs.readFileSync(COLOR_JSON, 'utf-8'));
console.log(`Reading ${OBJ_PATH}...`);
const objText = fs.readFileSync(OBJ_PATH, 'utf-8');

// We compute bounds AFTER excluding the floor so the resulting bbox is tight
// around the actual building (allows the consumer to know cafe extents).
const allVerts = [];
const keepVertSet = new Set(); // vertex indices touched by non-excluded faces
const faces = [];
const faceColors = [];
const colorByMtl = new Map();
let curColorIdx = -1;
let curObjName = '';
let curObjExcluded = false;
let excludedFaceCount = 0;
let keptFaceCount = 0;

for (const line of objText.split('\n')) {
  if (!line) continue;
  const c = line.charCodeAt(0);
  if (c === 118 && line.charCodeAt(1) === 32) {
    const p = line.split(' ');
    allVerts.push(+p[1], -(+p[2]), +p[3]);
  } else if (c === 111 && line.charCodeAt(1) === 32) {
    curObjName = line.substring(2).trim();
    curObjExcluded = EXCLUDE.has(curObjName);
  } else if (c === 102 && line.charCodeAt(1) === 32) {
    const p = line.split(' ');
    const a = parseInt(p[1]) - 1;
    let prev = parseInt(p[2]) - 1;
    for (let i = 3; i < p.length; i++) {
      const c2 = parseInt(p[i]) - 1;
      if (curObjExcluded) {
        excludedFaceCount++;
      } else {
        faces.push(a, prev, c2, curColorIdx);
        keepVertSet.add(a); keepVertSet.add(prev); keepVertSet.add(c2);
        keptFaceCount++;
      }
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

const numVerts = allVerts.length / 3;
const numFaces = faces.length / 4;
console.log(`Parsed: ${numVerts.toLocaleString()} verts (${keepVertSet.size.toLocaleString()} used), kept=${keptFaceCount.toLocaleString()}, excluded=${excludedFaceCount.toLocaleString()} faces`);
if (excludedFaceCount === 0 && EXCLUDE.size > 0) {
  console.error('WARNING: no faces were excluded — object names did not match any "o" group in OBJ.');
}

// Compute bounds from used vertices only (so bbox tightens after exclusion)
let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
for (const vi of keepVertSet) {
  const x = allVerts[vi*3], y = allVerts[vi*3+1], z = allVerts[vi*3+2];
  if (x < minX) minX = x; if (x > maxX) maxX = x;
  if (y < minY) minY = y; if (y > maxY) maxY = y;
  if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
}
const sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
console.log(`Bounds (used verts): ${sizeX.toFixed(2)} × ${sizeY.toFixed(2)} × ${sizeZ.toFixed(2)} m`);

const totalGridX = Math.ceil(sizeX / VOXEL_SIZE) + 1;
const totalGridY = Math.ceil(sizeY / VOXEL_SIZE) + 1;
const totalGridZ = Math.ceil(sizeZ / VOXEL_SIZE) + 1;
console.log(`Total grid: ${totalGridX} × ${totalGridY} × ${totalGridZ}`);

console.log('Voxelizing...');
const t0 = Date.now();
const voxelMap = new Map();
const VS = VOXEL_SIZE;
const reportEvery = Math.max(1, Math.floor(numFaces / 20));

for (let fi = 0; fi < numFaces; fi++) {
  const base = fi * 4;
  const i0 = faces[base] * 3;
  const i1 = faces[base+1] * 3;
  const i2 = faces[base+2] * 3;
  const ci = faces[base+3];
  if (ci < 0) continue;

  const x0 = allVerts[i0],   y0 = allVerts[i0+1], z0 = allVerts[i0+2];
  const x1 = allVerts[i1],   y1 = allVerts[i1+1], z1 = allVerts[i1+2];
  const x2 = allVerts[i2],   y2 = allVerts[i2+1], z2 = allVerts[i2+2];

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
      // Some vertices outside the new bbox would crash; clamp by skipping
      if (px < minX || px > maxX || py < minY || py > maxY || pz < minZ || pz > maxZ) continue;
      const gx = ((px - minX) / VS) | 0;
      const gy = ((py - minY) / VS) | 0;
      const gz = ((pz - minZ) / VS) | 0;
      const key = gx + gy * 4096 + gz * 16777216;
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

function chunkIndex(g, ranges) {
  for (let i = 0; i < ranges.length; i++) {
    if (g >= ranges[i][0] && g < ranges[i][1]) return i;
  }
  return ranges.length - 1;
}

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
while (palette.length < 256) palette.push([0, 0, 0]);
console.log(`Palette: ${paletteMap.size} unique entries`);

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

// Clean up old chunk files first
for (const f of fs.readdirSync(BASE)) {
  if ((f.startsWith(`${NAME}_chunk_`) || f === `${NAME}.vox`) && f.endsWith('.vox')) {
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
        ? `${NAME}.vox`
        : `${NAME}_chunk_${cx}_${cy}_${cz}.vox`;
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

if (chunks.length > 1) {
  const stale = path.join(BASE, `${NAME}.vox`);
  if (fs.existsSync(stale)) fs.unlinkSync(stale);
}

fs.writeFileSync(OUT_META, JSON.stringify({
  name: NAME,
  voxel_size: VOXEL_SIZE,
  total_grid: [totalGridX, totalGridY, totalGridZ],
  total_voxel_count: voxelMap.size,
  palette_size: paletteMap.size,
  bounds_meters: [+sizeX.toFixed(3), +sizeY.toFixed(3), +sizeZ.toFixed(3)],
  source: 'C:/Users/user/Downloads/uploads_files_6212131_Cafe/Cafe.fbx',
  excluded_objects: [...EXCLUDE],
  chunks,
}, null, 2));

console.log(`\nWrote ${chunks.length} chunk(s) and ${OUT_META}`);
console.log(`Excluded: ${[...EXCLUDE].join(', ')}`);
