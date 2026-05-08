/**
 * Building (Farm Pack) OBJ-to-VOX Converter
 *
 * Converts LowPoly Farm Pack (944 OBJ parts → ~160 unique models)
 * into individual .vox files by spatial clustering.
 *
 * Pipeline:
 *   1. Parse OBJ → extract per-object vertices, UVs, faces, bounding boxes
 *   2. Cluster spatially adjacent objects into models
 *   3. Deduplicate similar clusters (keep unique models only)
 *   4. Voxelize and write .vox files
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// ── Config ──────────────────────────────────────────────────────────

const OBJ_PATH = 'E:/Field/building/uploads_files_3332521_LowPoly_Farm_Pack_obj.obj';
const TEXTURE_PATH = 'E:/Field/building/uploads_files_3332521_textures/textures/color_1024x1024.jpg';
const OUTPUT_DIR = 'C:/Users/user/developsecond/game-assets/field/building';

const VOXEL_RESOLUTION = 40;
const CLUSTER_TOLERANCE = 0.5; // merge objects within this distance

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
  const { data, info } = await sharp(texPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return new TextureSampler(data, info.width, info.height);
}

// ── OBJ Parser ──────────────────────────────────────────────────────

function parseOBJWithBounds(objText) {
  const allVertices = [];
  const allUVs = [];
  const objects = []; // { name, faces[], bbox }
  let current = null;

  for (const line of objText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('mtllib') || trimmed.startsWith('usemtl') || trimmed.startsWith('s ') || trimmed.startsWith('vn ')) continue;
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0];

    if (cmd === 'v') {
      allVertices.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
    } else if (cmd === 'vt') {
      allUVs.push([parseFloat(parts[1]), parseFloat(parts[2])]);
    } else if (cmd === 'o') {
      current = {
        name: parts[1],
        faces: [],
        bbox: { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity },
        vertIndices: new Set(),
      };
      objects.push(current);
    } else if (cmd === 'f' && current) {
      const faceVerts = [];
      for (let i = 1; i < parts.length; i++) {
        const indices = parts[i].split('/');
        const vi = parseInt(indices[0]) - 1;
        const ti = indices[1] ? parseInt(indices[1]) - 1 : -1;
        faceVerts.push({ vi, ti });
        current.vertIndices.add(vi);
      }
      for (let i = 1; i < faceVerts.length - 1; i++) {
        current.faces.push([faceVerts[0], faceVerts[i], faceVerts[i + 1]]);
      }
    }
  }

  // Compute bounding boxes
  for (const obj of objects) {
    for (const vi of obj.vertIndices) {
      const [x, y, z] = allVertices[vi];
      obj.bbox.minX = Math.min(obj.bbox.minX, x);
      obj.bbox.minY = Math.min(obj.bbox.minY, y);
      obj.bbox.minZ = Math.min(obj.bbox.minZ, z);
      obj.bbox.maxX = Math.max(obj.bbox.maxX, x);
      obj.bbox.maxY = Math.max(obj.bbox.maxY, y);
      obj.bbox.maxZ = Math.max(obj.bbox.maxZ, z);
    }
    delete obj.vertIndices;
  }

  return { allVertices, allUVs, objects };
}

// ── Spatial clustering ──────────────────────────────────────────────

function bboxOverlap(a, b, tolerance) {
  return (
    a.minX - tolerance <= b.maxX && a.maxX + tolerance >= b.minX &&
    a.minY - tolerance <= b.maxY && a.maxY + tolerance >= b.minY &&
    a.minZ - tolerance <= b.maxZ && a.maxZ + tolerance >= b.minZ
  );
}

function clusterObjects(objects, tolerance) {
  // Union-Find
  const parent = objects.map((_, i) => i);
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

  // O(n^2) pairwise check - acceptable for ~944 objects
  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      if (bboxOverlap(objects[i].bbox, objects[j].bbox, tolerance)) {
        union(i, j);
      }
    }
  }

  // Group by root
  const groups = new Map();
  for (let i = 0; i < objects.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }

  return [...groups.values()];
}

// ── Label clusters ──────────────────────────────────────────────────

function labelCluster(objects, indices) {
  // Try to find a descriptive name from named objects (not Box/Cylinder/Object/etc)
  const genericPrefixes = ['Box', 'Cylinder', 'Object', 'Plane', 'Sphere', 'Line', 'Shape', 'Rectangle', 'OilTank'];
  const namedObjs = indices
    .map(i => objects[i].name.replace(/_Mesh.*$/, ''))
    .filter(n => !genericPrefixes.some(p => n.startsWith(p)));

  if (namedObjs.length > 0) {
    // Extract base name (remove trailing numbers and variant suffixes)
    const base = namedObjs[0].replace(/_[a-z]?\d*$/, '').replace(/\d+$/, '');
    return base || namedObjs[0];
  }

  return null; // no descriptive name
}

// ── Deduplication ───────────────────────────────────────────────────

function clusterSignature(objects, indices) {
  // Create a rough signature based on dimensions and face count
  let totalFaces = 0;
  let bMinX = Infinity, bMinY = Infinity, bMinZ = Infinity;
  let bMaxX = -Infinity, bMaxY = -Infinity, bMaxZ = -Infinity;

  for (const i of indices) {
    totalFaces += objects[i].faces.length;
    bMinX = Math.min(bMinX, objects[i].bbox.minX);
    bMinY = Math.min(bMinY, objects[i].bbox.minY);
    bMinZ = Math.min(bMinZ, objects[i].bbox.minZ);
    bMaxX = Math.max(bMaxX, objects[i].bbox.maxX);
    bMaxY = Math.max(bMaxY, objects[i].bbox.maxY);
    bMaxZ = Math.max(bMaxZ, objects[i].bbox.maxZ);
  }

  const dx = Math.round((bMaxX - bMinX) * 10);
  const dy = Math.round((bMaxY - bMinY) * 10);
  const dz = Math.round((bMaxZ - bMinZ) * 10);

  return `${indices.length}_${totalFaces}_${dx}x${dy}x${dz}`;
}

// ── Voxelizer ───────────────────────────────────────────────────────

function voxelizeCluster(allVertices, allUVs, objects, indices, resolution, texSampler) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const i of indices) {
    minX = Math.min(minX, objects[i].bbox.minX);
    minY = Math.min(minY, objects[i].bbox.minY);
    minZ = Math.min(minZ, objects[i].bbox.minZ);
    maxX = Math.max(maxX, objects[i].bbox.maxX);
    maxY = Math.max(maxY, objects[i].bbox.maxY);
    maxZ = Math.max(maxZ, objects[i].bbox.maxZ);
  }

  const maxExt = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (maxExt === 0) return [];
  const voxelSize = maxExt / resolution;
  const voxelMap = new Map();

  function toGrid(x, y, z) {
    return [Math.floor((x - minX) / voxelSize), Math.floor((y - minY) / voxelSize), Math.floor((z - minZ) / voxelSize)];
  }

  for (const objIdx of indices) {
    for (const tri of objects[objIdx].faces) {
      const v0 = allVertices[tri[0].vi];
      const v1 = allVertices[tri[1].vi];
      const v2 = allVertices[tri[2].vi];
      const uv0 = tri[0].ti >= 0 ? allUVs[tri[0].ti] : [0.5, 0.5];
      const uv1 = tri[1].ti >= 0 ? allUVs[tri[1].ti] : [0.5, 0.5];
      const uv2 = tri[2].ti >= 0 ? allUVs[tri[2].ti] : [0.5, 0.5];

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
          const tu = w*uv0[0]+u*uv1[0]+v*uv2[0];
          const tv = w*uv0[1]+u*uv1[1]+v*uv2[1];
          const [gx,gy,gz] = toGrid(px, py, pz);
          const key = `${gx},${gy},${gz}`;
          if (!voxelMap.has(key)) {
            const color = texSampler.sample(tu, tv);
            voxelMap.set(key, { x: gx, y: gy, z: gz, ...color });
          }
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
  if(sx>128||sy>128||sz>128) return voxels;
  const grid=new Uint8Array(sx*sy*sz);
  for(const v of voxels) grid[v.x+v.y*sx+v.z*sx*sy]=1;
  const exterior=new Uint8Array(sx*sy*sz);
  const queue=[];
  for(let x=0;x<sx;x++)for(let y=0;y<sy;y++)for(const z of[0,sz-1]){const i=x+y*sx+z*sx*sy;if(!grid[i]){exterior[i]=1;queue.push([x,y,z]);}}
  for(let x=0;x<sx;x++)for(let z=0;z<sz;z++)for(const y of[0,sy-1]){const i=x+y*sx+z*sx*sy;if(!grid[i]&&!exterior[i]){exterior[i]=1;queue.push([x,y,z]);}}
  for(let y=0;y<sy;y++)for(let z=0;z<sz;z++)for(const x of[0,sx-1]){const i=x+y*sx+z*sx*sy;if(!grid[i]&&!exterior[i]){exterior[i]=1;queue.push([x,y,z]);}}
  const dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  while(queue.length>0){const[cx,cy,cz]=queue.pop();for(const[dx,dy,dz]of dirs){const nx=cx+dx,ny=cy+dy,nz=cz+dz;if(nx<0||nx>=sx||ny<0||ny>=sy||nz<0||nz>=sz)continue;const ni=nx+ny*sx+nz*sx*sy;if(grid[ni]||exterior[ni])continue;exterior[ni]=1;queue.push([nx,ny,nz]);}}
  const result=[...voxels];
  for(let x=0;x<sx;x++)for(let y=0;y<sy;y++)for(let z=0;z<sz;z++){const i=x+y*sx+z*sx*sy;if(!grid[i]&&!exterior[i]){let nc={r:.5,g:.5,b:.5},md=Infinity;for(const sv of voxels){const d=(sv.x-x)**2+(sv.y-y)**2+(sv.z-z)**2;if(d<md){md=d;nc={r:sv.r,g:sv.g,b:sv.b};if(d<=1)break;}}result.push({x,y,z,...nc});}}
  return result;
}

// ── VOX writer ──────────────────────────────────────────────────────

function writeVox(voxels, filePath) {
  if(voxels.length===0)return false;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(const v of voxels){minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);minZ=Math.min(minZ,v.z);maxZ=Math.max(maxZ,v.z);}
  const sizeX=maxX-minX+1,sizeY=maxY-minY+1,sizeZ=maxZ-minZ+1;
  if(sizeX>256||sizeY>256||sizeZ>256){console.warn(`  WARNING: grid ${sizeX}x${sizeY}x${sizeZ} exceeds 256, skipping`);return false;}
  const pm=new Map(),palette=[];
  function ck(r,g,b){return((Math.round(r*255)&0xFC)<<16)|((Math.round(g*255)&0xFC)<<8)|(Math.round(b*255)&0xFC);}
  const rv=[];
  for(const v of voxels){const k=ck(v.r,v.g,v.b);let ci=pm.get(k);if(ci===undefined){if(palette.length>=255){let bd=Infinity,bi=0;for(let i=0;i<palette.length;i++){const d=(palette[i].r-v.r)**2+(palette[i].g-v.g)**2+(palette[i].b-v.b)**2;if(d<bd){bd=d;bi=i;}}ci=bi+1;}else{palette.push({r:Math.round(v.r*255),g:Math.round(v.g*255),b:Math.round(v.b*255)});ci=palette.length;pm.set(k,ci);}}rv.push({x:v.x-minX,y:v.y-minY,z:v.z-minZ,colorIndex:ci});}
  while(palette.length<256)palette.push({r:0,g:0,b:0});
  const n=rv.length;const sc=Buffer.alloc(12);sc.writeUInt32LE(sizeX,0);sc.writeUInt32LE(sizeY,4);sc.writeUInt32LE(sizeZ,8);
  const xc=Buffer.alloc(4+n*4);xc.writeUInt32LE(n,0);for(let i=0;i<n;i++){xc.writeUInt8(rv[i].x,4+i*4);xc.writeUInt8(rv[i].y,4+i*4+1);xc.writeUInt8(rv[i].z,4+i*4+2);xc.writeUInt8(rv[i].colorIndex,4+i*4+3);}
  const rc=Buffer.alloc(256*4);for(let i=0;i<256;i++){rc.writeUInt8(palette[i].r,i*4);rc.writeUInt8(palette[i].g,i*4+1);rc.writeUInt8(palette[i].b,i*4+2);rc.writeUInt8(255,i*4+3);}
  function mc(id,ct,ch=Buffer.alloc(0)){const h=Buffer.alloc(12);h.write(id,0,4,'ascii');h.writeUInt32LE(ct.length,4);h.writeUInt32LE(ch.length,8);return Buffer.concat([h,ct,ch]);}
  const mch=Buffer.concat([mc('SIZE',sc),mc('XYZI',xc),mc('RGBA',rc)]);
  const fh=Buffer.alloc(8);fh.write('VOX ',0,4,'ascii');fh.writeUInt32LE(150,4);
  fs.writeFileSync(filePath,Buffer.concat([fh,mc('MAIN',Buffer.alloc(0),mch)]));
  fs.writeFileSync(filePath.replace('.vox','_meta.json'),JSON.stringify({name:path.basename(filePath,'.vox'),grid:[sizeX,sizeY,sizeZ],voxel_count:n,palette_size:palette.filter(p=>p.r||p.g||p.b).length,resolution:VOXEL_RESOLUTION},null,2));
  return true;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('Loading texture...');
  const texSampler = await loadTexture(TEXTURE_PATH);
  console.log(`  Texture: ${texSampler.width}×${texSampler.height}`);

  console.log('Parsing OBJ file...');
  const objText = fs.readFileSync(OBJ_PATH, 'utf-8');
  const { allVertices, allUVs, objects } = parseOBJWithBounds(objText);
  console.log(`  ${objects.length} objects, ${allVertices.length} vertices`);

  console.log('Clustering objects by spatial proximity...');
  const clusters = clusterObjects(objects, CLUSTER_TOLERANCE);
  console.log(`  ${clusters.length} clusters found`);

  // Filter out tiny clusters (likely stray vertices) and very large ground planes
  const validClusters = clusters.filter(indices => {
    if (indices.length === 0) return false;
    let totalFaces = 0;
    let bMinX = Infinity, bMinY = Infinity, bMinZ = Infinity;
    let bMaxX = -Infinity, bMaxY = -Infinity, bMaxZ = -Infinity;
    for (const i of indices) {
      totalFaces += objects[i].faces.length;
      bMinX = Math.min(bMinX, objects[i].bbox.minX);
      bMinY = Math.min(bMinY, objects[i].bbox.minY);
      bMinZ = Math.min(bMinZ, objects[i].bbox.minZ);
      bMaxX = Math.max(bMaxX, objects[i].bbox.maxX);
      bMaxY = Math.max(bMaxY, objects[i].bbox.maxY);
      bMaxZ = Math.max(bMaxZ, objects[i].bbox.maxZ);
    }
    // Skip clusters with no geometry
    if (totalFaces < 2) return false;
    // Skip extremely large clusters (likely the entire scene merged)
    const span = Math.max(bMaxX - bMinX, bMaxY - bMinY, bMaxZ - bMinZ);
    if (span > 50) return false;
    return true;
  });

  console.log(`  ${validClusters.length} valid clusters after filtering`);

  // Deduplicate by signature
  const seen = new Map(); // signature → first cluster index
  const uniqueClusters = [];
  for (const indices of validClusters) {
    const sig = clusterSignature(objects, indices);
    if (!seen.has(sig)) {
      seen.set(sig, uniqueClusters.length);
      uniqueClusters.push(indices);
    }
  }
  console.log(`  ${uniqueClusters.length} unique models after deduplication\n`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Process each unique cluster
  let outputCount = 0;
  const modelNames = [];

  for (let ci = 0; ci < uniqueClusters.length; ci++) {
    const indices = uniqueClusters[ci];
    const label = labelCluster(objects, indices);
    const modelName = label
      ? `${label}_${String(ci + 1).padStart(3, '0')}`
      : `farm_${String(ci + 1).padStart(3, '0')}`;

    // Clean name for filesystem
    const safeName = modelName.replace(/[^a-zA-Z0-9_-]/g, '_');

    let totalFaces = 0;
    for (const i of indices) totalFaces += objects[i].faces.length;

    console.log(`[${ci + 1}/${uniqueClusters.length}] ${safeName} (${indices.length} parts, ${totalFaces} tris)`);

    let voxels = voxelizeCluster(allVertices, allUVs, objects, indices, VOXEL_RESOLUTION, texSampler);
    console.log(`  Surface voxels: ${voxels.length}`);

    if (voxels.length === 0) { console.log('  Skipping (empty)\n'); continue; }

    voxels = fillInterior(voxels);
    console.log(`  After fill: ${voxels.length}`);

    // Y-up → Z-up
    const remapped = voxels.map(v => ({ x: v.x, y: v.z, z: v.y, r: v.r, g: v.g, b: v.b }));
    let minZ = Infinity;
    for (const v of remapped) minZ = Math.min(minZ, v.z);
    for (const v of remapped) v.z -= minZ;

    const outPath = path.join(OUTPUT_DIR, `${safeName}.vox`);
    if (writeVox(remapped, outPath)) {
      console.log(`  → ${outPath}\n`);
      modelNames.push(safeName);
      outputCount++;
    } else {
      console.log('  Write failed\n');
    }
  }

  // Write index file
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.json'), JSON.stringify({
    count: outputCount,
    models: modelNames,
  }, null, 2));

  console.log(`\nDone! ${outputCount} models converted.`);
}

main().catch(console.error);
