export function vec3(x = 0, y = 0, z = 0) { return [x, y, z]; }

export function v3add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function v3scale(v, s) { return [v[0] * s, v[1] * s, v[2] * s]; }
export function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function v3cross(a, b) {
  return [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
}
export function v3len(v) { return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]); }
export function v3norm(v) {
  const l = v3len(v);
  return l > 0.0001 ? [v[0]/l, v[1]/l, v[2]/l] : [0, 0, 0];
}
export function v3lerp(a, b, t) {
  return [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, a[2] + (b[2]-a[2])*t];
}

export function mat4identity() {
  return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
}

export function mat4multiply(a, b) {
  const r = new Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      r[i*4+j] = 0;
      for (let k = 0; k < 4; k++) r[i*4+j] += a[i*4+k] * b[k*4+j];
    }
  return r;
}

export function mat4lookAt(eye, target, up) {
  const z = v3norm(v3sub(eye, target));
  let x = v3cross(up, z);
  // When looking nearly straight up/down, up and forward are parallel
  // and the cross product collapses. Use an alternative up vector.
  if (v3len(x) < 0.001) {
    x = v3cross([0, 0, 1], z);
    if (v3len(x) < 0.001) x = v3cross([1, 0, 0], z);
  }
  x = v3norm(x);
  const y = v3cross(z, x);
  return [
    x[0], x[1], x[2], -v3dot(x, eye),
    y[0], y[1], y[2], -v3dot(y, eye),
    z[0], z[1], z[2], -v3dot(z, eye),
    0, 0, 0, 1
  ];
}

export function mat4perspective(fov, aspect, near, far) {
  const f = 1.0 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return [
    f/aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far+near)*nf, 2*far*near*nf,
    0, 0, -1, 0
  ];
}

export function transformPoint(m, p) {
  const x = m[0]*p[0] + m[1]*p[1] + m[2]*p[2] + m[3];
  const y = m[4]*p[0] + m[5]*p[1] + m[6]*p[2] + m[7];
  const z = m[8]*p[0] + m[9]*p[1] + m[10]*p[2] + m[11];
  const w = m[12]*p[0] + m[13]*p[1] + m[14]*p[2] + m[15];
  return [x, y, z, w];
}

export function projectPoint(mvp, p, hw, hh) {
  const c = transformPoint(mvp, p);
  if (c[3] <= 0.001) return null;
  const invW = 1 / c[3];
  return [hw + c[0] * invW * hw, hh - c[1] * invW * hh, c[2] * invW];
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(a, b, t) {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
}
