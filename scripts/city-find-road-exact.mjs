/**
 * city.obj の主な ground/road メッシュ (Plane.031, TABAN, Plane.107 など) の
 * 正確な bbox を出力する。新しい floor 拡張のサイズ・位置・厚み合わせ用。
 */

import fs from 'fs';

const OBJ = 'C:/Users/user/developsecond/game-assets/field/city/city.obj';
const TARGETS = ['Plane.031', 'Plane.107', 'TABAN', 'Plane.001', 'Plane', 'Plane.002', 'Plane.003'];

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
    if (TARGETS.includes(name)) {
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

let gMinZ = Infinity, gMinX = Infinity, gMinY = Infinity;
for (const v of verts) {
  if (v[0] < gMinX) gMinX = v[0];
  if (v[1] < gMinY) gMinY = v[1];
  if (v[2] < gMinZ) gMinZ = v[2];
}
console.log(`Global Blender minZ=${gMinZ}, minX=${gMinX}, minY=${gMinY}`);
console.log(`(world y for Z=z: y = z - ${gMinZ})`);
console.log();

// City voxel parameters
const VS = 0.025;
const totGX = 990, totGY = 1299, totGZ = 235;
const cx = totGX * VS / 2; // 12.375
const cz = totGY * VS / 2; // 16.2375
const cityCenterX = (gMinX + 20.79) / 2; // approx blender X center

// Recompute exact city center from used Blender coords
let allMinX = Infinity, allMaxX = -Infinity, allMinY = Infinity, allMaxY = -Infinity;
for (const v of verts) {
  if (v[0] < allMinX) allMinX = v[0]; if (v[0] > allMaxX) allMaxX = v[0];
  if (v[1] < allMinY) allMinY = v[1]; if (v[1] > allMaxY) allMaxY = v[1];
}
const blenderCenterX = (allMinX + allMaxX) / 2;
const blenderCenterY = (allMinY + allMaxY) / 2;
console.log(`Blender bbox center: (${blenderCenterX.toFixed(3)}, ${blenderCenterY.toFixed(3)})`);
console.log(`Voxel grid extent: ±${cx} (X), ±${cz} (Z)`);
console.log();

for (const o of objects) {
  if (o.idxs.size === 0) continue;
  let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity, mnZ = Infinity, mxZ = -Infinity;
  for (const vi of o.idxs) {
    const v = verts[vi];
    if (v[0] < mnX) mnX = v[0]; if (v[0] > mxX) mxX = v[0];
    if (v[1] < mnY) mnY = v[1]; if (v[1] > mxY) mxY = v[1];
    if (v[2] < mnZ) mnZ = v[2]; if (v[2] > mxZ) mxZ = v[2];
  }
  // Voxelizer: viewer X = blender X - blenderCenterX (well, actually offset by -minX + ... to grid)
  // Loader does mesh.position.set(oX*s - cx, ...)
  // gx = (blenderX - allMinX) / VS, viewer X = -cx + gx*VS = -cx + (blenderX - allMinX)
  const viewerXmin = -cx + (mnX - allMinX);
  const viewerXmax = -cx + (mxX - allMinX);
  // For viewer Z: voxelizer Y = -blenderY, gy = (voxY - voxYmin) / VS = (-blenderY - (-(allMaxY))) / VS
  //   = (allMaxY - blenderY) / VS
  // viewer Z = -gy*VS + cz
  //   (highest blenderY → lowest gy → highest viewer Z)
  const viewerZmax = -((allMaxY - mxY)) + cz;
  const viewerZmin = -((allMaxY - mnY)) + cz;
  // Voxel layer: gz = floor((blenderZ - allMinZ)/VS), top face = (gz+1)*VS world y
  const gzMin = Math.floor((mnZ - gMinZ) / VS);
  const gzMax = Math.floor((mxZ - gMinZ) / VS);
  const worldYBottom = gzMin * VS;       // bottom face of lowest voxel
  const worldYTop    = (gzMax + 1) * VS; // top face of highest voxel

  console.log(`${o.name}:`);
  console.log(`  Blender: X[${mnX.toFixed(3)}, ${mxX.toFixed(3)}]  Y[${mnY.toFixed(3)}, ${mxY.toFixed(3)}]  Z[${mnZ.toFixed(3)}, ${mxZ.toFixed(3)}]`);
  console.log(`  viewer X[${viewerXmin.toFixed(3)}, ${viewerXmax.toFixed(3)}]  Z[${viewerZmin.toFixed(3)}, ${viewerZmax.toFixed(3)}]  Y[${worldYBottom.toFixed(3)}, ${worldYTop.toFixed(3)}] (voxel-quantized)`);
  console.log(`  size: ${(viewerXmax-viewerXmin).toFixed(2)} × ${(viewerZmax-viewerZmin).toFixed(2)} m,  thickness: ${(worldYTop-worldYBottom).toFixed(3)} m`);
}
