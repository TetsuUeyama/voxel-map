/**
 * 4 SE 家 (z.001/z.002/z.003/z.019) と「真ん中の道路」候補ラインを
 * topdown 画像に重ねる。
 */

import fs from 'fs';
import sharp from 'sharp';

const SRC_PNG = 'C:/Users/user/developsecond/voxel-map/scripts/_renders/city_topdown_hires.png';
const OUT_PNG = 'C:/Users/user/developsecond/voxel-map/scripts/_renders/city_east_extension_options.png';

// City topdown render coords: cx=8.44, cy=-10.29, ortho=35.67, image 1600×1600
const cx = 8.44, cy = -10.29, orthoScale = 35.67;
const W = 1600, H = 1600;
const worldToPx = (x, y) => [
  W / 2 + (x - cx) / orthoScale * W,
  H / 2 - (y - cy) / orthoScale * H,
];

// House bboxes in Blender (X, Y)
const houses = {
  'z.001 (SW)': { x: [11.34, 14.37], y: [-24.28, -20.11] },
  'z.002 (SE)': { x: [16.99, 20.02], y: [-24.38, -20.21] },
  'z.019 (NW)': { x: [11.34, 14.37], y: [-19.95, -15.78] },
  'z.003 (NE)': { x: [14.17, 20.02], y: [-20.21, -15.83] },
};

// 4 houses combined bbox
const allX = Object.values(houses).flatMap(h => h.x);
const allY = Object.values(houses).flatMap(h => h.y);
const housesMnX = Math.min(...allX), housesMxX = Math.max(...allX);
const housesMnY = Math.min(...allY), housesMxY = Math.max(...allY);
const housesCenterX = (housesMnX + housesMxX) / 2;
const housesCenterY = (housesMnY + housesMxY) / 2;

// Candidate "middle road" lines:
// (A) N-S road between west pair and east pair  → Blender X ≈ 15.7 (= midpoint between z.001 east edge and z.002 west edge)
// (B) E-W road between south pair and north pair → Blender Y ≈ -19.97
const roadAX = (14.37 + 16.99) / 2;
const roadBY = (-20.11 + -19.95) / 2;

// City east edge (current) Blender X
const cityEastX = 20.79;

const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`];

// Highlight 4 houses
for (const [name, h] of Object.entries(houses)) {
  const [x0, y0] = worldToPx(h.x[0], h.y[1]);
  const [x1, y1] = worldToPx(h.x[1], h.y[0]);
  parts.push(`<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${(x1-x0).toFixed(1)}" height="${(y1-y0).toFixed(1)}" fill="rgba(0,200,255,0.25)" stroke="#00aaff" stroke-width="3" />`);
  parts.push(`<text x="${((x0+x1)/2).toFixed(1)}" y="${((y0+y1)/2).toFixed(1)}" font-size="22" font-weight="bold" fill="#00aaff" stroke="#000" stroke-width="4" paint-order="stroke" text-anchor="middle">${name}</text>`);
}

// (A) N-S road inside 4 houses
const [aX, aY0] = worldToPx(roadAX, housesMnY);
const [, aY1] = worldToPx(roadAX, housesMxY);
parts.push(`<line x1="${aX}" y1="${aY0}" x2="${aX}" y2="${aY1}" stroke="#ff8800" stroke-width="6" stroke-dasharray="14,6" />`);
parts.push(`<text x="${aX}" y="${aY0 - 12}" font-size="22" fill="#ff8800" stroke="#000" stroke-width="4" paint-order="stroke" text-anchor="middle">A: 縦の中央道路 X=${roadAX.toFixed(2)}</text>`);

// (B) E-W road inside 4 houses
const [bX0, bY] = worldToPx(housesMnX, roadBY);
const [bX1] = worldToPx(housesMxX, roadBY);
parts.push(`<line x1="${bX0}" y1="${bY}" x2="${bX1}" y2="${bY}" stroke="#88ff00" stroke-width="6" stroke-dasharray="14,6" />`);
parts.push(`<text x="${(bX0+bX1)/2}" y="${bY - 12}" font-size="22" fill="#88ff00" stroke="#000" stroke-width="4" paint-order="stroke" text-anchor="middle">B: 横の中央道路 Y=${roadBY.toFixed(2)}</text>`);

// Current city east edge
const [eX, eY0] = worldToPx(cityEastX, -30);
const [, eY1] = worldToPx(cityEastX, 8);
parts.push(`<line x1="${eX}" y1="${eY0}" x2="${eX}" y2="${eY1}" stroke="#ff00ff" stroke-width="4" />`);
parts.push(`<text x="${eX + 30}" y="${(eY0+eY1)/2}" font-size="20" fill="#ff00ff" stroke="#000" stroke-width="4" paint-order="stroke">現city東端 X=${cityEastX}</text>`);

// East extension options:
// Option X1: extend by width of 4-house cluster (≈ 8.68m) → new east at Blender X ≈ 29.47
// Option X2: extend by half = ≈ 4.34m → new east at X ≈ 25.13
// Option X3: extend by distance from current east edge to road A (X=15.68) → 5.11m → new east at X ≈ 25.9
const ext1 = housesMxX - housesMnX;          // 8.68
const ext2 = (cityEastX - roadAX);           // 5.11

for (const [opt, ext, color, dy] of [
  ['X1', ext1, '#ff5555', 50],
  ['X2', ext2, '#ffaa00', 100],
]) {
  const newEastX = cityEastX + ext;
  const [nX, nY] = worldToPx(newEastX, -25);
  parts.push(`<line x1="${nX}" y1="${nY - 200}" x2="${nX}" y2="${nY + 200}" stroke="${color}" stroke-width="4" stroke-dasharray="6,6" />`);
  parts.push(`<text x="${nX + 8}" y="${nY + dy}" font-size="20" fill="${color}" stroke="#000" stroke-width="4" paint-order="stroke">${opt}: +${ext.toFixed(2)}m → X=${newEastX.toFixed(2)}</text>`);
}

parts.push('</svg>');
const svg = parts.join('\n');
const composite = await sharp(SRC_PNG)
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .png()
  .toBuffer();
fs.writeFileSync(OUT_PNG, composite);
console.log(`Wrote ${OUT_PNG}`);
console.log(`  4 houses combined bbox: X[${housesMnX}, ${housesMxX}] Y[${housesMnY}, ${housesMxY}]`);
console.log(`  Road A (N-S middle): Blender X = ${roadAX.toFixed(2)}`);
console.log(`  Road B (E-W middle): Blender Y = ${roadBY.toFixed(2)}`);
console.log(`  Option X1 (extend by cluster width 8.68m): new east X = ${(cityEastX + ext1).toFixed(2)}`);
console.log(`  Option X2 (extend by gap to road A 5.11m): new east X = ${(cityEastX + ext2).toFixed(2)}`);
