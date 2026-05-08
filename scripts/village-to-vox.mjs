/**
 * Village Southern Europe → VOX Converter
 *
 * 1. assets.obj → individual object .vox files (resolution 40)
 * 2. village.obj → field tiles 4×4 (resolution 200 per tile)
 * 3. Generate layout JSON with tile positions + object placements
 *
 * All materials use solid colors (no textures).
 */

import fs from 'fs';
import path from 'path';

// ── Config ──────────────────────────────────────────────────────────

const ASSETS_OBJ = 'C:/Users/user/Downloads/map/uploads_files_4979073_assets.obj';
const VILLAGE_OBJ = 'C:/Users/user/Downloads/map/uploads_files_4979073_village+southern+europe.obj';
const OUTPUT_DIR = 'C:/Users/user/developsecond/game-assets/field/village';

const OBJECT_RESOLUTION = 40;
const TILE_RESOLUTION = 200;
const TILE_GRID = 4; // 4×4 tiles

// Material name → RGB (0-1 range)
// OBJ uses underscores (e.g. "brick_1"), Blender uses spaces ("brick 1")
const MATERIAL_COLORS = {
  'brick_1': [0.51, 0.17, 0.07],
  'brick_2': [0.80, 0.26, 0.10],
  'brick_3': [0.55, 0.33, 0.21],
  'cloth_1': [0.52, 0.69, 0.71],
  'cloth_2': [0.01, 0.15, 0.59],
  'cloth_3': [0.80, 0.02, 0.02],
  'Dots_Stroke': [0.80, 0.80, 0.80],
  'flower_1': [1.00, 0.51, 0.00],
  'flower_2': [1.00, 0.00, 0.00],
  'grass_1': [0.32, 0.50, 0.01],
  'iron_1': [0.04, 0.02, 0.02],
  'leaf_1': [0.29, 0.30, 0.00],
  'leaf_2': [0.50, 0.26, 0.00],
  'leaf_3': [0.51, 0.42, 0.00],
  'mirror_1': [0.80, 0.72, 0.64],
  'orange': [1.00, 0.21, 0.00],
  'road_1': [0.43, 0.38, 0.23],
  'road_2': [0.28, 0.22, 0.04],
  'rock_1': [0.29, 0.24, 0.18],
  'roof_1': [0.80, 0.07, 0.00],
  'roof_2': [0.80, 0.07, 0.04],
  'shadow': [0.00, 0.00, 0.00],
  'wall_1': [0.80, 0.57, 0.39],
  'wall_2': [0.40, 0.22, 0.17],
  'wood_1': [0.22, 0.06, 0.02],
  'wood_2': [0.22, 0.01, 0.01],
  'wood_3': [0.11, 0.00, 0.00],
};

// ── OBJ Parser (multi-material, per-object) ─────────────────────────

function parseOBJObjects(objText) {
  const allVertices = [];
  const allUVs = [];
  const objects = []; // { name, faces[], currentMaterial }
  let current = null;
  let currentMaterial = 'unknown';

  for (const line of objText.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('mtllib')) continue;
    const p = t.split(/\s+/);

    if (p[0] === 'v') {
      allVertices.push([parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]);
    } else if (p[0] === 'vt') {
      allUVs.push([parseFloat(p[1]), parseFloat(p[2])]);
    } else if (p[0] === 'usemtl') {
      currentMaterial = p.slice(1).join(' ');
    } else if (p[0] === 'o') {
      current = { name: p[1], faces: [] };
      objects.push(current);
    } else if (p[0] === 'f' && current) {
      const fv = [];
      for (let i = 1; i < p.length; i++) {
        const idx = p[i].split('/');
        fv.push({ vi: parseInt(idx[0]) - 1, ti: idx[1] ? parseInt(idx[1]) - 1 : -1 });
      }
      for (let i = 1; i < fv.length - 1; i++) {
        current.faces.push({ tri: [fv[0], fv[i], fv[i + 1]], material: currentMaterial });
      }
    }
  }

  return { allVertices, allUVs, objects };
}

// ── Color sampler from material ─────────────────────────────────────

function getMaterialColor(matName) {
  const c = MATERIAL_COLORS[matName];
  if (c) return { r: c[0], g: c[1], b: c[2] };
  // Try partial match
  for (const [key, val] of Object.entries(MATERIAL_COLORS)) {
    if (matName.includes(key)) return { r: val[0], g: val[1], b: val[2] };
  }
  return { r: 0.5, g: 0.5, b: 0.5 };
}

// ── Voxelizer ───────────────────────────────────────────────────────

/**
 * @param voxelSizeOverride — if provided, use this exact voxel size (for tile consistency)
 */
function voxelizeObject(allVertices, faces, resolution, boundsOverride, voxelSizeOverride) {
  let minX, minY, minZ, maxX, maxY, maxZ;

  if (boundsOverride) {
    ({ minX, minY, minZ, maxX, maxY, maxZ } = boundsOverride);
  } else {
    minX = Infinity; minY = Infinity; minZ = Infinity;
    maxX = -Infinity; maxY = -Infinity; maxZ = -Infinity;
    const used = new Set();
    for (const f of faces) for (const fv of f.tri) used.add(fv.vi);
    for (const vi of used) {
      const [x, y, z] = allVertices[vi];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
  }

  const maxExt = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (maxExt === 0) return [];
  const voxelSize = voxelSizeOverride || (maxExt / resolution);
  const voxelMap = new Map();

  for (const face of faces) {
    const tri = face.tri;
    const color = getMaterialColor(face.material);
    const v0 = allVertices[tri[0].vi], v1 = allVertices[tri[1].vi], v2 = allVertices[tri[2].vi];

    // Skip faces completely outside tile (all 3 verts outside on same side)
    if (boundsOverride) {
      const allLeft  = v0[0] < minX && v1[0] < minX && v2[0] < minX;
      const allRight = v0[0] > maxX && v1[0] > maxX && v2[0] > maxX;
      const allFront = v0[2] < minZ && v1[2] < minZ && v2[2] < minZ;
      const allBack  = v0[2] > maxZ && v1[2] > maxZ && v2[2] > maxZ;
      if (allLeft || allRight || allFront || allBack) continue;
    }

    const e01 = Math.sqrt(((v1[0]-v0[0])/voxelSize)**2+((v1[1]-v0[1])/voxelSize)**2+((v1[2]-v0[2])/voxelSize)**2);
    const e02 = Math.sqrt(((v2[0]-v0[0])/voxelSize)**2+((v2[1]-v0[1])/voxelSize)**2+((v2[2]-v0[2])/voxelSize)**2);
    const steps = Math.max(Math.ceil(Math.max(e01, e02)) * 2, 4);

    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps, v = j / steps, w = 1 - u - v;
        if (w < -0.001) continue;
        const px = w*v0[0]+u*v1[0]+v*v2[0];
        const py = w*v0[1]+u*v1[1]+v*v2[1];
        const pz = w*v0[2]+u*v1[2]+v*v2[2];

        // Clip samples to tile bounds
        if (boundsOverride && (px < minX || px > maxX || pz < minZ || pz > maxZ)) continue;

        const gx = Math.floor((px - minX) / voxelSize);
        const gy = Math.floor((py - minY) / voxelSize);
        const gz = Math.floor((pz - minZ) / voxelSize);
        const key = `${gx},${gy},${gz}`;
        if (!voxelMap.has(key)) {
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
  let maxX=0,maxY=0,maxZ=0;
  for(const v of voxels){maxX=Math.max(maxX,v.x);maxY=Math.max(maxY,v.y);maxZ=Math.max(maxZ,v.z);}
  const sx=maxX+1,sy=maxY+1,sz=maxZ+1;
  if(sx>256||sy>256||sz>256) return voxels;
  const grid=new Uint8Array(sx*sy*sz);
  for(const v of voxels) grid[v.x+v.y*sx+v.z*sx*sy]=1;
  const ext=new Uint8Array(sx*sy*sz);
  const q=[];
  for(let x=0;x<sx;x++)for(let y=0;y<sy;y++)for(const z of[0,sz-1]){const i=x+y*sx+z*sx*sy;if(!grid[i]){ext[i]=1;q.push([x,y,z]);}}
  for(let x=0;x<sx;x++)for(let z=0;z<sz;z++)for(const y of[0,sy-1]){const i=x+y*sx+z*sx*sy;if(!grid[i]&&!ext[i]){ext[i]=1;q.push([x,y,z]);}}
  for(let y=0;y<sy;y++)for(let z=0;z<sz;z++)for(const x of[0,sx-1]){const i=x+y*sx+z*sx*sy;if(!grid[i]&&!ext[i]){ext[i]=1;q.push([x,y,z]);}}
  const dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  while(q.length>0){const[cx,cy,cz]=q.pop();for(const[dx,dy,dz]of dirs){const nx=cx+dx,ny=cy+dy,nz=cz+dz;if(nx<0||nx>=sx||ny<0||ny>=sy||nz<0||nz>=sz)continue;const ni=nx+ny*sx+nz*sx*sy;if(grid[ni]||ext[ni])continue;ext[ni]=1;q.push([nx,ny,nz]);}}
  const r=[...voxels];
  for(let x=0;x<sx;x++)for(let y=0;y<sy;y++)for(let z=0;z<sz;z++){const i=x+y*sx+z*sx*sy;if(!grid[i]&&!ext[i]){let nc={r:.5,g:.5,b:.5},md=Infinity;for(const sv of voxels){const d=(sv.x-x)**2+(sv.y-y)**2+(sv.z-z)**2;if(d<md){md=d;nc={r:sv.r,g:sv.g,b:sv.b};if(d<=1)break;}}r.push({x,y,z,...nc});}}
  return r;
}

// ── VOX writer ──────────────────────────────────────────────────────

function writeVox(voxels, filePath) {
  if(voxels.length===0) return false;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(const v of voxels){minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);minZ=Math.min(minZ,v.z);maxZ=Math.max(maxZ,v.z);}
  const sX=maxX-minX+1,sY=maxY-minY+1,sZ=maxZ-minZ+1;
  if(sX>256||sY>256||sZ>256){console.warn(`  WARNING: grid ${sX}x${sY}x${sZ} exceeds 256, skipping`);return false;}
  const pm=new Map(),pal=[];
  function ck(r,g,b){return((Math.round(r*255)&0xFC)<<16)|((Math.round(g*255)&0xFC)<<8)|(Math.round(b*255)&0xFC);}
  const rv=[];
  for(const v of voxels){const k=ck(v.r,v.g,v.b);let ci=pm.get(k);if(ci===undefined){if(pal.length>=255){let bd=Infinity,bi=0;for(let i=0;i<pal.length;i++){const d=(pal[i].r-v.r)**2+(pal[i].g-v.g)**2+(pal[i].b-v.b)**2;if(d<bd){bd=d;bi=i;}}ci=bi+1;}else{pal.push({r:Math.round(v.r*255),g:Math.round(v.g*255),b:Math.round(v.b*255)});ci=pal.length;pm.set(k,ci);}}rv.push({x:v.x-minX,y:v.y-minY,z:v.z-minZ,colorIndex:ci});}
  while(pal.length<256)pal.push({r:0,g:0,b:0});
  const n=rv.length;const sc=Buffer.alloc(12);sc.writeUInt32LE(sX,0);sc.writeUInt32LE(sY,4);sc.writeUInt32LE(sZ,8);
  const xc=Buffer.alloc(4+n*4);xc.writeUInt32LE(n,0);for(let i=0;i<n;i++){xc.writeUInt8(rv[i].x,4+i*4);xc.writeUInt8(rv[i].y,4+i*4+1);xc.writeUInt8(rv[i].z,4+i*4+2);xc.writeUInt8(rv[i].colorIndex,4+i*4+3);}
  const rc=Buffer.alloc(256*4);for(let i=0;i<256;i++){rc.writeUInt8(pal[i].r,i*4);rc.writeUInt8(pal[i].g,i*4+1);rc.writeUInt8(pal[i].b,i*4+2);rc.writeUInt8(255,i*4+3);}
  function mc(id,ct,ch=Buffer.alloc(0)){const h=Buffer.alloc(12);h.write(id,0,4,'ascii');h.writeUInt32LE(ct.length,4);h.writeUInt32LE(ch.length,8);return Buffer.concat([h,ct,ch]);}
  const mch=Buffer.concat([mc('SIZE',sc),mc('XYZI',xc),mc('RGBA',rc)]);
  const fh=Buffer.alloc(8);fh.write('VOX ',0,4,'ascii');fh.writeUInt32LE(150,4);
  fs.writeFileSync(filePath,Buffer.concat([fh,mc('MAIN',Buffer.alloc(0),mch)]));
  fs.writeFileSync(filePath.replace('.vox','_meta.json'),JSON.stringify({name:path.basename(filePath,'.vox'),grid:[sX,sY,sZ],voxel_count:n},null,2));
  return true;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(path.join(OUTPUT_DIR, 'objects'), { recursive: true });
  fs.mkdirSync(path.join(OUTPUT_DIR, 'tiles'), { recursive: true });

  const layout = {
    tileGrid: TILE_GRID,
    tileResolution: TILE_RESOLUTION,
    fieldBounds: { minX: -75, maxX: 75, minZ: -75, maxZ: 75 },
    tiles: [],
    objects: [],
    assetIds: [],
  };

  // ══════════════════════════════════════════════════════════════════
  // Part 1: Convert assets.obj → individual object .vox files
  // ══════════════════════════════════════════════════════════════════

  console.log('=== Part 1: Converting assets ===\n');
  const assetsText = fs.readFileSync(ASSETS_OBJ, 'utf-8');
  const assets = parseOBJObjects(assetsText);
  console.log(`${assets.objects.length} asset objects\n`);

  for (const obj of assets.objects) {
    if (obj.faces.length === 0) continue;
    const safeName = obj.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    console.log(`Converting asset: ${safeName} (${obj.faces.length} tris)`);

    let voxels = voxelizeObject(assets.allVertices, obj.faces, OBJECT_RESOLUTION);
    console.log(`  Surface: ${voxels.length}`);
    if (voxels.length === 0) { console.log('  Skipping\n'); continue; }

    voxels = fillInterior(voxels);
    console.log(`  After fill: ${voxels.length}`);

    // Y-up → Z-up remap
    const remapped = voxels.map(v => ({ x: v.x, y: v.z, z: v.y, r: v.r, g: v.g, b: v.b }));
    let minZ = Infinity;
    for (const v of remapped) minZ = Math.min(minZ, v.z);
    for (const v of remapped) v.z -= minZ;

    const outPath = path.join(OUTPUT_DIR, 'objects', `${safeName}.vox`);
    if (writeVox(remapped, outPath)) {
      layout.assetIds.push(safeName);
      console.log(`  → ${safeName}.vox\n`);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Part 2: Convert village field → 4×4 tiles
  // ══════════════════════════════════════════════════════════════════

  console.log('\n=== Part 2: Converting field tiles ===\n');
  console.log('Parsing village OBJ...');
  const villageText = fs.readFileSync(VILLAGE_OBJ, 'utf-8');
  const village = parseOBJObjects(villageText);
  console.log(`${village.objects.length} village objects, ${village.allVertices.length} vertices\n`);

  // Collect all field-related faces (grass, road, rock surfaces, ground)
  const fieldMaterials = new Set([
    'grass_1', 'road_1', 'road_2', 'rock_1', 'wall_2', 'shadow',
  ]);

  const fieldFaces = [];
  const objectPlacements = [];

  for (const obj of village.objects) {
    // Determine if this is a field object or a placed object
    const mats = new Set(obj.faces.map(f => f.material));
    const isField = obj.name === 'Grid' || obj.name.startsWith('Plane.') ||
      (mats.size <= 2 && [...mats].every(m => fieldMaterials.has(m)));

    if (isField) {
      fieldFaces.push(...obj.faces);
    } else {
      // Record object placement for layout JSON
      if (obj.faces.length === 0) continue;
      const used = new Set();
      for (const f of obj.faces) for (const fv of f.tri) used.add(fv.vi);
      let cx = 0, cy = 0, cz = 0, n = 0;
      for (const vi of used) {
        cx += village.allVertices[vi][0];
        cy += village.allVertices[vi][1];
        cz += village.allVertices[vi][2];
        n++;
      }
      if (n > 0) {
        objectPlacements.push({
          name: obj.name,
          centerX: cx / n,
          centerY: cy / n,
          centerZ: cz / n,
          faceCount: obj.faces.length,
        });
      }
    }
  }

  console.log(`Field faces: ${fieldFaces.length}`);
  console.log(`Object placements: ${objectPlacements.length}\n`);

  // OBJ coordinate system (Blender export default: Y-up, -Z forward):
  //   OBJ X = horizontal (left-right)
  //   OBJ Y = vertical (up)     range: -5 to 12
  //   OBJ Z = horizontal (depth) range: -75 to 75
  //
  // Game coordinate system (buildVoxelObjectMesh):
  //   Game X = voxel.x * scale      → OBJ X
  //   Game Y = voxel.z * scale      → OBJ Y (height)
  //   Game Z = -voxel.y * scale     → -OBJ Z (depth, negated)
  //
  // Tile split: on OBJ X and OBJ Z (both horizontal ground axes)

  const fieldMinX = -75, fieldMaxX = 75;  // OBJ X range
  const fieldMinZ = -75, fieldMaxZ = 75;  // OBJ Z range
  const fieldMinY = -5,  fieldMaxY = 12;  // OBJ Y (height) range
  const tileWidth = (fieldMaxX - fieldMinX) / TILE_GRID; // 37.5
  const tileDepth = (fieldMaxZ - fieldMinZ) / TILE_GRID; // 37.5

  // Fixed voxel size for ALL tiles (based on tile width and resolution)
  const tileVoxelSize = tileWidth / TILE_RESOLUTION;  // 37.5 / 200 = 0.1875

  console.log(`Tile size: ${tileWidth} × ${tileDepth} Blender units`);
  console.log(`Voxel size: ${tileVoxelSize.toFixed(4)} (fixed for all tiles)`);
  console.log(`Grid: ${TILE_GRID}×${TILE_GRID} = ${TILE_GRID * TILE_GRID} tiles\n`);

  // DEFAULT_TERRAIN_SCALE from the game
  const TERRAIN_SCALE = 0.02;

  for (let tx = 0; tx < TILE_GRID; tx++) {
    for (let tz = 0; tz < TILE_GRID; tz++) {
      const tMinX = fieldMinX + tx * tileWidth;
      const tMaxX = tMinX + tileWidth;
      const tMinZ = fieldMinZ + tz * tileDepth;
      const tMaxZ = tMinZ + tileDepth;

      const tileName = `tile_${tx}_${tz}`;
      console.log(`Converting ${tileName} (X:${tMinX.toFixed(0)}→${tMaxX.toFixed(0)}, Z:${tMinZ.toFixed(0)}→${tMaxZ.toFixed(0)})...`);

      const bounds = {
        minX: tMinX, maxX: tMaxX,
        minY: fieldMinY, maxY: fieldMaxY,
        minZ: tMinZ, maxZ: tMaxZ,
      };
      let voxels = voxelizeObject(village.allVertices, fieldFaces, TILE_RESOLUTION, bounds, tileVoxelSize);
      console.log(`  Surface: ${voxels.length}`);

      if (voxels.length === 0) {
        console.log('  Empty tile, skipping\n');
        continue;
      }

      // Remap: OBJ (X, Y, Z) → VOX (X, Z, Y) so that:
      //   VOX X = OBJ X direction (grid gx)
      //   VOX Y = OBJ Z direction (grid gz)
      //   VOX Z = OBJ Y direction (grid gy = height)
      const remapped = voxels.map(v => ({ x: v.x, y: v.z, z: v.y, r: v.r, g: v.g, b: v.b }));

      // Normalize Z (height) so ground starts at 0
      let minZval = Infinity;
      for (const v of remapped) minZval = Math.min(minZval, v.z);
      for (const v of remapped) v.z -= minZval;

      const outPath = path.join(OUTPUT_DIR, 'tiles', `${tileName}.vox`);

      // Compute expected voxel grid dimensions for this tile
      const expectedVoxX = Math.ceil(tileWidth / tileVoxelSize);
      const expectedVoxY = Math.ceil(tileDepth / tileVoxelSize);

      // Game-world position for this tile:
      //   Game X = tile OBJ X origin * scale factor
      //   Game Z = -tile OBJ Z origin * scale factor (negated!)
      // Scale factor = TERRAIN_SCALE / tileVoxelSize (voxels → world units cancelled by voxel→world)
      // Actually: each voxel at index i maps to game position (i * TERRAIN_SCALE)
      // Tile origin offset in game coords:
      const gameX = tx * expectedVoxX * TERRAIN_SCALE;
      const gameZ = -((tz + 1) * expectedVoxY * TERRAIN_SCALE); // negated + offset to max

      if (writeVox(remapped, outPath)) {
        layout.tiles.push({
          id: tileName,
          gridX: tx,
          gridZ: tz,
          objBounds: { minX: tMinX, maxX: tMaxX, minZ: tMinZ, maxZ: tMaxZ },
          voxelSize: tileVoxelSize,
          expectedGrid: { x: expectedVoxX, y: expectedVoxY },
          gamePosition: { x: gameX, z: gameZ },
          terrainScale: TERRAIN_SCALE,
        });
        console.log(`  Grid: ~${expectedVoxX}×${expectedVoxY}, game pos: (${gameX.toFixed(2)}, ${gameZ.toFixed(2)})`);
        console.log(`  → ${tileName}.vox\n`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Part 3: Write layout JSON
  // ══════════════════════════════════════════════════════════════════

  layout.objects = objectPlacements;

  const layoutPath = path.join(OUTPUT_DIR, 'layout.json');
  fs.writeFileSync(layoutPath, JSON.stringify(layout, null, 2));
  console.log(`\nLayout written to ${layoutPath}`);
  console.log(`  ${layout.tiles.length} tiles`);
  console.log(`  ${layout.assetIds.length} asset types`);
  console.log(`  ${layout.objects.length} object placements`);
  console.log('\nDone!');
}

main().catch(console.error);
