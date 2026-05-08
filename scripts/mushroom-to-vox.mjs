/**
 * Mushroom OBJ-to-VOX Converter
 *
 * Converts Low-Poly Mushroom OBJ files into MagicaVoxel .vox files.
 * Each mushroom is a separate OBJ file with a shared texture atlas.
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// ── Config ──────────────────────────────────────────────────────────

const OBJ_DIR = 'C:/Users/user/Downloads/mushroom/uploads_files_2456554_obj';
const TEXTURE_PATH = 'C:/Users/user/Downloads/mushroom/uploads_files_2456554_texture/low_poly_mushrooms_texture_atlas.png';
const OUTPUT_DIR = 'C:/Users/user/developsecond/game-assets/field/mushroom';

const VOXEL_RESOLUTION = 32; // mushrooms are smaller, lower res is fine

// ── OBJ Parser ──────────────────────────────────────────────────────

function parseOBJ(objText) {
  const vertices = [];
  const uvs = [];
  const faces = [];

  for (const line of objText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0];

    if (cmd === 'v') {
      vertices.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
    } else if (cmd === 'vt') {
      uvs.push([parseFloat(parts[1]), parseFloat(parts[2])]);
    } else if (cmd === 'f') {
      const faceVerts = [];
      for (let i = 1; i < parts.length; i++) {
        const indices = parts[i].split('/');
        faceVerts.push({
          vi: parseInt(indices[0]) - 1,
          ti: indices[1] ? parseInt(indices[1]) - 1 : -1,
        });
      }
      for (let i = 1; i < faceVerts.length - 1; i++) {
        faces.push([faceVerts[0], faceVerts[i], faceVerts[i + 1]]);
      }
    }
  }

  return { vertices, uvs, faces };
}

// ── Texture sampler ─────────────────────────────────────────────────

class TextureSampler {
  constructor(pixels, width, height) {
    this.pixels = pixels;
    this.width = width;
    this.height = height;
    this.channels = 3;
  }

  sample(u, v) {
    u = u - Math.floor(u);
    v = v - Math.floor(v);
    const px = Math.min(Math.floor(u * this.width), this.width - 1);
    const py = Math.min(Math.floor((1 - v) * this.height), this.height - 1);
    const idx = (py * this.width + px) * this.channels;
    return {
      r: this.pixels[idx] / 255,
      g: this.pixels[idx + 1] / 255,
      b: this.pixels[idx + 2] / 255,
    };
  }
}

async function loadTexture(texPath) {
  const { data, info } = await sharp(texPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return new TextureSampler(data, info.width, info.height);
}

// ── Triangle rasterizer ─────────────────────────────────────────────

function voxelizeMesh(vertices, uvs, faces, resolution, texSampler) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const usedVerts = new Set();
  for (const tri of faces) {
    for (const fv of tri) usedVerts.add(fv.vi);
  }

  for (const vi of usedVerts) {
    const [x, y, z] = vertices[vi];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }

  const extX = maxX - minX;
  const extY = maxY - minY;
  const extZ = maxZ - minZ;
  const maxExt = Math.max(extX, extY, extZ);
  if (maxExt === 0) return [];

  const voxelSize = maxExt / resolution;
  const voxelMap = new Map();

  function toGrid(x, y, z) {
    return [
      Math.floor((x - minX) / voxelSize),
      Math.floor((y - minY) / voxelSize),
      Math.floor((z - minZ) / voxelSize),
    ];
  }

  for (const tri of faces) {
    const v0 = vertices[tri[0].vi];
    const v1 = vertices[tri[1].vi];
    const v2 = vertices[tri[2].vi];

    const uv0 = tri[0].ti >= 0 ? uvs[tri[0].ti] : [0.5, 0.5];
    const uv1 = tri[1].ti >= 0 ? uvs[tri[1].ti] : [0.5, 0.5];
    const uv2 = tri[2].ti >= 0 ? uvs[tri[2].ti] : [0.5, 0.5];

    const edge01 = Math.sqrt(
      ((v1[0] - v0[0]) / voxelSize) ** 2 +
      ((v1[1] - v0[1]) / voxelSize) ** 2 +
      ((v1[2] - v0[2]) / voxelSize) ** 2
    );
    const edge02 = Math.sqrt(
      ((v2[0] - v0[0]) / voxelSize) ** 2 +
      ((v2[1] - v0[1]) / voxelSize) ** 2 +
      ((v2[2] - v0[2]) / voxelSize) ** 2
    );

    const steps = Math.max(Math.ceil(Math.max(edge01, edge02)) * 2, 4);

    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps;
        const v = j / steps;
        const w = 1 - u - v;
        if (w < -0.001) continue;

        const px = w * v0[0] + u * v1[0] + v * v2[0];
        const py = w * v0[1] + u * v1[1] + v * v2[1];
        const pz = w * v0[2] + u * v1[2] + v * v2[2];

        const tu = w * uv0[0] + u * uv1[0] + v * uv2[0];
        const tv = w * uv0[1] + u * uv1[1] + v * uv2[1];

        const [gx, gy, gz] = toGrid(px, py, pz);
        const key = `${gx},${gy},${gz}`;

        if (!voxelMap.has(key)) {
          const color = texSampler.sample(tu, tv);
          voxelMap.set(key, { x: gx, y: gy, z: gz, ...color });
        }
      }
    }
  }

  return [...voxelMap.values()];
}

// ── Interior fill ───────────────────────────────────────────────────

function fillInterior(voxels) {
  if (voxels.length === 0) return voxels;

  let maxX = 0, maxY = 0, maxZ = 0;
  for (const v of voxels) {
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
    maxZ = Math.max(maxZ, v.z);
  }

  const sx = maxX + 1, sy = maxY + 1, sz = maxZ + 1;
  if (sx > 128 || sy > 128 || sz > 128) return voxels;

  const grid = new Uint8Array(sx * sy * sz);
  for (const v of voxels) {
    grid[v.x + v.y * sx + v.z * sx * sy] = 1;
  }

  const exterior = new Uint8Array(sx * sy * sz);
  const queue = [];

  for (let x = 0; x < sx; x++) {
    for (let y = 0; y < sy; y++) {
      for (const z of [0, sz - 1]) {
        const idx = x + y * sx + z * sx * sy;
        if (!grid[idx]) { exterior[idx] = 1; queue.push([x, y, z]); }
      }
    }
  }
  for (let x = 0; x < sx; x++) {
    for (let z = 0; z < sz; z++) {
      for (const y of [0, sy - 1]) {
        const idx = x + y * sx + z * sx * sy;
        if (!grid[idx] && !exterior[idx]) { exterior[idx] = 1; queue.push([x, y, z]); }
      }
    }
  }
  for (let y = 0; y < sy; y++) {
    for (let z = 0; z < sz; z++) {
      for (const x of [0, sx - 1]) {
        const idx = x + y * sx + z * sx * sy;
        if (!grid[idx] && !exterior[idx]) { exterior[idx] = 1; queue.push([x, y, z]); }
      }
    }
  }

  const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  while (queue.length > 0) {
    const [cx, cy, cz] = queue.pop();
    for (const [dx, dy, dz] of dirs) {
      const nx = cx + dx, ny = cy + dy, nz = cz + dz;
      if (nx < 0 || nx >= sx || ny < 0 || ny >= sy || nz < 0 || nz >= sz) continue;
      const nIdx = nx + ny * sx + nz * sx * sy;
      if (grid[nIdx] || exterior[nIdx]) continue;
      exterior[nIdx] = 1;
      queue.push([nx, ny, nz]);
    }
  }

  const result = [...voxels];
  for (let x = 0; x < sx; x++) {
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++) {
        const idx = x + y * sx + z * sx * sy;
        if (!grid[idx] && !exterior[idx]) {
          let nearestColor = { r: 0.5, g: 0.5, b: 0.5 };
          let minDist = Infinity;
          for (const sv of voxels) {
            const d = (sv.x - x) ** 2 + (sv.y - y) ** 2 + (sv.z - z) ** 2;
            if (d < minDist) { minDist = d; nearestColor = { r: sv.r, g: sv.g, b: sv.b }; if (d <= 1) break; }
          }
          result.push({ x, y, z, ...nearestColor });
        }
      }
    }
  }

  return result;
}

// ── VOX writer ──────────────────────────────────────────────────────

function writeVox(voxels, filePath) {
  if (voxels.length === 0) return;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of voxels) {
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
  }

  const sizeX = maxX - minX + 1;
  const sizeY = maxY - minY + 1;
  const sizeZ = maxZ - minZ + 1;

  if (sizeX > 256 || sizeY > 256 || sizeZ > 256) {
    console.warn(`  WARNING: grid ${sizeX}×${sizeY}×${sizeZ} exceeds 256, skipping`);
    return;
  }

  const paletteMap = new Map();
  const palette = [];

  function colorKey(r, g, b) {
    const qr = Math.round(r * 255) & 0xFC;
    const qg = Math.round(g * 255) & 0xFC;
    const qb = Math.round(b * 255) & 0xFC;
    return (qr << 16) | (qg << 8) | qb;
  }

  const remappedVoxels = [];
  for (const v of voxels) {
    const key = colorKey(v.r, v.g, v.b);
    let ci = paletteMap.get(key);
    if (ci === undefined) {
      if (palette.length >= 255) {
        let bestDist = Infinity, bestIdx = 0;
        for (let i = 0; i < palette.length; i++) {
          const d = (palette[i].r - v.r) ** 2 + (palette[i].g - v.g) ** 2 + (palette[i].b - v.b) ** 2;
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        ci = bestIdx + 1;
      } else {
        palette.push({ r: Math.round(v.r * 255), g: Math.round(v.g * 255), b: Math.round(v.b * 255) });
        ci = palette.length;
        paletteMap.set(key, ci);
      }
    }
    remappedVoxels.push({ x: v.x - minX, y: v.y - minY, z: v.z - minZ, colorIndex: ci });
  }

  while (palette.length < 256) palette.push({ r: 0, g: 0, b: 0 });

  const numVoxels = remappedVoxels.length;
  const sizeContent = Buffer.alloc(12);
  sizeContent.writeUInt32LE(sizeX, 0);
  sizeContent.writeUInt32LE(sizeY, 4);
  sizeContent.writeUInt32LE(sizeZ, 8);

  const xyziContent = Buffer.alloc(4 + numVoxels * 4);
  xyziContent.writeUInt32LE(numVoxels, 0);
  for (let i = 0; i < numVoxels; i++) {
    const v = remappedVoxels[i];
    xyziContent.writeUInt8(v.x, 4 + i * 4);
    xyziContent.writeUInt8(v.y, 4 + i * 4 + 1);
    xyziContent.writeUInt8(v.z, 4 + i * 4 + 2);
    xyziContent.writeUInt8(v.colorIndex, 4 + i * 4 + 3);
  }

  const rgbaContent = Buffer.alloc(256 * 4);
  for (let i = 0; i < 256; i++) {
    rgbaContent.writeUInt8(palette[i].r, i * 4);
    rgbaContent.writeUInt8(palette[i].g, i * 4 + 1);
    rgbaContent.writeUInt8(palette[i].b, i * 4 + 2);
    rgbaContent.writeUInt8(255, i * 4 + 3);
  }

  function makeChunk(id, content, children = Buffer.alloc(0)) {
    const header = Buffer.alloc(12);
    header.write(id, 0, 4, 'ascii');
    header.writeUInt32LE(content.length, 4);
    header.writeUInt32LE(children.length, 8);
    return Buffer.concat([header, content, children]);
  }

  const mainChildren = Buffer.concat([
    makeChunk('SIZE', sizeContent),
    makeChunk('XYZI', xyziContent),
    makeChunk('RGBA', rgbaContent),
  ]);
  const mainChunk = makeChunk('MAIN', Buffer.alloc(0), mainChildren);

  const fileHeader = Buffer.alloc(8);
  fileHeader.write('VOX ', 0, 4, 'ascii');
  fileHeader.writeUInt32LE(150, 4);

  fs.writeFileSync(filePath, Buffer.concat([fileHeader, mainChunk]));

  const metaPath = filePath.replace('.vox', '_meta.json');
  fs.writeFileSync(metaPath, JSON.stringify({
    name: path.basename(filePath, '.vox'),
    grid: [sizeX, sizeY, sizeZ],
    voxel_count: numVoxels,
    palette_size: palette.filter(p => p.r || p.g || p.b).length,
    resolution: VOXEL_RESOLUTION,
  }, null, 2));
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('Loading texture...');
  const texSampler = await loadTexture(TEXTURE_PATH);
  console.log(`  Texture: ${texSampler.width}×${texSampler.height}`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const objFiles = fs.readdirSync(OBJ_DIR).filter(f => f.endsWith('.obj'));
  console.log(`Found ${objFiles.length} mushroom OBJ files\n`);

  for (const objFile of objFiles) {
    const name = path.basename(objFile, '.obj');
    console.log(`Converting ${name}...`);

    const objText = fs.readFileSync(path.join(OBJ_DIR, objFile), 'utf-8');
    const { vertices, uvs, faces } = parseOBJ(objText);
    console.log(`  ${faces.length} triangles`);

    let voxels = voxelizeMesh(vertices, uvs, faces, VOXEL_RESOLUTION, texSampler);
    console.log(`  Surface voxels: ${voxels.length}`);

    if (voxels.length === 0) { console.log('  Skipping (empty)'); continue; }

    voxels = fillInterior(voxels);
    console.log(`  After fill: ${voxels.length} voxels`);

    // OBJ Y-up → VOX Z-up
    const remapped = voxels.map(v => ({
      x: v.x,
      y: v.z,
      z: v.y,
      r: v.r, g: v.g, b: v.b,
    }));

    let minZ = Infinity;
    for (const v of remapped) minZ = Math.min(minZ, v.z);
    for (const v of remapped) v.z -= minZ;

    const outputPath = path.join(OUTPUT_DIR, `${name}.vox`);
    writeVox(remapped, outputPath);
    console.log(`  → ${outputPath}\n`);
  }

  console.log('Done!');
}

main().catch(console.error);
