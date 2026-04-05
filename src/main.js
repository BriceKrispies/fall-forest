import { Renderer } from './renderer.js';
import { RailCamera } from './camera.js';
import { buildScene, PATH_NODES } from './scene.js';

const RENDER_W = 320;
const RENDER_H = 200;
const FOV = 1.1;

const canvas = document.getElementById('canvas');
const hint = document.getElementById('hint');
const renderer = new Renderer(canvas, RENDER_W, RENDER_H);

const camera = new RailCamera(PATH_NODES);
const sceneTris = buildScene();

const input = { forward: false, backward: false, dx: 0, dy: 0 };
let locked = false;
let lastTime = performance.now();
let hintTimer = 0;

const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

if (!isTouch) {
  canvas.style.cursor = 'none';
  canvas.addEventListener('click', () => {
    canvas.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (locked) {
      hint.classList.add('hidden');
      hintTimer = 0;
    }
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
      if (e.changedTouches[i].identifier === lookTouchId) {
        lookTouchId = null;
      }
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

  if (!isTouch && !locked) {
    hintTimer += dt;
    if (hintTimer > 5) hint.classList.remove('hidden');
  }

  camera.update(dt, input);

  const eye = camera.getEye();
  const target = camera.getTarget();

  renderer.beginFrame(eye, target, [0, 1, 0], FOV);
  renderer.drawSun();
  renderer.drawMesh(sceneTris);
  renderer.endFrame();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
