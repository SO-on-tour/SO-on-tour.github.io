(() => {
const SOUND_BIN_COUNT = 36;

function soundClamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(Math.round(canvas.clientWidth * ratio), 320);
  const height = Math.max(Math.round(canvas.clientHeight * ratio), 220);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function drawSpectrumChart(canvas, values, options = {}) {
  const ctx = canvas.getContext("2d");
  resizeCanvas(canvas);
  const width = canvas.width;
  const height = canvas.height;
  const padding = { top: 24, right: 20, bottom: 74, left: 72 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = options.maxValue ?? 1;
  const barColor = options.barColor ?? "#5dd4c2";
  const highlightIndex = options.highlightIndex ?? -1;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#111821";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (plotHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();

  const step = plotWidth / values.length;
  const barWidth = step * 0.72;

  values.forEach((value, index) => {
    const barHeight = (soundClamp(value, 0, maxValue) / maxValue) * plotHeight;
    const x = padding.left + (index * step) + ((step - barWidth) / 2);
    const y = height - padding.bottom - barHeight;
    ctx.fillStyle = index === highlightIndex ? "#f3a24f" : barColor;
    ctx.fillRect(x, y, barWidth, Math.max(barHeight, 2));
  });

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "20px Georgia";
  ctx.textAlign = "center";
  ctx.fillText(options.xLabel ?? "Frequency", padding.left + (plotWidth / 2), height - 18);

  ctx.save();
  ctx.translate(18, padding.top + (plotHeight / 2));
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText(options.yLabel ?? "Amplitude", 0, 0);
  ctx.restore();

  ctx.font = "18px Georgia";
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.textAlign = "center";
  const axisTicks = options.axisTicks ?? [];
  axisTicks.forEach((tick) => {
    const x = padding.left + (soundClamp(tick.position, 0, 1) * plotWidth);
    ctx.fillText(tick.label, x, height - padding.bottom + 24);
  });
}

function createLogFrequencyBins(binCount, minFrequency, maxFrequency) {
  const edges = [];
  const logMin = Math.log10(minFrequency);
  const logMax = Math.log10(maxFrequency);
  for (let i = 0; i <= binCount; i += 1) {
    const t = i / binCount;
    edges.push(10 ** (logMin + ((logMax - logMin) * t)));
  }
  return edges;
}

function setupPitchDemo() {
  const canvas = document.getElementById("sound-pitch-canvas");
  const frequencyInput = document.getElementById("sound-pitch-frequency");
  const frequencyOutput = document.getElementById("sound-pitch-frequency-output");
  const volumeInput = document.getElementById("sound-pitch-volume");
  const volumeOutput = document.getElementById("sound-pitch-volume-output");
  const playButton = document.getElementById("sound-pitch-play");
  const status = document.getElementById("sound-pitch-status");

  if (!canvas || !frequencyInput || !frequencyOutput || !volumeInput || !volumeOutput || !playButton || !status) {
    return;
  }

  let audioContext;
  let previewTimer;

  const getValues = () => {
    const frequency = Number(frequencyInput.value);
    const volume = Number(volumeInput.value) / 100;
    return { frequency, volume };
  };

  const getBinIndex = (frequency) => {
    const normalized = (frequency - 120) / (1200 - 120);
    return soundClamp(Math.round(normalized * (SOUND_BIN_COUNT - 1)), 0, SOUND_BIN_COUNT - 1);
  };

  const buildBars = (frequency, volume) => {
    const values = new Array(SOUND_BIN_COUNT).fill(0.05);
    values[getBinIndex(frequency)] = Math.max(volume, 0.08);
    return values;
  };

  const playTone = async (frequency, volume, duration = 0.35) => {
    audioContext = audioContext || new window.AudioContext();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.001), now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  };

  const render = () => {
    const { frequency, volume } = getValues();
    frequencyOutput.textContent = `${Math.round(frequency)} Hz`;
    volumeOutput.textContent = `${Math.round(volume * 100)}%`;
    const highlightIndex = getBinIndex(frequency);
    drawSpectrumChart(canvas, buildBars(frequency, volume), {
      maxValue: 1,
      barColor: "#3bb8c3",
      highlightIndex,
      xLabel: "Pitch / Frequency",
      yLabel: "Volume / Amplitude",
      axisTicks: [
        { label: "Low", position: 0 },
        { label: "Mid", position: 0.5 },
        { label: "High", position: 1 },
      ],
    });
    status.textContent = `The highlighted bar shows a tone near ${Math.round(frequency)} Hz with ${Math.round(volume * 100)}% volume.`;
  };

  const schedulePreview = () => {
    const { frequency, volume } = getValues();
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      playTone(frequency, volume).catch(() => {
        status.textContent = "Your browser blocked audio autoplay. Press Play tone to hear the sound.";
      });
    }, 60);
  };

  frequencyInput.addEventListener("input", () => {
    render();
    schedulePreview();
  });

  volumeInput.addEventListener("input", () => {
    render();
    schedulePreview();
  });

  playButton.addEventListener("click", () => {
    const { frequency, volume } = getValues();
    playTone(frequency, volume).catch(() => {
      status.textContent = "Audio could not start in this browser.";
    });
  });

  window.addEventListener("resize", render);
  render();
}

function setupMicrophoneDemo() {
  const canvas = document.getElementById("sound-mic-canvas");
  const toggleButton = document.getElementById("sound-mic-toggle");
  const status = document.getElementById("sound-mic-status");

  if (!canvas || !toggleButton || !status) {
    return;
  }

  let audioContext = null;
  let analyser = null;
  let source = null;
  let stream = null;
  let animationFrame = null;
  let running = false;
  const microphoneRange = { min: 80, max: 4000 };
  const logBinEdges = createLogFrequencyBins(
    SOUND_BIN_COUNT,
    microphoneRange.min,
    microphoneRange.max,
  );
  const microphoneTicks = [
    { label: "80", position: 0 },
    { label: "200", position: (Math.log10(200) - Math.log10(microphoneRange.min)) / (Math.log10(microphoneRange.max) - Math.log10(microphoneRange.min)) },
    { label: "500", position: (Math.log10(500) - Math.log10(microphoneRange.min)) / (Math.log10(microphoneRange.max) - Math.log10(microphoneRange.min)) },
    { label: "1k", position: (Math.log10(1000) - Math.log10(microphoneRange.min)) / (Math.log10(microphoneRange.max) - Math.log10(microphoneRange.min)) },
    { label: "2k", position: (Math.log10(2000) - Math.log10(microphoneRange.min)) / (Math.log10(microphoneRange.max) - Math.log10(microphoneRange.min)) },
    { label: "4k", position: 1 },
  ];

  const idleBars = new Array(SOUND_BIN_COUNT).fill(0.06);
  const renderIdle = () => {
    drawSpectrumChart(canvas, idleBars, {
      maxValue: 1,
      barColor: "#ef7d57",
      xLabel: "Detected Frequency",
      yLabel: "Measured Amplitude",
      axisTicks: microphoneTicks,
    });
  };
  renderIdle();

  const stop = () => {
    running = false;
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    if (source) {
      source.disconnect();
      source = null;
    }
    if (analyser) {
      analyser.disconnect();
      analyser = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    toggleButton.textContent = "Start listening";
    status.textContent = "Microphone analysis stopped.";
    renderIdle();
  };

  const render = () => {
    if (!running || !analyser) {
      return;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const bars = new Array(SOUND_BIN_COUNT).fill(0);
    const nyquist = audioContext.sampleRate / 2;

    for (let i = 0; i < SOUND_BIN_COUNT; i += 1) {
      let sum = 0;
      const startFrequency = logBinEdges[i];
      const endFrequency = logBinEdges[i + 1];
      const start = Math.max(0, Math.floor((startFrequency / nyquist) * data.length));
      const end = Math.max(start + 1, Math.min(data.length, Math.ceil((endFrequency / nyquist) * data.length)));
      for (let j = start; j < end; j += 1) {
        sum += data[j];
      }
      bars[i] = (sum / Math.max(end - start, 1)) / 255;
    }

    drawSpectrumChart(canvas, bars, {
      maxValue: 1,
      barColor: "#ef7d57",
      xLabel: "Detected Frequency",
      yLabel: "Measured Amplitude",
      axisTicks: microphoneTicks,
    });
    animationFrame = requestAnimationFrame(render);
  };

  const start = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status.textContent = "Microphone access is not supported in this browser.";
      return;
    }

    try {
      audioContext = audioContext || new window.AudioContext();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      running = true;
      toggleButton.textContent = "Stop listening";
      status.textContent = "Listening now. Try speaking, humming, or whistling into the microphone.";
      render();
    } catch (error) {
      status.textContent = "Microphone access was denied or could not be started.";
    }
  };

  toggleButton.addEventListener("click", () => {
    if (running) {
      stop();
    } else {
      start();
    }
  });

  window.addEventListener("resize", () => {
    if (running) {
      render();
    } else {
      renderIdle();
    }
  });

  window.addEventListener("beforeunload", stop);
}

document.addEventListener("DOMContentLoaded", () => {
  setupPitchDemo();
  setupMicrophoneDemo();
});
})();
