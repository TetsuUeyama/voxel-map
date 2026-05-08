'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Engine, Scene, ArcRotateCamera, Vector3, Color4,
} from '@babylonjs/core';
import { buildStage } from '@/GamePlay/FightGame/Stage/StageBuilder';
import type { ModelProgress } from '@/GamePlay/FightGame/Stage/VoxelModelLoader';
import type { TerrainKind } from '@/GamePlay/FightGame/Config/FighterConfig';

interface Stats {
  fps: number;
  totalMeshes: number;
  activeMeshes: number;
  activeIndices: number;
}

export interface VoxelMapViewerProps {
  /** Override terrain mode. Defaults to STAGE_CONFIG.terrain. */
  terrain?: TerrainKind;
}

export function VoxelMapViewer({ terrain }: VoxelMapViewerProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<Stats>({ fps: 0, totalMeshes: 0, activeMeshes: 0, activeIndices: 0 });
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<ModelProgress | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.55, 0.75, 0.95, 1);

    const camera = new ArcRotateCamera(
      'cam',
      -Math.PI / 2.5,
      Math.PI / 3,
      45,
      new Vector3(0, 1, 0),
      scene,
    );
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 5;
    camera.upperRadiusLimit = 120;
    camera.wheelDeltaPercentage = 0.02;
    camera.panningSensibility = 50;

    let cancelled = false;
    buildStage(scene, {
      terrain,
      onModelProgress: (p) => { if (!cancelled) setProgress(p); },
    })
      .then(() => { if (!cancelled) { setLoading(false); setProgress(null); } })
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
