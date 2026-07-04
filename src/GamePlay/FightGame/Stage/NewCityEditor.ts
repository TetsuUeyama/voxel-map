/**
 * NewCity Editor — load SimplePoly City prototypes lazily, place them on a
 * 4.92 m grid (= 19.685 / 4 — the smallest road-tile dimension), supporting
 * multi-cell footprints and 90° rotation.
 *
 * Each placement is a Babylon Mesh clone of the canonical template, rotated
 * about its bbox center and positioned so its footprint occupies a contiguous
 * rectangle of grid cells anchored at the clicked NW corner.
 */

import {
  Scene, Mesh, Vector3, VertexData, StandardMaterial, Color3, type Material,
} from '@babylonjs/core';
import { loadChunkedVoxelModel } from '@/GamePlay/FightGame/Stage/VoxelModelLoader';
import { createUnlitMaterial } from '@/lib/voxel-skeleton';

/** Grid tile = 1/4 of the standard SimplePoly tile so even the smallest
    road part (Road_Tile_Small at 4.92 × 9.84 m) snaps to integer cells. */
export const TILE_SIZE_M = 19.685 / 4;  // ≈ 4.92125 m

/** Buildings snap to a finer grid — each road cell subdivides into
 *  DIVISOR × DIVISOR building cells (2 → 2.46 m building tile). Roads/ground
 *  keep the full TILE_SIZE_M pitch. */
export const BUILDING_TILE_DIVISOR = 2;

const BASE_URL = '/api/game-assets/field/newcity';
const MANIFEST_URL = `${BASE_URL}/prototypes_manifest.json`;

interface PrototypeManifestEntry {
  id: string;
  category: string;
  meta_path: string;
  instance_count: number;
  voxel_count: number;
}

interface PrototypesManifest {
  voxel_size: number;
  total_grid: [number, number, number];
  prototypes: PrototypeManifestEntry[];
}

export interface PrototypeInfo {
  id: string;
  category: string;
}

/** Which editing layer a placement belongs to.
 *  - 'ground'   : roads / ground tiles (the base surface)
 *  - 'building' : everything placed on top (buildings, nature, props, …) */
export type Layer = 'ground' | 'building';

export interface Placement {
  id: string;
  i: number;
  j: number;
  rotation: 0 | 1 | 2 | 3;  // multiples of 90°
  layer: Layer;
}

export interface Layout {
  version: 2;
  placements: Placement[];
}

/** Categories that belong to the ground layer. Everything else is a "building"
 *  layer part placed on top. Adjust here if e.g. ground-type natures should
 *  count as ground. */
const GROUND_CATEGORIES = new Set(['road']);
/** Specific prototype ids forced onto the ground layer regardless of category
 *  (e.g. flat grass ground tiles, which are categorised as 'nature'). */
const GROUND_IDS = new Set(['Natures_Grass_Tile', 'Natures_Grass_Tile_Small']);
export function layerOfCategory(id: string, category: string): Layer {
  if (GROUND_IDS.has(id)) return 'ground';
  return GROUND_CATEGORIES.has(category) ? 'ground' : 'building';
}

/** Snap pitch (metres) for a layer. Ground = full tile, building = half. */
export function tileForLayer(layer: Layer): number {
  return layer === 'building' ? TILE_SIZE_M / BUILDING_TILE_DIVISOR : TILE_SIZE_M;
}

interface ProtoState {
  id: string;
  mesh: Mesh;
  canonicalCenter: Vector3;
  sizeMW: number;  // unrotated footprint width (X) in metres
  sizeMD: number;  // unrotated footprint depth (Z) in metres
  instances: Map<string, PlacementInstance>;  // anchorKey → instance
}

interface PlacementInstance {
  i: number;
  j: number;
  rotation: 0 | 1 | 2 | 3;
  w: number;  // footprint W after rotation
  d: number;  // footprint D after rotation
  layer: Layer;
  mesh: Mesh;
}

interface Lazy {
  load: () => Promise<Mesh | null>;
  promise: Promise<Mesh | null> | null;
}

function cellKey(i: number, j: number): string { return `${i},${j}`; }

/** Footprint = model size rounded to the NEAREST whole cell (min 1). Rounding
 *  (not ceil) keeps a part that only slightly overflows a cell — e.g. a 2.6 m
 *  prop on the 2.46 m building grid — at 1 cell instead of ballooning to 2×2.
 *  Parts genuinely larger than 1.5 cells still round up as expected. Exact
 *  multiples (a 19.68 m road on the 4.92 m grid → 4) are unaffected. */
function cellsForSize(sizeM: number, tileM: number = TILE_SIZE_M): number {
  return Math.max(1, Math.round(sizeM / tileM));
}

export class NewCityEditorController {
  private protos = new Map<string, ProtoState>();
  private lazy = new Map<string, Lazy>();
  /** Per-layer cell ownership (cellKey → { protoId, anchorKey }). The ground
   *  and building layers are independent so placing a building does not evict
   *  the road beneath it (and vice versa). */
  owners: Record<Layer, Map<string, { protoId: string; anchorKey: string }>> = {
    ground: new Map(),
    building: new Map(),
  };
  private onChange?: () => void;
  private onLoadingChange?: (id: string, loading: boolean) => void;

  /** Translucent "ghost" preview of the part about to be placed. Reused across
   *  mouse moves; re-cloned only when the prototype or rotation changes. */
  private ghost: Mesh | null = null;
  private ghostKey: string | null = null;
  private ghostMat: StandardMaterial | null = null;

  registerLoader(id: string, load: () => Promise<Mesh | null>): void {
    this.lazy.set(id, { load, promise: null });
  }

  setOnChange(cb: () => void): void { this.onChange = cb; }
  setOnLoadingChange(cb: (id: string, loading: boolean) => void): void {
    this.onLoadingChange = cb;
  }

  isLoaded(id: string): boolean { return this.protos.has(id); }
  preload(id: string): void { void this.ensureLoaded(id); }

  /** Returns the footprint of a prototype in (w, d) cells for the given layer's
   *  grid pitch (building = half). Returns null if not loaded yet. */
  getCellFootprint(
    id: string, rotation: 0 | 1 | 2 | 3 = 0, layer: Layer = 'building',
  ): { w: number; d: number } | null {
    const p = this.protos.get(id);
    if (!p) return null;
    const tile = tileForLayer(layer);
    const wM = rotation % 2 === 0 ? p.sizeMW : p.sizeMD;
    const dM = rotation % 2 === 0 ? p.sizeMD : p.sizeMW;
    return { w: cellsForSize(wM, tile), d: cellsForSize(dM, tile) };
  }

  async ensureLoaded(id: string): Promise<boolean> {
    if (this.protos.has(id)) return true;
    const slot = this.lazy.get(id);
    if (!slot) { console.warn(`[NewCityEditor] no loader for "${id}"`); return false; }
    if (!slot.promise) {
      console.log(`[NewCityEditor] lazy-loading ${id}…`);
      this.onLoadingChange?.(id, true);
      slot.promise = (async () => {
        try {
          const mesh = await slot.load();
          if (mesh) {
            this.registerProto(id, mesh);
            console.log(`[NewCityEditor] loaded ${id} → verts=${mesh.getTotalVertices()}`);
          }
          return mesh;
        } catch (err) {
          console.error(`[NewCityEditor] load failed for "${id}":`, err);
          return null;
        } finally {
          this.onLoadingChange?.(id, false);
        }
      })();
    }
    await slot.promise;
    return this.protos.has(id);
  }

  private registerProto(id: string, mesh: Mesh): void {
    const positions = mesh.getVerticesData('position');
    let mnX = Infinity, mnY = Infinity, mnZ = Infinity;
    let mxX = -Infinity, mxY = -Infinity, mxZ = -Infinity;
    if (positions) {
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i], y = positions[i + 1], z = positions[i + 2];
        if (x < mnX) mnX = x; if (x > mxX) mxX = x;
        if (y < mnY) mnY = y; if (y > mxY) mxY = y;
        if (z < mnZ) mnZ = z; if (z > mxZ) mxZ = z;
      }
    }
    const center = new Vector3((mnX + mxX) / 2, (mnY + mxY) / 2, (mnZ + mxZ) / 2);
    const sizeMW = mxX - mnX;
    const sizeMD = mxZ - mnZ;
    console.log(
      `[NewCityEditor] registerProto ${id}: ` +
      `size_m=(${sizeMW.toFixed(2)}×${sizeMD.toFixed(2)}) → ` +
      `road-cells=${cellsForSize(sizeMW)}×${cellsForSize(sizeMD)} / ` +
      `bldg-cells=${cellsForSize(sizeMW, tileForLayer('building'))}×${cellsForSize(sizeMD, tileForLayer('building'))}, ` +
      `center=(${center.x.toFixed(1)}, ${center.y.toFixed(1)}, ${center.z.toFixed(1)})`
    );
    this.protos.set(id, {
      id, mesh, canonicalCenter: center,
      sizeMW, sizeMD,
      instances: new Map(),
    });
    mesh.setEnabled(false);
  }

  async place(
    id: string, i: number, j: number,
    rotation: 0 | 1 | 2 | 3 = 0, layer: Layer = 'building',
  ): Promise<void> {
    console.log(`[NewCityEditor] place ${id} at (${i}, ${j}) rot=${rotation * 90}° layer=${layer}`);
    const ok = await this.ensureLoaded(id);
    if (!ok) return;
    const p = this.protos.get(id);
    if (!p) return;
    const owners = this.owners[layer];
    const tile = tileForLayer(layer);
    const wM = rotation % 2 === 0 ? p.sizeMW : p.sizeMD;
    const dM = rotation % 2 === 0 ? p.sizeMD : p.sizeMW;
    const w = cellsForSize(wM, tile);
    const d = cellsForSize(dM, tile);

    // Buildings may only be placed on top of ground-layer tiles (roads/grass).
    if (layer === 'building' && !this.hasGroundUnder(i, j, w, d, layer)) {
      console.log(`[NewCityEditor] place rejected: no road/ground under footprint at (${i}, ${j}) ${w}×${d}`);
      return;
    }

    // Remove any existing placement in THIS layer that overlaps the footprint.
    const overlapping = new Set<string>();
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        const k = cellKey(i + dx, j + dz);
        const owner = owners.get(k);
        if (owner) overlapping.add(`${owner.protoId}|${owner.anchorKey}`);
      }
    }
    for (const ref of overlapping) {
      const [protoId, anchorKey] = ref.split('|');
      this.disposeInstance(protoId, anchorKey, /*skipNotify*/ true);
    }

    // Clone, rotate around bbox center, translate to footprint center.
    const anchorKey = cellKey(i, j);
    const cloned = p.mesh.clone(`${id}_${anchorKey}_r${rotation}`, null, false);
    if (!cloned) return;
    cloned.setEnabled(true);
    cloned.isPickable = false;
    cloned.alwaysSelectAsActiveMesh = true;
    // Only set pivot when actually rotating, to avoid any rotation-pivot
    // interactions with translation at rotation=0.
    if (rotation !== 0) {
      cloned.setPivotPoint(p.canonicalCenter);
      cloned.rotation.y = rotation * Math.PI / 2;
    }
    const footprintCenterX = (i + w / 2) * tile;
    const footprintCenterZ = (j + d / 2) * tile;
    cloned.position.set(
      footprintCenterX - p.canonicalCenter.x,
      0,
      footprintCenterZ - p.canonicalCenter.z,
    );
    console.log(
      `[NewCityEditor]   canonical.center=(${p.canonicalCenter.x.toFixed(2)}, ${p.canonicalCenter.y.toFixed(2)}, ${p.canonicalCenter.z.toFixed(2)}) ` +
      `footprintCenter=(${footprintCenterX.toFixed(2)}, ${footprintCenterZ.toFixed(2)}) ` +
      `→ translation=(${cloned.position.x.toFixed(2)}, ${cloned.position.y.toFixed(2)}, ${cloned.position.z.toFixed(2)})`
    );

    // Instance key includes the layer so the same prototype can (defensively)
    // exist at the same anchor on both layers without colliding.
    const instKey = `${layer}:${anchorKey}`;
    const inst: PlacementInstance = { i, j, rotation, w, d, layer, mesh: cloned };
    p.instances.set(instKey, inst);
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        owners.set(cellKey(i + dx, j + dz), { protoId: id, anchorKey: instKey });
      }
    }
    // Force world matrix update so the bounding info is correct for logging
    cloned.computeWorldMatrix(true);
    cloned.refreshBoundingInfo();
    const bb = cloned.getBoundingInfo().boundingBox;
    console.log(
      `[NewCityEditor] placed ${id} → anchor=(${i},${j}) footprint=${w}×${d} cells (tile=${tile.toFixed(2)}m) ` +
      `expected world=[${(i * tile).toFixed(2)}..${((i + w) * tile).toFixed(2)}] × [${(j * tile).toFixed(2)}..${((j + d) * tile).toFixed(2)}]`
    );
    console.log(
      `[NewCityEditor]   actual mesh world bbox: X[${bb.minimumWorld.x.toFixed(2)}..${bb.maximumWorld.x.toFixed(2)}] Z[${bb.minimumWorld.z.toFixed(2)}..${bb.maximumWorld.z.toFixed(2)}]`
    );
    this.onChange?.();
  }

  private disposeInstance(protoId: string, instKey: string, skipNotify = false): void {
    const p = this.protos.get(protoId);
    if (!p) return;
    const inst = p.instances.get(instKey);
    if (!inst) return;
    const owners = this.owners[inst.layer];
    for (let dx = 0; dx < inst.w; dx++) {
      for (let dz = 0; dz < inst.d; dz++) {
        owners.delete(cellKey(inst.i + dx, inst.j + dz));
      }
    }
    inst.mesh.dispose();
    p.instances.delete(instKey);
    if (!skipNotify) this.onChange?.();
  }

  removeAt(i: number, j: number, layer: Layer): boolean {
    const owner = this.owners[layer].get(cellKey(i, j));
    if (!owner) return false;
    this.disposeInstance(owner.protoId, owner.anchorKey);
    return true;
  }

  /** True if a placement on `layer` occupies cell (i, j). */
  isOccupied(i: number, j: number, layer: Layer): boolean {
    return this.owners[layer].has(cellKey(i, j));
  }

  /** True if every cell of the w×d footprint anchored at (i, j) is covered by a
   *  ground-layer tile (road / grass). Buildings may only sit on the ground.
   *  The (i, j) footprint is in `layer`'s grid; building cells are mapped down
   *  to the coarser ground grid (floor(cell / DIVISOR)) before the lookup. */
  hasGroundUnder(i: number, j: number, w: number, d: number, layer: Layer = 'building'): boolean {
    const div = layer === 'building' ? BUILDING_TILE_DIVISOR : 1;
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        const gi = Math.floor((i + dx) / div);
        const gj = Math.floor((j + dz) / div);
        if (!this.owners.ground.has(cellKey(gi, gj))) return false;
      }
    }
    return true;
  }

  /** Rotate the placement occupying (i, j) on the given layer by +90°.
   *  Re-places the same prototype at its anchor with the next rotation, which
   *  evicts the old instance and clones a fresh one. Returns false if empty. */
  async rotatePlacementAt(i: number, j: number, layer: Layer): Promise<boolean> {
    const owner = this.owners[layer].get(cellKey(i, j));
    if (!owner) return false;
    const p = this.protos.get(owner.protoId);
    const inst = p?.instances.get(owner.anchorKey);
    if (!p || !inst) return false;
    const newRot = ((inst.rotation + 1) % 4) as 0 | 1 | 2 | 3;
    await this.place(owner.protoId, inst.i, inst.j, newRot, layer);
    return true;
  }

  clear(): void {
    for (const p of this.protos.values()) {
      for (const inst of p.instances.values()) inst.mesh.dispose();
      p.instances.clear();
    }
    this.owners.ground.clear();
    this.owners.building.clear();
    this.onChange?.();
  }

  private ghostMaterial(scene: Scene): StandardMaterial {
    if (!this.ghostMat) {
      const m = new StandardMaterial('newcityGhost', scene);
      m.diffuseColor = new Color3(0.55, 0.8, 1);
      m.emissiveColor = new Color3(0.3, 0.55, 0.75);
      m.specularColor = new Color3(0, 0, 0);
      m.alpha = 0.55;
      m.backFaceCulling = false;
      this.ghostMat = m;
    }
    return this.ghostMat;
  }

  /** Show a translucent silhouette of `id` at cell (i, j) with `rotation`, using
   *  the exact same transform as place(). Returns true if a ghost is shown,
   *  false if the prototype is not loaded yet (caller can fall back to a box). */
  updatePreview(
    id: string, i: number, j: number, rotation: 0 | 1 | 2 | 3, layer: Layer = 'building',
  ): boolean {
    const p = this.protos.get(id);
    if (!p) { this.hidePreview(); return false; }
    const key = `${id}:${rotation}`;
    if (this.ghostKey !== key) {
      if (this.ghost) { this.ghost.dispose(); this.ghost = null; }
      const g = p.mesh.clone(`ghost_${id}`, null, false);
      if (!g) return false;
      g.isPickable = false;
      g.alwaysSelectAsActiveMesh = true;
      g.material = this.ghostMaterial(p.mesh.getScene());
      // Match place(): only set the rotation pivot when actually rotating.
      if (rotation !== 0) {
        g.setPivotPoint(p.canonicalCenter);
        g.rotation.y = rotation * Math.PI / 2;
      }
      this.ghost = g;
      this.ghostKey = key;
    }
    const tile = tileForLayer(layer);
    const w = cellsForSize(rotation % 2 === 0 ? p.sizeMW : p.sizeMD, tile);
    const d = cellsForSize(rotation % 2 === 0 ? p.sizeMD : p.sizeMW, tile);
    const fx = (i + w / 2) * tile;
    const fz = (j + d / 2) * tile;
    this.ghost!.position.set(fx - p.canonicalCenter.x, 0, fz - p.canonicalCenter.z);
    this.ghost!.setEnabled(true);
    return true;
  }

  hidePreview(): void {
    if (this.ghost) this.ghost.setEnabled(false);
  }

  countPlacements(): number {
    let n = 0;
    for (const p of this.protos.values()) n += p.instances.size;
    return n;
  }
}

/** Manual merge (concat positions/normals/colors/indices). */
function manualMergeMeshes(
  meshes: Mesh[], scene: Scene, name: string, material: Material,
): Mesh | null {
  if (meshes.length === 0) return null;
  if (meshes.length === 1) {
    const m = meshes[0];
    m.name = name;
    m.material = material;
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    return m;
  }
  let totalVerts = 0, totalIndices = 0;
  for (const m of meshes) {
    totalVerts += m.getTotalVertices();
    totalIndices += m.getTotalIndices();
  }
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 4);
  const indices = new Uint32Array(totalIndices);
  let hasNormals = false, hasColors = false, vOff = 0, iOff = 0;
  for (const m of meshes) {
    const p = m.getVerticesData('position');
    const n = m.getVerticesData('normal');
    const c = m.getVerticesData('color');
    const idx = m.getIndices();
    if (!p || !idx) continue;
    const v = m.getTotalVertices();
    positions.set(p, vOff * 3);
    if (n) { normals.set(n, vOff * 3); hasNormals = true; }
    if (c) { colors.set(c, vOff * 4); hasColors = true; }
    for (let i = 0; i < idx.length; i++) indices[iOff + i] = idx[i] + vOff;
    vOff += v;
    iOff += idx.length;
  }
  const merged = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  if (hasNormals) vd.normals = normals;
  if (hasColors) vd.colors = colors;
  vd.indices = indices;
  vd.applyToMesh(merged);
  merged.material = material;
  merged.isPickable = false;
  merged.alwaysSelectAsActiveMesh = true;
  for (const m of meshes) m.dispose();
  return merged;
}

export async function buildNewCityEditor(scene: Scene): Promise<{
  controller: NewCityEditorController;
  prototypeList: PrototypeInfo[];
}> {
  const resp = await fetch(`${MANIFEST_URL}?v=${Date.now()}`);
  if (!resp.ok) throw new Error(`Failed to fetch newcity manifest: ${resp.status}`);
  const manifest: PrototypesManifest = await resp.json();

  const controller = new NewCityEditorController();
  const prototypeList: PrototypeInfo[] = [];
  const sharedMat = createUnlitMaterial(scene, 'newcityEditorShared');

  for (const entry of manifest.prototypes) {
    const dirSegments = entry.meta_path.split('/').slice(0, -1).join('/');
    const metaName = entry.meta_path.split('/').pop()!;
    controller.registerLoader(entry.id, async () => {
      const protoMeshes = await loadChunkedVoxelModel(scene, {
        baseUrl: `${BASE_URL}/${dirSegments}`,
        metaName,
        materialName: `newcityEditor_${entry.id}`,
        logTag: `editor:${entry.id}`,
      });
      if (protoMeshes.length === 0) return null;
      return manualMergeMeshes(protoMeshes, scene, `editor_${entry.id}`, sharedMat);
    });
    prototypeList.push({ id: entry.id, category: entry.category });
  }

  console.log(`[newcity-editor] manifest loaded: ${prototypeList.length} prototypes (lazy)`);
  return { controller, prototypeList };
}
