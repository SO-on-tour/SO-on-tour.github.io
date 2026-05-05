const MappingScanDemo = (() => {
  const DATA_SIZE = 96;
  const TOD_SAMPLES = 1024;
  const SAMPLE_DT = 0.02;
  const CG_ITERATIONS = 18;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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

  function drawArrayToCanvas(canvas, values, width, height, options = {}) {
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
      const [r, g, b] = createViridisColor(t);
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

  function drawImageToCanvas(canvas, image) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(8, 11, 18, 0.16)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function coarseGridSizeForResolution(resolution) {
    const factor = 1 + Math.floor((10 - resolution) / 3);
    if (factor <= 1) return DATA_SIZE;
    if (factor === 2) return 48;
    if (factor === 3) return 32;
    return 24;
  }

  function rebinField(values, sourceSize, targetSize) {
    if (targetSize === sourceSize) {
      return Float32Array.from(values);
    }

    const rebinned = new Float32Array(targetSize * targetSize);
    for (let ty = 0; ty < targetSize; ty += 1) {
      const yStart = Math.floor((ty * sourceSize) / targetSize);
      const yEnd = Math.max(yStart + 1, Math.floor(((ty + 1) * sourceSize) / targetSize));
      for (let tx = 0; tx < targetSize; tx += 1) {
        const xStart = Math.floor((tx * sourceSize) / targetSize);
        const xEnd = Math.max(xStart + 1, Math.floor(((tx + 1) * sourceSize) / targetSize));
        let total = 0;
        let count = 0;
        for (let y = yStart; y < yEnd; y += 1) {
          for (let x = xStart; x < xEnd; x += 1) {
            total += values[y * sourceSize + x];
            count += 1;
          }
        }
        rebinned[ty * targetSize + tx] = total / Math.max(count, 1);
      }
    }
    return rebinned;
  }

  function blurField(values, size, passes) {
    let current = new Float32Array(values);

    for (let pass = 0; pass < passes; pass += 1) {
      const next = new Float32Array(values.length);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          let total = 0;
          let count = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            const ny = y + dy;
            if (ny < 0 || ny >= size) continue;
            for (let dx = -1; dx <= 1; dx += 1) {
              const nx = x + dx;
              if (nx < 0 || nx >= size) continue;
              total += current[ny * size + nx];
              count += 1;
            }
          }
          next[y * size + x] = total / count;
        }
      }
      current = next;
    }

    return current;
  }

  function buildSkyFromImage(image, size, resolution) {
    const scratch = document.createElement("canvas");
    scratch.width = size;
    scratch.height = size;
    const ctx = scratch.getContext("2d");
    ctx.drawImage(image, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    const values = new Float32Array(size * size);

    for (let i = 0; i < size * size; i += 1) {
      values[i] = data[(i * 4) + 1] / 255;
    }

    const blurPasses = Math.round(10 - resolution);
    const smoothed = blurPasses > 0 ? blurField(values, size, blurPasses) : values;
    let mean = 0;
    for (const value of smoothed) mean += value;
    mean /= smoothed.length;

    let maxAbs = 0;
    for (let i = 0; i < smoothed.length; i += 1) {
      smoothed[i] -= mean;
      maxAbs = Math.max(maxAbs, Math.abs(smoothed[i]));
    }

    const scale = maxAbs || 1;
    for (let i = 0; i < smoothed.length; i += 1) {
      smoothed[i] /= scale;
    }

    return smoothed;
  }

  function fft(real, imag, inverse = false) {
    const n = real.length;
    let j = 0;
    for (let i = 1; i < n; i += 1) {
      let bit = n >> 1;
      while (j & bit) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }

    for (let len = 2; len <= n; len <<= 1) {
      const angle = (inverse ? 2 : -2) * Math.PI / len;
      const wlenCos = Math.cos(angle);
      const wlenSin = Math.sin(angle);
      for (let i = 0; i < n; i += len) {
        let wCos = 1;
        let wSin = 0;
        for (let k = 0; k < len / 2; k += 1) {
          const uReal = real[i + k];
          const uImag = imag[i + k];
          const vIndex = i + k + (len / 2);
          const vReal = (real[vIndex] * wCos) - (imag[vIndex] * wSin);
          const vImag = (real[vIndex] * wSin) + (imag[vIndex] * wCos);

          real[i + k] = uReal + vReal;
          imag[i + k] = uImag + vImag;
          real[vIndex] = uReal - vReal;
          imag[vIndex] = uImag - vImag;

          const nextCos = (wCos * wlenCos) - (wSin * wlenSin);
          const nextSin = (wCos * wlenSin) + (wSin * wlenCos);
          wCos = nextCos;
          wSin = nextSin;
        }
      }
    }

    if (inverse) {
      for (let i = 0; i < n; i += 1) {
        real[i] /= n;
        imag[i] /= n;
      }
    }
  }

  function simNoiseSpec(nsamp, dt, fknee, alpha, sigma) {
    const spec = new Float32Array(nsamp);
    for (let i = 0; i < nsamp; i += 1) {
      let freq = i <= nsamp / 2 ? i / (nsamp * dt) : (nsamp - i) / (nsamp * dt);
      if (i === 0) freq = 1 / (nsamp * dt);
      spec[i] = (1 + (Math.max(freq, 1 / (nsamp * dt)) / fknee) ** (-alpha)) * sigma * sigma/100;
    }
    return spec;
  }

  function bilinearSample(map, size, y, x) {
    const clampedX = clamp(x, 0, size - 1);
    const clampedY = clamp(y, 0, size - 1);
    const x0 = Math.floor(clampedX);
    const y0 = Math.floor(clampedY);
    const x1 = Math.min(x0 + 1, size - 1);
    const y1 = Math.min(y0 + 1, size - 1);
    const tx = clampedX - x0;
    const ty = clampedY - y0;

    const v00 = map[y0 * size + x0];
    const v10 = map[y0 * size + x1];
    const v01 = map[y1 * size + x0];
    const v11 = map[y1 * size + x1];

    return (
      v00 * (1 - tx) * (1 - ty) +
      v10 * tx * (1 - ty) +
      v01 * (1 - tx) * ty +
      v11 * tx * ty
    );
  }

  function buildFootprint(radius) {
    const offsets = [];
    const pixelRadius = Math.max(0, Math.round(radius));
    for (let dy = -pixelRadius; dy <= pixelRadius; dy += 1) {
      for (let dx = -pixelRadius; dx <= pixelRadius; dx += 1) {
        if ((dx * dx) + (dy * dy) > pixelRadius * pixelRadius) continue;
        offsets.push({ dx, dy });
      }
    }
    if (offsets.length === 0) offsets.push({ dx: 0, dy: 0 });
    return offsets;
  }

  function offsetPointing(points, offset, size) {
    return points.map((point) => ({
      x: clamp(point.x + offset.dx, 0, size - 1),
      y: clamp(point.y + offset.dy, 0, size - 1),
    }));
  }

  function observeMap(map, points, size) {
    const tod = new Float32Array(points.length);
    for (let i = 0; i < points.length; i += 1) {
      tod[i] = bilinearSample(map, size, points[i].y, points[i].x);
    }
    return tod;
  }

  function simTod(map, points, size, noiseSpec) {
    const signal = observeMap(map, points, size);
    const real = new Float32Array(signal.length);
    const imag = new Float32Array(signal.length);
    for (let i = 0; i < signal.length; i += 1) {
      real[i] = gaussianRandom();
    }
    fft(real, imag, false);
    for (let i = 0; i < signal.length; i += 1) {
      const scale = Math.sqrt(noiseSpec[i]);
      real[i] *= scale;
      imag[i] *= scale;
    }
    fft(real, imag, true);
    for (let i = 0; i < signal.length; i += 1) {
      signal[i] += real[i];
    }
    return signal;
  }

  function mulInvNoise(tod, noiseSpec) {
    const real = new Float32Array(tod);
    const imag = new Float32Array(tod.length);
    fft(real, imag, false);
    for (let i = 0; i < tod.length; i += 1) {
      const inv = 1 / Math.max(noiseSpec[i], 1e-6);
      real[i] *= inv;
      imag[i] *= inv;
    }
    fft(real, imag, true);
    return real;
  }

  function transposePointing(tod, points, size) {
    const map = new Float32Array(size * size);
    for (let i = 0; i < points.length; i += 1) {
      const x = clamp(Math.round(points[i].x), 0, size - 1);
      const y = clamp(Math.round(points[i].y), 0, size - 1);
      map[y * size + x] += tod[i];
    }
    return map;
  }

  function solveBinnedAverage(dataset, size) {
    const rhs = new Float32Array(size * size);
    const hits = new Float32Array(size * size);

    dataset.forEach((data) => {
      const projected = transposePointing(data.tod, data.point, size);
      const ones = transposePointing(
        new Float32Array(data.point.length).fill(1),
        data.point,
        size
      );
      for (let i = 0; i < rhs.length; i += 1) {
        rhs[i] += projected[i];
        hits[i] += ones[i];
      }
    });

    const result = new Float32Array(size * size);
    for (let i = 0; i < result.length; i += 1) {
      result[i] = hits[i] > 0 ? rhs[i] / hits[i] : 0;
    }

    return { map: result, hits };
  }

  function dot(a, b) {
    let total = 0;
    for (let i = 0; i < a.length; i += 1) total += a[i] * b[i];
    return total;
  }

  async function solveFull(dataset, size, niter, onIteration) {
    const pixelCount = size * size;
    const b = new Float32Array(pixelCount);

    dataset.forEach((data) => {
      const weightedTod = mulInvNoise(data.tod, data.noise_spec);
      const pt = transposePointing(weightedTod, data.point, size);
      for (let i = 0; i < pixelCount; i += 1) b[i] += pt[i];
    });

    const applyA = (x) => {
      const result = new Float32Array(pixelCount);
      dataset.forEach((data) => {
        const tod = observeMap(x, data.point, size);
        const weighted = mulInvNoise(tod, data.noise_spec);
        const pt = transposePointing(weighted, data.point, size);
        for (let i = 0; i < pixelCount; i += 1) result[i] += pt[i];
      });
      return result;
    };

    const x = new Float32Array(pixelCount);
    const r = new Float32Array(b);
    const p = new Float32Array(r);
    const rz0 = dot(r, r) || 1;
    let rz = rz0;

    for (let iter = 0; iter < niter; iter += 1) {
      const ap = applyA(p);
      const denom = dot(p, ap);
      if (!Number.isFinite(denom) || Math.abs(denom) < 1e-20 || !Number.isFinite(rz)) break;
      const alpha = rz / denom;
      if (!Number.isFinite(alpha)) break;
      for (let i = 0; i < pixelCount; i += 1) {
        x[i] += alpha * p[i];
        r[i] -= alpha * ap[i];
      }

      const nextRz = dot(r, r);
      if (!Number.isFinite(nextRz)) break;
      const err = nextRz / rz0;
      if (onIteration) onIteration(iter + 1, err);
      if (err < 1e-6) break;

      const beta = nextRz / Math.max(rz, 1e-12);
      if (!Number.isFinite(beta)) break;
      for (let i = 0; i < pixelCount; i += 1) {
        p[i] = r[i] + (beta * p[i]);
      }
      rz = nextRz;

      if ((iter + 1) % 2 === 0) {
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
      }
    }

    return x;
  }

  function resampleDrawnPath(path, count, size) {
    if (path.length < 2) return [];

    const cumulative = [0];
    let totalLength = 0;
    for (let i = 1; i < path.length; i += 1) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      totalLength += Math.hypot(dx, dy);
      cumulative.push(totalLength);
    }

    if (totalLength === 0) return [];

    const result = [];
    for (let i = 0; i < count; i += 1) {
      const target = (i / (count - 1)) * totalLength;
      let hi = 1;
      while (hi < cumulative.length && cumulative[hi] < target) hi += 1;
      const lo = Math.max(0, hi - 1);
      const span = cumulative[hi] - cumulative[lo] || 1;
      const t = (target - cumulative[lo]) / span;
      const a = path[lo];
      const b = path[Math.min(hi, path.length - 1)];
      result.push({
        x: clamp((a.x + ((b.x - a.x) * t)) * (size - 1), 0, size - 1),
        y: clamp((a.y + ((b.y - a.y) * t)) * (size - 1), 0, size - 1),
      });
    }

    return result;
  }

  function buildDataset(map, points, size, options) {
    const dataset = [];
    const detectorOffsets = buildFootprint(options.focalPlaneRadius);
    const baseNoiseSpec = simNoiseSpec(points.length, SAMPLE_DT, options.fknee, options.alpha, options.sigma);
    for (let i = 0; i < options.repeats; i += 1) {
      const direction = i % 2 === 0 ? points : [...points].reverse();
      detectorOffsets.forEach((offset) => {
        const detectorPointing = offsetPointing(direction, offset, size);
        dataset.push({
          tod: simTod(map, detectorPointing, size, baseNoiseSpec),
          point: detectorPointing,
          noise_spec: new Float32Array(baseNoiseSpec),
          detector_offset: offset,
        });
      });
    }
    return dataset;
  }

  function drawTodChart(canvas, values) {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const left = 36;
    const right = 14;
    const top = 18;
    const bottom = 28;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#101722";
    ctx.fillRect(0, 0, width, height);

    let min = Infinity;
    let max = -Infinity;
    values.forEach((value) => {
      min = Math.min(min, value);
      max = Math.max(max, value);
    });
    const range = max - min || 1;
    const toX = (index) => left + (index / (values.length - 1)) * chartWidth;
    const toY = (value) => top + (1 - ((value - min) / range)) * chartHeight;

    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (i / 4) * chartHeight;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(width - right, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "#4fe3ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = toX(index);
      const y = toY(value);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "13px Georgia";
    ctx.fillText("TOD sample", width - 90, height - 8);
    ctx.fillText("Signal + noise", left, 14);
  }

  class ScanCanvasController {
    constructor(canvas, image) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.image = image;
      this.path = [];
      this.isDrawing = false;
      this.lastPoint = null;
      this.focalPlaneRadius = 0;
      this.resolutionMarkerScale = 0;

      canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
      canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
      canvas.addEventListener("pointerleave", () => this.onPointerUp());
      window.addEventListener("pointerup", () => this.onPointerUp());
      this.draw();
    }

    eventToPoint(event) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
        y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
      };
    }

    appendPoint(point) {
      if (!this.lastPoint) {
        this.path.push(point);
        this.lastPoint = point;
        return;
      }

      const dx = point.x - this.lastPoint.x;
      const dy = point.y - this.lastPoint.y;
      const distance = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(distance * DATA_SIZE * 1.5));
      for (let i = 1; i <= steps; i += 1) {
        this.path.push({
          x: this.lastPoint.x + ((dx * i) / steps),
          y: this.lastPoint.y + ((dy * i) / steps),
        });
      }
      this.lastPoint = point;
    }

    onPointerDown(event) {
      event.preventDefault();
      this.isDrawing = true;
      this.lastPoint = null;
      this.appendPoint(this.eventToPoint(event));
      this.draw();
    }

    onPointerMove(event) {
      if (!this.isDrawing) return;
      this.appendPoint(this.eventToPoint(event));
      this.draw();
    }

    onPointerUp() {
      this.isDrawing = false;
      this.lastPoint = null;
    }

    clear() {
      this.path = [];
      this.lastPoint = null;
      this.draw();
    }

    setExamplePath() {
      this.path = [];
      const points = [];
      for (let i = 0; i <= 220; i += 1) {
        const t = i / 220;
        points.push({
          x: 0.1 + (0.8 * t),
          y: 0.22 + (0.56 * (0.5 + (0.45 * Math.sin(t * Math.PI * 6)))),
        });
      }
      this.path = points;
      this.draw();
    }

    setFocalPlaneRadius(radius) {
      this.focalPlaneRadius = radius;
      this.draw();
    }

    setResolutionMarkerScale(scale) {
      this.resolutionMarkerScale = scale;
      this.draw();
    }

    draw() {
      const { ctx, canvas } = this;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(this.image, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(8, 11, 18, 0.22)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 1;
      const step = canvas.width / 8;
      for (let i = 1; i < 8; i += 1) {
        ctx.beginPath();
        ctx.moveTo(i * step, 0);
        ctx.lineTo(i * step, canvas.height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * step);
        ctx.lineTo(canvas.width, i * step);
        ctx.stroke();
      }

      if (this.path.length > 1) {
        const strokeWidth = 4 + (this.focalPlaneRadius * 4) + this.resolutionMarkerScale;
        if (this.focalPlaneRadius > 0) {
          ctx.strokeStyle = "rgba(255, 179, 107, 0.18)";
          ctx.lineWidth = strokeWidth + 10;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.beginPath();
          this.path.forEach((point, index) => {
            const x = point.x * canvas.width;
            const y = point.y * canvas.height;
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        }

        ctx.strokeStyle = "#ffb36b";
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        this.path.forEach((point, index) => {
          const x = point.x * canvas.width;
          const y = point.y * canvas.height;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        const start = this.path[0];
        const end = this.path[this.path.length - 1];
        ctx.fillStyle = "#68f0b5";
        ctx.beginPath();
        ctx.arc(
          start.x * canvas.width,
          start.y * canvas.height,
          6 + (this.focalPlaneRadius * 2) + this.resolutionMarkerScale,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.fillStyle = "#ff5d73";
        ctx.beginPath();
        ctx.arc(
          end.x * canvas.width,
          end.y * canvas.height,
          6 + (this.focalPlaneRadius * 2) + this.resolutionMarkerScale,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }
  }

  function setOutputText(input, output, formatter = (value) => value) {
    const update = () => {
      output.textContent = formatter(input.value);
    };
    input.addEventListener("input", update);
    update();
  }

  async function init() {
    const scanCanvas = document.getElementById("mapping-demo-scan-canvas");
    if (!scanCanvas) return;

    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = window.SO_LOGO_DATA_URI || "data/SO_Logo_final_no_text.png";
    });

    const scanController = new ScanCanvasController(scanCanvas, image);

    const status = document.getElementById("mapping-demo-status");
    const methodInput = document.getElementById("mapping-demo-method");
    const mapTitle = document.getElementById("mapping-demo-map-title");
    const resolutionInput = document.getElementById("mapping-demo-resolution");
    const focalPlaneInput = document.getElementById("mapping-demo-focal-plane");
    const repeatsInput = document.getElementById("mapping-demo-repeats");
    const sigmaInput = document.getElementById("mapping-demo-sigma");
    const fkneeInput = document.getElementById("mapping-demo-fknee");
    const alphaInput = document.getElementById("mapping-demo-alpha");
    let sky = null;
    let latestResults = null;
    let displayGridSize = DATA_SIZE;

    const drawDisplayField = (canvasId, values, options = {}) => {
      const rebinned = rebinField(values, DATA_SIZE, displayGridSize);
      drawArrayToCanvas(document.getElementById(canvasId), rebinned, displayGridSize, displayGridSize, options);
    };

    const renderSelectedMap = () => {
      const outputCanvas = document.getElementById("mapping-demo-map");
      if (!outputCanvas) return;

      mapTitle.textContent = methodInput.value === "ml"
        ? "Maximum-likelihood map"
        : "Filter-bin / binned map";

      if (!latestResults) {
        drawArrayToCanvas(outputCanvas, new Float32Array(displayGridSize * displayGridSize), displayGridSize, displayGridSize, {
          min: -1,
          max: 1,
        });
        return;
      }

      const map = methodInput.value === "ml"
        ? latestResults.full
        : latestResults.binned.map;

      if (!map) {
        drawArrayToCanvas(outputCanvas, new Float32Array(displayGridSize * displayGridSize), displayGridSize, displayGridSize, {
          min: -1,
          max: 1,
        });
        return;
      }

      const rebinned = rebinField(map, DATA_SIZE, displayGridSize);
      drawArrayToCanvas(outputCanvas, rebinned, displayGridSize, displayGridSize, {
        min: -1,
        max: 1,
      });
    };

    const rebuildSky = () => {
      displayGridSize = coarseGridSizeForResolution(Number(resolutionInput.value));
      sky = buildSkyFromImage(image, DATA_SIZE, Number(resolutionInput.value));
      scanController.setResolutionMarkerScale(Math.max(0, ((DATA_SIZE / displayGridSize) - 1) * 4));
      drawDisplayField("mapping-demo-sky", sky, {
        min: -1,
        max: 1,
      });
      latestResults = null;
      renderSelectedMap();
      drawArrayToCanvas(document.getElementById("mapping-demo-hits"), new Float32Array(displayGridSize * displayGridSize), displayGridSize, displayGridSize);
      drawTodChart(document.getElementById("mapping-demo-tod"), new Float32Array(TOD_SAMPLES));
    };

    setOutputText(
      resolutionInput,
      document.getElementById("mapping-demo-resolution-output"),
      (value) => value
    );
    setOutputText(
      focalPlaneInput,
      document.getElementById("mapping-demo-focal-plane-output"),
      (value) => value
    );
    setOutputText(repeatsInput, document.getElementById("mapping-demo-repeats-output"));
    setOutputText(sigmaInput, document.getElementById("mapping-demo-sigma-output"));
    setOutputText(fkneeInput, document.getElementById("mapping-demo-fknee-output"), (value) => Number(value).toFixed(2));
    setOutputText(alphaInput, document.getElementById("mapping-demo-alpha-output"), (value) => Number(value).toFixed(2));

    rebuildSky();

    drawArrayToCanvas(
      document.getElementById("mapping-demo-hits"),
      new Float32Array(displayGridSize * displayGridSize),
      displayGridSize,
      displayGridSize
    );
    renderSelectedMap();
    drawTodChart(document.getElementById("mapping-demo-tod"), new Float32Array(TOD_SAMPLES));

    methodInput.addEventListener("input", () => {
      renderSelectedMap();
      if (!latestResults) return;
      if (methodInput.value === "ml" && !latestResults.full) {
        status.textContent = "Maximum-likelihood has not been computed for the current settings. Generate the map with ML selected.";
        return;
      }
      status.textContent = methodInput.value === "ml"
        ? "Showing the maximum-likelihood reconstruction."
        : "Showing the filter-bin / binned reconstruction.";
    });

    resolutionInput.addEventListener("input", () => {
      rebuildSky();
      status.textContent = "Updated the telescope resolution. Higher resolution means less beam blurring.";
    });

    focalPlaneInput.addEventListener("input", () => {
      scanController.setFocalPlaneRadius(Number(focalPlaneInput.value));
      latestResults = null;
      renderSelectedMap();
      drawArrayToCanvas(document.getElementById("mapping-demo-hits"), new Float32Array(displayGridSize * displayGridSize), displayGridSize, displayGridSize);
      drawTodChart(document.getElementById("mapping-demo-tod"), new Float32Array(TOD_SAMPLES));
      status.textContent = "Updated the focal plane size. Larger values add offset detectors, creating more pointings and a wider scan marker.";
    });

    document.getElementById("mapping-demo-clear").addEventListener("click", () => {
      scanController.clear();
      latestResults = null;
      renderSelectedMap();
      status.textContent = "Path cleared. Draw a new scan pattern.";
    });

    document.getElementById("mapping-demo-example").addEventListener("click", () => {
      scanController.setExamplePath();
      status.textContent = "Example scan loaded. Generate a map to see how coverage changes the reconstruction.";
    });

    document.getElementById("mapping-demo-run").addEventListener("click", async () => {
      if (scanController.path.length < 2) {
        status.textContent = "Draw at least a short scan path before generating a map.";
        return;
      }

      const sampledPath = resampleDrawnPath(scanController.path, TOD_SAMPLES, DATA_SIZE);
      if (sampledPath.length < 2) {
        status.textContent = "The drawn path is too short to sample. Try a longer stroke.";
        return;
      }

      const options = {
        repeats: Number(repeatsInput.value),
        sigma: Number(sigmaInput.value),
        fknee: Number(fkneeInput.value),
        alpha: Number(alphaInput.value),
        focalPlaneRadius: Number(focalPlaneInput.value),
      };

      status.textContent = "Building noisy time streams from the drawn scan.";
      const dataset = buildDataset(sky, sampledPath, DATA_SIZE, options);
      const binned = solveBinnedAverage(dataset, DATA_SIZE);
      drawDisplayField("mapping-demo-hits", binned.hits);
      drawTodChart(document.getElementById("mapping-demo-tod"), dataset[0].tod);

      let full = null;
      if (methodInput.value === "ml") {
        status.textContent = "Running conjugate-gradient mapmaking with inverse-noise weighting.";
        full = await solveFull(dataset, DATA_SIZE, CG_ITERATIONS, (iteration, err) => {
          if (!Number.isFinite(err)) {
            status.textContent = `Running conjugate-gradient mapmaking: iteration ${iteration}/${CG_ITERATIONS}, relative error unavailable.`;
            return;
          }
          status.textContent = `Running conjugate-gradient mapmaking: iteration ${iteration}/${CG_ITERATIONS}, relative error ${err.toExponential(2)}.`;
        });
      }

      latestResults = { binned, full };
      renderSelectedMap();
      status.textContent = methodInput.value === "ml"
        ? "Done. The maximum-likelihood reconstruction is shown."
        : "Done. The filter-bin / binned reconstruction is shown.";
    });

    scanController.setExamplePath();
    scanController.setFocalPlaneRadius(Number(focalPlaneInput.value));
    status.textContent = "Example scan loaded. Edit the path or generate a map.";
  }

  return { init };
})();

window.addEventListener("DOMContentLoaded", () => {
  MappingScanDemo.init().catch((error) => {
    const status = document.getElementById("mapping-demo-status");
    if (status) status.textContent = `The interactive demo failed to load: ${error.message}`;
  });
});
