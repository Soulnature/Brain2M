// Three.js objects: voxel brain, genome ring, selection markers.
import * as THREE from 'three';
import { RING, T_THRESHOLD } from './config.js';
import { mulberry32 } from './model.js';

const POINT_FRAG = /* glsl */ `
  varying vec4 vCol;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.12, d);
    gl_FragColor = vec4(vCol.rgb, vCol.a * a);
  }`;

const pointMaterial = (uniforms, vertexShader) => new THREE.ShaderMaterial({
  uniforms, vertexShader, fragmentShader: POINT_FRAG,
  transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
});

export function createBrain(vox) {
  const rng = mulberry32(2_000_000);
  const scatter = new Float32Array(vox.n * 3);
  const rnd = new Float32Array(vox.n);
  for (let v = 0; v < vox.n; v++) {
    const r = 2.2 + 2.6 * rng(); const th = rng() * Math.PI * 2; const ph = Math.acos(2 * rng() - 1);
    scatter.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)], 3 * v);
    rnd[v] = rng();
  }
  const geo = new THREE.BufferGeometry();
  const tAttr = new THREE.BufferAttribute(new Float32Array(vox.n), 1);
  geo.setAttribute('position', new THREE.BufferAttribute(vox.pos, 3));
  geo.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  geo.setAttribute('aNormal', new THREE.BufferAttribute(vox.normal, 3));
  geo.setAttribute('aT1', new THREE.BufferAttribute(vox.t1, 1));
  geo.setAttribute('aExpo', new THREE.BufferAttribute(vox.exposure, 1));
  geo.setAttribute('aT', tAttr);

  const uniforms = {
    uAssemble: { value: 0 }, uTmix: { value: 0 }, uSize: { value: 1 },
    uThr: { value: T_THRESHOLD }, uTmax: { value: 8 },
    uCut: { value: 0 }, uStep: { value: vox.step },
    uFocus: { value: new THREE.Vector3() }, uCutDir: { value: new THREE.Vector3(0.7, 0, 0.7) },
    uEye: { value: new THREE.Vector3(0, 0, 5) },
  };
  // Opaque voxels shaded like a T1 volume render: lit grey cortex outside,
  // raw T1 intensity (white matter bright, CSF dark) on the cutaway faces.
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aScatter; attribute vec3 aNormal;
      attribute float aRnd, aT1, aExpo, aT;
      uniform float uAssemble, uTmix, uSize, uThr, uTmax, uCut, uStep;
      uniform vec3 uFocus, uCutDir, uEye;
      varying vec3 vCol;
      void main() {
        float k = smoothstep(0.0, 1.0, clamp(uAssemble * 1.5 - aRnd * 0.5, 0.0, 1.0));
        vec4 mv = modelViewMatrix * vec4(mix(aScatter, position, k), 1.0);
        vec3 d = position - uFocus;
        float h = uStep * 0.5;
        bool cut = d.y > h + (1.0 - uCut) * 2.0 && dot(d.xz, uCutDir.xz) > h;
        gl_Position = cut ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;

        float surf = step(0.001, dot(aNormal, aNormal));
        vec3 view = normalize(uEye - position);
        float lam = max(dot(aNormal, normalize(view + vec3(0.0, 0.7, 0.0))), 0.0);
        float shade = (0.3 + 0.8 * lam) * (0.5 + 1.1 * aExpo);
        float grey = mix(pow(aT1, 1.25), mix(aT1, 0.72, 0.55) * shade, surf);
        vec3 col = vec3(0.86, 0.93, 1.0) * grey;
        col += vec3(0.2, 0.75, 0.7) * pow(1.0 - max(dot(aNormal, view), 0.0), 3.0) * 0.5 * aExpo * surf;

        float m = clamp((abs(aT) - uThr) / (uTmax - uThr), 0.0, 1.0);
        float on = step(uThr, abs(aT)) * uTmix;
        vec3 hot = mix(vec3(1.0, 0.25, 0.1), vec3(1.0, 0.9, 0.4), m);
        vec3 cold = mix(vec3(0.1, 0.35, 1.0), vec3(0.4, 0.95, 1.0), m);
        vec3 tc = (aT > 0.0 ? hot : cold) * mix(1.0, 0.45 + 0.75 * shade, surf);
        vCol = mix(col, tc, on * (0.75 + 0.25 * m)) * (0.15 + 0.85 * k);
        gl_PointSize = uSize / -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main() { gl_FragColor = vec4(vCol, 1.0); }`,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return {
    object: points, uniforms,
    setT(values, tmax) { tAttr.array.set(values); tAttr.needsUpdate = true; uniforms.uTmax.value = tmax; },
    /** True when the cutaway hides this voxel (mirrors the vertex shader). */
    isCut(v) {
      const f = uniforms.uFocus.value; const dir = uniforms.uCutDir.value; const h = vox.step * 0.5;
      const dx = vox.pos[3 * v] - f.x; const dy = vox.pos[3 * v + 1] - f.y; const dz = vox.pos[3 * v + 2] - f.z;
      return dy > h + (1 - uniforms.uCut.value) * 2 && dx * dir.x + dz * dir.z > h;
    },
  };
}

export function createGenome(genome) {
  const rng = mulberry32(22);
  const base = new Float32Array(genome.n * 3);
  const parity = new Float32Array(genome.n);
  for (let s = 0; s < genome.n; s++) {
    const r = RING.radius + (rng() - 0.5) * 0.09;
    base.set([r * Math.cos(genome.theta[s]), RING.y + (rng() - 0.5) * 0.024, r * Math.sin(genome.theta[s])], 3 * s);
    parity[s] = genome.chr[s] % 2;
  }
  const lpAttr = new THREE.BufferAttribute(new Float32Array(genome.n), 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(base, 3));
  geo.setAttribute('aPar', new THREE.BufferAttribute(parity, 1));
  geo.setAttribute('aLp', lpAttr);
  const uniforms = { uLift: { value: 0 }, uK: { value: RING.liftPerLog }, uSize: { value: 1 }, uShow: { value: 0 } };
  const material = pointMaterial(uniforms, /* glsl */ `
    attribute float aPar; attribute float aLp;
    uniform float uLift, uK, uSize, uShow;
    varying vec4 vCol;
    void main() {
      vec3 p = position + vec3(0.0, min(aLp, 70.0) * uK * uLift, 0.0);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float sig = smoothstep(6.0, 8.0, aLp) * uLift;
      vec3 c = mix(mix(vec3(0.36, 0.84, 0.79), vec3(0.44, 0.53, 1.0), aPar), vec3(1.0, 0.82, 0.48), sig);
      vCol = vec4(c, (0.14 + 0.76 * sig) * uShow);
      gl_PointSize = uSize * (1.0 + 1.3 * sig) / -mv.z;
    }`);
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;

  const group = new THREE.Group();
  group.add(points);
  const arcMat = new THREE.LineBasicMaterial({ color: 0x5fd6c9, transparent: true, opacity: 0.28 });
  for (const arc of genome.arcs) {
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const a = arc.a0 + ((arc.a1 - arc.a0) * i) / 48;
      pts.push(new THREE.Vector3((RING.radius - 0.085) * Math.cos(a), RING.y, (RING.radius - 0.085) * Math.sin(a)));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), arcMat));
  }

  const lp = lpAttr.array;
  return {
    object: group, uniforms, base, lp,
    setLp(values) { lp.set(values); lpAttr.needsUpdate = true; },
    position(s, out) {
      return out.set(base[3 * s], base[3 * s + 1] + Math.min(lp[s], 70) * RING.liftPerLog * uniforms.uLift.value, base[3 * s + 2]);
    },
  };
}

/** Bright cube for the chosen voxel inside a faint 3×3×3 lattice of its neighbours. */
export function createVoxelMarker(step) {
  const s = step;
  const group = new THREE.Group();
  const core = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(s, s, s)),
    new THREE.LineBasicMaterial({ color: 0xffd27a }),
  );
  const fill = new THREE.Mesh(
    new THREE.BoxGeometry(s, s, s),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.45, depthTest: false, blending: THREE.AdditiveBlending }),
  );
  const pts = [];
  const e = [-1.5 * s, -0.5 * s, 0.5 * s, 1.5 * s];
  for (const a of e) for (const b of e) {
    pts.push(a, b, e[0], a, b, e[3], a, e[0], b, a, e[3], b, e[0], a, b, e[3], a, b);
  }
  const lattice = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
    new THREE.LineBasicMaterial({ color: 0x7fe3d4, transparent: true, opacity: 0.22, depthTest: false }),
  );
  core.material.depthTest = false;
  group.add(lattice, fill, core);
  group.visible = false;
  return { object: group, fill };
}

/** Dot on the chosen variant plus a line to the voxel it affects most. */
export function createSnpMarker() {
  const group = new THREE.Group();
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
  );
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.045, 0.052, 40),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }),
  );
  const linkGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const link = new THREE.Line(linkGeo, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.55, depthTest: false }));
  link.frustumCulled = false;
  group.add(dot, halo, link);
  group.visible = false;
  return {
    object: group, halo,
    place(from, to) {
      dot.position.copy(from); halo.position.copy(from);
      link.visible = Boolean(to);
      if (to) { linkGeo.attributes.position.array.set([from.x, from.y, from.z, to.x, to.y, to.z]); linkGeo.attributes.position.needsUpdate = true; }
    },
  };
}
