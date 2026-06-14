/**
 * city.obj から AB17 ビル1 跡地周辺 (X[15.88, 20.07], Y[-10.63, -6.13]) の
 * 「地面/道路」候補メッシュ (薄くて広い) を抽出し、Z 高さを報告する。
 */

import fs from 'fs';

const OBJ = 'C:/Users/user/developsecond/game-assets/field/city/city.obj';

const text = fs.readFileSync(OBJ, 'utf-8');
const verts = [];
const objects = [];
let cur = null;
for (const line of text.split('\n')) {
  if (!line) continue;
  const c0 = line.charCodeAt(0);
  if (c0 === 118 && line.charCodeAt(1) === 32) {
    const p = line.split(' ');
    verts.push([+p[1], +p[2], +p[3]]);
  } else if (line.startsWith('o ')) {
    cur = { name: line.substring(2).trim(), idxs: new Set() };
    objects.push(cur);
  } else if (c0 === 102 && line.charCodeAt(1) === 32 && cur) {
    const p = line.split(' ');
    for (let i = 1; i < p.length; i++) {
      const vi = parseInt(p[i].split('/')[0]) - 1;
      if (!isNaN(vi)) cur.idxs.add(vi);
    }
  }
}

let gMinZ = Infinity;
for (const v of verts) if (v[2] < gMinZ) gMinZ = v[2];
console.log(`Global Blender minZ: ${gMinZ.toFixed(3)} (this maps to world y=0)`);

// Lot bbox in Blender space
const LOT_X = [15.88, 20.07], LOT_Y = [-10.63, -6.13];
console.log(`Lot bbox: X[${LOT_X.join(', ')}], Y[${LOT_Y.join(', ')}]`);

// Find meshes that overlap the lot in XY and are flat (low Z thickness)
const candidates = [];
for (const o of objects) {
  if (o.idxs.size === 0) continue;
  let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity, mnZ = Infinity, mxZ = -Infinity;
  for (const vi of o.idxs) {
    const v = verts[vi];
    if (v[0] < mnX) mnX = v[0]; if (v[0] > mxX) mxX = v[0];
    if (v[1] < mnY) mnY = v[1]; if (v[1] > mxY) mxY = v[1];
    if (v[2] < mnZ) mnZ = v[2]; if (v[2] > mxZ) mxZ = v[2];
  }
  // Overlap with lot?
  const overlapX = !(mxX < LOT_X[0] || mnX > LOT_X[1]);
  const overlapY = !(mxY < LOT_Y[0] || mnY > LOT_Y[1]);
  if (!overlapX || !overlapY) continue;
  const dz = mxZ - mnZ;
  candidates.push({ name: o.name, mnZ, mxZ, dz, area: (mxX - mnX) * (mxY - mnY), mnX, mxX, mnY, mxY });
}

console.log(`\n${candidates.length} meshes overlap the lot bbox.`);
console.log('--- Flat surfaces near the lot (sorted by mxZ ascending = closest to ground) ---');
candidates.filter(c => c.dz < 1.0).sort((a, b) => a.mxZ - b.mxZ);
const flat = candidates.filter(c => c.dz < 1.0).sort((a, b) => a.mxZ - b.mxZ);
for (const c of flat.slice(0, 25)) {
  console.log(`${c.name.padEnd(20)} | top Z=${c.mxZ.toFixed(3).padStart(6)} world_y=${(c.mxZ - gMinZ).toFixed(3).padStart(6)} | dz=${c.dz.toFixed(3)} | area ${c.area.toFixed(1)}m²`);
}
