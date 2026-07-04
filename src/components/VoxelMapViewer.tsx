'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Engine, Scene, ArcRotateCamera, Vector3, Color4,
  Mesh, MeshBuilder, StandardMaterial, Color3, TransformNode, Ray,
} from '@babylonjs/core';
import { buildStage } from '@/GamePlay/FightGame/Stage/StageBuilder';
import { STAGE_CONFIG } from '@/GamePlay/FightGame/Config/FighterConfig';
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
  const walkToggleRef = useRef<(() => void) | null>(null);
  const [stats, setStats] = useState<Stats>({ fps: 0, totalMeshes: 0, activeMeshes: 0, activeIndices: 0 });
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<ModelProgress | null>(null);
  const [cityBuildings, setCityBuildings] = useState<CityBuildingEntry[] | null>(null);
  const [walkMode, setWalkMode] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.55, 0.75, 0.95, 1);
    // Enable physics-lite collisions so the walking character can stand on the
    // ground and bump into buildings.
    scene.collisionsEnabled = true;
    scene.gravity = new Vector3(0, -0.55, 0);

    // Large invisible collision floor at ground level. The visible arena floor
    // only covers the small active zone (±10 m), so without this the character
    // falls through the world the moment it steps outside that patch.
    const groundLevel = STAGE_CONFIG.groundY;
    const walkFloor = MeshBuilder.CreateGround('walkFloor', { width: 800, height: 800 }, scene);
    walkFloor.position.y = groundLevel;
    walkFloor.checkCollisions = true;
    walkFloor.isVisible = false;
    walkFloor.isPickable = false;

    // Meshes the character can stand ON (streets / floors). Populated after the
    // stage loads. Buildings are deliberately excluded so the down-ray that
    // keeps the avatar on the surface never snaps it up onto a roof.
    const groundMeshes: Mesh[] = [walkFloor];

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

    // ---- Walkable character (third-person) ----
    // A visible avatar walks the streets; a chase camera trails behind so the
    // town comes into view along the character's facing direction.
    // Scene is left-handed (default, useRightHandedSystem not set) → the avatar's
    // local +Z is its "forward", and Mesh.lookAt() with yawCor 0 faces it correctly.
    // Explicit spawn: on the ground, just south of centre, facing north (+Z).
    // Kept inside the visible arena floor for the default (city) scene so the
    // character lands on solid ground immediately.
    const spawnZ = maxRadius > 200 ? -maxRadius * 0.3 : -8;
    const startPos = new Vector3(0, groundLevel + 0.1, spawnZ);

    // Whole-avatar scale. 0.2 = 1/5 of the original height & width.
    const AVATAR_SCALE = 0.2;

    // Root acts as the collider; visuals are parented to it.
    const player = new Mesh('player', scene);
    player.position.copyFrom(startPos);
    player.scaling.setAll(AVATAR_SCALE); // shrinks all parented visuals uniformly
    player.checkCollisions = true;
    // moveWithCollisions ignores mesh scaling, so size the ellipsoid by hand.
    player.ellipsoid = new Vector3(0.4 * AVATAR_SCALE, 0.9 * AVATAR_SCALE, 0.4 * AVATAR_SCALE);
    player.ellipsoidOffset = new Vector3(0, 0.9 * AVATAR_SCALE, 0); // feet(0)→head(1.8*scale)
    player.isPickable = false;
    player.setEnabled(false); // hidden until walk mode starts

    const bodyMat = new StandardMaterial('playerBody', scene);
    bodyMat.diffuseColor = new Color3(0.2, 0.5, 0.85);
    const skinMat = new StandardMaterial('playerSkin', scene);
    skinMat.diffuseColor = new Color3(0.95, 0.78, 0.62);
    const faceMat = new StandardMaterial('playerFace', scene);
    faceMat.diffuseColor = new Color3(0.1, 0.12, 0.16);

    // Visuals are built with local y=0 at the feet, so when the collider settles
    // (position.y == ground), the avatar's feet rest exactly on the ground.
    const body = MeshBuilder.CreateCapsule('pBody', { height: 1.15, radius: 0.3 }, scene);
    body.position.y = 0.575; body.material = bodyMat; body.parent = player; // [0 .. 1.15]
    const head = MeshBuilder.CreateSphere('pHead', { diameter: 0.5, segments: 10 }, scene);
    head.position.y = 1.4; head.material = skinMat; head.parent = player;   // [1.15 .. 1.65]
    // Visor on +Z marks the forward (gaze) direction.
    const visor = MeshBuilder.CreateBox('pVisor', { width: 0.34, height: 0.1, depth: 0.08 }, scene);
    visor.position.set(0, 1.42, 0.27); visor.material = faceMat; visor.parent = player;
    const arms: Mesh[] = [];
    for (const sx of [-1, 1]) {
      const arm = MeshBuilder.CreateCapsule(`pArm${sx}`, { height: 0.8, radius: 0.1 }, scene);
      arm.position.set(sx * 0.42, 0.7, 0); arm.material = bodyMat; arm.parent = player;
      arm.setPivotPoint(new Vector3(0, 0.35, 0)); // swing about the shoulder
      arms.push(arm);
    }
    [body, head, visor, ...arms].forEach((m) => { m.isPickable = false; });

    // Node the chase camera locks onto (around the head/upper body).
    const camTarget = new TransformNode('camTarget', scene);
    camTarget.parent = player;
    camTarget.position.set(0, 1.4, 0);

    // ---- Chase camera (orbit + follow) ----
    const chaseCam = new ArcRotateCamera(
      'chase', -Math.PI / 2, Math.PI / 2.8, 6 * AVATAR_SCALE, startPos.clone(), scene,
    );
    chaseCam.lockedTarget = camTarget;        // follows the walking character
    chaseCam.lowerRadiusLimit = 2.5 * AVATAR_SCALE;
    chaseCam.upperRadiusLimit = 14 * AVATAR_SCALE;
    chaseCam.lowerBetaLimit = 0.2;
    chaseCam.upperBetaLimit = Math.PI / 2.05; // keep above the horizon
    chaseCam.wheelDeltaPercentage = 0.02;
    chaseCam.minZ = 0.1;
    chaseCam.maxZ = maxRadius > 200 ? maxRadius * 4 : 1000;
    chaseCam.checkCollisions = false;

    scene.activeCamera = camera; // start in orbit (overhead) mode

    // ---- Input + per-frame character movement ----
    const WALK_SPEED = 3.2 * AVATAR_SCALE, RUN_SPEED = 6.4 * AVATAR_SCALE; // m/s, scaled to body size
    const pressed = new Set<string>();
    let vy = 0;       // vertical velocity for gravity
    let walkPhase = 0; // arm-swing animation phase
    let isWalking = false;

    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      pressed.add(k);
      if (isWalking && (k === 'Escape')) exitWalk();
      // Stop WASD/arrows from scrolling the page while walking.
      if (isWalking && ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      pressed.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const has = (...keys: string[]) => keys.some((k) => pressed.has(k));

    const updatePlayer = () => {
      if (!isWalking) return;
      const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);

      // Horizontal camera basis (handedness-safe via getDirection).
      const fwd = chaseCam.getDirection(Vector3.Forward()); fwd.y = 0;
      if (fwd.lengthSquared() < 1e-6) fwd.set(0, 0, 1);
      fwd.normalize();
      const right = chaseCam.getDirection(Vector3.Right()); right.y = 0; right.normalize();

      const move = Vector3.Zero();
      if (has('w', 'ArrowUp')) move.addInPlace(fwd);
      if (has('s', 'ArrowDown')) move.subtractInPlace(fwd);
      if (has('d', 'ArrowRight')) move.addInPlace(right);
      if (has('a', 'ArrowLeft')) move.subtractInPlace(right);

      const moving = move.lengthSquared() > 1e-6;
      const speed = has('Shift') ? RUN_SPEED : WALK_SPEED;
      const disp = Vector3.Zero();
      if (moving) {
        move.normalize();
        disp.copyFrom(move.scale(speed * dt));
        // Turn to face the travel direction (level look — target shares player.y).
        player.lookAt(new Vector3(player.position.x + move.x, player.position.y, player.position.z + move.z));
        walkPhase += dt * (has('Shift') ? 16 : 10);
      } else {
        walkPhase *= 0.8; // ease arms back to rest
      }

      // Horizontal movement only — walls / buildings block via collisions.
      disp.y = 0;
      player.moveWithCollisions(disp);

      // Hard floor clamp: the avatar can never drop below the surface beneath it.
      // Start the surface ray just above the feet (not from high in the sky) so a
      // structure arching OVER the street — an elevated railway / overpass — is
      // never picked and can't yank the avatar up onto it while it walks below.
      const gy = groundYAt(player.position.x, player.position.z, player.position.y + STEP_UP);
      if (gy === null) {
        vy += -18 * dt; player.position.y += vy * dt;       // no ground info → free fall
      } else if (player.position.y <= gy) {
        player.position.y = gy; vy = 0;                     // at/under surface → lift onto it
      } else {
        vy += -18 * dt;                                     // above surface → fall toward it
        const ny = player.position.y + vy * dt;
        if (ny <= gy) { player.position.y = gy; vy = 0; } else { player.position.y = ny; }
      }

      // Arm swing.
      const swing = Math.sin(walkPhase) * 0.7;
      arms[0].rotation.x = swing;
      arms[1].rotation.x = -swing;
    };
    scene.onBeforeRenderObservable.add(updatePlayer);

    // How high (world metres) a ground surface may sit above the avatar's feet
    // and still count as "stand-on-able". Above curbs/sidewalk noise (~0.1–0.2 m)
    // yet well below the elevated railway (metres up), so walking under the rails
    // keeps the avatar on the street instead of snapping it onto the tracks.
    const STEP_UP = 0.5;

    // Cast straight down onto the registered ground meshes to find the real
    // surface height under a point. `fromY` is where the ray starts: while
    // walking we pass feet+STEP_UP so any surface ABOVE the player (a track or
    // bridge overhead) sits above the ray origin and is never picked. The
    // predicate replaces Babylon's default isPickable test, so it still hits the
    // voxel city (which is isPickable=false).
    const groundYAt = (x: number, z: number, fromY = groundLevel + 200): number | null => {
      const ray = new Ray(new Vector3(x, fromY, z), new Vector3(0, -1, 0), fromY - groundLevel + 500);
      const hit = scene.pickWithRay(ray, (m) => groundMeshes.indexOf(m as Mesh) !== -1);
      return hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : null;
    };

    const enterWalk = () => {
      isWalking = true;
      vy = 0; walkPhase = 0;
      player.position.copyFrom(startPos);
      player.position.y = groundYAt(startPos.x, startPos.z) ?? groundLevel; // plant feet on the ground
      player.rotationQuaternion = null;
      player.rotation.set(0, 0, 0); // face +Z (north)
      player.setEnabled(true);

      // --- TEMP DIAGNOSTIC (remove once verified) ---
      const dbgHit = scene.pickWithRay(
        new Ray(new Vector3(startPos.x, groundLevel + 200, startPos.z), new Vector3(0, -1, 0), 500),
        (m) => groundMeshes.indexOf(m as Mesh) !== -1,
      );
      const hv = player.getHierarchyBoundingVectors();
      console.log('[WALK-DEBUG] enterWalk', {
        codeVersion: 'raycast-clamp-v4',
        spawn: `${startPos.x},${startPos.z}`,
        playerY: player.position.y.toFixed(3),
        rayHit: dbgHit?.hit ?? false,
        hitMesh: dbgHit?.pickedMesh?.name ?? 'NONE',
        hitY: dbgHit?.pickedPoint?.y?.toFixed(3) ?? 'n/a',
        feetWorldY: hv.min.y.toFixed(3),
        headWorldY: hv.max.y.toFixed(3),
        groundMeshNames: groundMeshes.map((m) => m.name),
        avatarScaling: player.scaling.x,
      });
      // --- END DIAGNOSTIC ---

      camera.detachControl();
      chaseCam.setTarget(camTarget.getAbsolutePosition());
      chaseCam.alpha = -Math.PI / 2; chaseCam.beta = Math.PI / 2.8; chaseCam.radius = 6 * AVATAR_SCALE;
      scene.activeCamera = chaseCam;
      chaseCam.attachControl(canvas, true);
      setWalkMode(true);
    };
    const exitWalk = () => {
      isWalking = false;
      chaseCam.detachControl();
      player.setEnabled(false);
      scene.activeCamera = camera;
      camera.attachControl(canvas, true);
      setWalkMode(false);
    };
    walkToggleRef.current = () => { if (isWalking) exitWalk(); else enterWalk(); };

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
        // Make the world solid for walking: floor + buildings collide, but skip
        // GPU thin-instanced props (collision would only use the base mesh at the
        // origin) and the billboarded compass labels.
        for (const m of result.meshes) {
          if (m.thinInstanceCount > 0) continue;
          if (m.name.startsWith('compass')) continue;
          m.checkCollisions = true;
          // Register as stand-on ground, except toggleable buildings/props so the
          // surface ray follows the streets rather than climbing onto roofs.
          if (m.name.startsWith('cityBuilding') || m.name.startsWith('cityProto')) continue;
          groundMeshes.push(m);
        }
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
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      walkToggleRef.current = null;
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
        {walkMode
          ? 'WASD / 矢印 = キャラ移動 ／ ドラッグ = 視点 ／ ホイール = 距離 ／ Shift = 走る ／ Esc = 俯瞰'
          : 'Mouse: drag = orbit / wheel = zoom / right drag = pan'}
      </div>
      <button
        style={walkButtonStyle}
        onClick={() => walkToggleRef.current?.()}
        title={walkMode ? '俯瞰モードに戻る' : 'キャラクターで街を歩く'}
      >
        {walkMode ? '🛰 俯瞰に戻る' : '🚶 キャラで歩く'}
      </button>
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

const walkButtonStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  right: 12,
  padding: '9px 16px',
  background: 'rgba(20, 30, 48, 0.78)',
  color: '#cfe4ff',
  border: '1px solid rgba(120,170,255,0.45)',
  borderRadius: 999,
  cursor: 'pointer',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 13,
  fontWeight: 'bold',
  pointerEvents: 'auto',
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
