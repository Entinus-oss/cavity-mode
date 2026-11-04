# Cavity Mode Studio

Interactive 3D calculator for rectangular and cylindrical microwave cavity resonators.
Single-file web app, no build step needed to run: open `index.html` in any WebGL 2 browser.

## What it does

- Rectangular ($a \times b \times d$) and cylindrical ($R$, $L$) cavities, dimensions in mm / cm / inch, optional dielectric fill $\varepsilon_r$
- Lists the 60 lowest TE/TM modes with resonant frequency and unloaded $Q$; degenerate pairs are flagged
- Wall material: brass, copper, aluminium (Pozar conductivities) or a custom conductivity
- Two-port coupling model: loaded $Q$, 3 dB passband, insertion loss, and a $|S_{21}|$ response chart showing the selected modes next to their spurious neighbours
- Superposition of any number of modes with signed amplitudes
- GPU field visualisation: particle flow along $\mathbf{E}$ (warm colours) and $\mathbf{H}$ (cool colours) field lines, instanced arrows, orthogonal slices, volume glow; orbit / pan / zoom, auto-rotate, oscillation animation
- "Tune a dimension": solve one dimension so a chosen mode lands on a target frequency
- Export as JSON, CSV or a plain-text build sheet

## Physics

### Resonant frequencies

Phase velocity in the fill: $v = c_0/\sqrt{\varepsilon_r}$ (non-magnetic, lossless fill).

**Rectangular cavity**, $\mathrm{TE}_{mnp}$ and $\mathrm{TM}_{mnp}$ with $m \leftrightarrow a$ ($x$), $n \leftrightarrow b$ ($y$), $p \leftrightarrow d$ ($z$):

$$
f_{mnp} = \frac{c_0}{2\sqrt{\varepsilon_r}}
\sqrt{\left(\frac{m}{a}\right)^2 + \left(\frac{n}{b}\right)^2 + \left(\frac{p}{d}\right)^2}
$$

TE modes need $p \ge 1$ and $(m,n) \ne (0,0)$; TM modes need $m,n \ge 1$ and $p \ge 0$.

**Cylindrical cavity** of radius $R$ and length $L$ (axis along $z$), $\mathrm{TE}_{nml}$ and $\mathrm{TM}_{nml}$ with $n$ azimuthal, $m$ radial, $l$ axial:

$$
f_{nml} = \frac{c_0}{2\pi\sqrt{\varepsilon_r}}
\sqrt{\left(\frac{\chi}{R}\right)^2 + \left(\frac{l\pi}{L}\right)^2},
\qquad
\chi =
\begin{cases}
p'_{nm}, & \mathrm{TE}\ (J_n'(p'_{nm}) = 0,\ l \ge 1)\\[2pt]
p_{nm},  & \mathrm{TM}\ (J_n(p_{nm}) = 0,\ l \ge 0)
\end{cases}
$$

The Bessel zeros are not tabulated but found numerically at start-up by bisection on
$J_n(x) = \frac{1}{2\pi}\int_{-\pi}^{\pi}\cos(n\tau - x\sin\tau)\,d\tau$, evaluated with the trapezoid rule
(spectrally accurate for a periodic integrand).

### Field patterns

The maps are the exact standing-wave solutions. With $k_c^2 = k_x^2 + k_y^2$ (rectangular) or $k_c = \chi/R$ (cylindrical),
$\beta = p\pi/d$ (or $l\pi/L$) and $k^2 = k_c^2 + \beta^2$, the transverse fields follow from the longitudinal one:

$$
\mathrm{TE}:\quad
\mathbf{H}_t = \frac{1}{k_c^2}\nabla_t\frac{\partial H_z}{\partial z},\qquad
\mathbf{E}_t = \frac{k\eta}{k_c^2}\,\hat{\mathbf z}\times\nabla_t H_z
$$

$$
\mathrm{TM}:\quad
\mathbf{E}_t = \frac{1}{k_c^2}\nabla_t\frac{\partial E_z}{\partial z},\qquad
\mathbf{H}_t = -\frac{k}{\eta\,k_c^2}\,\hat{\mathbf z}\times\nabla_t E_z
$$

with, for example, $H_z = \cos(k_x x)\cos(k_y y)\sin(\beta z)$ in the rectangular TE case and
$H_z = J_n(k_c\rho)\cos(n\varphi)\sin(\beta z)$ in the cylindrical TE case.
Each mode is normalised to peak $|\mathbf{E}| = 1$ before superposition; $\mathbf{E}$ and $\mathbf{H}$ are
shown at their respective maxima (they are $90^\circ$ apart in time), which the "Oscillate" option animates as
$\mathbf{E}\cos\omega t$, $\mathbf{H}\sin\omega t$.

### Unloaded Q

Only conductor loss of a closed cavity is included:

$$
Q_u = \frac{\omega\,\mu_0 \displaystyle\int_V |\mathbf{E}|^2\,dV}{R_s \displaystyle\oint_S |\mathbf{H}_{\tan}|^2\,dS},
\qquad
R_s = \sqrt{\frac{\omega\mu_0}{2\sigma}},
\qquad
\delta_s = \frac{1}{\sqrt{\pi f \mu_0 \sigma}}
$$

(fields in the normalised units of the kernels, $\mathbf{E}$ in units of $\eta H_0$). For the rectangular cavity the integrals
separate into products of $\int\cos^2$ and $\int\sin^2$ terms and are evaluated in closed form; for the cylindrical cavity the
azimuthal and axial integrals are analytic and the three radial integrals
$\int_0^R J_n^2\,\rho\,d\rho$, $\int_0^R J_n'^2\,\rho\,d\rho$, $\int_0^R J_n^2/\rho\,d\rho$ are done with Simpson's rule on a 513-point table.

Checks: agreement to five digits with Pozar's closed forms for $\mathrm{TE}_{10l}$,

$$
Q_{\mathrm{TE}_{10l}} = \frac{(kad)^3\,b\,\eta}{2\pi^2 R_s}\,
\frac{1}{2l^2a^3b + 2bd^3 + l^2a^3d + ad^3},
$$

and for $\mathrm{TM}_{010}$, $Q = \dfrac{p_{01}\,\eta}{2R_s}\,\dfrac{1}{1 + R/L}$; brute-force 3D integration of the cylindrical kernels;
and $\nabla\times\mathbf{E} = -k\eta\mathbf{H}$, $\nabla\cdot\mathbf{E}=0$ verified numerically on the field kernels.

Conductivities (S/m): copper $5.813\times10^7$, aluminium $3.816\times10^7$, brass $2.564\times10^7$ (Pozar, *Microwave Engineering*, App. F).
Plated, alloyed or rough walls can be well below these values; a custom $\sigma$ can be entered.

### Bandwidth and coupling

The narrowest possible passband is set by the unloaded $Q$:

$$
\Delta f_{\min} = \frac{f_0}{Q_u}.
$$

Real ports load the cavity. With coupling coefficients $\beta_i = Q_u/Q_{\mathrm{ext},i}$ on the input and output ports,

$$
Q_L = \frac{Q_u}{1 + \beta_{\mathrm{in}} + \beta_{\mathrm{out}}},\qquad
\Delta f_{3\,\mathrm{dB}} = \frac{f_0}{Q_L},\qquad
|S_{21}(f_0)| = \frac{2\sqrt{\beta_{\mathrm{in}}\beta_{\mathrm{out}}}}{1 + \beta_{\mathrm{in}} + \beta_{\mathrm{out}}}
$$

and the response of each mode is drawn as the Lorentzian

$$
|S_{21}(f)| = \frac{|S_{21}(f_0)|}{\sqrt{1 + \left(2Q_L\,\dfrac{f - f_0}{f_0}\right)^2}}.
$$

$\beta = 1$ on both ports (critical coupling) gives $Q_L = Q_u/3$ and $3.5$ dB insertion loss.

### Solving a dimension for a target frequency

With $k = 2\pi f_{\mathrm{target}}\sqrt{\varepsilon_r}/c_0$, one dimension is isolated from the frequency formula, e.g. for the rectangular cavity

$$
a = \frac{m\pi}{\sqrt{k^2 - (n\pi/b)^2 - (p\pi/d)^2}},
$$

and for the cylinder $R = \chi\big/\sqrt{k^2 - (l\pi/L)^2}$ or $L = l\pi\big/\sqrt{k^2 - (\chi/R)^2}$.
The app reports when the target lies below the cutoff fixed by the other dimensions.

## Layout

- `src/head.html` – markup and styles
- `src/physics.js` – mode enumeration, Bessel functions, $Q$ factors, dimension solver (also runs under Node for tests)
- `src/app.js` – three.js scene, worker pool for field evaluation, GPGPU particles, UI
- `build.sh` – concatenates the sources into `index.html` (standalone) and `artifact.html` (claude.ai artifact body)

three.js 0.160 is loaded from jsDelivr; everything else is inline.
