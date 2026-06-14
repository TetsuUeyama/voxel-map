/**
 * cafe.obj の各 'o' グループの bbox を調べ、床候補 (薄くて広い) と
 * 建物候補 (高さ 1m+) を分類する。
 */

import fs from 'fs';

const OBJ = 'C:/Users/user/developsecond/game-assets/field/cafe/cafe.obj';

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

// Global bounds
let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity, gMinZ = Infinity, gMaxZ = -Infinity;
for (const v of verts) {
  if (v[0] < gMinX) gMinX = v[0]; if (v[0] > gMaxX) gMaxX = v[0];
  if (v[1] < gMinY) gMinY = v[1]; if (v[1] > gMaxY) gMaxY = v[1];
  if (v[2] < gMinZ) gMinZ = v[2]; if (v[2] > gMaxZ) gMaxZ = v[2];
}
const gWidthX = gMaxX - gMinX, gWidthY = gMaxY - gMinY;
console.log(`Global Blender bounds: X[${gMinX.toFixed(2)}, ${gMaxX.toFixed(2)}]  Y[${gMinY.toFixed(2)}, ${gMaxY.toFixed(2)}]  Z[${gMinZ.toFixed(2)}, ${gMaxZ.toFixed(2)}]`);
console.log(`Width: ${gWidthX.toFixed(2)} × ${gWidthY.toFixed(2)}, height: ${(gMaxZ - gMinZ).toFixed(2)}m`);
console.log(`Total objects: ${objects.length}`);

const floorCandidates = [];
const buildingCandidates = [];
const otherItems = [];
for (const o of objects) {
  if (o.idxs.size === 0) continue;
  let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity, mnZ = Infinity, mxZ = -Infinity;
  for (const vi of o.idxs) {
    const v = verts[vi];
    if (v[0] < mnX) mnX = v[0]; if (v[0] > mxX) mxX = v[0];
    if (v[1] < mnY) mnY = v[1]; if (v[1] > mxY) mxY = v[1];
    if (v[2] < mnZ) mnZ = v[2]; if (v[2] > mxZ) mxZ = v[2];
  }
  const dx = mxX - mnX, dy = mxY - mnY, dz = mxZ - mnZ;
  const item = { name: o.name, mnX, mxX, mnY, mxY, mnZ, mxZ, dx, dy, dz, area: dx * dy };
  // Floor heuristic: very flat (dz < 1m) AND covers > 30% of total bbox area
  const coverage = (dx * dy) / (gWidthX * gWidthY);
  if (dz < 1.0 && coverage > 0.30) {
    floorCandidates.push({ ...item, coverage });
  } else if (dz >= 1.0) {
    buildingCandidates.push(item);
  } else {
    otherItems.push(item);
  }
}

console.log(`\n=== Floor candidates (flat & wide, ${floorCandidates.length}) ===`);
floorCandidates.sort((a, b) => b.area - a.area);
for (const f of floorCandidates) {
  console.log(`${f.name.padEnd(30)} | size ${f.dx.toFixed(1).padStart(6)}×${f.dy.toFixed(1).padStart(6)}×${f.dz.toFixed(2).padStart(5)}m | coverage ${(f.coverage*100).toFixed(1)}% | Z[${f.mnZ.toFixed(2)}, ${f.mxZ.toFixed(2)}]`);
}

console.log(`\n=== Building candidates (height ≥ 1m, top 30 by volume) ===`);
buildingCandidates.sort((a, b) => (b.dx * b.dy * b.dz) - (a.dx * a.dy * a.dz));
for (let i = 0; i < Math.min(30, buildingCandidates.length); i++) {
  const b = buildingCandidates[i];
  console.log(`${b.name.padEnd(30)} | size ${b.dx.toFixed(1).padStart(6)}×${b.dy.toFixed(1).padStart(6)}×${b.dz.toFixed(2).padStart(5)}m | Z[${b.mnZ.toFixed(2)}, ${b.mxZ.toFixed(2)}]`);
}
console.log(`\n(${buildingCandidates.length} building-like, ${otherItems.length} small/other items)`);

// Compute bbox of all NON-floor items combined
let bMnX = Infinity, bMxX = -Infinity, bMnY = Infinity, bMxY = -Infinity, bMnZ = Infinity, bMxZ = -Infinity;
for (const item of [...buildingCandidates, ...otherItems]) {
  if (item.mnX < bMnX) bMnX = item.mnX; if (item.mxX > bMxX) bMxX = item.mxX;
  if (item.mnY < bMnY) bMnY = item.mnY; if (item.mxY > bMxY) bMxY = item.mxY;
  if (item.mnZ < bMnZ) bMnZ = item.mnZ; if (item.mxZ > bMxZ) bMxZ = item.mxZ;
}
console.log(`\nNON-floor combined bounds (estimated building extents):`);
console.log(`  X[${bMnX.toFixed(2)}, ${bMxX.toFixed(2)}]  size ${(bMxX-bMnX).toFixed(2)}m`);
console.log(`  Y[${bMnY.toFixed(2)}, ${bMxY.toFixed(2)}]  size ${(bMxY-bMnY).toFixed(2)}m`);
console.log(`  Z[${bMnZ.toFixed(2)}, ${bMxZ.toFixed(2)}]  size ${(bMxZ-bMnZ).toFixed(2)}m`);
