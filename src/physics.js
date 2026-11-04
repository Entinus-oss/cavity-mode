/* ===== Cavity physics engine (plain script, exposes window.CAV / module.exports) ===== */
(function (root) {
'use strict';
const C0 = 299792458;            // m/s
const MU0 = 4e-7 * Math.PI;      // H/m
const ETA0 = 376.730313668;      // ohm

// Wall materials: DC conductivity in S/m (Pozar, Microwave Engineering, App. F)
const MATERIALS = {
  copper:    { key: 'copper',    name: 'Copper',    sigma: 5.813e7, note: 'annealed, Pozar App. F' },
  aluminum:  { key: 'aluminum',  name: 'Aluminium', sigma: 3.816e7, note: 'pure; 6061-T6 alloy is ~2.5e7' },
  brass:     { key: 'brass',     name: 'Brass',     sigma: 2.564e7, note: '70/30 cartridge brass is ~1.5e7' },
};

/* ---------- Bessel functions ---------- */
// J_n(x) via the integral representation, trapezoid over a full period (spectrally accurate for x < ~60)
function besselJ(n, x) {
  const N = 96;                   // aliasing error ~ J_{N-n}(x): negligible for x < 60
  let s = 0;
  for (let i = 0; i < N; i++) {
    const t = -Math.PI + (2 * Math.PI * (i + 0.5)) / N;
    s += Math.cos(n * t - x * Math.sin(t));
  }
  return s / N;
}
function besselJp(n, x) {           // derivative dJ_n/dx
  if (n === 0) return -besselJ(1, x);
  return 0.5 * (besselJ(n - 1, x) - besselJ(n + 1, x));
}
// zeros of J_n (type 'J') or J_n' (type 'Jp') : returns [z1..zM]
function findZeros(fn, n, M) {
  const out = [];
  let x = 0.4, prev = fn(n, x);
  const step = 0.02;
  while (out.length < M && x < 80) {
    const xn = x + step, cur = fn(n, xn);
    if ((prev < 0 && cur > 0) || (prev > 0 && cur < 0)) {
      let lo = x, hi = xn, flo = prev;
      for (let it = 0; it < 48; it++) {
        const mid = 0.5 * (lo + hi), fm = fn(n, mid);
        if ((flo < 0 && fm < 0) || (flo > 0 && fm > 0)) { lo = mid; flo = fm; } else hi = mid;
      }
      out.push(0.5 * (lo + hi));
    }
    x = xn; prev = cur;
  }
  return out;
}
const NMAX = 6, MMAX = 6;
const PJ = [], PJP = [];
for (let n = 0; n <= NMAX; n++) { PJ.push(findZeros(besselJ, n, MMAX)); PJP.push(findZeros(besselJp, n, MMAX)); }

/* ---------- helpers ---------- */
const fmtSub = s => String(s).replace(/[0-9]/g, c => '₀₁₂₃₄₅₆₇₈₉'[c]);
function modeLabel(mode) {
  return mode.type + fmtSub('' + mode.m + mode.n + mode.p);
}
function modeKey(mode) { return mode.geom + ':' + mode.type + ':' + mode.m + ',' + mode.n + ',' + mode.p; }

function surfaceResistance(f, sigma) { return Math.sqrt(2 * Math.PI * f * MU0 / (2 * sigma)); }
function skinDepth(f, sigma) { return 1 / Math.sqrt(Math.PI * f * MU0 * sigma); }

/* ---------- Mode construction ----------
   Geometry in mm.  Rectangular: a (x), b (y), d (z).  Cylindrical: R radius, d length (axis z).
   Returned wavenumbers are in 1/mm.  f in Hz.
   Rectangular TE/TM_mnp : m↔a, n↔b, p↔d.
   Cylindrical TE/TM_nml : n azimuthal, m radial, l axial  (stored as m=n, n=m, p=l to share code). */
function makeRectMode(type, m, n, p, a, b, d, er) {
  if (type === 'TE' && (p < 1 || (m === 0 && n === 0))) return null;
  if (type === 'TM' && (m < 1 || n < 1 || p < 0)) return null;
  const v = C0 / Math.sqrt(er);
  const kx = m * Math.PI / a, ky = n * Math.PI / b, beta = p * Math.PI / d;
  const kc2 = kx * kx + ky * ky, k = Math.sqrt(kc2 + beta * beta);
  const f = v * k * 1000 / (2 * Math.PI);     // k in 1/mm -> 1/m
  return { geom: 'rect', type, m, n, p, kx, ky, beta, kc: Math.sqrt(kc2), kc2, k, f, er };
}
function makeCylMode(type, n, m, l, R, d, er) {
  if (n > NMAX || m > MMAX || m < 1) return null;
  if (type === 'TE' && l < 1) return null;
  if (type === 'TM' && l < 0) return null;
  const v = C0 / Math.sqrt(er);
  const pz = type === 'TE' ? PJP[n][m - 1] : PJ[n][m - 1];
  const kc = pz / R, beta = l * Math.PI / d;
  const k = Math.sqrt(kc * kc + beta * beta);
  const f = v * k * 1000 / (2 * Math.PI);
  return { geom: 'cyl', type, m: n, n: m, p: l, nAz: n, mRad: m, lAx: l, kc, kc2: kc * kc, beta, k, f, er, pz };
}
function makeMode(geom, type, i, j, l, dims) {
  return geom === 'rect' ? makeRectMode(type, i, j, l, dims.a, dims.b, dims.d, dims.er)
                         : makeCylMode(type, i, j, l, dims.R, dims.d, dims.er);
}

function listModes(geom, dims, count) {
  const out = [];
  const I = geom === 'rect' ? 7 : NMAX;
  for (const type of ['TE', 'TM'])
    for (let i = 0; i <= I; i++)
      for (let j = (geom === 'rect' ? 0 : 1); j <= (geom === 'rect' ? 7 : MMAX); j++)
        for (let l = 0; l <= 7; l++) {
          const md = makeMode(geom, type, i, j, l, dims);
          if (md) out.push(md);
        }
  out.sort((x, y) => x.f - y.f);
  const res = out.slice(0, count);
  // flag degeneracies (same f within 1e-9 relative)
  for (let i = 0; i < res.length; i++) {
    res[i].degenerate = res.some((o, j) => j !== i && Math.abs(o.f - res[i].f) < 1e-9 * res[i].f);
  }
  return res;
}

/* ---------- Radial tables for cylindrical modes ---------- */
const NR = 513;
const radialCache = new Map();
// J_n(kc ρ) sampled on ρ/R ∈ [0,1]; kc·R is the Bessel zero, so the table depends only on (type, n, m)
function radialTables(mode, R) {
  if (mode.J) return mode;
  const key = mode.type + ':' + mode.nAz + ':' + mode.mRad;
  let t = radialCache.get(key);
  if (!t) {
    const n = mode.nAz, J = new Float32Array(NR), Jp = new Float32Array(NR);
    for (let i = 0; i < NR; i++) {
      const x = mode.pz * i / (NR - 1);
      J[i] = besselJ(n, x); Jp[i] = besselJp(n, x);
    }
    t = { J, Jp }; radialCache.set(key, t);
  }
  mode.J = t.J; mode.Jp = t.Jp;
  return mode;
}
function simpson(fn, N, h) {            // fn(i) sample i=0..N-1 (N odd), spacing h
  let s = fn(0) + fn(N - 1);
  for (let i = 1; i < N - 1; i++) s += fn(i) * (i % 2 ? 4 : 2);
  return s * h / 3;
}

/* ---------- Unloaded Q (conductor loss only) ----------
   Q = ω μ0 ∫|E_u|² dV / (Rs ∮|H_u,tan|² dS), fields in the normalised units used by the field kernels.
   Lengths in mm cancel (ratio of volume/surface integrals gives mm; converted below). */
function qFactor(mode, dims, sigma) {
  const Rs = surfaceResistance(mode.f, sigma);
  const w = 2 * Math.PI * mode.f;
  const Ic = (m, L) => (m > 0 ? L / 2 : L), Is = (m, L) => (m > 0 ? L / 2 : 0);
  let volE, surfH;
  if (mode.geom === 'rect') {
    const { a, b, d } = dims, { m, n, p, kx, ky, beta, kc2, k } = mode;
    if (mode.type === 'TE') {
      volE = (k * k / (kc2 * kc2)) * (ky * ky * Ic(m, a) * Is(n, b) * Is(p, d) + kx * kx * Is(m, a) * Ic(n, b) * Is(p, d));
      const cx = (beta * kx / kc2) ** 2, cy = (beta * ky / kc2) ** 2;
      surfH = 2 * (cy * Is(n, b) * Ic(p, d) + Ic(n, b) * Is(p, d))          // x walls
            + 2 * (cx * Is(m, a) * Ic(p, d) + Ic(m, a) * Is(p, d))          // y walls
            + 2 * (cx * Is(m, a) * Ic(n, b) + cy * Ic(m, a) * Is(n, b));    // z walls
    } else {
      volE = (beta * beta / (kc2 * kc2)) * (kx * kx * Ic(m, a) * Is(n, b) * Is(p, d) + ky * ky * Is(m, a) * Ic(n, b) * Is(p, d))
           + Is(m, a) * Is(n, b) * Ic(p, d);
      const cx = (k * kx / kc2) ** 2, cy = (k * ky / kc2) ** 2;
      surfH = 2 * cx * Is(n, b) * Ic(p, d) + 2 * cy * Is(m, a) * Ic(p, d)
            + 2 * (cy * Is(m, a) * Ic(n, b) + cx * Ic(m, a) * Is(n, b));
    }
  } else {
    const R = dims.R, d = dims.d, n = mode.nAz, l = mode.lAx, { kc, kc2, beta, k } = mode;
    radialTables(mode, R);
    const h = R / (NR - 1), J = mode.J, Jp = mode.Jp;
    const rho = i => i * h;
    const R1 = simpson(i => J[i] * J[i] * rho(i), NR, h);
    const R2 = simpson(i => Jp[i] * Jp[i] * rho(i), NR, h);
    const R3 = n > 0 ? simpson(i => (i === 0 ? 0 : J[i] * J[i] / rho(i)), NR, h) : 0;
    const Icp = n > 0 ? Math.PI : 2 * Math.PI, Isp = n > 0 ? Math.PI : 0;
    const Icz = Ic(l, d), Isz = Is(l, d);
    const Jw = J[NR - 1], Jpw = Jp[NR - 1];
    if (mode.type === 'TE') {
      volE = (k * k / (kc2 * kc2)) * n * n * R3 * Isp * Isz + (k * k / kc2) * R2 * Icp * Isz;
      surfH = R * ((beta * n / (kc2 * R)) ** 2 * Jw * Jw * Isp * Icz + Jw * Jw * Icp * Isz)
            + 2 * ((beta / kc) ** 2 * R2 * Icp + (beta * n / kc2) ** 2 * R3 * Isp);
    } else {
      volE = R1 * Icp * Icz + (beta / kc) ** 2 * R2 * Icp * Isz + (beta * n / kc2) ** 2 * R3 * Isp * Isz;
      surfH = R * (k / kc) ** 2 * Jpw * Jpw * Icp * Icz
            + 2 * ((k * n / kc2) ** 2 * R3 * Isp + (k / kc) ** 2 * R2 * Icp);
    }
  }
  // volE/surfH has units of mm -> metres
  return w * MU0 * (volE / surfH) * 1e-3 / Rs;
}

/* ---------- Solve one dimension for a target frequency ---------- */
function solveDimension(geom, type, idx, dims, which, fTarget) {
  const v = C0 / Math.sqrt(dims.er);
  const k = 2 * Math.PI * fTarget / v / 1000;   // 1/mm
  if (geom === 'rect') {
    const [m, n, p] = idx;
    const terms = { a: m, b: n, d: p };
    if (!terms[which]) return { error: 'That index is zero for this mode, so the frequency does not depend on ' + which + '.' };
    let rest = 0;
    for (const key of ['a', 'b', 'd']) if (key !== which) rest += (terms[key] * Math.PI / dims[key]) ** 2;
    const kk = k * k - rest;
    if (kk <= 0) return { error: 'Target is below the cutoff set by the other two dimensions. Lower them or raise the target.' };
    return { value: terms[which] * Math.PI / Math.sqrt(kk) };
  } else {
    const [n, m, l] = idx;
    const pz = type === 'TE' ? PJP[n][m - 1] : PJ[n][m - 1];
    if (which === 'R') {
      const kk = k * k - (l * Math.PI / dims.d) ** 2;
      if (kk <= 0) return { error: 'Target is below the axial cutoff set by the length. Shorten it or raise the target.' };
      return { value: pz / Math.sqrt(kk) };
    } else {
      if (l === 0) return { error: 'This mode has l = 0; its frequency does not depend on the length.' };
      const kk = k * k - (pz / dims.R) ** 2;
      if (kk <= 0) return { error: 'Target is below the radial cutoff set by the radius. Reduce the radius or raise the target.' };
      return { value: l * Math.PI / Math.sqrt(kk) };
    }
  }
}

const api = { C0, MU0, ETA0, MATERIALS, besselJ, besselJp, PJ, PJP, NMAX, MMAX, NR,
  makeMode, makeRectMode, makeCylMode, listModes, radialTables, qFactor, surfaceResistance, skinDepth,
  modeLabel, modeKey, fmtSub, solveDimension };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CAV = api;
})(typeof self !== 'undefined' ? self : this);
