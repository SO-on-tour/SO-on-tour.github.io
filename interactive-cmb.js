const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const SPECTRUM_CONFIG = {
  kMin: 1,
  kMax: 100,
  pMin: 1e-4,
  pMax: 1,
};

function gaussianRandom() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function createViridisColor(t) {
  const stops = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ];
  const scaled = clamp(t, 0, 1) * (stops.length - 1);
  const index = Math.floor(scaled);
  const frac = scaled - index;
  const a = stops[index];
  const b = stops[Math.min(index + 1, stops.length - 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * frac),
    Math.round(a[1] + (b[1] - a[1]) * frac),
    Math.round(a[2] + (b[2] - a[2]) * frac),
  ];
}

function createPhaseColor(t) {
  const hue = clamp(t, 0, 1) * 360;
  const saturation = 0.9;
  const lightness = 0.6;
  const chroma = (1 - Math.abs((2 * lightness) - 1)) * saturation;
  const prime = hue / 60;
  const second = chroma * (1 - Math.abs((prime % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (prime < 1) [red, green, blue] = [chroma, second, 0];
  else if (prime < 2) [red, green, blue] = [second, chroma, 0];
  else if (prime < 3) [red, green, blue] = [0, chroma, second];
  else if (prime < 4) [red, green, blue] = [0, second, chroma];
  else if (prime < 5) [red, green, blue] = [second, 0, chroma];
  else [red, green, blue] = [chroma, 0, second];

  const match = lightness - chroma / 2;
  return [
    Math.round((red + match) * 255),
    Math.round((green + match) * 255),
    Math.round((blue + match) * 255),
  ];
}

function drawArrayToCanvas(canvas, values, width, height, colorMap = "gray", options = {}) {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  let min = options.min;
  let max = options.max;

  if (min === undefined || max === undefined) {
    min = Infinity;
    max = -Infinity;
    for (const value of values) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }

  const range = max - min || 1;

  for (let i = 0; i < values.length; i += 1) {
    const t = (values[i] - min) / range;
    const offset = i * 4;
    let r;
    let g;
    let b;
    if (colorMap === "viridis") {
      [r, g, b] = createViridisColor(t);
    } else if (colorMap === "phase") {
      [r, g, b] = createPhaseColor(t);
    } else {
      const shade = Math.round(t * 255);
      r = shade;
      g = shade;
      b = shade;
    }
    imageData.data[offset] = r;
    imageData.data[offset + 1] = g;
    imageData.data[offset + 2] = b;
    imageData.data[offset + 3] = 255;
  }

  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  scratch.getContext("2d").putImageData(imageData, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, canvas.width, canvas.height);
}

function interpolateArray(values, index) {
  const clamped = clamp(index, 0, values.length - 1);
  const lo = Math.floor(clamped);
  const hi = Math.min(lo + 1, values.length - 1);
  const t = clamped - lo;
  return values[lo] * (1 - t) + values[hi] * t;
}

function dft2D(matrix, size) {
  const real = new Float32Array(size * size);
  const imag = new Float32Array(size * size);
  for (let ky = 0; ky < size; ky += 1) {
    for (let kx = 0; kx < size; kx += 1) {
      let sumReal = 0;
      let sumImag = 0;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const angle = (-2 * Math.PI * ((kx * x) + (ky * y))) / size;
          const value = matrix[y * size + x];
          sumReal += value * Math.cos(angle);
          sumImag += value * Math.sin(angle);
        }
      }
      const index = ky * size + kx;
      real[index] = sumReal;
      imag[index] = sumImag;
    }
  }
  return { real, imag, size };
}

function idft2D(real, imag, size) {
  const output = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (let ky = 0; ky < size; ky += 1) {
        for (let kx = 0; kx < size; kx += 1) {
          const index = ky * size + kx;
          const angle = (2 * Math.PI * ((kx * x) + (ky * y))) / size;
          sum += real[index] * Math.cos(angle) - imag[index] * Math.sin(angle);
        }
      }
      output[y * size + x] = sum / (size * size);
    }
  }
  return output;
}

function fftShiftValues(values, size) {
  const shifted = new Float32Array(size * size);
  const half = Math.floor(size / 2);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + half) % size;
      const ny = (y + half) % size;
      shifted[ny * size + nx] = values[y * size + x];
    }
  }
  return shifted;
}

function amplitudeMap(real, imag, size) {
  const values = new Float32Array(size * size);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = Math.log(1 + Math.hypot(real[i], imag[i]));
  }
  return fftShiftValues(values, size);
}

function phaseMap(real, imag, size) {
  const values = new Float32Array(size * size);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = (Math.atan2(imag[i], real[i]) + Math.PI) / (2 * Math.PI);
  }
  return fftShiftValues(values, size);
}

function resampleImageToGrid(image, size) {
  const scratch = document.createElement("canvas");
  scratch.width = size;
  scratch.height = size;
  const ctx = scratch.getContext("2d");
  ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const values = new Float32Array(size * size);
  for (let i = 0; i < size * size; i += 1) {
    const offset = i * 4;
    values[i] = (0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2]) / 255;
  }
  return values;
}

function cloneSpectrum(spectrum) {
  return {
    real: new Float32Array(spectrum.real),
    imag: new Float32Array(spectrum.imag),
    size: spectrum.size,
  };
}

function filterSpectrum(spectrum, filter, radius) {
  const result = cloneSpectrum(spectrum);
  const { size } = result;
  const cutoff = radius * (size / 2);
  let meanAmp = 0;

  if (filter === "randomAmplitudes") {
    for (let i = 0; i < size * size; i += 1) {
      meanAmp += Math.hypot(result.real[i], result.imag[i]);
    }
    meanAmp /= size * size;
  }

  for (let y = 0; y < size; y += 1) {
    const fy = y <= size / 2 ? y : y - size;
    for (let x = 0; x < size; x += 1) {
      const fx = x <= size / 2 ? x : x - size;
      const index = y * size + x;
      const k = Math.hypot(fx, fy);
      if (filter === "lowPass" && k > cutoff) {
        result.real[index] = 0;
        result.imag[index] = 0;
      } else if (filter === "highPass" && k < cutoff) {
        result.real[index] = 0;
        result.imag[index] = 0;
      } else if (filter === "randomPhases") {
        const amp = Math.hypot(result.real[index], result.imag[index]);
        const phase = Math.random() * Math.PI * 2 - Math.PI;
        result.real[index] = amp * Math.cos(phase);
        result.imag[index] = amp * Math.sin(phase);
      } else if (filter === "randomAmplitudes") {
        const phase = Math.atan2(result.imag[index], result.real[index]);
        const amp = Math.random() * 2 * meanAmp;
        result.real[index] = amp * Math.cos(phase);
        result.imag[index] = amp * Math.sin(phase);
      }
    }
  }
  return result;
}

function samplePowerFromEditor(samples, k, options = {}) {
  const { kMin = SPECTRUM_CONFIG.kMin, kMax = SPECTRUM_CONFIG.kMax, xLog = true } = options;
  if (xLog) {
    if (k < kMin || kMax <= kMin) return 0;
    const normX = Math.log(k / kMin) / Math.log(kMax / kMin);
    return interpolateArray(samples, normX * (samples.length - 1));
  }
  const normX = clamp(k / kMax, 0, 1);
  return interpolateArray(samples, normX * (samples.length - 1));
}

function buildHermitianSpectrum(size, samplePower) {
  const real = new Float32Array(size * size);
  const imag = new Float32Array(size * size);
  const visited = new Uint8Array(size * size);
  const half = size / 2;

  for (let y = 0; y < size; y += 1) {
    const ky = y <= half ? y : y - size;
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if (visited[index]) continue;

      const mx = (size - x) % size;
      const my = (size - y) % size;
      const mirrorIndex = my * size + mx;
      const kx = x <= half ? x : x - size;
      const k = Math.hypot(kx, ky);
      const power = Math.max(samplePower(k), 0);
      const sigma = Math.sqrt(power * 0.5);
      const a = sigma * gaussianRandom();
      const b = sigma * gaussianRandom();

      real[index] = a;
      imag[index] = index === mirrorIndex ? 0 : b;
      real[mirrorIndex] = a;
      imag[mirrorIndex] = index === mirrorIndex ? 0 : -b;
      visited[index] = 1;
      visited[mirrorIndex] = 1;
    }
  }

  imag[0] = 0;
  return { real, imag, size };
}

function buildFieldFromSpectrumSamples(samples, size, options = {}) {
  const spectrum = buildHermitianSpectrum(size, (k) => samplePowerFromEditor(samples, k, options));
  return {
    ...spectrum,
    field: idft2D(spectrum.real, spectrum.imag, size),
  };
}

function applySpectralTilt(spectrum, tilt) {
  const result = cloneSpectrum(spectrum);
  const { size } = result;
  const half = size / 2;
  for (let y = 0; y < size; y += 1) {
    const ky = y <= half ? y : y - size;
    for (let x = 0; x < size; x += 1) {
      const kx = x <= half ? x : x - size;
      const k = Math.hypot(kx, ky);
      if (k === 0) continue;
      const scale = k ** tilt;
      const index = y * size + x;
      result.real[index] *= scale;
      result.imag[index] *= scale;
    }
  }
  return result;
}

function azimuthalSpectrum(spectrum, ellPerPixel) {
  const { real, imag, size } = spectrum;
  const half = size / 2;
  const bins = [];
  for (let radius = 1; radius <= half; radius += 1) {
    let total = 0;
    let count = 0;
    for (let y = 0; y < size; y += 1) {
      const ky = y <= half ? y : y - size;
      for (let x = 0; x < size; x += 1) {
        const kx = x <= half ? x : x - size;
        if (Math.round(Math.hypot(kx, ky)) !== radius) continue;
        const index = y * size + x;
        total += real[index] * real[index] + imag[index] * imag[index];
        count += 1;
      }
    }
    if (count > 0) {
      bins.push({
        ell: radius * ellPerPixel,
        power: total / count,
      });
    }
  }
  return bins;
}

function interpolateCls(ell) {
  const data = window.CMB_TEST_CLS;
  if (!data || !data.ell || !data.cl) return 0;
  const ellArray = data.ell;
  const clArray = data.cl;
  if (ell <= ellArray[0] || ell >= ellArray[ellArray.length - 1]) return 0;

  let lo = 0;
  let hi = ellArray.length - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ellArray[mid] > ell) hi = mid;
    else lo = mid;
  }
  const t = (ell - ellArray[lo]) / (ellArray[hi] - ellArray[lo]);
  return clArray[lo] * (1 - t) + clArray[hi] * t;
}

function drawSpectrumChart(canvas, theoryPoints, measuredPoints) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const left = 64;
  const right = 20;
  const top = 18;
  const bottom = 36;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#101722";
  ctx.fillRect(0, 0, width, height);

  const xMax = Math.max(
    theoryPoints[theoryPoints.length - 1]?.ell || 1,
    measuredPoints[measuredPoints.length - 1]?.ell || 1
  );
  const positiveValues = [...theoryPoints.map((point) => point.power), ...measuredPoints.map((point) => point.power)]
    .filter((value) => value > 0);
  const rawMin = Math.min(...positiveValues, 1e-12);
  const rawMax = Math.max(...positiveValues, 1e-11);
  const yMax = Math.log10(rawMax);
  const yMin = Math.max(Math.log10(rawMin), yMax - 4);

  function toX(ell) {
    return left + (ell / xMax) * chartWidth;
  }

  function toY(power) {
    const lp = Math.log10(Math.max(power, 1e-12));
    return top + (1 - (lp - yMin) / (yMax - yMin || 1)) * chartHeight;
  }

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  for (let i = 0; i <= 4; i += 1) {
    const y = top + (i / 4) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, height - bottom);
  ctx.lineTo(width - right, height - bottom);
  ctx.stroke();

  const drawLine = (points, color) => {
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = toX(point.ell);
      const y = toY(point.power);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  };

  drawLine(theoryPoints, "#ffcc7a");
  drawLine(measuredPoints, "#4fe3ff");

  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "13px Georgia";
  ctx.fillText("Theory Cℓ", left, 14);
  ctx.fillText("Measured", left + 90, 14);
  ctx.fillText("ℓ", width - 18, height - 12);
  ctx.save();
  ctx.translate(16, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Power", 0, 0);
  ctx.restore();
}

class SpectrumEditor {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.values = new Float32Array(192);
    this.overlayProvider = options.overlayProvider || null;
    this.logX = options.logX ?? false;
    this.logY = options.logY ?? false;
    this.dragging = false;
    this.last = null;
    this.clear();
    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    window.addEventListener("pointerup", () => this.onPointerUp());
  }

  valueFromNormY(normY) {
    if (this.logY) {
      return SPECTRUM_CONFIG.pMin * ((SPECTRUM_CONFIG.pMax / SPECTRUM_CONFIG.pMin) ** normY);
    }
    return normY * SPECTRUM_CONFIG.pMax;
  }

  normYFromValue(value) {
    if (this.logY) {
      if (value <= 0) return 0;
      return Math.log(value / SPECTRUM_CONFIG.pMin) / Math.log(SPECTRUM_CONFIG.pMax / SPECTRUM_CONFIG.pMin);
    }
    return clamp(value / SPECTRUM_CONFIG.pMax, 0, 1);
  }

  clear() {
    this.values.fill(this.logY ? SPECTRUM_CONFIG.pMin : 0);
    this.draw();
  }

  getValues() {
    return Float32Array.from(this.values);
  }

  pointFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  applyPoint(point) {
    const index = Math.round(point.x * (this.values.length - 1));
    this.values[index] = this.valueFromNormY(point.y);
  }

  applySegment(a, b) {
    const start = Math.round(Math.min(a.x, b.x) * (this.values.length - 1));
    const end = Math.round(Math.max(a.x, b.x) * (this.values.length - 1));
    const sourceA = a.x <= b.x ? a : b;
    const sourceB = a.x <= b.x ? b : a;
    for (let i = start; i <= end; i += 1) {
      const x = i / (this.values.length - 1);
      const t = sourceA.x === sourceB.x ? 0 : (x - sourceA.x) / (sourceB.x - sourceA.x);
      const y = sourceA.y * (1 - t) + sourceB.y * t;
      this.values[i] = this.valueFromNormY(clamp(y, 0, 1));
    }
  }

  onPointerDown(event) {
    this.dragging = true;
    this.last = this.pointFromEvent(event);
    this.applyPoint(this.last);
    this.draw();
  }

  onPointerMove(event) {
    if (!this.dragging) return;
    const point = this.pointFromEvent(event);
    this.applySegment(this.last, point);
    this.last = point;
    this.draw();
  }

  onPointerUp() {
    this.dragging = false;
    this.last = null;
  }

  xTickPositions() {
    if (!this.logX) return [0, 0.25, 0.5, 0.75, 1].map((v) => ({ pos: v, label: `${Math.round(v * SPECTRUM_CONFIG.kMax)}` }));
    const tickValues = [1, 2, 5, 10, 20, 50, 100];
    return tickValues.map((value) => ({
      pos: Math.log(value / SPECTRUM_CONFIG.kMin) / Math.log(SPECTRUM_CONFIG.kMax / SPECTRUM_CONFIG.kMin),
      label: `${value}`,
    }));
  }

  yTickPositions() {
    if (!this.logY) return [0, 0.25, 0.5, 0.75, 1].map((v) => ({ pos: v, label: `${v.toFixed(2)}` }));
    const tickValues = [1e-4, 1e-3, 1e-2, 1e-1, 1];
    return tickValues.map((value) => ({
      pos: this.normYFromValue(value),
      label: value >= 1 ? "1" : `10^${Math.round(Math.log10(value))}`,
    }));
  }

  drawCurve(values, color, dashed = false) {
    const { ctx, canvas } = this;
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = (index / (values.length - 1)) * canvas.width;
      const y = (1 - this.normYFromValue(value)) * canvas.height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.setLineDash(dashed ? [10, 6] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  draw() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#121823";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;

    this.xTickPositions().forEach((tick) => {
      const x = tick.pos * canvas.width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    });

    this.yTickPositions().forEach((tick) => {
      const y = (1 - tick.pos) * canvas.height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    });

    this.drawCurve(this.values, "#4fe3ff");
    const overlay = this.overlayProvider ? this.overlayProvider() : null;
    if (overlay) this.drawCurve(overlay, "#ff9d4d", true);

    ctx.fillStyle = "rgba(255,255,255,0.52)";
    ctx.font = "11px Georgia";
    this.xTickPositions().forEach((tick) => {
      ctx.fillText(tick.label, tick.pos * canvas.width + 2, canvas.height - 4);
    });
    this.yTickPositions().forEach((tick) => {
      ctx.fillText(tick.label, 4, (1 - tick.pos) * canvas.height - 4);
    });
    ctx.fillText("k →", canvas.width - 24, canvas.height - 4);
    ctx.save();
    ctx.translate(12, 28);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("P(k)", 0, 0);
    ctx.restore();
  }
}

function initSingleMode() {
  const display = document.getElementById("singleModeCanvas");
  const grid = document.getElementById("singleGridCanvas");
  const amplitude = document.getElementById("singleAmplitude");
  const amplitudeValue = document.getElementById("singleAmplitudeValue");
  const phase = document.getElementById("singlePhase");
  const phaseValue = document.getElementById("singlePhaseValue");
  const info = document.getElementById("singleModeInfo");
  const reset = document.getElementById("singleReset");
  const gridCtx = grid.getContext("2d");
  const maxK = 8;
  const state = { kx: 1, ky: 0 };

  function drawGrid() {
    const count = 2 * maxK + 1;
    const cell = grid.width / count;
    gridCtx.clearRect(0, 0, grid.width, grid.height);
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        const kx = col - maxK;
        const ky = row - maxK;
        if (kx === state.kx && ky === state.ky) gridCtx.fillStyle = "#b24c2b";
        else if (kx === 0 && ky === 0) gridCtx.fillStyle = "rgba(241,203,88,0.7)";
        else if (Math.abs(kx) + Math.abs(ky) <= 2) gridCtx.fillStyle = "rgba(255,255,255,0.22)";
        else gridCtx.fillStyle = "rgba(255,255,255,0.08)";
        gridCtx.fillRect(col * cell, row * cell, cell - 1, cell - 1);
      }
    }
  }

  function render() {
    amplitudeValue.textContent = Number(amplitude.value).toFixed(2);
    phaseValue.textContent = `${(Number(phase.value) / Math.PI).toFixed(2)}π`;
    const size = 96;
    const values = new Float32Array(size * size);
    const amp = Number(amplitude.value);
    const phi = Number(phase.value);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const arg = (2 * Math.PI * ((state.kx * x) + (state.ky * y))) / size + phi;
        values[y * size + x] = amp * Math.cos(arg);
      }
    }
    drawArrayToCanvas(display, values, size, size, "gray", { min: -1, max: 1 });
    const wavelength = Math.hypot(state.kx, state.ky) > 0 ? `${(size / Math.hypot(state.kx, state.ky)).toFixed(2)} px` : "Infinity";
    let orientation = "DC (no oscillation)";
    if (state.kx === 0 && state.ky !== 0) orientation = "Horizontal bands";
    else if (state.ky === 0 && state.kx !== 0) orientation = "Vertical bands";
    else if (state.kx !== 0 || state.ky !== 0) orientation = `${(Math.atan2(state.ky, state.kx) * 180 / Math.PI).toFixed(1)}°`;
    info.innerHTML = `f(x,y) = A cos(2π(kx x + ky y)/N + φ)<br>kx = ${state.kx}, ky = ${state.ky}<br>Wavelength: ${wavelength}<br>Orientation: ${orientation}`;
    drawGrid();
  }

  grid.addEventListener("pointerdown", (event) => {
    const rect = grid.getBoundingClientRect();
    const count = 2 * maxK + 1;
    const cell = rect.width / count;
    const col = clamp(Math.floor((event.clientX - rect.left) / cell), 0, count - 1);
    const row = clamp(Math.floor((event.clientY - rect.top) / cell), 0, count - 1);
    state.kx = col - maxK;
    state.ky = row - maxK;
    render();
  });

  amplitude.addEventListener("input", render);
  phase.addEventListener("input", render);
  reset.addEventListener("click", () => {
    state.kx = 1;
    state.ky = 0;
    amplitude.value = "1";
    phase.value = "0";
    render();
  });
  render();
}

function initImageAnalysis() {
  const upload = document.getElementById("imageUpload");
  const filter = document.getElementById("imageFilter");
  const radius = document.getElementById("imageRadius");
  const radiusValue = document.getElementById("imageRadiusValue");
  const realCanvas = document.getElementById("imageRealCanvas");
  const ampCanvas = document.getElementById("imageAmpCanvas");
  const phaseCanvas = document.getElementById("imagePhaseCanvas");
  const state = { source: null, spectrum: null };
  const size = 64;

  function renderPlaceholder(canvas, label) {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#101722";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "18px Georgia";
    ctx.textAlign = "center";
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
  }

  function render() {
    radiusValue.textContent = Number(radius.value).toFixed(2);
    if (!state.source || !state.spectrum) {
      renderPlaceholder(realCanvas, "Choose an image");
      renderPlaceholder(ampCanvas, "Amplitude");
      renderPlaceholder(phaseCanvas, "Phase");
      return;
    }
    const filtered = filterSpectrum(state.spectrum, filter.value, Number(radius.value));
    const real = idft2D(filtered.real, filtered.imag, size);
    drawArrayToCanvas(realCanvas, real, size, size, "gray");
    drawArrayToCanvas(ampCanvas, amplitudeMap(filtered.real, filtered.imag, size), size, size, "viridis");
    drawArrayToCanvas(phaseCanvas, phaseMap(filtered.real, filtered.imag, size), size, size, "phase");
  }

  upload.addEventListener("change", () => {
    const [file] = upload.files || [];
    if (!file) return;
    const image = new Image();
    image.onload = () => {
      state.source = resampleImageToGrid(image, size);
      state.spectrum = dft2D(state.source, size);
      render();
    };
    image.src = URL.createObjectURL(file);
  });
  filter.addEventListener("change", render);
  radius.addEventListener("input", render);
  render();
}

function initCMBMode() {
  const ellScale = document.getElementById("cmbEllScale");
  const ellScaleValue = document.getElementById("cmbEllScaleValue");
  // const tilt = document.getElementById("cmbTilt");
  // const tiltValue = document.getElementById("cmbTiltValue");
  const regenerate = document.getElementById("cmbRegenerate");
  const realCanvas = document.getElementById("cmbRealCanvas");
  const ampCanvas = document.getElementById("cmbAmpCanvas");
  const phaseCanvas = document.getElementById("cmbPhaseCanvas");
  const spectrumCanvas = document.getElementById("cmbSpectrumCanvas");
  const size = 64;

  function renderError() {
    const ctx = spectrumCanvas.getContext("2d");
    ctx.fillStyle = "#101722";
    ctx.fillRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
    ctx.fillStyle = "#f5f1ea";
    ctx.font = "18px Georgia";
    ctx.fillText("Missing CMB spectrum data.", 24, 48);
  }

  function render() {
    if (!window.CMB_TEST_CLS) {
      renderError();
      return;
    }
    ellScaleValue.textContent = ellScale.value;
    //tiltValue.textContent = Number(tilt.value).toFixed(2);
    const ellPerPixel = Number(ellScale.value);
    const baseSpectrum = buildHermitianSpectrum(size, (k) => interpolateCls(k * ellPerPixel));
    const field = idft2D(baseSpectrum.real, baseSpectrum.imag, size);
    const displaySpectrum = applySpectralTilt(baseSpectrum, Number(1.));
    drawArrayToCanvas(realCanvas, field, size, size, "gray");
    drawArrayToCanvas(ampCanvas, amplitudeMap(displaySpectrum.real, displaySpectrum.imag, size), size, size, "viridis");
    drawArrayToCanvas(phaseCanvas, phaseMap(displaySpectrum.real, displaySpectrum.imag, size), size, size, "phase");

    const measured = azimuthalSpectrum(baseSpectrum, ellPerPixel);
    const theory = measured.map((bin) => ({ ell: bin.ell, power: interpolateCls(bin.ell) }));
    drawSpectrumChart(spectrumCanvas, theory, measured);
  }

  ellScale.addEventListener("input", render);
  //tilt.addEventListener("input", render);
  regenerate.addEventListener("click", render);
  render();
}

function initDrawMode() {
  const editor = new SpectrumEditor(document.getElementById("drawSpectrumCanvas"), {
    logX: true,
    logY: true,
  });
  const clear = document.getElementById("drawClear");
  const generate = document.getElementById("drawGenerate");
  const fieldCanvas = document.getElementById("drawFieldCanvas");
  const size = 64;

  function renderField() {
    const model = buildFieldFromSpectrumSamples(editor.getValues(), size, {
      xLog: true,
      kMin: SPECTRUM_CONFIG.kMin,
      kMax: SPECTRUM_CONFIG.kMax,
    });
    drawArrayToCanvas(fieldCanvas, model.field, size, size, "viridis");
  }

  clear.addEventListener("click", () => {
    editor.clear();
    renderField();
  });
  generate.addEventListener("click", renderField);
  renderField();
}

function initTestMode() {
  const hiddenSpectra = [
    { name: "White Noise", values: (n) => Array.from({ length: n }, () => 1) },
    { name: "Red Tilt", values: (n) => Array.from({ length: n }, (_, i) => Math.max(0.02, 1 - 0.9 * (i / (n - 1)))) },
    { name: "Blue Tilt", values: (n) => Array.from({ length: n }, (_, i) => 0.05 + 0.95 * (i / (n - 1))) },
    { name: "Narrow Peak", values: (n) => Array.from({ length: n }, (_, i) => Math.exp(-0.5 * (((i / (n - 1)) - 0.3) / 0.07) ** 2)) },
    { name: "Broad Peak", values: (n) => Array.from({ length: n }, (_, i) => Math.exp(-0.5 * (((i / (n - 1)) - 0.5) / 0.2) ** 2)) },
    {
      name: "Double Peak",
      values: (n) =>
        Array.from({ length: n }, (_, i) => {
          const x = i / (n - 1);
          return Math.min(1, 0.9 * Math.exp(-0.5 * ((x - 0.2) / 0.06) ** 2) + 0.7 * Math.exp(-0.5 * ((x - 0.65) / 0.08) ** 2));
        }),
    },
  ];

  const challengeName = document.getElementById("testChallengeName");
  const scoreBox = document.getElementById("testScoreBox");
  const targetCanvas = document.getElementById("testTargetCanvas");
  const userCanvas = document.getElementById("testUserCanvas");
  const newChallenge = document.getElementById("testNewChallenge");
  const generateUser = document.getElementById("testGenerateUser");
  const scoreButton = document.getElementById("testScore");
  const size = 64;
  const state = { hidden: null, revealed: false };

  const editor = new SpectrumEditor(document.getElementById("testSpectrumCanvas"), {
    logX: true,
    logY: true,
    overlayProvider: () => (state.hidden && state.revealed ? state.hidden.values(editor.values.length) : null),
  });

  function renderPlaceholder(canvas, label) {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#101722";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "17px Georgia";
    ctx.textAlign = "center";
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
  }

  function computeScore(userValues, hiddenValues) {
    let sumSq = 0;
    for (let i = 0; i < userValues.length; i += 1) {
      const a = Math.log10(Math.max(userValues[i], 1e-6));
      const b = Math.log10(Math.max(hiddenValues[i], 1e-6));
      sumSq += (a - b) ** 2;
    }
    const rmse = Math.sqrt(sumSq / userValues.length);
    return clamp(100 * (1 - rmse / 3), 0, 100);
  }

  function startChallenge() {
    state.hidden = hiddenSpectra[Math.floor(Math.random() * hiddenSpectra.length)];
    state.revealed = false;
    editor.clear();
    const hiddenValues = state.hidden.values(editor.values.length);
    const targetModel = buildFieldFromSpectrumSamples(hiddenValues, size, {
      xLog: true,
      kMin: SPECTRUM_CONFIG.kMin,
      kMax: SPECTRUM_CONFIG.kMax,
    });
    drawArrayToCanvas(targetCanvas, targetModel.field, size, size, "viridis");
    renderPlaceholder(userCanvas, "Generate your guess");
    challengeName.textContent = `Challenge: ${state.hidden.name}. This editor uses logarithmic k and P(k) axes.`;
    scoreBox.textContent = "Draw your best guess, generate your field, then score it.";
    editor.draw();
  }

  newChallenge.addEventListener("click", startChallenge);
  generateUser.addEventListener("click", () => {
    const userModel = buildFieldFromSpectrumSamples(editor.getValues(), size, {
      xLog: true,
      kMin: SPECTRUM_CONFIG.kMin,
      kMax: SPECTRUM_CONFIG.kMax,
    });
    drawArrayToCanvas(userCanvas, userModel.field, size, size, "viridis");
  });
  scoreButton.addEventListener("click", () => {
    if (!state.hidden) return;
    const hiddenValues = state.hidden.values(editor.values.length);
    const score = computeScore(editor.getValues(), hiddenValues);
    state.revealed = true;
    editor.draw();
    scoreBox.textContent = `Score: ${score.toFixed(1)} / 100`;
  });

  renderPlaceholder(targetCanvas, "Awaiting challenge");
  renderPlaceholder(userCanvas, "Awaiting challenge");
}

document.addEventListener("DOMContentLoaded", () => {
  initSingleMode();
  initImageAnalysis();
  initCMBMode();
  initDrawMode();
  initTestMode();
});
