/**
 * OBJ-to-VOX Converter
 *
 * Converts Low-Poly Tree Collection OBJ meshes into MagicaVoxel .vox files.
 *
 * Pipeline:
 *   1. Parse OBJ file → extract per-object vertices, UVs, faces
 *   2. Read texture image → sample colors via UV coordinates
 *   3. Voxelize each tree mesh (triangle rasterization into 3D grid)
 *   4. Write .vox files to public/field/
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// ── Config ──────────────────────────────────────────────────────────

const OBJ_PATH = 'C:/Users/user/Downloads/新しいフォルダー/uploads_files_3304599_LowPoly_Tree_Collection_01_obj.obj';
const TEXTURE_PATH = 'C:/Users/user/Downloads/新しいフォルダー/uploads_files_3304599_textures/textures/color_1024x1024.jpg';
const OUTPUT_DIR = 'C:/Users/user/developsecond/game-assets/field/tree';

// Resolution: target voxel grid max dimension
const VOXEL_RESOLUTION = 48;

// Convert all 200 trees
const TREE_IDS = Array.from({ length: 200 }, (_, i) => i + 1);

// ── OBJ Parser ──────────────────────────────────────────────────────

function parseOBJ(objText) {
  const allVertices = [];  // global v list (1-indexed)
  const allUVs = [];       // global vt list (1-indexed)
  const objects = [];
  let currentObj = null;

  for (const line of objText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0];

    if (cmd === 'v') {
      allVertices.push([
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3]),
      ]);
    } else if (cmd === 'vt') {
      allUVs.push([
        parseFloat(parts[1]),
        parseFloat(parts[2]),
      ]);
    } else if (cmd === 'o') {
      currentObj = { name: parts[1], faces: [] };
      objects.push(currentObj);
    } else if (cmd === 'f' && currentObj) {
      // f v/vt/vn v/vt/vn v/vt/vn ...
      const faceVerts = [];
      for (let i = 1; i < parts.length; i++) {
        const indices = parts[i].split('/');
        faceVerts.push({
          vi: parseInt(indices[0]) - 1,  // vertex index (0-based)
          ti: indices[1] ? parseInt(indices[1]) - 1 : -1,  // UV index (0-based)
        });
      }
      // Triangulate fan-style for polygons with > 3 vertices
      for (let i = 1; i < faceVerts.length - 1; i++) {
        currentObj.faces.push([faceVerts[0], faceVerts[i], faceVerts[i + 1]]);
      }
    }
  }

  return { allVertices, allUVs, objects };
}

// ── Texture sampler ─────────────────────────────────────────────────

class TextureSampler {
  constructor(pixels, width, height) {
    this.pixels = pixels;
    this.width = width;
    this.height = height;
  }

  sample(u, v) {
    // Clamp and wrap UVs
    u = u - Math.floor(u);
    v = v - Math.floor(v);
    const px = Math.min(Math.floor(u * this.width), this.width - 1);
    const py = Math.min(Math.floor((1 - v) * this.height), this.height - 1);
    const idx = (py * this.width + px) * 3;
    return {
      r: this.pixels[idx] / 255,
      g: this.pixels[idx + 1] / 255,
      b: this.pixels[idx + 2] / 255,
    };
  }
}

async function loadTexture(texPath) {
  const img = sharp(texPath);
  const meta = await img.metadata();
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return new TextureSampler(data, info.width, info.height);
}

// ── Triangle rasterizer (voxelization) ──────────────────────────────

function voxelizeMesh(vertices, uvs, faces, resolution, texSampler) {
  // Compute bounding box
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
  const gridX = Math.ceil(extX / voxelSize) + 1;
  const gridY = Math.ceil(extY / voxelSize) + 1;
  const gridZ = Math.ceil(extZ / voxelSize) + 1;

  // Voxel grid: key -> color
  const voxelMap = new Map();

  function toGrid(x, y, z) {
    return [
      Math.floor((x - minX) / voxelSize),
      Math.floor((y - minY) / voxelSize),
      Math.floor((z - minZ) / voxelSize),
    ];
  }

  // Rasterize each triangle into voxels using barycentric sampling
  for (const tri of faces) {
    const v0 = vertices[tri[0].vi];
    const v1 = vertices[tri[1].vi];
    const v2 = vertices[tri[2].vi];

    const uv0 = tri[0].ti >= 0 ? uvs[tri[0].ti] : [0.5, 0.5];
    const uv1 = tri[1].ti >= 0 ? uvs[tri[1].ti] : [0.5, 0.5];
    const uv2 = tri[2].ti >= 0 ? uvs[tri[2].ti] : [0.5, 0.5];

    // Triangle edge lengths in voxel units
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

    // Number of samples along each edge
    const steps = Math.max(Math.ceil(Math.max(edge01, edge02)) * 2, 4);

    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps;
        const v = j / steps;
        const w = 1 - u - v;
        if (w < -0.001) continue;

        // Interpolate position
        const px = w * v0[0] + u * v1[0] + v * v2[0];
        const py = w * v0[1] + u * v1[1] + v * v2[1];
        const pz = w * v0[2] + u * v1[2] + v * v2[2];

        // Interpolate UV
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

// ── Solid fill (flood fill interior) ────────────────────────────────

function fillInterior(voxels) {
  if (voxels.length === 0) return voxels;

  // Find grid bounds
  let maxX = 0, maxY = 0, maxZ = 0;
  for (const v of voxels) {
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
    maxZ = Math.max(maxZ, v.z);
  }

  const sx = maxX + 1, sy = maxY + 1, sz = maxZ + 1;
  if (sx > 128 || sy > 128 || sz > 128) return voxels; // too large, skip fill

  // Build occupancy grid
  const grid = new Uint8Array(sx * sy * sz);
  const colorMap = new Map();
  for (const v of voxels) {
    const idx = v.x + v.y * sx + v.z * sx * sy;
    grid[idx] = 1;
    colorMap.set(`${v.x},${v.y},${v.z}`, { r: v.r, g: v.g, b: v.b });
  }

  // Flood fill from outside to find exterior
  const exterior = new Uint8Array(sx * sy * sz);
  const queue = [];

  // Start from all border cells that are empty
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

  // Fill interior voxels (not surface, not exterior)
  const result = [...voxels];
  for (let x = 0; x < sx; x++) {
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++) {
        const idx = x + y * sx + z * sx * sy;
        if (!grid[idx] && !exterior[idx]) {
          // Find nearest surface voxel color
          let nearestColor = { r: 0.5, g: 0.5, b: 0.5 };
          let minDist = Infinity;
          for (const sv of voxels) {
            const d = (sv.x - x) ** 2 + (sv.y - y) ** 2 + (sv.z - z) ** 2;
            if (d < minDist) {
              minDist = d;
              nearestColor = { r: sv.r, g: sv.g, b: sv.b };
              if (d <= 1) break;
            }
          }
          result.push({ x, y, z, ...nearestColor });
        }
      }
    }
  }

  return result;
}

// ── VOX file writer ─────────────────────────────────────────────────

function writeVox(voxels, filePath) {
  if (voxels.length === 0) return;

  // Remap to 0-based coordinates and find grid size
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

  // Clamp to VOX max 256
  if (sizeX > 256 || sizeY > 256 || sizeZ > 256) {
    console.warn(`  WARNING: grid ${sizeX}×${sizeY}×${sizeZ} exceeds 256, skipping`);
    return;
  }

  // Build color palette (quantize to nearest)
  const paletteMap = new Map();
  const palette = [];

  function colorKey(r, g, b) {
    // Quantize to 6-bit per channel for palette dedup
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
        // Find nearest palette color
        let bestDist = Infinity, bestIdx = 0;
        for (let i = 0; i < palette.length; i++) {
          const d = (palette[i].r - v.r) ** 2 + (palette[i].g - v.g) ** 2 + (palette[i].b - v.b) ** 2;
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        ci = bestIdx + 1;
      } else {
        palette.push({ r: Math.round(v.r * 255), g: Math.round(v.g * 255), b: Math.round(v.b * 255) });
        ci = palette.length; // 1-indexed in VOX
        paletteMap.set(key, ci);
      }
    }
    remappedVoxels.push({
      x: v.x - minX,
      y: v.y - minY,
      z: v.z - minZ,
      colorIndex: ci,
    });
  }

  // Fill palette to 256 entries
  while (palette.length < 256) {
    palette.push({ r: 0, g: 0, b: 0 });
  }

  // Build binary VOX file
  const numVoxels = remappedVoxels.length;

  // SIZE chunk: 12 bytes content
  const sizeContent = Buffer.alloc(12);
  sizeContent.writeUInt32LE(sizeX, 0);
  sizeContent.writeUInt32LE(sizeY, 4);
  sizeContent.writeUInt32LE(sizeZ, 8);

  // XYZI chunk: 4 + numVoxels * 4 bytes
  const xyziContent = Buffer.alloc(4 + numVoxels * 4);
  xyziContent.writeUInt32LE(numVoxels, 0);
  for (let i = 0; i < numVoxels; i++) {
    const v = remappedVoxels[i];
    xyziContent.writeUInt8(v.x, 4 + i * 4);
    xyziContent.writeUInt8(v.y, 4 + i * 4 + 1);
    xyziContent.writeUInt8(v.z, 4 + i * 4 + 2);
    xyziContent.writeUInt8(v.colorIndex, 4 + i * 4 + 3);
  }

  // RGBA chunk: 256 * 4 bytes
  const rgbaContent = Buffer.alloc(256 * 4);
  for (let i = 0; i < 256; i++) {
    rgbaContent.writeUInt8(palette[i].r, i * 4);
    rgbaContent.writeUInt8(palette[i].g, i * 4 + 1);
    rgbaContent.writeUInt8(palette[i].b, i * 4 + 2);
    rgbaContent.writeUInt8(255, i * 4 + 3); // alpha
  }

  function makeChunk(id, content, children = Buffer.alloc(0)) {
    const header = Buffer.alloc(12);
    header.write(id, 0, 4, 'ascii');
    header.writeUInt32LE(content.length, 4);
    header.writeUInt32LE(children.length, 8);
    return Buffer.concat([header, content, children]);
  }

  const sizeChunk = makeChunk('SIZE', sizeContent);
  const xyziChunk = makeChunk('XYZI', xyziContent);
  const rgbaChunk = makeChunk('RGBA', rgbaContent);

  const mainChildren = Buffer.concat([sizeChunk, xyziChunk, rgbaChunk]);
  const mainChunk = makeChunk('MAIN', Buffer.alloc(0), mainChildren);

  const fileHeader = Buffer.alloc(8);
  fileHeader.write('VOX ', 0, 4, 'ascii');
  fileHeader.writeUInt32LE(150, 4); // version

  const voxFile = Buffer.concat([fileHeader, mainChunk]);
  fs.writeFileSync(filePath, voxFile);

  // Also write metadata
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

  console.log('Parsing OBJ file...');
  const objText = fs.readFileSync(OBJ_PATH, 'utf-8');
  const { allVertices, allUVs, objects } = parseOBJ(objText);
  console.log(`  ${objects.length} objects, ${allVertices.length} vertices, ${allUVs.length} UVs`);

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Convert selected trees
  for (const treeId of TREE_IDS) {
    if (treeId > objects.length) {
      console.log(`  Tree ${treeId}: index out of range, skipping`);
      continue;
    }

    const obj = objects[treeId - 1];
    const paddedId = String(treeId).padStart(3, '0');
    console.log(`\nConverting tree ${paddedId} (${obj.name}): ${obj.faces.length} triangles`);

    // Voxelize
    let voxels = voxelizeMesh(allVertices, allUVs, obj.faces, VOXEL_RESOLUTION, texSampler);
    console.log(`  Surface voxels: ${voxels.length}`);

    if (voxels.length === 0) {
      console.log('  No voxels generated, skipping');
      continue;
    }

    // Fill interior for solid objects
    voxels = fillInterior(voxels);
    console.log(`  After fill: ${voxels.length} voxels`);

    // Remap Y/Z for VOX format: OBJ Y-up → VOX Z-up
    // OBJ: X right, Y up, Z forward
    // VOX: X right, Y forward, Z up
    const remapped = voxels.map(v => ({
      x: v.x,
      y: v.z, // OBJ Z → VOX Y (depth)
      z: v.y, // OBJ Y → VOX Z (height)
      r: v.r,
      g: v.g,
      b: v.b,
    }));

    // Ensure minimum z = 0 (ground level)
    let minZ = Infinity;
    for (const v of remapped) minZ = Math.min(minZ, v.z);
    for (const v of remapped) v.z -= minZ;

    const outputPath = path.join(OUTPUT_DIR, `tree_${paddedId}.vox`);
    writeVox(remapped, outputPath);
    console.log(`  → ${outputPath}`);
  }

  console.log('\nDone!');
}

main().catch(console.error);
