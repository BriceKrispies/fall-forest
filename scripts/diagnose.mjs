#!/usr/bin/env node
/**
 * Headless diagnostic harness — runs the same render pipeline as the browser.
 * Usage: node scripts/diagnose.mjs [command] [args...]
 *
 * Commands:
 *   findSnap              — binary-search for color discontinuity
 *   diagnoseSnap          — deep diagnosis with depth buffer checks
 *   pitchSweep [lo] [hi]  — sweep camera pitch, report per-step data
 *   render [pitch] [yaw]  — render one frame, print pixel samples
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// ── Mock canvas (satisfies Renderer constructor) ──
function createMockCanvas(w, h) {
  return {
    width: w,
    height: h,
    getContext() {
      return {
        createImageData(iw, ih) {
          return {
            data: new Uint8ClampedArray(iw * ih * 4),
            width: iw,
            height: ih,
          };
        },
        putImageData() {},
      };
    },
  };
}

// ── Load WASM bytes from filesystem ──
const wasmPath = join(ROOT, 'wasm', 'core.wasm');
const wasmBytes = readFileSync(wasmPath).buffer;

// ── Import game modules ──
const { initWasm, uploadMVP, uploadCamera, uploadSunDir,
        uploadConstants, uploadPointLights, readLeaves, readCreatures,
        readGrassVisible, LAYOUT, uploadHorrorConfig, clearHorrorBuffers,
        readHorrorEntities, moveHorrorEntity } = await import('../src/wasm-bridge.js');

const { Renderer } = await import('../src/renderer.js');
const { FreeCamera } = await import('../src/camera.js');
const { DayNightCycle, computeFireShadows } = await import('../src/lighting.js');
const { DaySky, NightSky } = await import('../src/sky.js');
const { WorldMode } = await import('../src/world-mode.js');
const { Rain } = await import('../src/rain.js');
const { ChunkManager } = await import('../src/world/chunk-manager.js');
const { groundYFast } = await import('../src/world/terrain.js');
const { makeFireFlames, updateSunShadowDir } = await import('../src/props.js');
const { generateAllHorrors } = await import('../src/horror-gen.js');
const { renderHorrors } = await import('../src/horror-renderer.js');
const { initHarness } = await import('../src/harness.js');

// ── Initialize ──
const wasm = await initWasm(wasmBytes);

const RENDER_W = 320;
const RENDER_H = 200;
const FOV = 1.1;

const mockCanvas = createMockCanvas(RENDER_W, RENDER_H);
const renderer = new Renderer(mockCanvas, RENDER_W, RENDER_H);
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
chunkManager.update(camera.z);

let totalTime = 0;

// ── renderStep — identical pipeline to main.js ──
function renderStep(dt, useInput = false) {
  const simDt = dt;
  totalTime += simDt;

  if (useInput) {
    camera.update(dt, { forward: false, backward: false, left: false, right: false, sprint: false, dx: 0, dy: 0 });
  }
  const eye = camera.getEye();
  const target = camera.getTarget();

  chunkManager.update(eye[2]);

  lighting.update(simDt * worldMode.timeScale);
  worldMode.resolve(simDt, lighting);
  const env = worldMode.resolved;

  renderer.setLighting(env);
  uploadSunDir(env.sunDir);
  updateSunShadowDir(env.sunDir);

  uploadConstants(20, 104, 0.2 + env.ambientLevel * 0.15);

  const mvp = renderer.beginFrame(eye, target, [0, 1, 0], FOV);

  daySky.update(simDt);
  daySky.draw(renderer.pixels, RENDER_W, RENDER_H, mvp,
              renderer.hw, renderer.hh, eye,
              env.nightness, env.fogColor);

  sky.update(simDt);
  sky.draw(renderer.pixels, RENDER_W, RENDER_H, mvp,
           renderer.hw, renderer.hh, eye,
           env.nightness, env.sunDir, totalTime, env.skyTint);

  renderer.drawSun(eye);
  renderer.saveSky();

  uploadMVP(mvp);
  uploadCamera(eye);
  wasm.set_time(totalTime);

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

  const breathingTris = chunkManager.getBreathingTris(totalTime, eye[0], eye[2]);
  if (breathingTris.length > 0) {
    renderer.drawDynamicTris(breathingTris, false);
  }

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

  rain.update(simDt, env.rainIntensity, eye[0], eye[1], eye[2]);
  rain.draw(renderer.pixels, RENDER_W, RENDER_H, renderer.depth,
            mvp, renderer.hw, renderer.hh);

  renderer.endFrame();

  return { visCount, eye, target, mvp, env };
}

// ── Wire up harness ──
const game = { camera, renderer, renderStep, RENDER_W, RENDER_H };
const harness = initHarness(game);

// ── CLI dispatch ──
const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case 'findSnap': {
    const result = harness.findSnap();
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case 'diagnoseSnap': {
    const result = harness.diagnoseSnap();
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case 'pitchSweep': {
    const lo = parseFloat(args[0]) || -1.2;
    const hi = parseFloat(args[1]) || 1.2;
    const result = harness.pitchSweep(lo, hi);
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case 'render': {
    const pitch = parseFloat(args[0]) || 0;
    const yaw = parseFloat(args[1]) || 0;
    camera.pitch = pitch;
    camera.yaw = yaw;
    const result = renderStep(0, false);
    const midX = RENDER_W >> 1;
    console.log(JSON.stringify({
      visCount: result.visCount,
      eye: result.eye,
      topPixel: harness.samplePixel(midX, 2),
      midPixel: harness.samplePixel(midX, RENDER_H >> 1),
      botPixel: harness.samplePixel(midX, RENDER_H - 3),
    }, null, 2));
    break;
  }
  default:
    console.log('Usage: node scripts/diagnose.mjs <command> [args...]');
    console.log('Commands: findSnap, diagnoseSnap, pitchSweep [lo] [hi], render [pitch] [yaw]');
}
