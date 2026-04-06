import { clamp } from './math.js';

export class FreeCamera {
  constructor(startPos) {
    this.x = startPos[0];
    this.y = startPos[1];
    this.z = startPos[2];
    this.yaw = 0;
    this.pitch = 0;
    this.eyeHeight = 1.4;
    this.speed = 3.0;
    this.swayTime = 0;
    this.bobPhase = 0;
    this.moving = false;
  }

  update(dt, input) {
    this.yaw -= input.dx * 0.002;
    this.pitch += input.dy * 0.002;
    this.pitch = clamp(this.pitch, -1.2, 1.2);
    input.dx = 0;
    input.dy = 0;

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let mx = 0, mz = 0;
    if (input.forward)  { mx += sy; mz += cy; }
    if (input.backward) { mx -= sy; mz -= cy; }
    if (input.left)     { mx += cy; mz -= sy; }
    if (input.right)    { mx -= cy; mz += sy; }

    const len = Math.sqrt(mx * mx + mz * mz);
    this.moving = len > 0.001;
    if (this.moving) {
      const inv = this.speed * dt / len;
      this.x += mx * inv;
      this.z += mz * inv;
    }

    this.swayTime += dt;
    if (this.moving) this.bobPhase += dt * 8;

    const gy = Math.sin(this.x * 0.3) * 0.08 + Math.cos(this.z * 0.25) * 0.06 +
      Math.sin(this.x * 0.7 + this.z * 0.5) * 0.04;
    this.y = gy;
  }

  getEye() {
    const bob = Math.sin(this.bobPhase) * 0.03 * (this.moving ? 1 : 0);
    const sway = Math.sin(this.swayTime * 0.4) * 0.015;
    return [
      this.x + Math.sin(this.swayTime * 0.3) * 0.02,
      this.y + this.eyeHeight + bob + sway,
      this.z
    ];
  }

  getTarget() {
    const eye = this.getEye();
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return [eye[0] + sy * cp, eye[1] - sp, eye[2] + cy * cp];
  }
}
