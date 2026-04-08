import { Renderer } from './renderer.js';
import { FreeCamera } from './camera.js';
import { makeFireFlames, updateSunShadowDir } from './props.js';
import { DayNightCycle, computeFireShadows } from './lighting.js';
import { DaySky, NightSky } from './sky.js';
import { initWasm, getWasm, uploadMVP, uploadCamera, uploadSunDir, uploadConstants, uploadPointLights, readLeaves, readCreatures, readMetrics, readGrassVisible, LAYOUT, getF32, uploadHorrorConfig, clearHorrorBuffers, readHorrorEntities, moveHorrorEntity } from './wasm-bridge.js';
import { WorldMode } from './world-mode.js';
import { Rain } from './rain.js';
import { CommandRegistry } from './commands.js';
import { GameConsole } from './console.js';
import { ChunkManager } from './world/chunk-manager.js';
import { groundYFast } from './world/terrain.js';
import { generateAllHorrors } from './horror-gen.js';
import { renderHorrors, renderHorrorDebug } from './horror-renderer.js';

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
  uploadConstants(20, 104, 0.32);

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

  // Horror subsystem state
  const horrorState = {
    enabled: false,       // overridden by world mode, but can be toggled manually
    debugEnabled: false,
    generated: false,     // true when horrors have been generated for current mode
    lastMode: null,       // track mode changes to regenerate
    spawnSeed: 0,         // seed used for last generation
    // Per-entity movement/behavior state
    entities: [],         // { heading, speed, wanderTimer, frozen }
  };

  const HORROR_FREEZE_DIST = 4.0;   // distance at which monsters freeze
  const HORROR_RESUME_DIST = 6.0;   // distance at which they resume
  const HORROR_WANDER_SPEED = 0.4;
  const HORROR_TURN_SPEED = 2.0;


  // Shared state for command handlers
  const gameState = {
    camera,
    lighting,
    renderer,
    worldMode,
    chunkManager,
    horrorState,
    debug: false,
    debugOverlay: null,
    frozen: false,
  };
  gameConsole.setGameState(gameState);

  // Debug overlay element (created once, shown/hidden by /debug)
  const debugOverlay = document.createElement('div');
  debugOverlay.id = 'debug-overlay';
  debugOverlay.style.display = 'none';
  document.body.appendChild(debugOverlay);
  gameState.debugOverlay = debugOverlay;

  // Register /freeze command
  commands.register('freeze', (args, state) => {
    state.frozen = !state.frozen;
    return `simulation ${state.frozen ? 'frozen' : 'resumed'}`;
  }, 'Freeze/resume all simulation (camera still works)');

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

  // Register /horror command
  commands.register('horror', (args, state) => {
    const arg = (args || '').trim().toLowerCase();
    if (arg === 'on') {
      state.horrorState.enabled = true;
      state.horrorState.generated = false;
      return 'horror: on';
    }
    if (arg === 'off') {
      state.horrorState.enabled = false;
      clearHorrorBuffers();
      return 'horror: off';
    }
    if (arg === 'debug') {
      state.horrorState.debugEnabled = !state.horrorState.debugEnabled;
      return `horror debug: ${state.horrorState.debugEnabled ? 'on' : 'off'}`;
    }
    if (arg === 'regen') {
      state.horrorState.generated = false;
      return 'horror: regenerating';
    }
    return `horror: ${state.horrorState.enabled ? 'on' : 'off'}`;
  }, 'Horror entity control');

  let frameCount = 0;
  let fpsAccum = 0;
  let fpsDisplay = 0;

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    const simDt = gameState.frozen ? 0 : dt;
    totalTime += simDt;

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
    lighting.update(simDt * worldMode.timeScale);
    worldMode.resolve(simDt, lighting);
    const env = worldMode.resolved;

    renderer.setLighting(env);
    uploadSunDir(env.sunDir);
    updateSunShadowDir(env.sunDir);

    // Dynamic ambient passed to WASM
    uploadConstants(20, 104, 0.2 + env.ambientLevel * 0.15);

    const mvp = renderer.beginFrame(eye, target, [0, 1, 0], FOV);

    // Day sky (gradient + clouds) — drawn before geometry, fades out at night
    daySky.update(simDt);
    daySky.draw(renderer.pixels, RENDER_W, RENDER_H, mvp,
                renderer.hw, renderer.hh, eye,
                env.nightness, env.fogColor);

    // Night sky (gradient, stars, moon, meteors) — drawn before geometry
    sky.update(simDt);
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
      pointLights.push([fp[0], groundYFast(fp[0], fp[2]) + 0.3, fp[2], 8.0]);
    }
    for (const lp of lamps) {
      pointLights.push([lp[0], groundYFast(lp[0], lp[2]) + 1.86, lp[2], 6.0]);
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
      const fpGy = groundYFast(fp[0], fp[2]);
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
      const lpGy = groundYFast(lp[0], lp[2]);
      renderer.drawLampGlow([lp[0], lpGy, lp[2]], eye, totalTime);
    }

    wasm.update_leaves(simDt, eye[0], eye[2], totalTime * 0.7);
    const leaves = readLeaves();
    for (const leaf of leaves) {
      renderer.drawLeafParticle(leaf);
    }

    wasm.update_grass(simDt, eye[0], eye[2]);
    const grassBlades = readGrassVisible();
    for (const blade of grassBlades) {
      renderer.drawGrassBlade(blade);
    }

    wasm.update_creatures(simDt, eye[0], eye[2], totalTime * 0.3);
    const creatures = readCreatures();
    for (const c of creatures) {
      renderer.drawCreature(c);
    }

    // ── Horror entities ──
    // Determine if horror is active (world mode or manual override)
    const horrorActive = env.horrorEnabled || horrorState.enabled;

    if (horrorActive) {
      // Regenerate if mode changed or not yet generated
      const modeKey = worldMode.current;
      if (!horrorState.generated || horrorState.lastMode !== modeKey) {
        // Generate horror spawn positions around camera
        const spawnCount = Math.max(1, Math.floor((env.horrorDensity || 0.5) * LAYOUT.MAX_HORROR_ENT));
        const spawnSeed = (chunkManager.worldSeed ^ (modeKey.charCodeAt(0) * 31337)) >>> 0;
        const positions = [];
        for (let i = 0; i < spawnCount; i++) {
          const hash = (spawnSeed + i * 2654435761) >>> 0;
          const angle = ((hash & 0xFFFF) / 0xFFFF) * Math.PI * 2;
          const dist = 3 + ((hash >>> 16) / 0xFFFF) * 5;
          const sx = eye[0] + Math.cos(angle) * dist;
          const sz = eye[2] + Math.sin(angle) * dist;
          const sy = groundYFast(sx, sz) + 0.3 + ((hash >>> 8 & 0xFF) / 255) * 0.5;
          positions.push({ x: sx, y: sy, z: sz, seed: hash });
        }
        generateAllHorrors(env, positions, wasm);
        horrorState.generated = true;
        horrorState.lastMode = modeKey;
        horrorState.spawnSeed = spawnSeed;
        horrorState.entities = []; // reset behavior state for fresh generation
      }

      // Initialize entity behavior state when freshly generated
      if (horrorState.entities.length === 0 || horrorState.entities.length !== wasm.get_horror_ent_count()) {
        const count = wasm.get_horror_ent_count();
        horrorState.entities = [];
        for (let i = 0; i < count; i++) {
          const hash = (horrorState.spawnSeed + i * 7919) >>> 0;
          horrorState.entities.push({
            heading: ((hash & 0xFFFF) / 0xFFFF) * Math.PI * 2,
            speed: HORROR_WANDER_SPEED * (0.6 + ((hash >>> 16) / 0xFFFF) * 0.8),
            wanderTimer: ((hash >>> 8) & 0xFF) / 255 * 3,
            frozen: false,
          });
        }
      }

      // Update entity movement / freeze behavior
      const ents = readHorrorEntities();
      for (const ent of ents) {
        const beh = horrorState.entities[ent.idx];
        if (!beh) continue;

        const dx = eye[0] - ent.x;
        const dz = eye[2] - ent.z;
        const distSq = dx * dx + dz * dz;
        const dist = Math.sqrt(distSq);

        if (!beh.frozen && dist < HORROR_FREEZE_DIST) {
          beh.frozen = true;
        } else if (beh.frozen && dist > HORROR_RESUME_DIST) {
          beh.frozen = false;
        }

        if (beh.frozen) {
          // Turn to face the player
          const targetHeading = Math.atan2(dx, dz);
          let diff = targetHeading - beh.heading;
          // Normalize to [-PI, PI]
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          beh.heading += diff * Math.min(1, HORROR_TURN_SPEED * simDt * 3);
        } else {
          // Wander
          beh.wanderTimer -= simDt;
          if (beh.wanderTimer <= 0) {
            beh.heading += (Math.random() - 0.5) * 1.6;
            beh.wanderTimer = 1.5 + Math.random() * 3;
          }

          const moveX = Math.sin(beh.heading) * beh.speed * simDt;
          const moveZ = Math.cos(beh.heading) * beh.speed * simDt;
          const newX = ent.x + moveX;
          const newZ = ent.z + moveZ;
          const newY = groundYFast(newX, newZ) + 0.3;
          const dy = newY - ent.y;

          moveHorrorEntity(ent.idx, moveX, dy, moveZ);
        }
      }

      // Upload simulation config from resolved world mode params
      // Reduce writhing when frozen near player for creepy stillness
      uploadHorrorConfig({
        writhe: env.horrorWrithingIntensity || 1,
        agitation: env.horrorAgitation || 0.5,
        pulseSpeed: 1.5,
        springK: 8,
        damping: 4,
        twitchChance: 0.3,
      });

      // Run WASM horror simulation
      wasm.update_horrors(simDt, eye[0], eye[2]);

      // Render horror geometry
      renderHorrors(renderer, env);

      // Debug overlay
      if (horrorState.debugEnabled) {
        renderHorrorDebug(renderer);
      }
    }

    // Rain — 3D drops around camera, depth-tested against scene
    rain.update(simDt, env.rainIntensity, eye[0], eye[1], eye[2]);
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
        `pitch: ${camera.pitch.toFixed(3)} rad (${(camera.pitch * 180 / Math.PI).toFixed(1)}°)\n` +
        `time: ${lighting.timeOfDay.toFixed(2)}\n` +
        `visTris: ${visCount}\n` +
        `mode: ${worldMode.current} nightness: ${env.nightness.toFixed(2)}` +
        (gameState.frozen ? '\n** FROZEN **' : '');

      // Sample pixel colors at key screen positions (after all rendering)
      const px = renderer.pixels;
      const samplePx = (sx, sy) => {
        const i = (sy * RENDER_W + sx) * 4;
        return `${px[i]},${px[i+1]},${px[i+2]}`;
      };
      const midX = RENDER_W >> 1;
      text += `\npx top: ${samplePx(midX, 5)}` +
              `  mid: ${samplePx(midX, RENDER_H >> 1)}` +
              `  bot: ${samplePx(midX, RENDER_H - 5)}`;

      // Fog color being used
      text += `\nfog: ${env.fogColor.map(c => (c * 255).toFixed(0)).join(',')}`;

      // MVP matrix sanity — check for NaN/Inf
      let mvpOk = true;
      for (let i = 0; i < 16; i++) {
        if (!isFinite(mvp[i])) { mvpOk = false; break; }
      }
      text += `\nmvp: ${mvpOk ? 'ok' : 'BROKEN'}`;

      // View matrix right vector length (gimbal lock indicator)
      const fwd = camera.getTarget();
      const dirX = fwd[0] - dbgEye[0], dirY = fwd[1] - dbgEye[1], dirZ = fwd[2] - dbgEye[2];
      const crossX = dirZ, crossZ = -dirX; // cross([0,1,0], dir) simplified
      const rightLen = Math.sqrt(crossX * crossX + crossZ * crossZ);
      text += `  rightVecLen: ${rightLen.toFixed(4)}`;

      if (chunkManager.debugEnabled) {
        const info = chunkManager.getDebugInfo();
        text += `\nseed: 0x${info.seed}` +
                `\nchunk: ${info.currentCoord}` +
                `\ntris: ${info.totalTris}` +
                `\n${info.chunks.join('\n')}`;
      }

      if (horrorState.debugEnabled) {
        const hEntCount = wasm.get_horror_ent_count();
        const hSegCount = wasm.get_horror_seg_count();
        text += `\nhorror: ${hEntCount} ent, ${hSegCount} seg`;
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
