/**
 * 指定オブジェクトを赤いハイライトで強調した topdown を生成。
 * Usage: node scripts/city-highlight-candidate.mjs name1 name2 ...
 */

import fs from 'fs';
import sharp from 'sharp';

const OBJ = 'C:/Users/user/developsecond/game-assets/field/city/city.obj';
const SRC_PNG = 'C:/Users/user/developsecond/voxel-map/scripts/_renders/city_topdown_hires.png';
const OUT_PNG = 'C:/Users/user/developsecond/voxel-map/scripts/_renders/city_topdown_highlight.png';

const targets = new Set(process.argv.slice(2));
console.log('targets:', [...targets]);

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

let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity;
for (const v of verts) {
  if (v[0] < gMinX) gMinX = v[0]; if (v[0] > gMaxX) gMaxX = v[0];
  if (v[1] < gMinY) gMinY = v[1]; if (v[1] > gMaxY) gMaxY = v[1];
}
const cx = (gMinX + gMaxX) / 2;
const cy = (gMinY + gMaxY) / 2;
const sz = Math.max(gMaxX - gMinX, gMaxY - gMinY);
const orthoScale = sz * 1.1;

const W = 1600, H = 1600;
const worldToPx = (x, y) => [
  400 * (W / 800) + (x - cx) / orthoScale * W,
  400 * (H / 800) - (y - cy) / orthoScale * H,
];

const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`];
let combinedMnX = Infinity, combinedMxX = -Infinity, combinedMnY = Infinity, combinedMxY = -Infinity;

for (const o of objects) {
  if (!targets.has(o.name) || o.idxs.size === 0) continue;
  let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
  for (const vi of o.idxs) {
    const v = verts[vi];
    if (v[0] < mnX) mnX = v[0]; if (v[0] > mxX) mxX = v[0];
    if (v[1] < mnY) mnY = v[1]; if (v[1] > mxY) mxY = v[1];
  }
  if (mnX < combinedMnX) combinedMnX = mnX; if (mxX > combinedMxX) combinedMxX = mxX;
  if (mnY < combinedMnY) combinedMnY = mnY; if (mxY > combinedMxY) combinedMxY = mxY;
  const [x0, y0] = worldToPx(mnX, mxY);
  const [x1, y1] = worldToPx(mxX, mnY);
  parts.push(`<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${(x1-x0).toFixed(1)}" height="${(y1-y0).toFixed(1)}" fill="rgba(255,0,0,0.35)" stroke="#ff0000" stroke-width="4" />`);
}

if (isFinite(combinedMnX)) {
  const [bx0, by0] = worldToPx(combinedMnX, combinedMxY);
  const [bx1, by1] = worldToPx(combinedMxX, combinedMnY);
  // Combined bbox label
  parts.push(`<rect x="${bx0.toFixed(1)}" y="${by0.toFixed(1)}" width="${(bx1-bx0).toFixed(1)}" height="${(by1-by0).toFixed(1)}" fill="none" stroke="#ffff00" stroke-width="3" stroke-dasharray="8,4" />`);
  const lx = (bx0 + bx1) / 2;
  const ly = by0 - 30;
  parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="32" font-family="sans-serif" font-weight="bold" fill="#ffff00" stroke="#000" stroke-width="6" paint-order="stroke" text-anchor="middle">CANDIDATE</text>`);
}
parts.push('</svg>');
const svg = parts.join('\n');
const composite = await sharp(SRC_PNG)
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .png()
  .toBuffer();
fs.writeFileSync(OUT_PNG, composite);
console.log(`Wrote ${OUT_PNG}`);
console.log(`Combined bbox: X[${combinedMnX.toFixed(2)}, ${combinedMxX.toFixed(2)}], Y[${combinedMnY.toFixed(2)}, ${combinedMxY.toFixed(2)}]`);
