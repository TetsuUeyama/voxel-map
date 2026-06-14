/**
 * city.obj から各 'o' グループの bbox を抽出し、Blender Y (= viewer +Z = 北/南 軸) 軸で
 * 最も南側 (= Blender Y 最小) にある「ビル候補」(地面より背の高いもの) を列挙する。
 *
 * Usage: node scripts/city-find-south.mjs
 */

import fs from 'fs';

const OBJ = 'C:/Users/user/developsecond/game-assets/field/city/city.obj';

const text = fs.readFileSync(OBJ, 'utf-8');
const verts = []; // 1-indexed: verts[i] = [x,y,z] in Blender space
const objects = []; // [{ name, vIdxSet }]
let cur = null;

for (const line of text.split('\n')) {
  if (!line) continue;
  const c0 = line.charCodeAt(0);
  if (c0 === 118 && line.charCodeAt(1) === 32) {
    const p = line.split(' ');
    verts.push([+p[1], +p[2], +p[3]]); // Blender X, Y, Z
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

console.log(`Verts: ${verts.length.toLocaleString()}, objects: ${objects.length}`);

// Compute global bounds
let gMinY = Infinity, gMaxY = -Infinity;
let gMinZ = Infinity, gMaxZ = -Infinity;
for (const v of verts) {
  if (v[1] < gMinY) gMinY = v[1]; if (v[1] > gMaxY) gMaxY = v[1];
  if (v[2] < gMinZ) gMinZ = v[2]; if (v[2] > gMaxZ) gMaxZ = v[2];
}
console.log(`Global Blender Y range: [${gMinY.toFixed(2)}, ${gMaxY.toFixed(2)}]  (low Y = south)`);
console.log(`Global Blender Z range: [${gMinZ.toFixed(2)}, ${gMaxZ.toFixed(2)}]  (Z = up)`);

// Compute per-object bbox in Blender space
const groundZ = gMinZ;
const heightThreshold = 1.5; // meters above ground -> "tall structure" candidate
const items = [];
for (const o of objects) {
  if (o.idxs.size === 0) continue;
  let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity, mnZ = Infinity, mxZ = -Infinity;
  for (const vi of o.idxs) {
    const v = verts[vi];
    if (v[0] < mnX) mnX = v[0]; if (v[0] > mxX) mxX = v[0];
    if (v[1] < mnY) mnY = v[1]; if (v[1] > mxY) mxY = v[1];
    if (v[2] < mnZ) mnZ = v[2]; if (v[2] > mxZ) mxZ = v[2];
  }
  const height = mxZ - groundZ;
  items.push({
    name: o.name,
    bx: [mnX, mxX], by: [mnY, mxY], bz: [mnZ, mxZ],
    cx: (mnX + mxX) / 2, cy: (mnY + mxY) / 2,
    height,
    nVerts: o.idxs.size,
  });
}

// Filter: tall enough to be a building (skip ground / road / curbs)
const tall = items.filter(i => i.height >= heightThreshold);
console.log(`\nTall candidates (height >= ${heightThreshold}m): ${tall.length}`);

// Sort by southmost (lowest Blender Y center), then lowest height-tie by name
tall.sort((a, b) => a.cy - b.cy);

console.log('\nTop 20 southernmost tall objects:');
console.log('rank | name                                    | center_Y | range_Y           | range_X           | height');
for (let i = 0; i < Math.min(20, tall.length); i++) {
  const t = tall[i];
  console.log(
    `${String(i+1).padStart(4)} | ${t.name.padEnd(40).substring(0,40)} | ${t.cy.toFixed(2).padStart(8)} | [${t.by[0].toFixed(2).padStart(7)}, ${t.by[1].toFixed(2).padStart(7)}] | [${t.bx[0].toFixed(2).padStart(7)}, ${t.bx[1].toFixed(2).padStart(7)}] | ${t.height.toFixed(2).padStart(5)}m`
  );
}

// Group by very close center_Y to identify building "clusters" — within 1m of one another
// (a single building usually has multiple meshes — facade, windows, roof...)
console.log('\nClusters at south end (centers grouped within 2m of each other):');
const groups = [];
for (const t of tall) {
  const existing = groups.find(g => Math.abs(g.cy - t.cy) < 2.0 && Math.abs(g.cx - t.cx) < 6.0);
  if (existing) {
    existing.items.push(t);
    existing.cy = (existing.cy * (existing.items.length - 1) + t.cy) / existing.items.length;
    existing.cx = (existing.cx * (existing.items.length - 1) + t.cx) / existing.items.length;
    existing.minY = Math.min(existing.minY, t.by[0]);
    existing.maxY = Math.max(existing.maxY, t.by[1]);
    existing.minX = Math.min(existing.minX, t.bx[0]);
    existing.maxX = Math.max(existing.maxX, t.bx[1]);
    existing.maxH = Math.max(existing.maxH, t.height);
  } else {
    groups.push({
      cy: t.cy, cx: t.cx,
      minY: t.by[0], maxY: t.by[1], minX: t.bx[0], maxX: t.bx[1],
      maxH: t.height,
      items: [t],
    });
  }
}
groups.sort((a, b) => a.cy - b.cy);
console.log('rank | center_Y | center_X | Y range          | X range          | maxH | nMeshes');
for (let i = 0; i < Math.min(8, groups.length); i++) {
  const g = groups[i];
  console.log(
    `${String(i+1).padStart(4)} | ${g.cy.toFixed(2).padStart(8)} | ${g.cx.toFixed(2).padStart(8)} | [${g.minY.toFixed(2).padStart(7)}, ${g.maxY.toFixed(2).padStart(7)}] | [${g.minX.toFixed(2).padStart(7)}, ${g.maxX.toFixed(2).padStart(7)}] | ${g.maxH.toFixed(2).padStart(4)} | ${g.items.length}`
  );
}
