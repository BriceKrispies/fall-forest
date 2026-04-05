import { Renderer, SUN_DIR } from './renderer.js';
import { RailCamera } from './camera.js';
import { buildScene, PATH_NODES } from './scene.js';
import { initWasm, getWasm, uploadMVP, uploadCamera, uploadSunDir, uploadConstants, uploadTriangles, readLeaves, readCreatures, readMetrics, uploadGrassInstances, readGrassVisible, LAYOUT, getF32 } from './wasm-bridge.js';

const RENDER_W = 320;
const RENDER_H = 200;
const FOV = 1.1;

const canvas = document.getElementById('canvas');
const hint = document.getElementById('hint');

async function start() {
  const wasm = await initWasm();

  const renderer = new Renderer(canvas, RENDER_W, RENDER_H);
  const camera = new RailCamera(PATH_NODES);
  const sceneTris = buildScene();

  wasm.set_screen(RENDER_W, RENDER_H);
  uploadSunDir(SUN_DIR);
  uploadConstants(7, 36, 0.32);
  uploadTriangles(sceneTris);

  const grassInstances = buildGrassInstances();
  uploadGrassInstances(grassInstances);

  const input = { forward: false, backward: false, dx: 0, dy: 0 };
  let locked = false;
  let lastTime = performance.now();
  let hintTimer = 0;
  let totalTime = 0;

  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

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
    const btnFwd = document.getElementById('btn-fwd');
    const btnBack = document.getElementById('btn-back');
    btnFwd.addEventListener('touchstart', (e) => { e.preventDefault(); input.forward = true; });
    btnFwd.addEventListener('touchend', (e) => { e.preventDefault(); input.forward = false; });
    btnFwd.addEventListener('touchcancel', () => { input.forward = false; });
    btnBack.addEventListener('touchstart', (e) => { e.preventDefault(); input.backward = true; });
    btnBack.addEventListener('touchend', (e) => { e.preventDefault(); input.backward = false; });
    btnBack.addEventListener('touchcancel', () => { input.backward = false; });

    let lookTouchId = null;
    let lastTouchX = 0, lastTouchY = 0;
    canvas.addEventListener('touchstart', (e) => {
      if (lookTouchId !== null) return;
      const t = e.changedTouches[0];
      lookTouchId = t.identifier;
      lastTouchX = t.clientX;
      lastTouchY = t.clientY;
      e.preventDefault();
    });
    canvas.addEventListener('touchmove', (e) => {
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
    if (e.code === 'KeyW' || e.code === 'ArrowUp') input.forward = true;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') input.backward = true;
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') input.forward = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') input.backward = false;
  });

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

    const mvp = renderer.beginFrame(eye, target, [0, 1, 0], FOV);
    renderer.drawSun(eye);

    uploadMVP(mvp);
    uploadCamera(eye);
    wasm.set_time(totalTime);

    const visCount = wasm.process_triangles();
    renderer.rasterizeWasmOutput(visCount);

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
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
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
