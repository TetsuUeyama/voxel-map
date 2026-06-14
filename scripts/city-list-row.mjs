/**
 * 指定オブジェクト名のパターンに一致する 'o' グループの bbox を列挙する。
 * Usage: node scripts/city-list-row.mjs [pattern1] [pattern2] ...
 *   例: node scripts/city-list-row.mjs AB17 adidas apple mcdonalds
 */

import fs from 'fs';

const OBJ = 'C:/Users/user/developsecond/game-assets/field/city/city.obj';
const patterns = process.argv.slice(2);

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
    const name = line.substring(2).trim();
    if (patterns.length === 0 || patterns.some(p => name.toLowerCase().includes(p.toLowerCase()))) {
      cur = { name, idxs: new Set() };
      objects.push(cur);
    } else {
      cur = null;
    }
  } else if (c0 === 102 && line.charCodeAt(1) === 32 && cur) {
    const p = line.split(' ');
    for (let i = 1; i < p.length; i++) {
      const vi = parseInt(p[i].split('/')[0]) - 1;
      if (!isNaN(vi)) cur.idxs.add(vi);
    }
  }
}

console.log(`Matched ${objects.length} objects`);
console.log('name                          | center_X | center_Y | X range          | Y range          | Z range          | h(Z) ');
console.log('-'.repeat(140));

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
  items.push({ name: o.name, mnX, mxX, mnY, mxY, mnZ, mxZ, cy: (mnY + mxY) / 2, cx: (mnX + mxX) / 2 });
}

items.sort((a, b) => a.cy - b.cy);
for (const t of items) {
  console.log(
    `${t.name.padEnd(30).substring(0, 30)} | ${t.cx.toFixed(2).padStart(8)} | ${t.cy.toFixed(2).padStart(8)} | [${t.mnX.toFixed(2).padStart(7)}, ${t.mxX.toFixed(2).padStart(7)}] | [${t.mnY.toFixed(2).padStart(7)}, ${t.mxY.toFixed(2).padStart(7)}] | [${t.mnZ.toFixed(2).padStart(5)}, ${t.mxZ.toFixed(2).padStart(5)}] | ${(t.mxZ - t.mnZ).toFixed(2).padStart(4)}`
  );
}
