'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Engine, Scene, ArcRotateCamera, Vector3, Color4,
} from '@babylonjs/core';
import { buildStage } from '@/GamePlay/FightGame/Stage/StageBuilder';
import type { ModelProgress } from '@/GamePlay/FightGame/Stage/VoxelModelLoader';
import type { TerrainKind } from '@/GamePlay/FightGame/Config/FighterConfig';
import type { CityBuildingEntry } from '@/GamePlay/FightGame/Stage/CityTerrain';
import { CityBuildingsPanel } from '@/components/CityBuildingsPanel';

interface Stats {
  fps: number;
  totalMeshes: number;
  activeMeshes: number;
  activeIndices: number;
}

export interface VoxelMapViewerProps {
  /** Override terrain mode. Defaults to STAGE_CONFIG.terrain. */
  terrain?: TerrainKind;
  /** Max camera distance (radius). Defaults to 120 (suitable for ~30m cities).
      Use larger value for big scenes like newcity (~300m). */
  cameraMax?: number;
}

export function VoxelMapViewer({ terrain, cameraMax }: VoxelMapViewerProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<Stats>({ fps: 0, totalMeshes: 0, activeMeshes: 0, activeIndices: 0 });
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<ModelProgress | null>(null);
  const [cityBuildings, setCityBuildings] = useState<CityBuildingEntry[] | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.55, 0.75, 0.95, 1);

    const maxRadius = cameraMax ?? 120;
    // For large scenes pick an initial radius that shows the whole bbox; for
    // small scenes keep the original 45 (good close-up of a 30 m city).
    const initialRadius = maxRadius > 200 ? maxRadius * 0.5 : 45;
    const camera = new ArcRotateCamera(
      'cam',
      -Math.PI / 2.5,
      Math.PI / 3,
      initialRadius,
      new Vector3(0, 1, 0),
      scene,
    );
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 5;
    camera.upperRadiusLimit = maxRadius;
    // Faster zoom for large scenes
    camera.wheelDeltaPercentage = maxRadius > 200 ? 0.05 : 0.02;
    camera.panningSensibility = maxRadius > 200 ? 20 : 50;
    // Broaden far plane so distant prototypes don't get clipped at full zoom out.
    if (maxRadius > 200) camera.maxZ = maxRadius * 4;

    let cancelled = false;
    buildStage(scene, {
      terrain,
      onModelProgress: (p) => { if (!cancelled) setProgress(p); },
    })
      .then((result) => {
        if (cancelled) return;
        setLoading(false);
        setProgress(null);
        if (result.cityBuildings) setCityBuildings(result.cityBuildings);
      })
      .catch((err) => { console.error('buildStage failed', err); if (!cancelled) setLoading(false); });

    engine.runRenderLoop(() => scene.render());

    const statsTimer = window.setInterval(() => {
      setStats({
        fps: Math.round(engine.getFps()),
        totalMeshes: scene.meshes.length,
        activeMeshes: scene.getActiveMeshes().length,
        activeIndices: scene.getActiveIndices(),
      });
    }, 500);

    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      window.clearInterval(statsTimer);
      window.removeEventListener('resize', onResize);
      engine.dispose();
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', outline: 'none' }}
      />
      <div style={hudStyle}>
        <div>FPS: <b>{stats.fps}</b></div>
        <div>Meshes: <b>{stats.totalMeshes}</b> (active {stats.activeMeshes})</div>
        <div>Tris (active): <b>{(stats.activeIndices / 3).toLocaleString()}</b></div>
        {loading && (
          <div style={{ color: '#ffeb3b', marginTop: 4 }}>
            {progress
              ? `Loading: ${progress.stage} ${progress.done}/${progress.total}`
              : 'Loading…'}
          </div>
        )}
      </div>
      <div style={hintStyle}>
        Mouse: drag = orbit / wheel = zoom / right drag = pan
      </div>
      {cityBuildings && cityBuildings.length > 0 && (
        <CityBuildingsPanel buildings={cityBuildings} />
      )}
    </div>
  );
}

const hudStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  padding: '8px 12px',
  background: 'rgba(0,0,0,0.55)',
  color: '#fff',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.5,
  borderRadius: 6,
  pointerEvents: 'none',
};

const hintStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: 12,
  padding: '6px 10px',
  background: 'rgba(0,0,0,0.45)',
  color: '#ddd',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 11,
  borderRadius: 6,
  pointerEvents: 'none',
};
