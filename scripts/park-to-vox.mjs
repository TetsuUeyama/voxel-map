/**
 * Park OBJ-to-VOX Converter
 *
 * Converts exported Park OBJ files into .vox files.
 * Each OBJ uses a single material with a known texture mapping.
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// ── Config ──────────────────────────────────────────────────────────

const OBJ_DIR = 'C:/Users/user/Downloads/uploads_files_2046386_Park/exported_obj';
const TEX_DIR = 'C:/Users/user/Downloads/uploads_files_2046386_Park';
const OUTPUT_DIR = 'C:/Users/user/developsecond/game-assets/field/park';

// Material name → texture file
const MATERIAL_TEXTURES = {
  'Bark': 'Bark.jpg',
  'Basketball_red': 'Red Basketball.jpg',
  'Bench': 'Wood.jpg',
  'Bridge': 'Bridge.jpg',
  'Grass': 'Grass.jpg',
  'Ground': 'Rocks.jpg',
  'Leaves': 'Leaf.jpg',
  'Line': 'Line.jpg',
  'Material': 'Asphalt.jpg',
  'Picnic_table': 'Picnic table.jpg',
  'Sand': 'Sand.jpg',
  'Swings02': 'Swings01.jpg',
  'Swings1': 'Swings02.jpg',
  'Tennis_table': 'Table tennis.jpg',
  'Water': 'Water.jpg',
};

// Resolution per category
const FIELD_RESOLUTION = 80;  // higher for large field
const OBJECT_RESOLUTION = 32;
const TREE_RESOLUTION = 40;

// ── Texture sampler ─────────────────────────────────────────────────

class TextureSampler {
  constructor(pixels, width, height) {
    this.pixels = pixels; this.width = width; this.height = height;
  }
  sample(u, v) {
    u = u - Math.floor(u); v = v - Math.floor(v);
    const px = Math.min(Math.floor(u * this.width), this.width - 1);
    const py = Math.min(Math.floor((1 - v) * this.height), this.height - 1);
    const idx = (py * this.width + px) * 3;
    return { r: this.pixels[idx] / 255, g: this.pixels[idx + 1] / 255, b: this.pixels[idx + 2] / 255 };
  }
}

async function loadTexture(texPath) {
  if (!fs.existsSync(texPath)) return null;
  const { data, info } = await sharp(texPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return new TextureSampler(data, info.width, info.height);
}

// ── OBJ Parser ──────────────────────────────────────────────────────

function parseOBJ(objText) {
  const vertices = [], uvs = [], faces = [];
  let materialName = 'unknown';

  for (const line of objText.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const p = t.split(/\s+/);
    if (p[0] === 'v') vertices.push([parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]);
    else if (p[0] === 'vt') uvs.push([parseFloat(p[1]), parseFloat(p[2])]);
    else if (p[0] === 'usemtl') materialName = p[1];
    else if (p[0] === 'f') {
      const fv = [];
      for (let i = 1; i < p.length; i++) {
        const idx = p[i].split('/');
        fv.push({ vi: parseInt(idx[0]) - 1, ti: idx[1] ? parseInt(idx[1]) - 1 : -1 });
      }
      for (let i = 1; i < fv.length - 1; i++) faces.push([fv[0], fv[i], fv[i + 1]]);
    }
  }
  return { vertices, uvs, faces, materialName };
}

// ── Voxelizer ───────────────────────────────────────────────────────

function voxelizeMesh(vertices, uvs, faces, resolution, texSampler) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const used = new Set();
  for (const tri of faces) for (const fv of tri) used.add(fv.vi);
  for (const vi of used) {
    const [x, y, z] = vertices[vi];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const maxExt = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (maxExt === 0) return [];
  const voxelSize = maxExt / resolution;
  const voxelMap = new Map();

  for (const tri of faces) {
    const v0 = vertices[tri[0].vi], v1 = vertices[tri[1].vi], v2 = vertices[tri[2].vi];
    const uv0 = tri[0].ti >= 0 ? uvs[tri[0].ti] : [0.5, 0.5];
    const uv1 = tri[1].ti >= 0 ? uvs[tri[1].ti] : [0.5, 0.5];
    const uv2 = tri[2].ti >= 0 ? uvs[tri[2].ti] : [0.5, 0.5];
    const e01 = Math.sqrt(((v1[0]-v0[0])/voxelSize)**2+((v1[1]-v0[1])/voxelSize)**2+((v1[2]-v0[2])/voxelSize)**2);
    const e02 = Math.sqrt(((v2[0]-v0[0])/voxelSize)**2+((v2[1]-v0[1])/voxelSize)**2+((v2[2]-v0[2])/voxelSize)**2);
    const steps = Math.max(Math.ceil(Math.max(e01, e02)) * 2, 4);
    for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps - i; j++) {
      const u = i / steps, v = j / steps, w = 1 - u - v;
      if (w < -0.001) continue;
      const px = w*v0[0]+u*v1[0]+v*v2[0], py = w*v0[1]+u*v1[1]+v*v2[1], pz = w*v0[2]+u*v1[2]+v*v2[2];
      const tu = w*uv0[0]+u*uv1[0]+v*uv2[0], tv = w*uv0[1]+u*uv1[1]+v*uv2[1];
      const gx = Math.floor((px-minX)/voxelSize), gy = Math.floor((py-minY)/voxelSize), gz = Math.floor((pz-minZ)/voxelSize);
      const key = `${gx},${gy},${gz}`;
      if (!voxelMap.has(key)) {
        const color = texSampler ? texSampler.sample(tu, tv) : { r: 0.5, g: 0.5, b: 0.5 };
        voxelMap.set(key, { x: gx, y: gy, z: gz, ...color });
      }
    }
  }
  return [...voxelMap.values()];
}

// ── Combined voxelizer for multi-OBJ (tree trunk+leaves) ────────────

function voxelizeMultiOBJ(objDataList, resolution, texSamplers) {
  // Global bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const { vertices, faces } of objDataList) {
    const used = new Set();
    for (const tri of faces) for (const fv of tri) used.add(fv.vi);
    for (const vi of used) {
      const [x, y, z] = vertices[vi];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
  }
  const maxExt = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (maxExt === 0) return [];
  const voxelSize = maxExt / resolution;
  const voxelMap = new Map();

  for (const { vertices, uvs, faces, materialName } of objDataList) {
    const tex = texSamplers[materialName] || null;
    for (const tri of faces) {
      const v0 = vertices[tri[0].vi], v1 = vertices[tri[1].vi], v2 = vertices[tri[2].vi];
      const uv0 = tri[0].ti >= 0 ? uvs[tri[0].ti] : [0.5, 0.5];
      const uv1 = tri[1].ti >= 0 ? uvs[tri[1].ti] : [0.5, 0.5];
      const uv2 = tri[2].ti >= 0 ? uvs[tri[2].ti] : [0.5, 0.5];
      const e01 = Math.sqrt(((v1[0]-v0[0])/voxelSize)**2+((v1[1]-v0[1])/voxelSize)**2+((v1[2]-v0[2])/voxelSize)**2);
      const e02 = Math.sqrt(((v2[0]-v0[0])/voxelSize)**2+((v2[1]-v0[1])/voxelSize)**2+((v2[2]-v0[2])/voxelSize)**2);
      const steps = Math.max(Math.ceil(Math.max(e01, e02)) * 2, 4);
      for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps - i; j++) {
        const u = i / steps, v = j / steps, w = 1 - u - v;
        if (w < -0.001) continue;
        const px = w*v0[0]+u*v1[0]+v*v2[0], py = w*v0[1]+u*v1[1]+v*v2[1], pz = w*v0[2]+u*v1[2]+v*v2[2];
        const tu = w*uv0[0]+u*uv1[0]+v*uv2[0], tv = w*uv0[1]+u*uv1[1]+v*uv2[1];
        const gx = Math.floor((px-minX)/voxelSize), gy = Math.floor((py-minY)/voxelSize), gz = Math.floor((pz-minZ)/voxelSize);
        const key = `${gx},${gy},${gz}`;
        if (!voxelMap.has(key)) {
          const color = tex ? tex.sample(tu, tv) : { r: 0.5, g: 0.5, b: 0.5 };
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
  if(sx>200||sy>200||sz>200) return voxels;
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
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load all textures
  console.log('Loading textures...');
  const texSamplers = {};
  for (const [matName, texFile] of Object.entries(MATERIAL_TEXTURES)) {
    const texPath = path.join(TEX_DIR, texFile);
    const sampler = await loadTexture(texPath);
    if (sampler) {
      texSamplers[matName] = sampler;
      console.log(`  ${matName} → ${texFile}`);
    } else {
      console.warn(`  WARNING: ${texFile} not found`);
    }
  }

  const objFiles = fs.readdirSync(OBJ_DIR).filter(f => f.endsWith('.obj'));
  console.log(`\n${objFiles.length} OBJ files to process\n`);

  const outputNames = { field: [], objects: [], tree: [] };

  for (const objFile of objFiles) {
    const name = path.basename(objFile, '.obj');

    // Skip tree parts (handled separately below)
    if (name.startsWith('tree_')) continue;

    const isField = name.startsWith('field_');
    const resolution = isField ? FIELD_RESOLUTION : OBJECT_RESOLUTION;

    console.log(`Converting ${name} (${isField ? 'field' : 'object'}, res=${resolution})...`);

    const objText = fs.readFileSync(path.join(OBJ_DIR, objFile), 'utf-8');
    const { vertices, uvs, faces, materialName } = parseOBJ(objText);
    console.log(`  ${faces.length} tris, material: ${materialName}`);

    const tex = texSamplers[materialName] || null;
    let voxels = voxelizeMesh(vertices, uvs, faces, resolution, tex);
    console.log(`  Surface voxels: ${voxels.length}`);

    if (voxels.length === 0) { console.log('  Skipping\n'); continue; }

    if (!isField) {
      voxels = fillInterior(voxels);
      console.log(`  After fill: ${voxels.length}`);
    }

    // Blender exports Y-up by default with obj_export
    // Remap: keep as-is since Blender's default OBJ export is Y-up
    const remapped = voxels.map(v => ({ x: v.x, y: v.z, z: v.y, r: v.r, g: v.g, b: v.b }));
    let minZ = Infinity;
    for (const v of remapped) minZ = Math.min(minZ, v.z);
    for (const v of remapped) v.z -= minZ;

    const outPath = path.join(OUTPUT_DIR, `${name}.vox`);
    if (writeVox(remapped, outPath)) {
      console.log(`  → ${outPath}\n`);
      if (isField) outputNames.field.push(name);
      else outputNames.objects.push(name);
    }
  }

  // ── Process tree (combine trunk + leaves) ──────────────────────────
  console.log('Converting park tree (trunk + leaves combined)...');

  const trunkFile = path.join(OBJ_DIR, 'tree_trunk.obj');
  const leavesFile = path.join(OBJ_DIR, 'tree_leaves.obj');

  if (fs.existsSync(trunkFile) && fs.existsSync(leavesFile)) {
    const trunkData = parseOBJ(fs.readFileSync(trunkFile, 'utf-8'));
    const leavesData = parseOBJ(fs.readFileSync(leavesFile, 'utf-8'));

    console.log(`  Trunk: ${trunkData.faces.length} tris, Leaves: ${leavesData.faces.length} tris`);

    let voxels = voxelizeMultiOBJ([trunkData, leavesData], TREE_RESOLUTION, texSamplers);
    console.log(`  Surface voxels: ${voxels.length}`);

    voxels = fillInterior(voxels);
    console.log(`  After fill: ${voxels.length}`);

    const remapped = voxels.map(v => ({ x: v.x, y: v.z, z: v.y, r: v.r, g: v.g, b: v.b }));
    let minZ = Infinity;
    for (const v of remapped) minZ = Math.min(minZ, v.z);
    for (const v of remapped) v.z -= minZ;

    const outPath = path.join(OUTPUT_DIR, 'park_tree.vox');
    if (writeVox(remapped, outPath)) {
      console.log(`  → ${outPath}\n`);
      outputNames.tree.push('park_tree');
    }
  }

  // Write index
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.json'), JSON.stringify(outputNames, null, 2));
  console.log('Done!');
}

main().catch(console.error);
