/**
 * Tree3 FBX-to-VOX Converter
 *
 * Converts FBX tree models (v1: maple trees, v2: generic trees) into .vox files.
 * Handles multi-geometry FBX with per-model textures.
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { parseBinary } from 'fbx-parser';

// ── Config ──────────────────────────────────────────────────────────

const V1_DIR = 'C:/Users/user/Downloads/tree3/uploads_files_2548450_treesGeneric_0_v1';
const V2_DIR = 'C:/Users/user/Downloads/tree3/uploads_files_2548450_treesGeneric_0_v2';
const OUTPUT_DIR = 'C:/Users/user/developsecond/game-assets/field/tree3';

const VOXEL_RESOLUTION = 48;

// ── Texture sampler ─────────────────────────────────────────────────

class TextureSampler {
  constructor(pixels, width, height) {
    this.pixels = pixels;
    this.width = width;
    this.height = height;
  }
  sample(u, v) {
    u = u - Math.floor(u);
    v = v - Math.floor(v);
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

// ── FBX helpers ─────────────────────────────────────────────────────

function findNode(nodes, name) { return nodes.find(n => n.name === name); }
function findAll(nodes, name) { return nodes.filter(n => n.name === name); }
function getChildProp(node, childName) {
  const child = findNode(node.nodes, childName);
  return child ? child.props[0] : null;
}

// ── Extract geometry from FBX ───────────────────────────────────────

function extractGeometry(geomNode) {
  const rawVerts = getChildProp(geomNode, 'Vertices');
  const rawIndices = getChildProp(geomNode, 'PolygonVertexIndex');

  if (!rawVerts || !rawIndices) return null;

  // Convert vertices
  const vertices = [];
  for (let i = 0; i < rawVerts.length; i += 3) {
    vertices.push([rawVerts[i], rawVerts[i + 1], rawVerts[i + 2]]);
  }

  // Convert polygon indices to triangles
  // FBX uses negative index (bitwise NOT) to mark end of polygon
  const faces = [];
  let polyStart = 0;
  const polyVerts = [];

  for (let i = 0; i < rawIndices.length; i++) {
    let idx = rawIndices[i];
    const isEnd = idx < 0;
    if (isEnd) idx = ~idx; // bitwise NOT to get actual index
    polyVerts.push(idx);

    if (isEnd) {
      // Triangulate polygon (fan)
      for (let j = 1; j < polyVerts.length - 1; j++) {
        faces.push([polyVerts[0], polyVerts[j], polyVerts[j + 1]]);
      }
      polyVerts.length = 0;
    }
  }

  // Extract UVs
  const uvNode = findNode(geomNode.nodes, 'LayerElementUV');
  let uvs = null;
  let uvIndices = null;
  let uvMappingType = 'ByPolygonVertex';
  let uvRefType = 'IndexToDirect';

  if (uvNode) {
    uvs = [];
    const rawUVs = getChildProp(uvNode, 'UV');
    if (rawUVs) {
      for (let i = 0; i < rawUVs.length; i += 2) {
        uvs.push([rawUVs[i], rawUVs[i + 1]]);
      }
    }
    const rawUVIdx = getChildProp(uvNode, 'UVIndex');
    if (rawUVIdx) uvIndices = Array.from(rawUVIdx);

    const mt = getChildProp(uvNode, 'MappingInformationType');
    if (mt) uvMappingType = mt;
    const rt = getChildProp(uvNode, 'ReferenceInformationType');
    if (rt) uvRefType = rt;
  }

  return { vertices, faces, uvs, uvIndices, uvMappingType, uvRefType, rawIndices: Array.from(rawIndices) };
}

// ── Resolve UV for a polygon vertex ─────────────────────────────────

function getUV(geom, faceIdx, vertIdx, polyVertexCounter) {
  if (!geom.uvs || geom.uvs.length === 0) return [0.5, 0.5];

  if (geom.uvIndices) {
    // IndexToDirect: use uvIndices to look up UV
    const uvIdx = geom.uvIndices[polyVertexCounter];
    if (uvIdx !== undefined && uvIdx < geom.uvs.length) {
      return geom.uvs[uvIdx];
    }
  } else if (geom.uvRefType === 'Direct') {
    if (polyVertexCounter < geom.uvs.length) {
      return geom.uvs[polyVertexCounter];
    }
  }

  // Fallback: try vertex index directly
  if (vertIdx < geom.uvs.length) return geom.uvs[vertIdx];
  return [0.5, 0.5];
}

// ── Voxelize ────────────────────────────────────────────────────────

function voxelizeGeometries(geomsWithTex, resolution) {
  // Global bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const { geom } of geomsWithTex) {
    for (const v of geom.vertices) {
      minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
      minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
      minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]);
    }
  }

  const maxExt = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
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

  for (const { geom, tex } of geomsWithTex) {
    // Build poly vertex counter mapping
    // We need to track which polygon vertex index corresponds to each face vertex
    let polyVertCounter = 0;
    const facePolyVertStart = [];

    // Rebuild face-to-polyVertexIndex mapping
    let pvIdx = 0;
    const rawIndices = geom.rawIndices;
    const facePolyVerts = []; // for each face, store [pvIdx0, pvIdx1, pvIdx2]

    // Re-walk rawIndices to build per-face polyVertex counters
    const polyVertIndices = [];
    let polyBuffer = [];
    pvIdx = 0;
    for (let i = 0; i < rawIndices.length; i++) {
      const isEnd = rawIndices[i] < 0;
      polyBuffer.push(pvIdx);
      pvIdx++;
      if (isEnd) {
        // Triangulate same as before
        for (let j = 1; j < polyBuffer.length - 1; j++) {
          facePolyVerts.push([polyBuffer[0], polyBuffer[j], polyBuffer[j + 1]]);
        }
        polyBuffer = [];
      }
    }

    for (let fi = 0; fi < geom.faces.length; fi++) {
      const face = geom.faces[fi];
      const pvIndices = facePolyVerts[fi] || [0, 0, 0];

      const v0 = geom.vertices[face[0]];
      const v1 = geom.vertices[face[1]];
      const v2 = geom.vertices[face[2]];

      const uv0 = getUV(geom, fi, face[0], pvIndices[0]);
      const uv1 = getUV(geom, fi, face[1], pvIndices[1]);
      const uv2 = getUV(geom, fi, face[2], pvIndices[2]);

      const edge01 = Math.sqrt(((v1[0]-v0[0])/voxelSize)**2 + ((v1[1]-v0[1])/voxelSize)**2 + ((v1[2]-v0[2])/voxelSize)**2);
      const edge02 = Math.sqrt(((v2[0]-v0[0])/voxelSize)**2 + ((v2[1]-v0[1])/voxelSize)**2 + ((v2[2]-v0[2])/voxelSize)**2);
      const steps = Math.max(Math.ceil(Math.max(edge01, edge02)) * 2, 4);

      for (let i = 0; i <= steps; i++) {
        for (let j = 0; j <= steps - i; j++) {
          const u = i / steps;
          const v = j / steps;
          const w = 1 - u - v;
          if (w < -0.001) continue;

          const px = w*v0[0] + u*v1[0] + v*v2[0];
          const py = w*v0[1] + u*v1[1] + v*v2[1];
          const pz = w*v0[2] + u*v1[2] + v*v2[2];

          const tu = w*uv0[0] + u*uv1[0] + v*uv2[0];
          const tv = w*uv0[1] + u*uv1[1] + v*uv2[1];

          const [gx, gy, gz] = toGrid(px, py, pz);
          const key = `${gx},${gy},${gz}`;
          if (!voxelMap.has(key)) {
            const color = tex ? tex.sample(tu, tv) : { r: 0.5, g: 0.5, b: 0.5 };
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
  let maxX = 0, maxY = 0, maxZ = 0;
  for (const v of voxels) { maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y); maxZ = Math.max(maxZ, v.z); }
  const sx = maxX+1, sy = maxY+1, sz = maxZ+1;
  if (sx > 128 || sy > 128 || sz > 128) return voxels;
  const grid = new Uint8Array(sx*sy*sz);
  for (const v of voxels) grid[v.x + v.y*sx + v.z*sx*sy] = 1;
  const exterior = new Uint8Array(sx*sy*sz);
  const queue = [];
  for (let x=0;x<sx;x++) for (let y=0;y<sy;y++) for (const z of [0,sz-1]) { const i=x+y*sx+z*sx*sy; if(!grid[i]){exterior[i]=1;queue.push([x,y,z]);} }
  for (let x=0;x<sx;x++) for (let z=0;z<sz;z++) for (const y of [0,sy-1]) { const i=x+y*sx+z*sx*sy; if(!grid[i]&&!exterior[i]){exterior[i]=1;queue.push([x,y,z]);} }
  for (let y=0;y<sy;y++) for (let z=0;z<sz;z++) for (const x of [0,sx-1]) { const i=x+y*sx+z*sx*sy; if(!grid[i]&&!exterior[i]){exterior[i]=1;queue.push([x,y,z]);} }
  const dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  while(queue.length>0){const[cx,cy,cz]=queue.pop();for(const[dx,dy,dz]of dirs){const nx=cx+dx,ny=cy+dy,nz=cz+dz;if(nx<0||nx>=sx||ny<0||ny>=sy||nz<0||nz>=sz)continue;const ni=nx+ny*sx+nz*sx*sy;if(grid[ni]||exterior[ni])continue;exterior[ni]=1;queue.push([nx,ny,nz]);}}
  const result=[...voxels];
  for(let x=0;x<sx;x++)for(let y=0;y<sy;y++)for(let z=0;z<sz;z++){const i=x+y*sx+z*sx*sy;if(!grid[i]&&!exterior[i]){let nc={r:.5,g:.5,b:.5},md=Infinity;for(const sv of voxels){const d=(sv.x-x)**2+(sv.y-y)**2+(sv.z-z)**2;if(d<md){md=d;nc={r:sv.r,g:sv.g,b:sv.b};if(d<=1)break;}}result.push({x,y,z,...nc});}}
  return result;
}

// ── VOX writer ──────────────────────────────────────────────────────

function writeVox(voxels, filePath) {
  if (voxels.length === 0) return;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(const v of voxels){minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);minZ=Math.min(minZ,v.z);maxZ=Math.max(maxZ,v.z);}
  const sizeX=maxX-minX+1,sizeY=maxY-minY+1,sizeZ=maxZ-minZ+1;
  if(sizeX>256||sizeY>256||sizeZ>256){console.warn(`  WARNING: grid ${sizeX}x${sizeY}x${sizeZ} exceeds 256`);return;}
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
}

// ── Process FBX file ────────────────────────────────────────────────

async function processFBX(fbxPath, name, texMap, outputDir) {
  console.log(`Converting ${name}...`);
  const buf = fs.readFileSync(fbxPath);
  const result = parseBinary(buf);
  const objects = findNode(result, 'Objects');
  const connections = findNode(result, 'Connections');

  const geoms = findAll(objects.nodes, 'Geometry');
  const models = findAll(objects.nodes, 'Model');

  // Build connection map: child → parent
  const childToParent = new Map();
  for (const c of connections.nodes) {
    childToParent.set(c.props[1], c.props[2]);
  }

  // Map geometry → model name
  const geomToModel = new Map();
  for (const g of geoms) {
    const parentModelId = childToParent.get(g.props[0]);
    const parentModel = models.find(m => m.props[0] === parentModelId);
    if (parentModel) {
      geomToModel.set(g.props[0], parentModel.props[1].replace('Model::', ''));
    }
  }

  // Extract and pair geometries with textures
  const geomsWithTex = [];
  for (const g of geoms) {
    const geom = extractGeometry(g);
    if (!geom || geom.vertices.length === 0) continue;

    const modelName = geomToModel.get(g.props[0]) || '';
    // Find matching texture
    let tex = null;
    for (const [pattern, sampler] of Object.entries(texMap)) {
      if (modelName.toLowerCase().includes(pattern.toLowerCase())) {
        tex = sampler;
        break;
      }
    }
    // Fallback: use first available texture
    if (!tex) {
      const vals = Object.values(texMap);
      if (vals.length > 0) tex = vals[0];
    }

    console.log(`  ${modelName}: ${geom.vertices.length} verts, ${geom.faces.length} tris, tex: ${tex ? 'yes' : 'no'}`);
    geomsWithTex.push({ geom, tex });
  }

  let voxels = voxelizeGeometries(geomsWithTex, VOXEL_RESOLUTION);
  console.log(`  Surface voxels: ${voxels.length}`);
  if (voxels.length === 0) { console.log('  Skipping\n'); return; }

  voxels = fillInterior(voxels);
  console.log(`  After fill: ${voxels.length}`);

  // Y-up → Z-up
  const remapped = voxels.map(v => ({ x: v.x, y: v.z, z: v.y, r: v.r, g: v.g, b: v.b }));
  let minZ = Infinity;
  for (const v of remapped) minZ = Math.min(minZ, v.z);
  for (const v of remapped) v.z -= minZ;

  const outPath = path.join(outputDir, `${name}.vox`);
  writeVox(remapped, outPath);
  console.log(`  → ${outPath}\n`);
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load v1 textures (maple trees)
  console.log('Loading v1 textures...');
  const v1TexDir = path.join(V1_DIR, 'tex');
  const v1TexMap = {};
  const barkTex = await loadTexture(path.join(v1TexDir, 'treeMaple_bark_diffuse.png'));
  const leafTex = await loadTexture(path.join(v1TexDir, 'mapleLeaf_diffuse.png'));
  const twigTex = await loadTexture(path.join(v1TexDir, 'twigs_diffuse.tif'));
  v1TexMap['base'] = barkTex;
  v1TexMap['bark'] = barkTex;
  v1TexMap['leaves'] = leafTex;
  v1TexMap['leaf'] = leafTex;
  v1TexMap['twigs'] = twigTex;
  v1TexMap['twig'] = twigTex;

  // Process v1 FBX files
  const v1FbxDir = path.join(V1_DIR, 'FBX_Files');
  const v1Files = fs.readdirSync(v1FbxDir).filter(f => f.endsWith('.fbx'));
  console.log(`\nV1: ${v1Files.length} FBX files\n`);

  for (const fbxFile of v1Files) {
    const name = path.basename(fbxFile, '.fbx');
    await processFBX(path.join(v1FbxDir, fbxFile), name, v1TexMap, OUTPUT_DIR);
  }

  // Load v2 textures (generic trees)
  console.log('Loading v2 textures...');
  const v2TexDir = path.join(V2_DIR, 'tex');
  const v2TexMap = {};
  const v2BarkTex = await loadTexture(path.join(v2TexDir, 'bark_diff.jpg'));
  const v2LeafTex = await loadTexture(path.join(v2TexDir, 'leaf0_diff.jpg'));
  v2TexMap['tree'] = v2BarkTex;
  v2TexMap['bark'] = v2BarkTex;
  v2TexMap['leaves'] = v2LeafTex;
  v2TexMap['leaf'] = v2LeafTex;

  // Process v2 FBX
  const v2FbxPath = path.join(V2_DIR, 'treesGeneric_0.fbx');
  // v2 has multiple trees in one FBX - we'll process them all together as separate trees
  console.log('\nV2: Processing treesGeneric_0.fbx\n');

  const buf = fs.readFileSync(v2FbxPath);
  const result = parseBinary(buf);
  const objects = findNode(result, 'Objects');
  const connections = findNode(result, 'Connections');
  const geoms = findAll(objects.nodes, 'Geometry');
  const models = findAll(objects.nodes, 'Model');

  // Build connection map
  const childToParent = new Map();
  for (const c of connections.nodes) {
    childToParent.set(c.props[1], c.props[2]);
  }

  // Group geometries by tree (tree1+leaves1, tree2+leaves2, tree3+leaves3)
  const treeGroups = { tree1: [], tree2: [], tree3: [] };
  for (const g of geoms) {
    const parentId = childToParent.get(g.props[0]);
    const parentModel = models.find(m => m.props[0] === parentId);
    if (!parentModel) continue;
    const modelName = parentModel.props[1].replace('Model::', '');

    const geom = extractGeometry(g);
    if (!geom || geom.vertices.length === 0) continue;

    let tex = null;
    if (modelName.includes('leaves')) tex = v2LeafTex;
    else if (modelName.includes('tree')) tex = v2BarkTex;

    // Determine which tree group
    for (const treeKey of ['tree1', 'tree2', 'tree3']) {
      const num = treeKey.replace('tree', '');
      if (modelName.includes(num)) {
        treeGroups[treeKey].push({ geom, tex });
        console.log(`  ${modelName} → ${treeKey}: ${geom.vertices.length} verts`);
        break;
      }
    }
  }

  // Voxelize each tree group
  for (const [treeName, geomsWithTex] of Object.entries(treeGroups)) {
    if (geomsWithTex.length === 0) continue;
    console.log(`\nConverting generic_${treeName}...`);

    let voxels = voxelizeGeometries(geomsWithTex, VOXEL_RESOLUTION);
    console.log(`  Surface voxels: ${voxels.length}`);
    if (voxels.length === 0) continue;

    voxels = fillInterior(voxels);
    console.log(`  After fill: ${voxels.length}`);

    const remapped = voxels.map(v => ({ x: v.x, y: v.z, z: v.y, r: v.r, g: v.g, b: v.b }));
    let minZ = Infinity;
    for (const v of remapped) minZ = Math.min(minZ, v.z);
    for (const v of remapped) v.z -= minZ;

    const outPath = path.join(OUTPUT_DIR, `generic_${treeName}.vox`);
    writeVox(remapped, outPath);
    console.log(`  → ${outPath}`);
  }

  console.log('\nDone!');
}

main().catch(console.error);
