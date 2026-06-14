/**
 * city_topdown.png に高さ ≥ 1.5m のオブジェクトの bbox + 名前を重ねた
 * city_topdown_annotated.png を生成する。
 *
 * カメラ設定 (city-render.py より):
 *   - 直交投影、上から見下ろし、(cx,cy,cz+sz) に配置 / 回転 (0,0,0)
 *   - ortho_scale = sz * 1.1 (sz = max(width,height) Blender XY)
 *   - 解像度 800×800
 *
 * 画像座標:
 *   px = 400 + (X - cx) / ortho_scale * 800
 *   py = 400 - (Y - cy) / ortho_scale * 800   (image Y は world Y の反転)
 */

import fs from 'fs';
import sharp from 'sharp';

const OBJ = 'C:/Users/user/developsecond/game-assets/field/city/city.obj';
const SRC_PNG = 'C:/Users/user/developsecond/voxel-map/scripts/_renders/city_topdown_hires.png';
const OUT_PNG = 'C:/Users/user/developsecond/voxel-map/scripts/_renders/city_topdown_annotated_hires.png';

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

let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity, gMinZ = Infinity, gMaxZ = -Infinity;
for (const v of verts) {
  if (v[0] < gMinX) gMinX = v[0]; if (v[0] > gMaxX) gMaxX = v[0];
  if (v[1] < gMinY) gMinY = v[1]; if (v[1] > gMaxY) gMaxY = v[1];
  if (v[2] < gMinZ) gMinZ = v[2]; if (v[2] > gMaxZ) gMaxZ = v[2];
}
const cx = (gMinX + gMaxX) / 2;
const cy = (gMinY + gMaxY) / 2;
const sz = Math.max(gMaxX - gMinX, gMaxY - gMinY);
const orthoScale = sz * 1.1;

const W = 1600, H = 1600;
const worldToPx = (x, y) => [
  400 + (x - cx) / orthoScale * W,
  400 - (y - cy) / orthoScale * H,
];

console.log(`bounds: X[${gMinX.toFixed(2)}, ${gMaxX.toFixed(2)}]  Y[${gMinY.toFixed(2)}, ${gMaxY.toFixed(2)}]  Z[${gMinZ.toFixed(2)}, ${gMaxZ.toFixed(2)}]`);
console.log(`cx=${cx.toFixed(2)} cy=${cy.toFixed(2)} sz=${sz.toFixed(2)} ortho=${orthoScale.toFixed(2)}`);

const groundZ = gMinZ;
const HEIGHT_MIN = 1.5;
const tall = [];
for (const o of objects) {
  if (o.idxs.size === 0) continue;
  let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity, mnZ = Infinity, mxZ = -Infinity;
  for (const vi of o.idxs) {
    const v = verts[vi];
    if (v[0] < mnX) mnX = v[0]; if (v[0] > mxX) mxX = v[0];
    if (v[1] < mnY) mnY = v[1]; if (v[1] > mxY) mxY = v[1];
    if (v[2] < mnZ) mnZ = v[2]; if (v[2] > mxZ) mxZ = v[2];
  }
  const h = mxZ - groundZ;
  if (h < HEIGHT_MIN) continue;
  // skip very wide objects (fences/walls): aspect > 6
  const dx = mxX - mnX, dy = mxY - mnY;
  const aspect = Math.max(dx / Math.max(dy, 0.1), dy / Math.max(dx, 0.1));
  tall.push({ name: o.name, mnX, mxX, mnY, mxY, h, aspect, area: dx * dy });
}

// SVG overlay
const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`];
parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="none"/>`);
// Cardinal axis indicator: origin in image is (cx, cy) in world
const [oxPx, oyPx] = worldToPx(0, 0);
parts.push(`<text x="${W-60}" y="20" font-size="14" font-weight="bold" fill="#ff0">+Y up = N</text>`);
parts.push(`<text x="${W-60}" y="${H-10}" font-size="14" font-weight="bold" fill="#ff0">-Y down = S</text>`);

for (const t of tall) {
  // Skip very long thin objects (fence/wall) for clarity
  if (t.aspect > 6 && t.area < 30) continue;
  const [x0, y0] = worldToPx(t.mnX, t.mxY); // top-left in image
  const [x1, y1] = worldToPx(t.mxX, t.mnY);
  const w = x1 - x0, h = y1 - y0;
  if (w < 4 || h < 4) continue;
  const colorByHeight = t.h >= 4 ? '#ff3366' : t.h >= 3 ? '#ff8833' : '#33ff66';
  parts.push(`<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="none" stroke="${colorByHeight}" stroke-width="3" />`);
  // Label (centered on bbox)
  const cxp = (x0 + x1) / 2;
  const cyp = (y0 + y1) / 2;
  parts.push(`<text x="${cxp.toFixed(1)}" y="${cyp.toFixed(1)}" font-size="18" font-family="monospace" font-weight="bold" fill="#ffffff" stroke="#000000" stroke-width="3" paint-order="stroke" text-anchor="middle" dominant-baseline="middle">${t.name}</text>`);
}
parts.push('</svg>');
const svg = parts.join('\n');

const composite = await sharp(SRC_PNG)
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .png()
  .toBuffer();
fs.writeFileSync(OUT_PNG, composite);
console.log(`Wrote ${OUT_PNG}  (annotated ${tall.length} tall objects)`);
