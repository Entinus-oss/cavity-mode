(function () {
'use strict';
const THREE = window.THREE;

/* ---- minimal orbit controls (rotate: drag / one finger, pan: right-drag or two fingers, zoom: wheel / pinch) ---- */
class OrbitControls {
  constructor(camera, el) {
    this.camera = camera; this.el = el; this.target = new THREE.Vector3(); this.enableDamping = true; this.dampingFactor = 0.08; this.autoRotate = false; this.autoRotateSpeed = 1.2;
    this.sph = new THREE.Spherical(); this.dRot = { t: 0, p: 0 }; this.dPan = new THREE.Vector3(); this.dZoom = 1; this.minR = 0.4; this.maxR = 30;
    const ptrs = new Map(); let lastPinch = 0, lastMid = null;
    el.style.touchAction = 'none';
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button }); el.setPointerCapture(e.pointerId); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; lastPinch = Math.hypot(a.x - b.x, a.y - b.y); lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; } });
    const up = e => { ptrs.delete(e.pointerId); lastMid = null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (lastPinch > 0) this.dZoom *= Math.pow(lastPinch / d, 1.0); if (lastMid) this.pan(mid.x - lastMid.x, mid.y - lastMid.y); lastPinch = d; lastMid = mid; return; }
      if (p.b === 2 || p.b === 1 || e.shiftKey) this.pan(dx, dy);
      else { this.dRot.t -= 2 * Math.PI * dx / el.clientHeight; this.dRot.p -= 2 * Math.PI * dy / el.clientHeight; }
    });
    el.addEventListener('wheel', e => { e.preventDefault(); this.dZoom *= Math.pow(0.95, -Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 40 + 0.5)); }, { passive: false });
  }
  pan(dx, dy) { const dist = this.camera.position.distanceTo(this.target); const h = 2 * dist * Math.tan(this.camera.fov * Math.PI / 360) / this.el.clientHeight;
    const x = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0), y = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1); this.dPan.addScaledVector(x, -dx * h).addScaledVector(y, dy * h); }
  update() {
    const off = this.camera.position.clone().sub(this.target); this.sph.setFromVector3(off);
    if (this.autoRotate) this.dRot.t -= 2 * Math.PI / 60 / 60 * this.autoRotateSpeed;
    const k = this.enableDamping ? this.dampingFactor : 1;
    this.sph.theta += this.dRot.t * k; this.sph.phi += this.dRot.p * k; this.sph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, this.sph.phi));
    this.sph.radius = Math.max(this.minR, Math.min(this.maxR, this.sph.radius * (1 + (this.dZoom - 1) * k)));
    this.target.addScaledVector(this.dPan, k); this.dRot.t *= 1 - k; this.dRot.p *= 1 - k; this.dZoom = 1 + (this.dZoom - 1) * (1 - k); this.dPan.multiplyScalar(1 - k);
    this.camera.position.copy(this.target).add(off.setFromSpherical(this.sph)); this.camera.lookAt(this.target);
  }
}

/* ---- minimal ping-pong GPGPU (one RGBA float texture, fullscreen pass) ---- */
class PingPong {
  constructor(size, renderer, fragment, uniforms, initData) {
    this.size = size; this.renderer = renderer;
    const type = renderer.extensions.has('EXT_color_buffer_float') ? THREE.FloatType : THREE.HalfFloatType;
    const mk = () => new THREE.WebGLRenderTarget(size, size, { type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false });
    this.rt = [mk(), mk()]; this.cur = 0;
    this.material = new THREE.ShaderMaterial({ uniforms: Object.assign({ texturePosition: { value: null }, resolution: { value: new THREE.Vector2(size, size) } }, uniforms),
      vertexShader: 'void main(){ gl_Position = vec4(position, 1.0); }', fragmentShader: 'uniform sampler2D texturePosition; uniform vec2 resolution;\n' + fragment });
    this.scene = new THREE.Scene(); this.cam = new THREE.Camera(); this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    const init = new THREE.DataTexture(initData, size, size, THREE.RGBAFormat, THREE.FloatType); init.needsUpdate = true;
    const copy = new THREE.ShaderMaterial({ uniforms: { t: { value: init } }, vertexShader: 'void main(){ gl_Position = vec4(position, 1.0); }', fragmentShader: 'uniform sampler2D t; void main(){ gl_FragColor = texelFetch(t, ivec2(gl_FragCoord.xy), 0); }' });
    const s2 = new THREE.Scene(); s2.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copy));
    for (const rt of this.rt) { renderer.setRenderTarget(rt); renderer.render(s2, this.cam); }
    renderer.setRenderTarget(null); init.dispose(); copy.dispose();
  }
  compute() { const src = this.rt[this.cur], dst = this.rt[1 - this.cur]; this.material.uniforms.texturePosition.value = src.texture; this.renderer.setRenderTarget(dst); this.renderer.render(this.scene, this.cam); this.renderer.setRenderTarget(null); this.cur = 1 - this.cur; }
  get texture() { return this.rt[this.cur].texture; }
  dispose() { for (const rt of this.rt) rt.dispose(); this.material.dispose(); }
}

const $ = id => document.getElementById(id);
const CAV = window.CAV;
const UNITS = { mm: { f: 1, name: 'mm', dec: 2 }, cm: { f: 10, name: 'cm', dec: 3 }, in: { f: 25.4, name: 'in', dec: 4 } };

/* ================= state ================= */
const state = {
  geom: 'rect', unit: 'mm', a: 22.86, b: 10.16, d: 22.86, R: 12, L: 25, er: 1,
  material: 'copper', sigmaCustom: null,
  selected: [],                           // {type, i, j, l, amp}
  field: 'both', layers: { particles: true, arrows: false, slices: false, volume: false },
  pTex: 256, speed: 0.35, lifetime: 3, dot: 2, normalize: false, oscillate: false, autorotate: false,
  walls: true, labels: true, axes: true, slice: { x: .5, y: .5, z: .5 }, res: 64, paused: false,
  beta1: 1, beta2: 1, span: 'near', arrowDens: 11, arrowSize: 0.9, glowStr: 1.5, glowGam: 3, collapsed: {},
};
try { const s = JSON.parse(localStorage.getItem('cavity-studio-v1')); if (s && typeof s === 'object') Object.assign(state, s, { paused: false }); } catch (e) {}
function persist() { try { localStorage.setItem('cavity-studio-v1', JSON.stringify(state)); } catch (e) {} }

const dims = () => state.geom === 'rect' ? { a: state.a, b: state.b, d: state.d, er: state.er } : { R: state.R, d: state.L, er: state.er };
const sigma = () => state.sigmaCustom || CAV.MATERIALS[state.material].sigma;
const fmtF = f => f >= 1e9 ? (f / 1e9).toFixed(4) + ' GHz' : (f / 1e6).toFixed(2) + ' MHz';
const fmtQ = q => Math.round(q).toLocaleString('en-US');
const fmtBW = bw => bw >= 1e6 ? (bw / 1e6).toFixed(3) + ' MHz' : (bw / 1e3).toFixed(1) + ' kHz';
const fmtLen = mm => (mm / UNITS[state.unit].f).toFixed(UNITS[state.unit].dec) + ' ' + UNITS[state.unit].name;
// two-port coupling model: Q_L = Q_u/(1+β1+β2), |S21| at resonance = 2√(β1β2)/(1+β1+β2)
function loaded(md) { const b1 = state.beta1, b2 = state.beta2, QL = md.Q / (1 + b1 + b2), S0 = 2 * Math.sqrt(b1 * b2) / (1 + b1 + b2);
  return { QL, S0, IL: S0 > 0 ? -20 * Math.log10(S0) : Infinity, bw: md.f / QL, bwMin: md.f / md.Q }; }
const typeCls = md => md.type.toLowerCase();
const idxOf = md => state.geom === 'rect' ? [md.m, md.n, md.p] : [md.nAz, md.mRad, md.lAx];

let modeList = [];     // sorted first 60 modes with Q
let selModes = [];     // resolved selected modes (with Q)

/* ================= rail: geometry ================= */
const DIM_DEFS = {
  rect: [['a', 'a', 'width, x'], ['b', 'b', 'height, y'], ['d', 'd', 'length, z']],
  cyl: [['R', 'R', 'radius'], ['L', 'L', 'length, z']],
};
function buildDimRows() {
  const host = $('dimRows'); host.innerHTML = '';
  for (const [key, lab, desc] of DIM_DEFS[state.geom]) {
    const u = UNITS[state.unit];
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<label for="dim_${key}" title="${desc}"><b>${lab}</b></label>
      <input class="num" id="dim_${key}" type="number" step="any" min="0.1">
      <input type="range" id="rng_${key}" min="0.5" max="${(200 / u.f).toFixed(2)}" step="${(0.05 / u.f).toFixed(4)}" aria-label="${desc}">`;
    host.appendChild(row);
    const num = row.querySelector('.num'), rng = row.querySelector('[type=range]');
    const show = () => { num.value = +(state[key] / u.f).toFixed(u.dec); rng.value = state[key] / u.f; };
    show();
    num.addEventListener('change', () => { const v = parseFloat(num.value); if (v > 0) { state[key] = v * u.f; rng.value = v; onDimsChange(); } });
    rng.addEventListener('input', () => { state[key] = parseFloat(rng.value) * u.f; num.value = +(parseFloat(rng.value)).toFixed(u.dec); onDimsChange(); });
    row._show = show;
  }
  $('geomHint').textContent = state.geom === 'rect' ? 'a × b × d, axis z along d' : 'radius R, length L along z';
}
function refreshDimRows() { for (const r of $('dimRows').children) r._show && r._show(); }

$('geomSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  state.geom = b.dataset.geom;
  for (const x of $('geomSeg').children) x.setAttribute('aria-pressed', x === b);
  state.selected = [];
  buildDimRows(); buildCustomLabels(); rebuildShell(); recomputeModes(true);
});
$('unitSel').addEventListener('change', () => { state.unit = $('unitSel').value; buildDimRows(); updateLabels(); renderSelected(); persist(); });
$('erIn').addEventListener('change', () => { const v = parseFloat($('erIn').value); if (v >= 1) { state.er = v; onDimsChange(); } });

function onDimsChange() { updateLabels(); rebuildShell(); recomputeModes(false); }

/* ================= rail: material ================= */
$('matSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  state.material = b.dataset.mat;
  for (const x of $('matSeg').children) x.setAttribute('aria-pressed', x === b);
  recomputeModes(false);
});
$('sigmaIn').addEventListener('change', () => { const v = parseFloat($('sigmaIn').value); state.sigmaCustom = v > 0 ? v : null; recomputeModes(false); });
$('sigmaClear').addEventListener('click', () => { $('sigmaIn').value = ''; state.sigmaCustom = null; recomputeModes(false); });
function renderMatInfo() {
  const m = CAV.MATERIALS[state.material], s = sigma();
  const f = selModes[0] ? selModes[0].f : (modeList[0] ? modeList[0].f : 1e9);
  $('matInfo').innerHTML = `<span>σ <b>${s.toExponential(3)}</b> S/m${state.sigmaCustom ? ' (custom)' : ''}</span>
    <span>R<sub>s</sub> <b>${(CAV.surfaceResistance(f, s) * 1e3).toFixed(2)}</b> mΩ @ ${fmtF(f)}</span>
    <span>δ <b>${(CAV.skinDepth(f, s) * 1e6).toFixed(2)}</b> µm</span>`;
}

/* ================= rail: modes ================= */
function buildCustomLabels() {
  const rect = state.geom === 'rect';
  $('l1').textContent = rect ? 'm (a)' : 'n (φ)'; $('l2').textContent = rect ? 'n (b)' : 'm (r)'; $('l3').textContent = rect ? 'p (d)' : 'l (z)';
  $('c2').min = rect ? 0 : 1; $('c1').max = rect ? 7 : CAV.NMAX; $('c2').max = rect ? 7 : CAV.MMAX;
  $('modeConv').textContent = rect ? 'TE/TM mnp · m↔a, n↔b, p↔d' : 'TE/TM nml · n azimuthal, m radial, l axial';
  $('convNote').textContent = rect
    ? 'Frequencies: f = (c/2√εr)·√((m/a)² + (n/b)² + (p/d)²). Q is the unloaded conductor Q of a closed cavity; coupling holes and seams lower it.'
    : 'Frequencies: f = (c/2π√εr)·√((p/R)² + (lπ/L)²), p = Bessel zero (p′nm for TE, pnm for TM). Q is the unloaded conductor Q of a closed cavity.';
}
$('cAdd').addEventListener('click', () => {
  const type = $('cType').value, i = +$('c1').value, j = +$('c2').value, l = +$('c3').value;
  const md = CAV.makeMode(state.geom, type, i, j, l, dims());
  if (!md) { setMsg('modeMsg', 'That index combination is not a valid ' + type + ' mode here.', 'err'); return; }
  toggleMode(type, i, j, l, true);
  setMsg('modeMsg', CAV.modeLabel(md) + ' added at ' + fmtF(md.f), 'ok');
});
function setMsg(id, text, cls) { const el = $(id); el.textContent = text; el.className = 'msg ' + (cls || ''); }

function selKey(type, i, j, l) { return type + ':' + i + ',' + j + ',' + l; }
function isSelected(type, i, j, l) { return state.selected.some(s => selKey(s.type, s.i, s.j, s.l) === selKey(type, i, j, l)); }
function toggleMode(type, i, j, l, forceOn) {
  const k = selKey(type, i, j, l), idx = state.selected.findIndex(s => selKey(s.type, s.i, s.j, s.l) === k);
  if (idx >= 0 && !forceOn) state.selected.splice(idx, 1);
  else if (idx < 0) state.selected.push({ type, i, j, l, amp: 1 });
  recomputeModes(false);
}

function recomputeModes(resetSelection) {
  const D = dims(), s = sigma();
  modeList = CAV.listModes(state.geom, D, 60);
  for (const md of modeList) md.Q = CAV.qFactor(md, D, s);
  // resolve selection
  selModes = [];
  for (const sel of state.selected) {
    const md = CAV.makeMode(state.geom, sel.type, sel.i, sel.j, sel.l, D);
    if (!md) continue;
    md.Q = CAV.qFactor(md, D, s); md.amp = sel.amp; md.sel = sel;
    selModes.push(md);
  }
  if (resetSelection && modeList.length) {
    const first = modeList[0]; state.selected = [{ type: first.type, i: idxOf(first)[0], j: idxOf(first)[1], l: idxOf(first)[2], amp: 1 }];
    return recomputeModes(false);
  }
  renderQuick(); renderTable(); renderSelected(); renderReadout(); renderMatInfo(); renderTune(); renderBandwidth();
  persist();
  scheduleField();
}

function renderQuick() {
  const host = $('quick'); host.innerHTML = '';
  modeList.slice(0, 8).forEach(md => {
    const [i, j, l] = idxOf(md);
    const b = document.createElement('button'); b.className = 'chip ' + typeCls(md); b.setAttribute('aria-pressed', isSelected(md.type, i, j, l));
    b.innerHTML = `<i class="dot"></i><span>${CAV.modeLabel(md)}</span><span class="f">${(md.f / 1e9).toFixed(3)} GHz</span>`;
    b.title = 'Toggle ' + CAV.modeLabel(md);
    b.addEventListener('click', () => toggleMode(md.type, i, j, l));
    host.appendChild(b);
  });
}
function renderTable() {
  const host = $('modeTable'); host.innerHTML = '';
  modeList.forEach(md => {
    const [i, j, l] = idxOf(md), on = isSelected(md.type, i, j, l);
    const r = document.createElement('div'); r.className = 'tr ' + typeCls(md);
    r.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''} aria-label="select ${CAV.modeLabel(md)}"><span>${CAV.modeLabel(md)}${md.degenerate ? '<span class="deg" title="degenerate with another mode">deg</span>' : ''}</span><span class="f">${(md.f / 1e9).toFixed(4)}</span><span class="q">${fmtQ(md.Q)}</span>`;
    r.addEventListener('click', e => { if (e.target.tagName !== 'INPUT') { e.preventDefault(); } toggleMode(md.type, i, j, l); });
    host.appendChild(r);
  });
}
function renderSelected() {
  const host = $('selList'); host.innerHTML = '';
  if (!selModes.length) { host.innerHTML = '<div class="empty">Tick one or more modes above. Several modes are summed with the amplitudes below.</div>'; return; }
  selModes.forEach(md => {
    const r = document.createElement('div'); r.className = 'sel-item ' + typeCls(md);
    r.innerHTML = `<div class="nm">${CAV.modeLabel(md)}<small>${(md.f / 1e9).toFixed(4)} GHz</small></div>
      <div class="amp"><input type="range" min="-1" max="1" step="0.05" value="${md.amp}" aria-label="amplitude of ${CAV.modeLabel(md)}"><span class="v">${md.amp.toFixed(2)}</span></div>
      <button class="x" aria-label="remove ${CAV.modeLabel(md)}">×</button>`;
    const rng = r.querySelector('input'), v = r.querySelector('.v');
    rng.addEventListener('input', () => { md.sel.amp = md.amp = parseFloat(rng.value); v.textContent = md.amp.toFixed(2); persist(); scheduleField(); });
    r.querySelector('.x').addEventListener('click', () => { state.selected = state.selected.filter(s => s !== md.sel); recomputeModes(false); });
    host.appendChild(r);
  });
}
function renderReadout() {
  const host = $('readout'); host.innerHTML = '';
  if (!selModes.length) { host.innerHTML = '<div class="ro hint">No mode selected</div>'; return; }
  selModes.forEach(md => {
    const el = document.createElement('div'); el.className = 'ro ' + typeCls(md);
    const lam = 1000 * CAV.C0 / md.f / Math.sqrt(state.er), L = loaded(md);
    el.innerHTML = `<div class="nm"><b>${CAV.modeLabel(md)}</b><span>${md.type === 'TE' ? 'transverse electric' : 'transverse magnetic'}</span></div>
      <div class="fq">${(md.f / 1e9).toFixed(4)}<span>GHz</span></div>
      <div class="q">Q<sub>u</sub> ${fmtQ(md.Q)} · Δf<sub>min</sub> ${fmtBW(L.bwMin)} · λ ${lam.toFixed(2)} mm</div>
      <div class="q">Q<sub>L</sub> ${fmtQ(L.QL)} · Δf<sub>3dB</sub> ${fmtBW(L.bw)} · IL ${isFinite(L.IL) ? L.IL.toFixed(2) + ' dB' : '∞'}</div>`;
    host.appendChild(el);
  });
}

/* ================= bandwidth & response ================= */
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs, text) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };
let chartCache = null;
function renderBandwidth() {
  const host = $('bwTable'); host.innerHTML = '';
  if (selModes.length) {
    host.insertAdjacentHTML('beforeend', '<span class="h">Mode</span><span class="h n">Q loaded</span><span class="h n">Δf 3 dB</span><span class="h n">IL</span>');
    for (const md of selModes) {
      const L = loaded(md);
      host.insertAdjacentHTML('beforeend', `<span class="m ${typeCls(md)}"><i class="dot"></i>${CAV.modeLabel(md)}</span><span class="n">${fmtQ(L.QL)}</span><span class="n">${fmtBW(L.bw)}</span><span class="n">${isFinite(L.IL) ? L.IL.toFixed(2) + ' dB' : '∞'}</span>`);
    }
  } else host.innerHTML = '<span class="empty" style="grid-column:1/-1">Select a mode to see its passband.</span>';
  $('bwHint').textContent = state.beta1 === 1 && state.beta2 === 1 ? 'β = 1 on both ports: critical coupling, 3.5 dB loss'
    : (state.beta1 + state.beta2 < 0.2 ? 'light coupling: passband approaches f₀/Qu' : 'β = Qu / Qext per port');
  renderChart();
}
function niceStep(span) { const p = Math.pow(10, Math.floor(Math.log10(span / 5))); for (const m of [1, 2, 2.5, 5, 10]) if (span / (m * p) <= 6) return m * p; return 10 * p; }
function renderChart() {
  const svg = $('chart'); while (svg.firstChild) svg.removeChild(svg.firstChild);
  const W = 348, H = 190, ml = 36, mr = 28, mt = 12, mb = 26, pw = W - ml - mr, ph = H - mt - mb;
  const ref = selModes.length ? selModes : modeList.slice(0, 1); if (!ref.length) return;
  const fs = ref.map(m => m.f), fmin0 = Math.min(...fs), fmax0 = Math.max(...fs);
  let f0, f1;
  if (state.span === 'line') { const L = loaded(ref[0]); f0 = ref[0].f - 15 * L.bw; f1 = ref[0].f + 15 * L.bw; }
  else if (state.span === 'near') { f0 = fmin0 * 0.95; f1 = fmax0 * 1.05; }
  else if (state.span === 'mid') { f0 = fmin0 * 0.75; f1 = fmax0 * 1.25; }
  else { f0 = modeList[0].f * 0.92; f1 = modeList[Math.min(29, modeList.length - 1)].f * 1.04; }
  const x = f => ml + (f - f0) / (f1 - f0) * pw, y = db => mt + (-db / 60) * ph;
  for (let db = 0; db >= -60; db -= 10) {
    svg.appendChild(svgEl('line', { x1: ml, x2: ml + pw, y1: y(db), y2: y(db), class: 'grid' }));
    svg.appendChild(svgEl('text', { x: ml - 4, y: y(db) + 3.5, 'text-anchor': 'end' }, db));
  }
  const step = niceStep(f1 - f0), dec = Math.max(0, Math.ceil(-Math.log10(step / 1e9)));
  for (let f = Math.ceil(f0 / step) * step; f <= f1 + 1e-6; f += step) {
    svg.appendChild(svgEl('line', { x1: x(f), x2: x(f), y1: mt, y2: mt + ph, class: 'grid' }));
    if (x(f) < ml + pw - 4) svg.appendChild(svgEl('text', { x: x(f), y: H - 8, 'text-anchor': 'middle' }, (f / 1e9).toFixed(dec)));
  }
  svg.appendChild(svgEl('line', { x1: ml, x2: ml + pw, y1: mt + ph, y2: mt + ph, class: 'axis' }));
  svg.appendChild(svgEl('text', { x: W - 2, y: H - 8, 'text-anchor': 'end', 'font-size': 9 }, 'GHz'));
  svg.appendChild(svgEl('text', { x: 4, y: mt + 4, 'text-anchor': 'start', 'font-size': 9 }, 'dB'));
  const selKeys = new Set(selModes.map(CAV.modeKey));
  const all = [...modeList.filter(m => !selKeys.has(CAV.modeKey(m))), ...selModes];
  const resp = (md, L, f) => { const d = 2 * L.QL * (f - md.f) / md.f; return 20 * Math.log10(L.S0 / Math.sqrt(1 + d * d)); };
  const curves = [];
  for (const md of all) {
    const L = loaded(md); if (!(L.S0 > 0)) continue;
    if (resp(md, L, Math.min(f1, Math.max(f0, md.f))) < -60) continue;   // never rises above the floor inside the window
    const sel = selKeys.has(CAV.modeKey(md)), n = sel ? 160 : 48, nd = sel ? 60 : 24;
    const xs = []; for (let i = 0; i <= n; i++) xs.push(f0 + (f1 - f0) * i / n);
    for (let i = -nd; i <= nd; i++) { const f = md.f + L.bw * 12 * Math.sign(i) * (i / nd) * (i / nd); if (f > f0 && f < f1) xs.push(f); }
    xs.sort((a, b) => a - b);
    let d = '';
    for (const f of xs) { const db = Math.max(-60, resp(md, L, f)); d += (d ? 'L' : 'M') + x(f).toFixed(1) + ',' + y(db).toFixed(1); }
    const pth = svgEl('path', { d, class: sel ? 'sel ' + typeCls(md) : 'other' });
    pth.appendChild(svgEl('title', {}, CAV.modeLabel(md) + ' ' + fmtF(md.f)));
    svg.appendChild(pth);
    curves.push({ md, L, sel });
  }
  let lastX = -99, row = 0;
  for (const c of curves.filter(c => c.sel)) {
    if (c.md.f < f0 || c.md.f > f1) continue;
    const px = x(c.md.f); row = px - lastX < 34 ? (row + 1) % 3 : 0; lastX = px;
    const py = Math.max(mt + 9, y(-c.L.IL) - 5) + row * 11;
    svg.appendChild(svgEl('text', { x: Math.min(ml + pw - 2, Math.max(ml + 2, px)), y: py, class: 'lab', 'text-anchor': px > ml + pw - 30 ? 'end' : (px < ml + 30 ? 'start' : 'middle') }, CAV.modeLabel(c.md)));
  }
  chartCache = { f0, f1, x, y, curves, resp, ml, pw, mt, ph };
}
(function chartHover() {
  const svg = $('chart');
  const layer = () => { let g = svg.querySelector('.hover'); if (!g) { g = svgEl('g', { class: 'hover' }); svg.appendChild(g); } return g; };
  svg.addEventListener('pointermove', e => {
    if (!chartCache) return;
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * 348;
    const { f0, f1, x, y, curves, resp, ml, pw, mt, ph } = chartCache;
    if (px < ml || px > ml + pw) { layer().innerHTML = ''; return; }
    const f = f0 + (px - ml) / pw * (f1 - f0), g = layer(); g.innerHTML = '';
    g.appendChild(svgEl('line', { x1: px, x2: px, y1: mt, y2: mt + ph, class: 'cross' }));
    const lines = [(f / 1e9).toFixed(4) + ' GHz'];
    const sel = curves.filter(c => c.sel);
    const shown = sel.length ? sel : curves.slice().sort((a, b) => Math.abs(a.md.f - f) - Math.abs(b.md.f - f)).slice(0, 1);
    for (const c of shown.slice(0, 4)) {
      const db = resp(c.md, c.L, f);
      lines.push(CAV.modeLabel(c.md) + '  ' + (db < -60 ? '< −60' : db.toFixed(1)) + ' dB');
      if (db > -60) g.appendChild(svgEl('circle', { cx: px, cy: y(db), r: 3, fill: c.md.type === 'TE' ? '#2aa684' : '#a85cd9', stroke: '#1a1a1d', 'stroke-width': 1.5 }));
    }
    const bw = 100, bh = 12 * lines.length + 8, bx = px + 8 + bw > ml + pw ? px - 8 - bw : px + 8, by = mt + 4;
    g.appendChild(svgEl('rect', { x: bx, y: by, width: bw, height: bh, rx: 4, class: 'tipbg' }));
    lines.forEach((t, i) => g.appendChild(svgEl('text', { x: bx + 6, y: by + 12 + i * 12, class: 'tip' }, t)));
  });
  svg.addEventListener('pointerleave', () => { layer().innerHTML = ''; });
})();
for (const id of ['beta1', 'beta2']) { $(id).value = state[id]; $(id).addEventListener('change', () => { const v = parseFloat($(id).value); if (v >= 0) { state[id] = v; renderReadout(); renderBandwidth(); persist(); } }); }
$('spanSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.span = b.dataset.span; for (const x of $('spanSeg').children) x.setAttribute('aria-pressed', x === b); renderChart(); persist(); });
for (const x of $('spanSeg').children) x.setAttribute('aria-pressed', x.dataset.span === state.span);
/* ================= tune ================= */
function renderTune() {
  const ms = $('tMode'), prev = ms.value; ms.innerHTML = '';
  const cands = [...selModes, ...modeList.slice(0, 10).filter(m => !selModes.some(s => CAV.modeKey(s) === CAV.modeKey(m)))];
  cands.forEach(md => { const o = document.createElement('option'); o.value = CAV.modeKey(md); o.textContent = CAV.modeLabel(md) + ' (' + (md.f / 1e9).toFixed(3) + ' GHz)'; ms.appendChild(o); });
  if ([...ms.options].some(o => o.value === prev)) ms.value = prev;
  const ds = $('tDim'), pd = ds.value; ds.innerHTML = '';
  for (const [key, lab, desc] of DIM_DEFS[state.geom]) { const o = document.createElement('option'); o.value = key; o.textContent = lab + ' (' + desc + ')'; ds.appendChild(o); }
  if ([...ds.options].some(o => o.value === pd)) ds.value = pd;
}
$('tSolve').addEventListener('click', () => {
  const key = $('tMode').value, md = [...selModes, ...modeList].find(m => CAV.modeKey(m) === key);
  if (!md) return;
  const fT = parseFloat($('tF').value) * 1e9; if (!(fT > 0)) { setMsg('tMsg', 'Enter a target frequency in GHz.', 'err'); return; }
  const which = $('tDim').value, physKey = which === 'L' ? 'd' : which;
  const r = CAV.solveDimension(state.geom, md.type, idxOf(md), dims(), physKey, fT);
  if (r.error) { setMsg('tMsg', r.error, 'err'); return; }
  state[which] = r.value; refreshDimRows();
  setMsg('tMsg', which + ' set to ' + fmtLen(r.value) + ' so that ' + CAV.modeLabel(md) + ' resonates at ' + fmtF(fT) + '.', 'ok');
  onDimsChange();
});

/* ================= export ================= */
function exportData() {
  const D = dims(), s = sigma(), u = UNITS[state.unit];
  const dimOut = {};
  for (const [key, lab] of DIM_DEFS[state.geom]) { dimOut[lab + '_mm'] = +state[key].toFixed(4); if (state.unit !== 'mm') dimOut[lab + '_' + u.name] = +(state[key] / u.f).toFixed(u.dec + 1); }
  const modeRec = md => {
    const [i, j, l] = idxOf(md);
    return { mode: md.type + (state.geom === 'rect' ? `${md.m}${md.n}${md.p}` : `${md.nAz}${md.mRad}${md.lAx}`), type: md.type,
      indices: state.geom === 'rect' ? { m: i, n: j, p: l } : { n: i, m: j, l: l },
      f_Hz: Math.round(md.f), f_GHz: +(md.f / 1e9).toFixed(6), Q_unloaded: Math.round(md.Q), bandwidth_3dB_Hz: Math.round(md.f / md.Q),
      lambda0_mm: +(1000 * CAV.C0 / md.f / Math.sqrt(state.er)).toFixed(4),
      Rs_ohm: +CAV.surfaceResistance(md.f, s).toExponential(4), skin_depth_um: +(CAV.skinDepth(md.f, s) * 1e6).toFixed(3),
      Q_loaded: Math.round(loaded(md).QL), bandwidth_loaded_3dB_Hz: Math.round(loaded(md).bw), insertion_loss_dB: isFinite(loaded(md).IL) ? +loaded(md).IL.toFixed(3) : null,
      degenerate: !!md.degenerate, ...(md.amp !== undefined ? { amplitude: md.amp } : {}) };
  };
  return {
    tool: 'Cavity Mode Studio', exported: new Date().toISOString(),
    geometry: { type: state.geom === 'rect' ? 'rectangular' : 'cylindrical', axis: 'z', ...dimOut, display_unit: u.name },
    fill: { epsilon_r: state.er }, wall: { material: state.sigmaCustom ? 'custom' : CAV.MATERIALS[state.material].name, sigma_S_per_m: s },
    conventions: state.geom === 'rect' ? 'TE/TM_mnp: m half-waves along a (x), n along b (y), p along d (z). f = (c/2sqrt(er))*sqrt((m/a)^2+(n/b)^2+(p/d)^2).'
      : 'TE/TM_nml: n azimuthal, m radial (Bessel zero index), l axial along L (z). f = (c/2pi sqrt(er))*sqrt((p/R)^2+(l pi/L)^2), p = p\'_nm (TE) or p_nm (TM).',
    q_note: 'Q_unloaded from conductor loss of a closed cavity with the given DC conductivity; no dielectric loss, seams or coupling. bandwidth_3dB_Hz = f/Q_unloaded is the narrowest possible passband.',
    coupling: { beta_in: state.beta1, beta_out: state.beta2, model: 'Q_loaded = Q_unloaded/(1+beta_in+beta_out); |S21(f0)| = 2*sqrt(beta_in*beta_out)/(1+beta_in+beta_out); bandwidth_loaded_3dB_Hz = f/Q_loaded' },
    selected_modes: selModes.map(modeRec), mode_table: modeList.slice(0, 40).map(modeRec),
  };
}
function csvData() {
  const d = exportData(), rows = [['mode', 'type', 'i1', 'i2', 'i3', 'f_GHz', 'Q_unloaded', 'bandwidth_min_kHz', 'Q_loaded', 'bandwidth_3dB_kHz', 'insertion_loss_dB', 'lambda0_mm', 'degenerate', 'selected']];
  const selKeys = new Set(d.selected_modes.map(m => m.mode));
  for (const m of d.mode_table) rows.push([m.mode, m.type, ...Object.values(m.indices), m.f_GHz, m.Q_unloaded, (m.bandwidth_3dB_Hz / 1e3).toFixed(2), m.Q_loaded, (m.bandwidth_loaded_3dB_Hz / 1e3).toFixed(2), m.insertion_loss_dB == null ? '' : m.insertion_loss_dB, m.lambda0_mm, m.degenerate ? 1 : 0, selKeys.has(m.mode) ? 1 : 0]);
  const head = Object.entries(d.geometry).filter(([k]) => k.endsWith('_mm')).map(([k, v]) => `# ${k} = ${v}`).join('\n');
  return `# Cavity Mode Studio export ${d.exported}\n# geometry = ${d.geometry.type}\n${head}\n# epsilon_r = ${d.fill.epsilon_r}\n# beta_in = ${state.beta1}, beta_out = ${state.beta2}\n# wall = ${d.wall.material}, sigma = ${d.wall.sigma_S_per_m} S/m\n` + rows.map(r => r.join(',')).join('\n');
}
function sheetData() {
  const d = exportData(), u = UNITS[state.unit];
  const L = [];
  L.push('CAVITY BUILD SHEET', 'generated ' + d.exported.slice(0, 16).replace('T', ' ') + ' · Cavity Mode Studio', '');
  L.push('GEOMETRY  ' + d.geometry.type + ' cavity, axis along z');
  for (const [key, lab, desc] of DIM_DEFS[state.geom]) L.push(`  ${lab.padEnd(2)} = ${(state[key] / u.f).toFixed(u.dec).padStart(10)} ${u.name}   (${desc})` + (state.unit !== 'mm' ? `  = ${state[key].toFixed(3)} mm` : ''));
  L.push(`  fill εr = ${state.er}`, `  walls  = ${d.wall.material}, σ = ${d.wall.sigma_S_per_m.toExponential(3)} S/m`, `  ports  = β_in ${state.beta1}, β_out ${state.beta2}`, '');
  L.push('SELECTED MODES');
  for (const m of d.selected_modes) { L.push(`  ${m.mode.padEnd(7)} ${m.f_GHz.toFixed(4).padStart(9)} GHz   Qu ${String(m.Q_unloaded).padStart(7)}   Δf_min ${(m.bandwidth_3dB_Hz / 1e3).toFixed(1).padStart(8)} kHz   λ0 ${m.lambda0_mm.toFixed(2)} mm   Rs ${(m.Rs_ohm * 1e3).toFixed(2)} mΩ   δ ${m.skin_depth_um} µm`);
    L.push(`          loaded: QL ${String(m.Q_loaded).padStart(7)}   Δf_3dB ${(m.bandwidth_loaded_3dB_Hz / 1e3).toFixed(1).padStart(8)} kHz   insertion loss ${m.insertion_loss_dB == null ? '∞' : m.insertion_loss_dB.toFixed(2) + ' dB'}`); }
  L.push('', 'LOWEST MODES (closest neighbours matter for mode purity)');
  for (const m of d.mode_table.slice(0, 20)) L.push(`  ${m.mode.padEnd(7)} ${m.f_GHz.toFixed(4).padStart(9)} GHz   Q ${String(m.Q_unloaded).padStart(7)}${m.degenerate ? '   degenerate' : ''}`);
  L.push('', 'NOTES', '  ' + d.conventions, '  ' + d.q_note);
  return L.join('\n');
}
function openExport(title, text, filename, mime) {
  $('dlgTitle').textContent = title; $('dlgText').value = text; $('dlg').setAttribute('open', '');
  $('dlgDl').onclick = async () => {
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;   // claude.ai viewer: mediated save
    if (dl) { try { await dl.save({ filename, data: text }); $('dlgNote').textContent = 'Saved ' + filename + '.'; } catch (e) { $('dlgNote').textContent = e && e.code === 'declined' ? 'Download cancelled. You can still copy the text.' : 'Download is not available here; copy the text instead.'; } return; }
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); } catch (e) {}
  };
  $('dlgCopy').onclick = () => { navigator.clipboard.writeText(text).then(() => { $('dlgCopy').textContent = 'Copied'; setTimeout(() => $('dlgCopy').textContent = 'Copy to clipboard', 1500); }).catch(() => { $('dlgText').select(); }); };
}
const stem = () => 'cavity_' + (state.geom === 'rect' ? `${state.a.toFixed(2)}x${state.b.toFixed(2)}x${state.d.toFixed(2)}` : `R${state.R.toFixed(2)}_L${state.L.toFixed(2)}`) + 'mm';
$('expJson').addEventListener('click', () => openExport('Export JSON', JSON.stringify(exportData(), null, 2), stem() + '.json', 'application/json'));
$('expCsv').addEventListener('click', () => openExport('Export CSV (mode table)', csvData(), stem() + '.csv', 'text/csv'));
$('expTxt').addEventListener('click', () => openExport('Build sheet', sheetData(), stem() + '.txt', 'text/plain'));
$('dlgClose').addEventListener('click', () => $('dlg').removeAttribute('open'));
$('dlg').addEventListener('click', e => { if (e.target === $('dlg')) $('dlg').removeAttribute('open'); });

/* ================= display controls ================= */
$('fieldSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.field = b.dataset.field; for (const x of $('fieldSeg').children) x.setAttribute('aria-pressed', x === b); applyField(); persist(); });
$('layers').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const k = b.dataset.layer; state.layers[k] = !state.layers[k]; b.setAttribute('aria-pressed', state.layers[k]); applyLayers(); persist(); });
const bindRange = (id, key, fmt, cb, evt = 'input') => { const el = $(id), v = $(id + 'V'); const show = () => v.textContent = fmt(state[key]); el.value = state[key]; show(); el.addEventListener(evt, () => { state[key] = parseFloat(el.value); show(); cb && cb(); persist(); }); if (evt !== 'input') el.addEventListener('input', () => v.textContent = fmt(parseFloat(el.value))); };
bindRange('pCount', 'pTex', v => Math.round(v * v / 1000) + 'k', () => rebuildParticles(), 'change');
bindRange('pSpeed', 'speed', v => v.toFixed(2));
bindRange('pLife', 'lifetime', v => v + ' s');
bindRange('pSize', 'dot', v => v.toFixed(1));
bindRange('aDens', 'arrowDens', v => String(v), () => updateArrows());
bindRange('aSize', 'arrowSize', v => v.toFixed(1), () => updateArrows());
bindRange('gStr', 'glowStr', v => v.toFixed(1));
bindRange('gGam', 'glowGam', v => v.toFixed(2));
for (const ax of ['x', 'y', 'z']) { const el = $('s' + ax), v = $('s' + ax + 'V'); el.value = state.slice[ax]; v.textContent = Math.round(state.slice[ax] * 100) + '%'; el.addEventListener('input', () => { state.slice[ax] = parseFloat(el.value); v.textContent = Math.round(state.slice[ax] * 100) + '%'; placeSlices(); persist(); }); }
const bindCheck = (id, key, cb) => { const el = $(id); el.checked = state[key]; el.addEventListener('change', () => { state[key] = el.checked; cb && cb(); persist(); }); };
bindCheck('ckNorm', 'normalize'); bindCheck('ckOsc', 'oscillate'); bindCheck('ckRot', 'autorotate', () => controls && (controls.autoRotate = state.autorotate));
bindCheck('ckWalls', 'walls', () => shell && (shell.visible = state.walls)); bindCheck('ckLabels', 'labels', () => labelGroup && (labelGroup.visible = state.labels)); bindCheck('ckAxes', 'axes', () => axesGroup && (axesGroup.visible = state.axes));
$('resSel').value = state.res; $('resSel').addEventListener('change', () => { state.res = +$('resSel').value; persist(); scheduleField(); });
$('menu').addEventListener('click', () => $('rail').classList.toggle('open'));
$('view').addEventListener('pointerdown', e => { if (e.target.closest('#menu')) return; $('rail').classList.remove('open'); });
$('resetView').addEventListener('click', resetView);
$('pauseBtn').addEventListener('click', () => { state.paused = !state.paused; $('pauseBtn').setAttribute('aria-pressed', state.paused); });
window.addEventListener('keydown', e => { if (e.target.matches('input,select,textarea')) return; if (e.key === 'r' || e.key === 'R') resetView(); if (e.key === ' ') { e.preventDefault(); $('pauseBtn').click(); } });
// restore pressed states
for (const x of $('geomSeg').children) x.setAttribute('aria-pressed', x.dataset.geom === state.geom);
for (const x of $('matSeg').children) x.setAttribute('aria-pressed', x.dataset.mat === state.material);
for (const x of $('fieldSeg').children) x.setAttribute('aria-pressed', x.dataset.field === state.field);
for (const x of $('layers').children) x.setAttribute('aria-pressed', !!state.layers[x.dataset.layer]);
$('unitSel').value = state.unit; $('erIn').value = state.er; if (state.sigmaCustom) $('sigmaIn').value = state.sigmaCustom;

/* ================= field computation (worker pool) ================= */
const KERNEL = `
function lerpTab(T, u) { const n = T.length - 1; let x = u * n; if (x <= 0) return T[0]; if (x >= n) return T[n]; const i = Math.floor(x); x -= i; return T[i] * (1 - x) + T[i + 1] * x; }
function evalMode(md, geom, R, x, y, z, o) {
  if (geom === 'rect') {
    const cx = Math.cos(md.kx * x), sx = Math.sin(md.kx * x), cy = Math.cos(md.ky * y), sy = Math.sin(md.ky * y), cz = Math.cos(md.beta * z), sz = Math.sin(md.beta * z);
    const kc2 = md.kc2, k = md.k, b = md.beta, kx = md.kx, ky = md.ky;
    if (md.type === 'TE') { o[0] = (k / kc2) * ky * cx * sy * sz; o[1] = -(k / kc2) * kx * sx * cy * sz; o[2] = 0; o[3] = -(b * kx / kc2) * sx * cy * cz; o[4] = -(b * ky / kc2) * cx * sy * cz; o[5] = cx * cy * sz; }
    else { o[0] = -(b * kx / kc2) * cx * sy * sz; o[1] = -(b * ky / kc2) * sx * cy * sz; o[2] = sx * sy * cz; o[3] = (k * ky / kc2) * sx * cy * cz; o[4] = -(k * kx / kc2) * cx * sy * cz; o[5] = 0; }
  } else {
    const rho = Math.hypot(x, y); if (rho > R) { o[0]=o[1]=o[2]=o[3]=o[4]=o[5]=0; return; }
    const phi = Math.atan2(y, x), u = rho / R, J = lerpTab(md.J, u), Jp = lerpTab(md.Jp, u), n = md.nAz;
    const cn = Math.cos(n * phi), sn = Math.sin(n * phi), cz = Math.cos(md.beta * z), sz = Math.sin(md.beta * z);
    const ir = 1 / Math.max(rho, 1e-6 * R), kc = md.kc, kc2 = md.kc2, b = md.beta, k = md.k;
    let Er, Ep, Ez, Hr, Hp, Hz;
    if (md.type === 'TE') { Hz = J * cn * sz; Hr = (b / kc) * Jp * cn * cz; Hp = -(b * n * ir / kc2) * J * sn * cz; Er = (k * n * ir / kc2) * J * sn * sz; Ep = (k / kc) * Jp * cn * sz; Ez = 0; }
    else { Ez = J * cn * cz; Er = -(b / kc) * Jp * cn * sz; Ep = (b * n * ir / kc2) * J * sn * sz; Hr = -(k * n * ir / kc2) * J * sn * cz; Hp = -(k / kc) * Jp * cn * cz; Hz = 0; }
    const c = Math.cos(phi), s = Math.sin(phi);
    o[0] = Er * c - Ep * s; o[1] = Er * s + Ep * c; o[2] = Ez; o[3] = Hr * c - Hp * s; o[4] = Hr * s + Hp * c; o[5] = Hz;
  }
}
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) { f32[0] = v; const x = u32[0]; const sign = (x >> 16) & 0x8000; let e = ((x >> 23) & 0xff) - 127 + 15; let m = x & 0x7fffff;
  if (e <= 0) { if (e < -10) return sign; m = (m | 0x800000) >> (1 - e); return sign | ((m + 0xfff + ((m >> 13) & 1)) >> 13); }
  if (e >= 31) return sign | 0x7c00; return sign | (e << 10) | ((m + 0xfff + ((m >> 13) & 1)) >> 13); }
onmessage = e => {
  const { jobId, geom, R, min, size, modes, N, z0, z1 } = e.data, o = new Float64Array(6);
  // per-mode normalisation on a coarse grid: peak |E| -> 1
  for (const md of modes) {
    let mx = 0; const C = 28;
    for (let k = 0; k < C; k++) for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) {
      evalMode(md, geom, R, min[0] + (i + .5) / C * size[0], min[1] + (j + .5) / C * size[1], min[2] + (k + .5) / C * size[2], o);
      const m2 = o[0] * o[0] + o[1] * o[1] + o[2] * o[2]; if (m2 > mx) mx = m2;
    }
    md.scale = mx > 0 ? md.amp / Math.sqrt(mx) : 0;
  }
  const nz = z1 - z0, E = new Float32Array(N * N * nz * 4), H = new Float32Array(N * N * nz * 4);
  const Eh = new Uint16Array(E.length), Hh = new Uint16Array(H.length);
  let maxE = 0, maxH = 0, idx = 0;
  for (let k = z0; k < z1; k++) { const z = min[2] + (k + .5) / N * size[2];
    for (let j = 0; j < N; j++) { const y = min[1] + (j + .5) / N * size[1];
      for (let i = 0; i < N; i++, idx += 4) { const x = min[0] + (i + .5) / N * size[0];
        let ex = 0, ey = 0, ez = 0, hx = 0, hy = 0, hz = 0;
        if (geom !== 'cyl' || x * x + y * y <= R * R) for (const md of modes) { evalMode(md, geom, R, x, y, z, o); const s = md.scale; ex += s * o[0]; ey += s * o[1]; ez += s * o[2]; hx += s * o[3]; hy += s * o[4]; hz += s * o[5]; }
        const me = Math.sqrt(ex * ex + ey * ey + ez * ez), mh = Math.sqrt(hx * hx + hy * hy + hz * hz);
        if (me > maxE) maxE = me; if (mh > maxH) maxH = mh;
        E[idx] = ex; E[idx + 1] = ey; E[idx + 2] = ez; E[idx + 3] = me; H[idx] = hx; H[idx + 1] = hy; H[idx + 2] = hz; H[idx + 3] = mh;
      } } }
  for (let i = 0; i < E.length; i++) { Eh[i] = toHalf(E[i]); Hh[i] = toHalf(H[i]); }
  postMessage({ jobId, z0, z1, E, H, Eh, Hh, maxE, maxH }, [E.buffer, H.buffer, Eh.buffer, Hh.buffer]);
};`;
const NW = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2)));
const workers = []; const kurl = URL.createObjectURL(new Blob([KERNEL], { type: 'text/javascript' }));
for (let i = 0; i < NW; i++) workers.push(new Worker(kurl));

const grid = { N: 0, E: null, H: null, Eh: null, Hh: null, maxE: 1, maxH: 1, min: [0, 0, 0], size: [1, 1, 1] };
let jobId = 0, pending = null, fieldTimer = 0, computing = false, queued = false;
function scheduleField() { clearTimeout(fieldTimer); fieldTimer = setTimeout(computeField, 40); }
function computeField() {
  if (computing) { queued = true; return; }
  const D = dims(), N = state.res, geom = state.geom;
  const min = geom === 'rect' ? [0, 0, 0] : [-D.R, -D.R, 0], size = geom === 'rect' ? [D.a, D.b, D.d] : [2 * D.R, 2 * D.R, D.d];
  const modes = selModes.map(md => { if (geom === 'cyl') CAV.radialTables(md, D.R); const { type, nAz, kx, ky, beta, kc, kc2, k, J, Jp, amp } = md; return { type, nAz, kx, ky, beta, kc, kc2, k, J, Jp, amp }; });
  const id = ++jobId, t0 = performance.now();
  pending = { id, N, min, size, parts: 0, E: new Float32Array(N * N * N * 4), H: new Float32Array(N * N * N * 4), Eh: new Uint16Array(N * N * N * 4), Hh: new Uint16Array(N * N * N * 4), maxE: 0, maxH: 0, t0 };
  computing = true;
  const nw = Math.min(NW, N);
  for (let w = 0; w < nw; w++) {
    const z0 = Math.floor(w * N / nw), z1 = Math.floor((w + 1) * N / nw);
    workers[w].postMessage({ jobId: id, geom, R: D.R || 0, min, size, modes, N, z0, z1 });
  }
  pending.expected = nw;
}
for (const w of workers) w.onmessage = e => {
  const m = e.data; if (!pending || m.jobId !== pending.id) return;
  const off = m.z0 * pending.N * pending.N * 4;
  pending.E.set(m.E, off); pending.H.set(m.H, off); pending.Eh.set(m.Eh, off); pending.Hh.set(m.Hh, off);
  pending.maxE = Math.max(pending.maxE, m.maxE); pending.maxH = Math.max(pending.maxH, m.maxH);
  if (++pending.parts === pending.expected) {
    Object.assign(grid, { N: pending.N, E: pending.E, H: pending.H, Eh: pending.Eh, Hh: pending.Hh, maxE: pending.maxE || 1, maxH: pending.maxH || 1, min: pending.min, size: pending.size });
    $('calcTime').textContent = `${pending.N}³ in ${Math.round(performance.now() - pending.t0)} ms · ${NW} threads`;
    computing = false; pending = null;
    onGridReady();
    if (queued) { queued = false; computeField(); }
  }
};

/* ================= three.js scene ================= */
let renderer, scene, camera, controls, shell, labelGroup, axesGroup, texE, texH, gpuE, gpuH, ptsE, ptsH, volMesh, sliceMeshes = [], arrowsE, arrowsH;
const uCommon = { boxMin: { value: new THREE.Vector3() }, boxSize: { value: new THREE.Vector3(1, 1, 1) }, center: { value: new THREE.Vector3() }, wscale: { value: 1 }, radius: { value: 0 }, isCyl: { value: 0 }, invMaxE: { value: 1 }, invMaxH: { value: 1 }, phaseE: { value: 1 }, phaseH: { value: 1 }, showE: { value: 1 }, showH: { value: 1 } };
const COL = { e0: new THREE.Color('#5a1600'), e1: new THREE.Color('#ff7a3d'), e2: new THREE.Color('#ffe2b0'), h0: new THREE.Color('#071a5c'), h1: new THREE.Color('#4fb3ff'), h2: new THREE.Color('#d8f3ff') };
const wsize = () => { const s = grid.size[0] ? grid.size : [1, 1, 1]; return 2 / Math.max(...currentSize()); };
function currentSize() { const D = dims(); return state.geom === 'rect' ? [D.a, D.b, D.d] : [2 * D.R, 2 * D.R, D.d]; }
function currentMin() { const D = dims(); return state.geom === 'rect' ? [0, 0, 0] : [-D.R, -D.R, 0]; }
function syncBox() {
  const sz = currentSize(), mn = currentMin(), S = 2 / Math.max(...sz);
  uCommon.boxMin.value.fromArray(mn); uCommon.boxSize.value.fromArray(sz); uCommon.center.value.set(mn[0] + sz[0] / 2, mn[1] + sz[1] / 2, mn[2] + sz[2] / 2);
  uCommon.wscale.value = S; uCommon.radius.value = state.geom === 'cyl' ? dims().R : 0; uCommon.isCyl.value = state.geom === 'cyl' ? 1 : 0;
}

function initThree() {
  const canvas = document.createElement('canvas'); $('view').prepend(canvas);
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' }); } catch (e) { $('nogl').style.display = 'grid'; return false; }
  if (!renderer.capabilities.isWebGL2) { $('nogl').style.display = 'grid'; return false; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0x050507, 1);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.autoRotateSpeed = 1.2; controls.autoRotate = state.autorotate;
  resetView();
  shell = new THREE.Group(); labelGroup = new THREE.Group(); axesGroup = new THREE.Group(); scene.add(shell, labelGroup, axesGroup);
  labelGroup.visible = state.labels; axesGroup.visible = state.axes;
  makeTextures(state.res);
  buildVolume(); buildSlices(); buildArrows(); rebuildParticles();
  rebuildShell();
  const ro = new ResizeObserver(resize); ro.observe($('view')); resize();
  return true;
}
function resetView() { camera.position.set(2.9, 1.7, 3.1); controls.target.set(0, 0, 0); controls.update(); }
function resize() { const w = $('view').clientWidth, h = $('view').clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }

function makeTextures(N) {
  const mk = () => { const t = new THREE.Data3DTexture(new Uint16Array(N * N * N * 4), N, N, N); t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType; t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true; return t; };
  if (texE) { texE.dispose(); texH.dispose(); }
  texE = mk(); texH = mk(); texE._N = N;
  for (const m of allFieldMaterials()) { m.uniforms.fieldE.value = texE; m.uniforms.fieldH.value = texH; }
}
function allFieldMaterials() { const out = []; if (volMesh) out.push(volMesh.material); for (const s of sliceMeshes) out.push(s.material); if (ptsE) out.push(ptsE.material, ptsH.material); if (gpuE) out.push(gpuE.material, gpuH.material); return out; }
function onGridReady() {
  if (!renderer) return;
  if (!texE || texE._N !== grid.N) makeTextures(grid.N);
  texE.image.data.set(grid.Eh); texH.image.data.set(grid.Hh); texE.needsUpdate = texH.needsUpdate = true;
  uCommon.invMaxE.value = 1 / grid.maxE; uCommon.invMaxH.value = 1 / grid.maxH;
  syncBox(); updateArrows(); placeSlices(); placeVolume();
}

/* ---- shared GLSL ---- */
const GL_COMMON = `
precision highp float; precision highp sampler3D;
uniform sampler3D fieldE, fieldH; uniform vec3 boxMin, boxSize, center; uniform float wscale, radius, isCyl, invMaxE, invMaxH, phaseE, phaseH, showE, showH;
uniform vec3 e0, e1, e2, h0, h1, h2;
vec3 rampE(float m){ return mix(mix(e0, e1, smoothstep(0.0, 0.55, m)), e2, smoothstep(0.55, 1.0, m)); }
vec3 rampH(float m){ return mix(mix(h0, h1, smoothstep(0.0, 0.55, m)), h2, smoothstep(0.55, 1.0, m)); }
vec3 toTex(vec3 p){ return (p - boxMin) / boxSize; }
bool inside(vec3 p){ vec3 t = toTex(p); if (any(lessThan(t, vec3(0.0))) || any(greaterThan(t, vec3(1.0)))) return false; if (isCyl > 0.5 && dot(p.xy, p.xy) > radius*radius) return false; return true; }
`;
const colorUniforms = () => ({ e0: { value: COL.e0 }, e1: { value: COL.e1 }, e2: { value: COL.e2 }, h0: { value: COL.h0 }, h1: { value: COL.h1 }, h2: { value: COL.h2 }, fieldE: { value: texE }, fieldH: { value: texH } });

/* ---- particles (GPGPU) ---- */
function rebuildParticles() {
  if (!renderer) return;
  for (const o of [ptsE, ptsH]) if (o) { scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
  for (const g of [gpuE, gpuH]) if (g) g.dispose();
  const P = state.pTex;
  const mkSys = (which) => {
    const d = new Float32Array(P * P * 4); const sz = currentSize(), mn = currentMin();
    for (let i = 0; i < P * P; i++) { let x, y; if (state.geom === 'cyl') { const r = dims().R * Math.sqrt(Math.random()), ph = Math.random() * 6.2831853; x = r * Math.cos(ph); y = r * Math.sin(ph); } else { x = mn[0] + Math.random() * sz[0]; y = mn[1] + Math.random() * sz[1]; } d[i * 4] = x; d[i * 4 + 1] = y; d[i * 4 + 2] = mn[2] + Math.random() * sz[2]; d[i * 4 + 3] = Math.random() * state.lifetime; }
    const gpu = new PingPong(P, renderer, GL_COMMON + `
      uniform float dt, speed, lifetime, normMix, time, stepLen, useH;
      float hash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      vec3 spawn1(vec2 uv, float s){ vec3 r = vec3(hash(vec3(uv, s)), hash(vec3(uv.yx, s + 1.37)), hash(vec3(uv + 0.5, s + 2.71)));
        if (isCyl > 0.5) { float rr = radius * sqrt(r.x); float ph = 6.2831853 * r.y; return vec3(rr * cos(ph), rr * sin(ph), boxMin.z + r.z * boxSize.z); } return boxMin + r * boxSize; }
      // importance sampling: keep candidates where the field is strong, so the mode shape shows in the particle density
      vec3 spawn(vec2 uv, float s){ vec3 p = spawn1(uv, s);
        for (int i = 0; i < 4; i++) { vec3 t = toTex(p); float m = useH > 0.5 ? texture(fieldH, t).w * invMaxH : texture(fieldE, t).w * invMaxE;
          if (hash(vec3(uv.yx * 3.1, s + 7.7 * float(i))) < 0.08 + 0.92 * m * m) break; p = spawn1(uv, s + 11.3 * float(i + 1)); }
        return p; }
      void main(){ vec2 uv = gl_FragCoord.xy / resolution.xy; vec4 p = texture2D(texturePosition, uv); vec3 pos = p.xyz; float age = p.w;
        vec3 t = toTex(pos); vec4 f = useH > 0.5 ? texture(fieldH, t) * phaseH : texture(fieldE, t) * phaseE; float inv = useH > 0.5 ? invMaxH : invMaxE;
        float mag = length(f.xyz) * inv; vec3 dir = mag > 1e-6 ? normalize(f.xyz) : vec3(0.0);
        float sp = mix(sqrt(mag), 1.0, normMix);
        pos += dir * sp * speed * stepLen * dt; age += dt;
        if (age > lifetime || !inside(pos) || mag < 0.004) { pos = spawn(uv, time + age); age = 0.0; }
        gl_FragColor = vec4(pos, age); }`,
      Object.assign({}, uCommon, colorUniforms(), { dt: { value: 0 }, speed: { value: 1 }, lifetime: { value: 3 }, normMix: { value: 0 }, time: { value: 0 }, stepLen: { value: 1 }, useH: { value: which === 'H' ? 1 : 0 } }), d);
    // render points
    const geo = new THREE.BufferGeometry(); const refs = new Float32Array(P * P * 2), pos = new Float32Array(P * P * 3);
    for (let i = 0; i < P * P; i++) { refs[i * 2] = ((i % P) + .5) / P; refs[i * 2 + 1] = (Math.floor(i / P) + .5) / P; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('ref', new THREE.BufferAttribute(refs, 2));
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign({ posTex: { value: null }, pointSize: { value: 2.5 }, lifetime: { value: 3 }, useH: { value: which === 'H' ? 1 : 0 }, dpr: { value: renderer.getPixelRatio() } }, uCommon, colorUniforms()),
      vertexShader: GL_COMMON + `uniform sampler2D posTex; uniform float pointSize, lifetime, useH, dpr; attribute vec2 ref; varying float vMag, vAlpha;
        void main(){ vec4 p = texture2D(posTex, ref); vec3 t = toTex(p.xyz); vec4 f = useH > 0.5 ? texture(fieldH, t) : texture(fieldE, t); vMag = clamp(length(f.xyz) * (useH > 0.5 ? invMaxH : invMaxE), 0.0, 1.0);
          vec3 w = (p.xyz - center) * wscale; vec4 mv = modelViewMatrix * vec4(w, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = pointSize * dpr * (0.7 + 0.8 * vMag) * (2.2 / max(-mv.z, 0.1));
          float a = p.w / lifetime; vAlpha = smoothstep(0.0, 0.1, a) * (1.0 - smoothstep(0.8, 1.0, a)); }`,
      fragmentShader: GL_COMMON + `uniform float useH; varying float vMag, vAlpha;
        void main(){ vec2 c = gl_PointCoord - 0.5; float r2 = dot(c, c); if (r2 > 0.25) discard; float soft = 1.0 - smoothstep(0.12, 0.25, r2);
          vec3 col = useH > 0.5 ? rampH(vMag) : rampE(vMag); gl_FragColor = vec4(col, vAlpha * soft * (0.12 + 0.75 * vMag * vMag)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
    return { gpu, pts };
  };
  ({ gpu: gpuE, pts: ptsE } = mkSys('E')); ({ gpu: gpuH, pts: ptsH } = mkSys('H'));
  applyLayers(); applyField();
}

/* ---- volume glow ---- */
function buildVolume() {
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ camPos: { value: new THREE.Vector3() }, steps: { value: 64 }, gStr: { value: 1.5 }, gGam: { value: 3 } }, uCommon, colorUniforms()),
    vertexShader: `varying vec3 vPos; void main(){ vPos = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: GL_COMMON + `uniform vec3 camPos; uniform float steps, gStr, gGam; varying vec3 vPos;
      void main(){ vec3 ro = camPos, rd = normalize(vPos - camPos); vec3 bmin = (boxMin - center) * wscale, bmax = (boxMin + boxSize - center) * wscale;
        vec3 inv = 1.0 / rd; vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv; vec3 tmn = min(t0, t1), tmx = max(t0, t1);
        float tn = max(max(tmn.x, tmn.y), tmn.z), tf = min(min(tmx.x, tmx.y), tmx.z); tn = max(tn, 0.0); if (tf <= tn) discard;
        float n = steps; float dt = (tf - tn) / n; vec3 acc = vec3(0.0); float T = 1.0;
        for (float i = 0.0; i < 160.0; i += 1.0) { if (i >= n) break; vec3 w = ro + rd * (tn + (i + 0.5) * dt); vec3 p = w / wscale + center;
          if (isCyl > 0.5 && dot(p.xy, p.xy) > radius * radius) continue; vec3 t = toTex(p);
          float me = showE * clamp(texture(fieldE, t).w * invMaxE, 0.0, 1.0), mh = showH * clamp(texture(fieldH, t).w * invMaxH, 0.0, 1.0);
          float de = pow(me, gGam), dh = pow(mh, gGam); float a = clamp((de + dh) * dt * 1.5 * gStr, 0.0, 1.0);
          vec3 col = (rampE(me) * de + rampH(mh) * dh) / max(de + dh, 1e-4);
          acc += T * a * col; T *= (1.0 - a); if (T < 0.02) break; }
        gl_FragColor = vec4(acc, 1.0 - T); }`,
    transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.NormalBlending });
  volMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat); volMesh.renderOrder = 5; scene.add(volMesh);
}
function placeVolume() { if (!volMesh) return; const sz = currentSize(), S = uCommon.wscale.value; volMesh.scale.set(sz[0] * S, sz[1] * S, sz[2] * S); }

/* ---- slices ---- */
function buildSlices() {
  for (let ax = 0; ax < 3; ax++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, uCommon, colorUniforms()),
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: GL_COMMON + `varying vec3 vW;
        void main(){ vec3 p = vW / wscale + center; if (!inside(p)) discard; vec3 t = toTex(p);
          float me = showE * clamp(texture(fieldE, t).w * invMaxE, 0.0, 1.0), mh = showH * clamp(texture(fieldH, t).w * invMaxH, 0.0, 1.0);
          vec3 col = vec3(0.03) + rampE(me) * pow(me, 1.3) + rampH(mh) * pow(mh, 1.3); gl_FragColor = vec4(col, 0.92); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); m.renderOrder = 3; m._ax = ax; scene.add(m); sliceMeshes.push(m);
  }
}
function placeSlices() {
  const sz = currentSize(), S = uCommon.wscale.value, w = [sz[0] * S, sz[1] * S, sz[2] * S];
  for (const m of sliceMeshes) {
    const ax = m._ax, f = state.slice['xyz'[ax]] - 0.5;
    m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1); m.position.set(0, 0, 0);
    if (ax === 0) { m.rotation.y = Math.PI / 2; m.scale.set(w[2], w[1], 1); m.position.x = f * w[0]; }
    else if (ax === 1) { m.rotation.x = -Math.PI / 2; m.scale.set(w[0], w[2], 1); m.position.y = f * w[1]; }
    else { m.scale.set(w[0], w[1], 1); m.position.z = f * w[2]; }
  }
}

/* ---- arrows (instanced) ---- */
function arrowGeometry() {
  const shaft = new THREE.CylinderGeometry(0.035, 0.035, 0.62, 6, 1); shaft.translate(0, 0.31, 0);
  const head = new THREE.ConeGeometry(0.11, 0.38, 10); head.translate(0, 0.62 + 0.19, 0);
  const pos = [], nor = []; for (const g of [shaft, head]) { const ng = g.toNonIndexed(); pos.push(...ng.attributes.position.array); nor.push(...ng.attributes.normal.array); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); return geo;
}
function buildArrows() {
  const geo = arrowGeometry(), MAXI = 4096;
  const mk = () => { const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.95 }), MAXI); m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 3), 3); m.frustumCulled = false; scene.add(m); return m; };
  arrowsE = mk(); arrowsH = mk();
  scene.add(new THREE.AmbientLight(0xffffff, 1.6)); const dl = new THREE.DirectionalLight(0xffffff, 1.2); dl.position.set(2, 3, 4); scene.add(dl);
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();
function updateArrows() {
  if (!arrowsE || !grid.N) return;
  const sz = currentSize(), mn = currentMin(), S = uCommon.wscale.value, N = grid.N;
  const maxDim = Math.max(...sz), per = state.arrowDens, cell = maxDim / per;
  const cnt = sz.map(s => Math.max(2, Math.round(s / cell)));
  const fill = (mesh, F, inv, ramp, phase) => {
    let n = 0;
    for (let k = 0; k < cnt[2]; k++) for (let j = 0; j < cnt[1]; j++) for (let i = 0; i < cnt[0]; i++) {
      const fx = (i + .5) / cnt[0], fy = (j + .5) / cnt[1], fz = (k + .5) / cnt[2];
      const px = mn[0] + fx * sz[0], py = mn[1] + fy * sz[1], pz = mn[2] + fz * sz[2];
      if (state.geom === 'cyl' && px * px + py * py > dims().R * dims().R * 0.97) continue;
      const idx = ((Math.min(N - 1, Math.floor(fz * N)) * N + Math.min(N - 1, Math.floor(fy * N))) * N + Math.min(N - 1, Math.floor(fx * N))) * 4;
      const vx = F[idx] * phase, vy = F[idx + 1] * phase, vz = F[idx + 2] * phase, mag = F[idx + 3] * inv;
      if (mag < 0.03) continue;
      _v.set(vx, vy, vz).normalize(); _q.setFromUnitVectors(_up, _v);
      const len = cell * S * (0.25 + 0.75 * mag) * state.arrowSize; _s.set(len * 0.9, len, len * 0.9);
      _m4.compose(new THREE.Vector3((px - mn[0] - sz[0] / 2) * S, (py - mn[1] - sz[1] / 2) * S, (pz - mn[2] - sz[2] / 2) * S).sub(_v.clone().multiplyScalar(len / 2)), _q, _s);
      mesh.setMatrixAt(n, _m4); ramp(mag); mesh.setColorAt(n, _c); n++;
      if (n >= 4096) break;
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
  };
  const rampE = m => _c.copy(COL.e0).lerp(COL.e1, Math.min(1, m / .55)).lerp(COL.e2, Math.max(0, (m - .55) / .45));
  const rampH = m => _c.copy(COL.h0).lerp(COL.h1, Math.min(1, m / .55)).lerp(COL.h2, Math.max(0, (m - .55) / .45));
  fill(arrowsE, grid.E, 1 / grid.maxE, rampE, uCommon.phaseE.value); fill(arrowsH, grid.H, 1 / grid.maxH, rampH, uCommon.phaseH.value);
}

/* ---- shell, labels, axes ---- */
function rebuildShell() {
  if (!scene) return;
  syncBox();
  for (const g of [shell, labelGroup, axesGroup]) { while (g.children.length) { const c = g.children.pop(); c.geometry && c.geometry.dispose(); c.material && c.material.map && c.material.map.dispose(); c.material && c.material.dispose(); } }
  const sz = currentSize(), S = uCommon.wscale.value, w = [sz[0] * S, sz[1] * S, sz[2] * S];
  const lineMat = new THREE.LineBasicMaterial({ color: 0x8e90a0, transparent: true, opacity: 0.8 });
  const faceMat = new THREE.MeshBasicMaterial({ color: 0x9aa0ff, transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false });
  if (state.geom === 'rect') {
    const g = new THREE.BoxGeometry(w[0], w[1], w[2]);
    shell.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), lineMat)); const f = new THREE.Mesh(g, faceMat); f.renderOrder = 1; shell.add(f);
  } else {
    const R = dims().R * S, L = w[2];
    const g = new THREE.CylinderGeometry(R, R, L, 72, 1, false); g.rotateX(Math.PI / 2);
    const f = new THREE.Mesh(g, faceMat); f.renderOrder = 1; shell.add(f);
    const pts = [];
    for (const z of [-L / 2, L / 2]) for (let i = 0; i < 72; i++) { const a0 = i / 72 * 6.2831853, a1 = (i + 1) / 72 * 6.2831853; pts.push(R * Math.cos(a0), R * Math.sin(a0), z, R * Math.cos(a1), R * Math.sin(a1), z); }
    for (let i = 0; i < 8; i++) { const a = i / 8 * 6.2831853; pts.push(R * Math.cos(a), R * Math.sin(a), -L / 2, R * Math.cos(a), R * Math.sin(a), L / 2); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); shell.add(new THREE.LineSegments(lg, lineMat));
  }
  shell.visible = state.walls;
  // axes: small triad at the cavity corner
  const o = new THREE.Vector3(-w[0] / 2, -w[1] / 2, -w[2] / 2).addScalar(-0.1), al = 0.32;
  const axis = (dir, col, txt) => { const g = new THREE.BufferGeometry().setFromPoints([o, o.clone().add(dir.clone().multiplyScalar(al))]); axesGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: col }))); const sp = textSprite(txt, '#c9cbd6', 44); sp.position.copy(o).add(dir.clone().multiplyScalar(al + 0.1)); sp.scale.multiplyScalar(0.9); axesGroup.add(sp); };
  axis(new THREE.Vector3(1, 0, 0), 0xd16d6d, 'x'); axis(new THREE.Vector3(0, 1, 0), 0x7fc97f, 'y'); axis(new THREE.Vector3(0, 0, 1), 0x7c83ff, 'z');
  updateLabels();
  placeVolume(); placeSlices();
}
function textSprite(text, color, px) {
  const c = document.createElement('canvas'); const ctx = c.getContext('2d'); ctx.font = `500 ${px}px Roboto Mono, monospace`; const tw = Math.ceil(ctx.measureText(text).width) + 24; c.width = tw; c.height = px + 20;
  ctx.font = `500 ${px}px Roboto Mono, monospace`; ctx.fillStyle = 'rgba(20,20,24,0.7)'; ctx.beginPath(); ctx.roundRect(0, 0, c.width, c.height, 10); ctx.fill(); ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, 12, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })); sp.scale.set(c.width / 850, c.height / 850, 1); sp.renderOrder = 10; return sp;
}
function updateLabels() {
  if (!labelGroup) return;
  while (labelGroup.children.length) { const c = labelGroup.children.pop(); c.material.map.dispose(); c.material.dispose(); }
  const sz = currentSize(), S = uCommon.wscale.value, w = [sz[0] * S, sz[1] * S, sz[2] * S];
  const add = (txt, x, y, z) => { const sp = textSprite(txt, '#ececf1', 40); sp.position.set(x, y, z); labelGroup.add(sp); };
  if (state.geom === 'rect') { add('a ' + fmtLen(state.a), 0, -w[1] / 2 - 0.1, w[2] / 2 + 0.1); add('b ' + fmtLen(state.b), w[0] / 2 + 0.1, 0, w[2] / 2 + 0.1); add('d ' + fmtLen(state.d), w[0] / 2 + 0.1, -w[1] / 2 - 0.1, 0); }
  else { add('R ' + fmtLen(state.R), 0, w[1] / 2 + 0.12, w[2] / 2 + 0.05); add('L ' + fmtLen(state.L), 0, -w[1] / 2 - 0.12, 0); add('Ø ' + fmtLen(2 * state.R), 0, 0, w[2] / 2 + 0.16); }
  labelGroup.visible = state.labels;
}

function applyLayers() {
  if (!renderer) return;
  const L = state.layers; ptsE.visible = L.particles && state.field !== 'H'; ptsH.visible = L.particles && state.field !== 'E';
  arrowsE.visible = L.arrows && state.field !== 'H'; arrowsH.visible = L.arrows && state.field !== 'E';
  for (const s of sliceMeshes) s.visible = L.slices; volMesh.visible = L.volume;
  $('particleRows').hidden = !L.particles; $('arrowRows').hidden = !L.arrows; $('glowRows').hidden = !L.volume; $('sliceRows').hidden = !L.slices;
}
function applyField() { uCommon.showE.value = state.field === 'H' ? 0 : 1; uCommon.showH.value = state.field === 'E' ? 0 : 1; applyLayers(); }

/* ---- render loop ---- */
let last = performance.now(), fpsAcc = 0, fpsN = 0, simT = 0, oscT = 0, lastPhaseUpdate = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  fpsAcc += dt; fpsN++; if (fpsAcc >= 0.5) { $('fps').textContent = Math.round(fpsN / fpsAcc) + ' fps'; fpsAcc = 0; fpsN = 0; }
  controls.update();
  if (!state.paused) {
    if (state.oscillate) { oscT += dt; const ph = oscT * 2 * Math.PI / 4; uCommon.phaseE.value = Math.cos(ph); uCommon.phaseH.value = Math.sin(ph); if (state.layers.arrows && now - lastPhaseUpdate > 50) { lastPhaseUpdate = now; updateArrows(); } }
    else if (uCommon.phaseE.value !== 1 || uCommon.phaseH.value !== 1) { uCommon.phaseE.value = uCommon.phaseH.value = 1; updateArrows(); }
    if (state.layers.particles && grid.N) {
      simT += dt; const stepLen = Math.max(...currentSize());
      for (const [g, p, on] of [[gpuE, ptsE, ptsE.visible], [gpuH, ptsH, ptsH.visible]]) {
        if (!on) continue;
        const u = g.material.uniforms; u.dt.value = dt; u.speed.value = state.speed; u.lifetime.value = state.lifetime; u.normMix.value = state.normalize ? 1 : 0; u.time.value = simT; u.stepLen.value = stepLen;
        g.compute();
        p.material.uniforms.posTex.value = g.texture; p.material.uniforms.pointSize.value = state.dot; p.material.uniforms.lifetime.value = state.lifetime;
      }
    }
  }
  if (volMesh.visible) { const u = volMesh.material.uniforms; u.camPos.value.copy(camera.position); u.gStr.value = state.glowStr; u.gGam.value = state.glowGam; }
  renderer.render(scene, camera);
}

/* ================= collapsible sections ================= */
if (!state.collapsed || typeof state.collapsed !== 'object') state.collapsed = {};
for (const sec of document.querySelectorAll('#rail .sec')) {
  const head = sec.querySelector('.sec-h'), h2 = head && head.querySelector('h2'); if (!h2) continue;
  const key = h2.textContent.trim().toLowerCase().replace(/[^a-z]+/g, '-');
  const btn = document.createElement('button'); btn.className = 'tg'; btn.type = 'button'; btn.textContent = h2.textContent; h2.textContent = ''; h2.appendChild(btn);
  const apply = () => { const c = !!state.collapsed[key]; sec.classList.toggle('collapsed', c); btn.setAttribute('aria-expanded', !c); };
  head.addEventListener('click', e => { if (e.target.closest('a, input, select')) return; state.collapsed[key] = !state.collapsed[key]; apply(); persist(); });
  apply();
}

/* ================= boot ================= */
buildDimRows(); buildCustomLabels();
const ok = initThree();
recomputeModes(state.selected.length === 0);
if (ok) requestAnimationFrame(loop);
})();
