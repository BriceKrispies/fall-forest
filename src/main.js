import { Renderer } from './renderer.js';
import { FreeCamera } from './camera.js';
import { makeFireFlames, updateSunShadowDir } from './props.js';
import { DayNightCycle, computeFireShadows } from './lighting.js';
import { DaySky, NightSky } from './sky.js';
import { initWasm, getWasm, uploadMVP, uploadCamera, uploadSunDir, uploadConstants, uploadPointLights, readLeaves, readCreatures, readMetrics, readGrassVisible, LAYOUT, getF32 } from './wasm-bridge.js';
import { WorldMode } from './world-mode.js';
import { Rain } from './rain.js';
import { CommandRegistry } from './commands.js';
import { GameConsole } from './console.js';
import { ChunkManager } from './world/chunk-manager.js';
import { groundY } from './world/path-gen.js';

const RENDER_W = 320;
const RENDER_H = 200;
const FOV = 1.1;

const canvas = document.getElementById('canvas');
const hint = document.getElementById('hint');

async function start() {
  const wasm = await initWasm();

  const renderer = new Renderer(canvas, RENDER_W, RENDER_H);
  const camera = new FreeCamera([0, 0, 0]);
  const lighting = new DayNightCycle();
  const worldMode = new WorldMode();
  const daySky = new DaySky();
  const sky = new NightSky();
  const rain = new Rain();
  const chunkManager = new ChunkManager();

  wasm.set_screen(RENDER_W, RENDER_H);
  uploadSunDir(lighting.sunDir);
  uploadConstants(10, 52, 0.32);

  // Initial chunk load at player start position
  chunkManager.update(camera.z);

  const input = { forward: false, backward: false, left: false, right: false, sprint: false, dx: 0, dy: 0 };
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
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.sprint = true;
  });
  document.addEventListener('keyup', (e) => {
    if (gameConsole.isOpen()) return;
    if (e.code === 'KeyW' || e.code === 'ArrowUp') input.forward = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') input.backward = false;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') input.left = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') input.right = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.sprint = false;
  });

  // Shared state for command handlers
  const gameState = {
    camera,
    lighting,
    renderer,
    worldMode,
    chunkManager,
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

  // Register /seed command
  commands.register('seed', (args, state) => {
    if (!args) {
      return `seed: 0x${state.chunkManager.worldSeed.toString(16)}`;
    }
    const val = parseInt(args, args.startsWith('0x') ? 16 : 10);
    if (isNaN(val)) return 'invalid seed';
    state.chunkManager.reset(val >>> 0);
    state.chunkManager.update(state.camera.z);
    return `seed: 0x${state.chunkManager.worldSeed.toString(16)}`;
  }, 'Show or set world seed');

  // Register /chunks command
  commands.register('chunks', (args, state) => {
    state.chunkManager.debugEnabled = !state.chunkManager.debugEnabled;
    return `chunks debug: ${state.chunkManager.debugEnabled ? 'on' : 'off'}`;
  }, 'Toggle chunk debug info');

  // Register /tp command
  commands.register('tp', (args, state) => {
    const z = parseFloat(args);
    if (isNaN(z)) return 'usage: /tp <z>';
    state.camera.x = 0;
    state.camera.z = z;
    state.chunkManager.update(z);
    return `teleported to z=${z.toFixed(1)}`;
  }, 'Teleport to Z coordinate');

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

    // Stream chunks around player
    chunkManager.update(eye[2]);

    // Update day/night cycle (time scale controlled by active world mode)
    lighting.update(dt * worldMode.timeScale);
    worldMode.resolve(dt, lighting);
    const env = worldMode.resolved;

    renderer.setLighting(env);
    uploadSunDir(env.sunDir);
    updateSunShadowDir(env.sunDir);

    // Dynamic ambient passed to WASM
    uploadConstants(10, 52, 0.2 + env.ambientLevel * 0.15);

    const mvp = renderer.beginFrame(eye, target, [0, 1, 0], FOV);

    // Day sky (gradient + clouds) — drawn before geometry, fades out at night
    daySky.update(dt);
    daySky.draw(renderer.pixels, RENDER_W, RENDER_H, mvp,
                renderer.hw, renderer.hh, eye,
                env.nightness, env.fogColor);

    // Night sky (gradient, stars, moon, meteors) — drawn before geometry
    sky.update(dt);
    sky.draw(renderer.pixels, RENDER_W, RENDER_H, mvp,
             renderer.hw, renderer.hh, eye,
             env.nightness, env.sunDir, totalTime, env.skyTint);

    renderer.drawSun(eye);

    uploadMVP(mvp);
    uploadCamera(eye);
    wasm.set_time(totalTime);

    // Upload point lights (fireplaces + lamps) for WASM triangle lighting
    const fireplaces = chunkManager.getFireplaces();
    const lamps = chunkManager.getLamps();
    const pointLights = [];
    for (const fp of fireplaces) {
      pointLights.push([fp[0], groundY(fp[0], fp[2]) + 0.3, fp[2], 8.0]);
    }
    for (const lp of lamps) {
      pointLights.push([lp[0], groundY(lp[0], lp[2]) + 1.86, lp[2], 6.0]);
    }
    uploadPointLights(pointLights);

    const visCount = wasm.process_triangles();
    renderer.rasterizeWasmOutput(visCount);

    // Tree breathing — canopy tris with subtle vertical displacement
    const breathingTris = chunkManager.getBreathingTris(totalTime, eye[0], eye[2]);
    if (breathingTris.length > 0) {
      renderer.drawDynamicTris(breathingTris, false);
    }

    // Render fire flames and glow for all active fireplaces
    for (const fp of fireplaces) {
      const fpGy = groundY(fp[0], fp[2]);
      const flames = makeFireFlames(fp[0], fpGy, fp[2], totalTime);
      renderer.drawDynamicTris(flames, true);

      const casters = chunkManager.getFireShadowCasters([fp[0], fpGy, fp[2]]);
      const fireShadows = computeFireShadows(
        [fp[0], fpGy, fp[2]],
        casters,
        env.nightness
      );
      renderer.drawFireShadows(fireShadows);

      renderer.drawFireGlow([fp[0], fpGy, fp[2]], eye);
    }

    // Render lamp glow for all active lamps
    for (const lp of lamps) {
      const lpGy = groundY(lp[0], lp[2]);
      renderer.drawLampGlow([lp[0], lpGy, lp[2]], eye, totalTime);
    }

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

    // Rain — 3D drops around camera, depth-tested against scene
    rain.update(dt, env.rainIntensity, eye[0], eye[1], eye[2]);
    rain.draw(renderer.pixels, RENDER_W, RENDER_H, renderer.depth,
              mvp, renderer.hw, renderer.hh);

    renderer.endFrame();

    // Debug overlay update
    if (gameState.debug || chunkManager.debugEnabled) {
      frameCount++;
      fpsAccum += dt;
      if (fpsAccum >= 1) {
        fpsDisplay = frameCount;
        frameCount = 0;
        fpsAccum = 0;
      }
      const dbgEye = camera.getEye();
      let text =
        `fps: ${fpsDisplay}\n` +
        `pos: ${dbgEye[0].toFixed(1)}, ${dbgEye[1].toFixed(1)}, ${dbgEye[2].toFixed(1)}\n` +
        `time: ${lighting.timeOfDay.toFixed(2)}`;

      if (chunkManager.debugEnabled) {
        const info = chunkManager.getDebugInfo();
        text += `\nseed: 0x${info.seed}` +
                `\nchunk: ${info.currentCoord}` +
                `\ntris: ${info.totalTris}` +
                `\n${info.chunks.join('\n')}`;
      }

      debugOverlay.textContent = text;
      debugOverlay.style.display = 'block';
    } else if (!gameState.debug && !chunkManager.debugEnabled) {
      debugOverlay.style.display = 'none';
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

start();
