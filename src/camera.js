import { v3add, v3sub, v3norm, v3scale, v3lerp, clamp, lerp } from './math.js';

export class RailCamera {
  constructor(path) {
    this.path = path;
    this.pathLen = this._computePathLength();
    this.t = 0.05;
    this.speed = 0;
    this.maxSpeed = 2.2;
    this.accel = 3.0;
    this.friction = 4.0;
    this.yaw = 0;
    this.pitch = 0;
    this.eyeHeight = 1.4;
    this.swayTime = 0;
    this.bobPhase = 0;
    this.smoothPos = this._getPointAt(this.t);
  }

  _computePathLength() {
    let len = 0;
    for (let i = 1; i < this.path.length; i++) {
      const d = v3sub(this.path[i], this.path[i-1]);
      len += Math.sqrt(d[0]*d[0] + d[1]*d[1] + d[2]*d[2]);
    }
    return len;
  }

  _getPointAt(t) {
    t = clamp(t, 0, 1);
    const totalSegs = this.path.length - 1;
    const seg = t * totalSegs;
    const i = Math.min(Math.floor(seg), totalSegs - 1);
    const frac = seg - i;

    const p0 = this.path[Math.max(0, i - 1)];
    const p1 = this.path[i];
    const p2 = this.path[Math.min(totalSegs, i + 1)];
    const p3 = this.path[Math.min(totalSegs, i + 2)];

    return this._catmullRom(p0, p1, p2, p3, frac);
  }

  _catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    const f = (a, b, c, d) =>
      0.5 * ((2*b) + (-a+c)*t + (2*a - 5*b + 4*c - d)*t2 + (-a + 3*b - 3*c + d)*t3);
    return [f(p0[0],p1[0],p2[0],p3[0]), f(p0[1],p1[1],p2[1],p3[1]), f(p0[2],p1[2],p2[2],p3[2])];
  }

  update(dt, input) {
    if (input.forward) this.speed += this.accel * dt;
    else if (input.backward) this.speed -= this.accel * dt;
    else {
      if (Math.abs(this.speed) < 0.1) this.speed = 0;
      else this.speed -= Math.sign(this.speed) * this.friction * dt;
    }
    this.speed = clamp(this.speed, -this.maxSpeed * 0.6, this.maxSpeed);

    const move = (this.speed * dt) / this.pathLen;
    this.t = clamp(this.t + move, 0.01, 0.99);

    const target = this._getPointAt(this.t);
    this.smoothPos = v3lerp(this.smoothPos, target, clamp(dt * 6, 0, 1));

    this.swayTime += dt;
    this.bobPhase += Math.abs(this.speed) * dt * 3.5;

    this.yaw -= input.dx * 0.002;
    this.pitch += input.dy * 0.002;
    this.pitch = clamp(this.pitch, -1.2, 1.2);

    input.dx = 0;
    input.dy = 0;
  }

  getEye() {
    const bob = Math.sin(this.bobPhase) * 0.03 * clamp(Math.abs(this.speed), 0, 1);
    const sway = Math.sin(this.swayTime * 0.4) * 0.015;
    return [
      this.smoothPos[0] + Math.sin(this.swayTime * 0.3) * 0.02,
      this.smoothPos[1] + this.eyeHeight + bob + sway,
      this.smoothPos[2]
    ];
  }

  getTarget() {
    const eye = this.getEye();
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return [eye[0] + sy * cp, eye[1] - sp, eye[2] + cy * cp];
  }
}
