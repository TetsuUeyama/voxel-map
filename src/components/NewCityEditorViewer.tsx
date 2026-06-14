'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Engine, Scene, ArcRotateCamera, Vector3, Color4, Color3, HemisphericLight,
  MeshBuilder, StandardMaterial, PointerEventTypes, GlowLayer,
  type AbstractMesh,
} from '@babylonjs/core';
import {
  buildNewCityEditor, NewCityEditorController, TILE_SIZE_M,
  type PrototypeInfo, type Layer,
} from '@/GamePlay/FightGame/Stage/NewCityEditor';
import { NewCityEditorPanel } from '@/components/NewCityEditorPanel';

const GRID_CELLS_RADIUS = 60; // 120×120 cells × 4.92m ≈ 590m square

export function NewCityEditorViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<NewCityEditorController | null>(null);
  const [prototypes, setPrototypes] = useState<PrototypeInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layer, setLayer] = useState<Layer>('ground');
  const [ready, setReady] = useState(false);
  const [placementCount, setPlacementCount] = useState(0);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [rotation, setRotation] = useState<0 | 1 | 2 | 3>(0);

  const selectedRef = useRef<string | null>(null);
  const layerRef = useRef<Layer>('ground');
  const rotationRef = useRef<0 | 1 | 2 | 3>(0);
  const readyRef = useRef(false);
  const loadingRef = useRef(false);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => { layerRef.current = layer; }, [layer]);
  useEffect(() => { rotationRef.current = rotation; }, [rotation]);
  useEffect(() => { readyRef.current = ready; }, [ready]);
  useEffect(() => { loadingRef.current = loadingId !== null; }, [loadingId]);
  // Reset rotation when prototype changes
  useEffect(() => { setRotation(0); }, [selectedId]);
  // Switching layer clears the current selection (its parts belong to the other layer).
  useEffect(() => { setSelectedId(null); }, [layer]);

  const handleSelect = (id: string) => { setSelectedId(id); };

  // R key cycles rotation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        setRotation((r) => ((r + 1) % 4) as 0 | 1 | 2 | 3);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Preload a prototype when it becomes selected so placement clicks are instant.
  useEffect(() => {
    if (selectedId) controllerRef.current?.preload(selectedId);
  }, [selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.oncontextmenu = (e) => e.preventDefault();

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.55, 0.75, 0.95, 1);

    const camera = new ArcRotateCamera(
      'cam', -Math.PI / 2, Math.PI / 4, 80, new Vector3(0, 1, 0), scene,
    );
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 10;
    camera.upperRadiusLimit = 1500;
    camera.wheelDeltaPercentage = 0.05;
    camera.panningSensibility = 20;
    camera.maxZ = 5000;

    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);

    const groundSize = GRID_CELLS_RADIUS * 2 * TILE_SIZE_M;
    const ground = MeshBuilder.CreateGround('editorGround',
      { width: groundSize, height: groundSize, subdivisions: 1 }, scene);
    ground.position.set(0, 0, 0);
    const gMat = new StandardMaterial('editorGroundMat', scene);
    gMat.diffuseColor = new Color3(0.12, 0.18, 0.10);
    gMat.specularColor = new Color3(0, 0, 0);
    ground.material = gMat;
    ground.isPickable = true;

    const gridLines: Vector3[][] = [];
    const half = GRID_CELLS_RADIUS;
    const span = half * TILE_SIZE_M;
    const color = new Color3(0.45, 0.45, 0.5);
    for (let i = -half; i <= half; i++) {
      const v = i * TILE_SIZE_M;
      gridLines.push([new Vector3(v, 0.01, -span), new Vector3(v, 0.01, span)]);
      gridLines.push([new Vector3(-span, 0.01, v), new Vector3(span, 0.01, v)]);
    }
    const grid = MeshBuilder.CreateLineSystem('grid', { lines: gridLines, updatable: false }, scene);
    grid.color = color;
    grid.alpha = 0.35;
    grid.isPickable = false;

    const hover = MeshBuilder.CreateBox('hover',
      { width: TILE_SIZE_M, height: 0.1, depth: TILE_SIZE_M }, scene);
    const hMat = new StandardMaterial('hoverMat', scene);
    hMat.diffuseColor = new Color3(1, 1, 0.3);
    hMat.emissiveColor = new Color3(0.6, 0.6, 0.1);
    hMat.alpha = 0.25;
    hover.material = hMat;
    hover.isPickable = false;
    hover.setEnabled(false);
    new GlowLayer('glow', scene, { mainTextureFixedSize: 256, blurKernelSize: 32 });

    let cancelled = false;

    buildNewCityEditor(scene)
      .then(({ controller, prototypeList }) => {
        if (cancelled) return;
        setPrototypes(prototypeList);
        controller.setOnLoadingChange((id, loading) => setLoadingId(loading ? id : null));
        controller.setOnChange(() => {
          setPlacementCount(controller.countPlacements());
        });
        controllerRef.current = controller;
        setReady(true);
      })
      .catch((err) => { console.error('[newcity-editor] build failed', err); });

    scene.onPointerObservable.add((eventData) => {
      const pickInfo = scene.pick(scene.pointerX, scene.pointerY,
        (m: AbstractMesh) => m === ground);
      if (!pickInfo?.hit || !pickInfo.pickedPoint) {
        hover.setEnabled(false);
        controllerRef.current?.hidePreview();
        return;
      }
      const p = pickInfo.pickedPoint;
      const i = Math.floor(p.x / TILE_SIZE_M);
      const j = Math.floor(p.z / TILE_SIZE_M);
      const controller = controllerRef.current;
      const curLayer = layerRef.current;
      const occupied = controller ? controller.isOccupied(i, j, curLayer) : false;
      // Show the actual-model ghost only over an EMPTY cell with a part selected.
      let w = 1, d = 1;
      let showGhost = false;
      let invalidGround = false;
      if (!occupied && controller && selectedRef.current) {
        const fp = controller.getCellFootprint(selectedRef.current, rotationRef.current);
        if (fp) { w = fp.w; d = fp.d; }
        showGhost = controller.updatePreview(selectedRef.current, i, j, rotationRef.current);
        // Buildings can only sit on the ground layer (roads/grass).
        if (curLayer === 'building') invalidGround = !controller.hasGroundUnder(i, j, w, d);
      } else {
        controller?.hidePreview();
      }
      // Tint the hover cursor: over a placed part = orange (left=rotate/right=erase),
      // over a building cell with no road under = red (can't place),
      // over empty with ghost = faint outline, over empty empty-handed = yellow.
      if (occupied) {
        hMat.diffuseColor.set(1, 0.6, 0.2); hMat.emissiveColor.set(0.6, 0.3, 0.05); hMat.alpha = 0.3;
      } else if (invalidGround) {
        hMat.diffuseColor.set(1, 0.25, 0.25); hMat.emissiveColor.set(0.6, 0.08, 0.08); hMat.alpha = 0.3;
      } else if (showGhost) {
        hMat.diffuseColor.set(0.7, 0.9, 1); hMat.emissiveColor.set(0.2, 0.35, 0.5); hMat.alpha = 0.12;
      } else {
        hMat.diffuseColor.set(1, 1, 0.3); hMat.emissiveColor.set(0.6, 0.6, 0.1); hMat.alpha = 0.25;
      }
      hover.setEnabled(true);
      hover.scaling.set(w, 1, d);
      hover.position.set((i + w / 2) * TILE_SIZE_M, 0.05, (j + d / 2) * TILE_SIZE_M);

      // Act only on a TAP (down+up without dragging) so right-drag-to-pan and
      // left-drag-to-orbit don't trigger placement/rotation/erase.
      if (eventData.type !== PointerEventTypes.POINTERTAP) return;
      const evt = eventData.event as PointerEvent;
      if (!controller) return;
      // Block all editing until the manifest is ready AND nothing is loading,
      // so half-loaded parts can't be placed.
      if (!readyRef.current || loadingRef.current) {
        console.log('[click] ignored — still loading');
        return;
      }
      console.log(
        `[click] world=(${p.x.toFixed(2)}, ${p.z.toFixed(2)}) → cell(${i}, ${j}), ` +
        `button=${evt.button}, selected=${selectedRef.current ?? 'none'}, rot=${rotationRef.current * 90}°, layer=${curLayer}, occupied=${occupied}`
      );
      if (evt.button === 2) {
        // Right-click: on a placed part = erase; on empty = rotate the part to place.
        if (occupied) {
          controller.removeAt(i, j, curLayer);
        } else if (selectedRef.current) {
          const newRot = ((rotationRef.current + 1) % 4) as 0 | 1 | 2 | 3;
          setRotation(newRot);
          controller.updatePreview(selectedRef.current, i, j, newRot);  // refresh ghost immediately
        }
      } else if (evt.button === 0) {
        // Left-click: on a placed part = rotate it; on empty = place selected part.
        if (occupied) {
          void controller.rotatePlacementAt(i, j, curLayer);
        } else if (selectedRef.current) {
          void controller.place(selectedRef.current, i, j, rotationRef.current, curLayer);
        }
      }
    });

    engine.runRenderLoop(() => scene.render());

    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      engine.dispose();
    };
  }, []);

  const loadingBanner = loadingId ? (
    <div style={{
      position: 'absolute', bottom: 50, left: 12,
      padding: '6px 10px', background: 'rgba(255,193,7,0.85)', color: '#000',
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 11,
      borderRadius: 6, pointerEvents: 'none',
    }}>
      ⏳ {loadingId} を読み込み中…
    </div>
  ) : null;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', outline: 'none' }}
      />
      <div style={statusBannerStyle}>
        {!ready ? (
          <>📦 manifest を読み込み中…（読み込み完了まで操作できません）</>
        ) : loadingId ? (
          <>⏳ <b>{loadingId}</b> を読み込み中…（完了まで操作できません）</>
        ) : selectedId ? (
          <>📍 <b>{selectedId}</b> ({layer === 'ground' ? '地面・道路' : '建物'}) — 向き {rotation * 90}° — 左クリックで配置 / 右クリックで向き変更{layer === 'building' ? '（道路の上のみ・赤=不可）' : ''}</>
        ) : (
          <>👈 右のリストから{layer === 'ground' ? '地面・道路' : '建物'}パーツを選んでください</>
        )}
      </div>
      <div style={hintStyle}>
        カメラ: ドラッグ=回転 / ホイール=ズーム / 右ドラッグ=パン　　配置: 左=配置・回転 / 右=向き変更・消去 / R=向き変更
      </div>
      {loadingBanner}
      <NewCityEditorPanel
        prototypes={prototypes}
        selectedId={selectedId}
        onSelect={handleSelect}
        layer={layer}
        onSetLayer={setLayer}
        onClear={() => controllerRef.current?.clear()}
        placementCount={placementCount}
        ready={ready}
      />
    </div>
  );
}

const hintStyle: React.CSSProperties = {
  position: 'absolute', bottom: 12, left: 12,
  padding: '6px 10px', background: 'rgba(0,0,0,0.55)', color: '#ddd',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 11,
  borderRadius: 6, pointerEvents: 'none',
};
const statusBannerStyle: React.CSSProperties = {
  position: 'absolute', top: 12, left: 12,
  padding: '8px 14px', background: 'rgba(0,0,0,0.75)', color: '#fff',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13,
  borderRadius: 6, pointerEvents: 'none', maxWidth: 'calc(100vw - 320px)',
};
