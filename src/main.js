import { Renderer } from './renderer.js';
import { FreeCamera } from './camera.js';
import { buildScene, PATH_NODES, FIREPLACE_POS } from './scene.js';
import { makeFireFlames, updateSunShadowDir } from './props.js';
import { DayNightCycle, computeFireShadows } from './lighting.js';
import { NightSky } from './sky.js';
import { initWasm, getWasm, uploadMVP, uploadCamera, uploadSunDir, uploadConstants, uploadTriangles, readLeaves, readCreatures, readMetrics, uploadGrassInstances, readGrassVisible, LAYOUT, getF32 } from './wasm-bridge.js';
import { WorldMode } from './world-mode.js';
import { CommandRegistry } from './commands.js';
import { GameConsole } from './console.js';

const RENDER_W = 320;
const RENDER_H = 200;
const FOV = 1.1;

const canvas = document.getElementById('canvas');
const hint = document.getElementById('hint');

async function start() {
  const wasm = await initWasm();

  const renderer = new Renderer(canvas, RENDER_W, RENDER_H);
  const camera = new FreeCamera(PATH_NODES[0]);
  const lighting = new DayNightCycle();
  const worldMode = new WorldMode();
  const sky = new NightSky();
  const sceneTris = buildScene();

  // Objects near the fireplace that should cast fire shadows
  const fireShadowCasters = buildFireShadowCasters();

  wasm.set_screen(RENDER_W, RENDER_H);
  uploadSunDir(lighting.sunDir);
  uploadConstants(7, 36, 0.32);
  uploadTriangles(sceneTris);

  const grassInstances = buildGrassInstances();
  uploadGrassInstances(grassInstances);

  const input = { forward: false, backward: false, left: false, right: false, dx: 0, dy: 0 };
  let locked = false;
  let lastTime = performance.now();
  let hintTimer = 0;
  let totalTime = 0;

  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // ── Console system (created early so input handlers can check isOpen) ──
  const commands = new CommandRegistry();
  const gameConsole = new GameConsole(commands);

  if (!isTouch) {
    canvas.style.cursor = 'none';
    canvas.addEventListener('click', () => { canvas.requestPointerLock(); });
    document.addEventListener('pointerlockchange', () => {
      locked = document.pointerLockElement === canvas;
      if (locked) { hint.classList.add('hidden'); hintTimer = 0; }
    });
    document.addEventListener('mousemove', (e) => {
      if (!locked) return;
      input.dx += e.movementX;
      input.dy += e.movementY;
    });
  }

  if (isTouch) {
    const btns = [
      ['btn-fwd', 'forward'], ['btn-back', 'backward'],
      ['btn-left', 'left'], ['btn-right', 'right'],
    ];
    for (const [id, key] of btns) {
      const el = document.getElementById(id);
      el.addEventListener('touchstart', (e) => { e.preventDefault(); input[key] = true; });
      el.addEventListener('touchend', (e) => { e.preventDefault(); input[key] = false; });
      el.addEventListener('touchcancel', () => { input[key] = false; });
    }

    let lookTouchId = null;
    let lastTouchX = 0, lastTouchY = 0;
    canvas.addEventListener('touchstart', (e) => {
      if (gameConsole.isOpen()) return;
      if (lookTouchId !== null) return;
      const t = e.changedTouches[0];
      lookTouchId = t.identifier;
      lastTouchX = t.clientX;
      lastTouchY = t.clientY;
      e.preventDefault();
    });
    canvas.addEventListener('touchmove', (e) => {
      if (gameConsole.isOpen()) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === lookTouchId) {
          input.dx += (t.clientX - lastTouchX) * 1.5;
          input.dy += (t.clientY - lastTouchY) * 1.5;
          lastTouchX = t.clientX;
          lastTouchY = t.clientY;
        }
      }
      e.preventDefault();
    });
    const endTouch = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === lookTouchId) lookTouchId = null;
      }
    };
    canvas.addEventListener('touchend', endTouch);
    canvas.addEventListener('touchcancel', endTouch);
  }

  document.addEventListener('keydown', (e) => {
    if (gameConsole.isOpen()) return; // console captures input in capture phase
    if (e.code === 'KeyW' || e.code === 'ArrowUp') input.forward = true;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') input.backward = true;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') input.left = true;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') input.right = true;
  });
  document.addEventListener('keyup', (e) => {
    if (gameConsole.isOpen()) return;
    if (e.code === 'KeyW' || e.code === 'ArrowUp') input.forward = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') input.backward = false;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') input.left = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') input.right = false;
  });

  // Shared state for command handlers
  const gameState = {
    camera,
    lighting,
    renderer,
    worldMode,
    debug: false,
    debugOverlay: null,
  };
  gameConsole.setGameState(gameState);

  // Debug overlay element (created once, shown/hidden by /debug)
  const debugOverlay = document.createElement('div');
  debugOverlay.id = 'debug-overlay';
  debugOverlay.style.display = 'none';
  document.body.appendChild(debugOverlay);
  gameState.debugOverlay = debugOverlay;

  // Register /debug command
  commands.register('debug', (args, state) => {
    state.debug = !state.debug;
    state.debugOverlay.style.display = state.debug ? 'block' : 'none';
    return `debug: ${state.debug ? 'on' : 'off'}`;
  }, 'Toggle debug overlay');

  // Register world mode commands
  for (const name of ['hell', 'dark', 'day', 'rain', 'normal']) {
    commands.register(name, (args, state) => {
      const activated = state.worldMode.activate(name);
      return activated ? `${name}` : `unknown mode`;
    }, `Activate ${name} mode`);
  }

  let frameCount = 0;
  let fpsAccum = 0;
  let fpsDisplay = 0;

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    totalTime += dt;

    if (!isTouch && !locked) {
      hintTimer += dt;
      if (hintTimer > 5) hint.classList.remove('hidden');
    }

    camera.update(dt, input);
    const eye = camera.getEye();
    const target = camera.getTarget();

    // Update day/night cycle (time scale controlled by active world mode)
    lighting.update(dt * worldMode.timeScale);
    worldMode.resolve(dt, lighting);
    const env = worldMode.resolved;

    renderer.setLighting(env);
    uploadSunDir(env.sunDir);
    updateSunShadowDir(env.sunDir);

    // Dynamic ambient passed to WASM
    uploadConstants(7, 36, 0.2 + env.ambientLevel * 0.15);

    const mvp = renderer.beginFrame(eye, target, [0, 1, 0], FOV);

    // Night sky (gradient, stars, moon, meteors) — drawn before geometry
    sky.update(dt);
    sky.draw(renderer.pixels, RENDER_W, RENDER_H, mvp,
             renderer.hw, renderer.hh, eye,
             env.nightness, env.sunDir, totalTime, env.skyTint);

    renderer.drawSun(eye);

    uploadMVP(mvp);
    uploadCamera(eye);
    wasm.set_time(totalTime);

    const visCount = wasm.process_triangles();
    renderer.rasterizeWasmOutput(visCount);

    const fpGy = Math.sin(FIREPLACE_POS[0] * 0.3) * 0.08 + Math.cos(FIREPLACE_POS[2] * 0.25) * 0.06 +
      Math.sin(FIREPLACE_POS[0] * 0.7 + FIREPLACE_POS[2] * 0.5) * 0.04;
    const flames = makeFireFlames(FIREPLACE_POS[0], fpGy, FIREPLACE_POS[2], totalTime);
    renderer.drawDynamicTris(flames, true);  // emissive — not affected by ambient

    // Fire shadows at night
    const fireShadows = computeFireShadows(
      [FIREPLACE_POS[0], fpGy, FIREPLACE_POS[2]],
      fireShadowCasters,
      env.nightness
    );
    renderer.drawFireShadows(fireShadows);

    renderer.drawFireGlow([FIREPLACE_POS[0], fpGy, FIREPLACE_POS[2]], eye);

    wasm.update_leaves(dt, eye[0], eye[2], totalTime * 0.7);
    const leaves = readLeaves();
    for (const leaf of leaves) {
      renderer.drawLeafParticle(leaf);
    }

    wasm.update_grass(dt, eye[0], eye[2]);
    const grassBlades = readGrassVisible();
    for (const blade of grassBlades) {
      renderer.drawGrassBlade(blade);
    }

    wasm.update_creatures(dt, eye[0], eye[2], totalTime * 0.3);
    const creatures = readCreatures();
    for (const c of creatures) {
      renderer.drawCreature(c);
    }

    renderer.endFrame();

    // Debug overlay update
    if (gameState.debug) {
      frameCount++;
      fpsAccum += dt;
      if (fpsAccum >= 1) {
        fpsDisplay = frameCount;
        frameCount = 0;
        fpsAccum = 0;
      }
      const eye = camera.getEye();
      debugOverlay.textContent =
        `fps: ${fpsDisplay}\n` +
        `pos: ${eye[0].toFixed(1)}, ${eye[1].toFixed(1)}, ${eye[2].toFixed(1)}\n` +
        `time: ${lighting.timeOfDay.toFixed(2)}`;
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

// Objects near the fireplace that cast shadows from firelight
function buildFireShadowCasters() {
  const fpx = FIREPLACE_POS[0], fpz = FIREPLACE_POS[2];
  const casters = [];

  // Nearby trees (from scene.js tree list — objects within ~8 units of fire)
  const nearbyTrees = [
    [4, 41, 1.0, 3.6],    // tree near end of path
    [3.5, 39, 0.8, 3.6],
    [-3, 43, 1.2, 4.4],
    [5.5, 38, 0.9, 4.0],
  ];
  for (const [x, z, scale, baseHeight] of nearbyTrees) {
    const dx = x - fpx, dz = z - fpz;
    if (Math.sqrt(dx * dx + dz * dz) > 10) continue;
    const gy = Math.sin(x * 0.3) * 0.08 + Math.cos(z * 0.25) * 0.06 + Math.sin(x * 0.7 + z * 0.5) * 0.04;
    casters.push({ x, z, gy, height: baseHeight * scale, radius: 1.2 * scale });
  }

  // Nearby rocks/stumps
  const nearbySmall = [
    [2.0, 35, 0.8, 0.25, 0.3],
    [1.3, 36, 0.7, 0.35, 0.25],
    [2.5, 39, 0.8, 0.25, 0.3],
  ];
  for (const [x, z, scale, height, radius] of nearbySmall) {
    const gy = Math.sin(x * 0.3) * 0.08 + Math.cos(z * 0.25) * 0.06 + Math.sin(x * 0.7 + z * 0.5) * 0.04;
    casters.push({ x, z, gy, height: height * scale, radius: radius * scale });
  }

  return casters;
}

function buildGrassInstances() {
  const instances = [];
  for (let z = -2; z < 44; z += 0.8) {
    for (let x = -6; x < 6; x += 0.9) {
      const seed = x * 100 + z * 7;
      const ox = Math.sin(seed) * 0.3;
      const oz = Math.cos(seed * 1.3) * 0.2;
      const gx = x + ox;
      const gz = z + oz;
      const gy = Math.sin(gx * 0.3) * 0.08 + Math.cos(gz * 0.25) * 0.06 + Math.sin(gx * 0.7 + gz * 0.5) * 0.04;
      const h = 0.12 + 0.08 * Math.sin(seed + 1.3);
      const colorSeed = Math.abs(Math.sin(seed * 2.7));
      instances.push([gx, gy, gz, h, colorSeed, 0]);
    }
  }
  return instances;
}

start();
