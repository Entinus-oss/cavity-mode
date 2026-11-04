# Cavity Mode Studio

Interactive 3D calculator for rectangular and cylindrical microwave cavity resonators.
Single-file web app (no build step needed to run): open `index.html` in any WebGL 2 browser.

## What it does

- Rectangular (a × b × d) and cylindrical (R, L) cavities, dimensions in mm / cm / inch, optional dielectric fill (εr)
- Lists the 60 lowest TE/TM modes with resonant frequency and unloaded Q; degenerate pairs are flagged
- Wall material: brass, copper, aluminium (Pozar conductivities) or a custom conductivity
- Superposition of any number of modes with signed amplitudes
- GPU field visualisation: particle flow along E (warm) and H (cool) field lines, instanced arrows,
  orthogonal slices, volume glow; orbit / pan / zoom, auto-rotate, oscillation animation
- "Tune a dimension": solve one dimension so a chosen mode lands on a target frequency
- Export as JSON, CSV or a plain-text build sheet

## Physics

- Rectangular: f = (c / 2√εr) · √((m/a)² + (n/b)² + (p/d)²), TE/TM_mnp with m↔a, n↔b, p↔d
- Cylindrical: f = (c / 2π√εr) · √((p/R)² + (lπ/L)²), p = p′ₙₘ (TE) or pₙₘ (TM); TE/TM_nml with n azimuthal, m radial, l axial
- Q is the unloaded conductor Q of a closed cavity, Q = ωμ₀∫|E|²dV / (Rs ∮|H_tan|²dS), evaluated
  analytically (rectangular) or semi-analytically with numerical radial integrals (cylindrical).
  Verified against Pozar's closed forms for TE10l and TM010 and against brute-force integration.
- Field patterns are the exact analytic standing-wave solutions; each mode is normalised to peak |E| = 1
  before superposition.

## Layout

- `src/head.html` – markup and styles
- `src/physics.js` – mode enumeration, Bessel functions, Q factors, dimension solver (also runs under Node for tests)
- `src/app.js` – three.js scene, worker pool for field evaluation, GPGPU particles, UI
- `build.sh` – concatenates the sources into `index.html` (standalone) and `artifact.html`

three.js 0.160 is loaded from jsDelivr; everything else is inline.
