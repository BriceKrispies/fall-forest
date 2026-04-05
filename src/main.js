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

  if (!locked) {
    hintTimer += dt;
    if (hintTimer > 5) hint.classList.remove('hidden');
  }

  camera.update(dt, input);

  const eye = camera.getEye();
  const target = camera.getTarget();

  renderer.beginFrame(eye, target, [0, 1, 0], FOV);
  renderer.drawMesh(sceneTris);
  renderer.endFrame();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
