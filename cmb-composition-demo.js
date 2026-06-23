document.addEventListener("DOMContentLoaded", () => {
  const video = document.getElementById("composition-demo-video");
  const status = document.getElementById("composition-status");

  if (!video || !status) {
    return;
  }

  const selection = {
    ombh2: 1,
    omch2: 1,
    neff: 1,
  };

  const values = {
    ombh2: ["0.00224", "0.0224", "0.8"],
    omch2: ["0.0", "0.12", "0.8"],
    neff: ["0.046", "3.05", "6.05"],
  };

  const labels = {
    ombh2: "ordinary matter",
    omch2: "dark matter",
    neff: "particle species",
  };

  const controls = {
    ombh2: {
      input: document.getElementById("composition-ombh2"),
    },
    omch2: {
      input: document.getElementById("composition-omch2"),
    },
    neff: {
      input: document.getElementById("composition-neff"),
    },
  };

  if (
    !controls.ombh2.input ||
    !controls.omch2.input ||
    !controls.neff.input
  ) {
    return;
  }

  const buildSource = () => {
    const ombh2 = values.ombh2[selection.ombh2];
    const omch2 = values.omch2[selection.omch2];
    const neff = values.neff[selection.neff];
    return `data/Videos/bao_mass_2d_radiation_${ombh2}_${omch2}_${neff}_1075.0.mp4`;
  };

  const updateStatus = () => {
    status.textContent = "The selected video updates as you move the sliders.";
  };

  const updateVideo = () => {
    const source = buildSource();

    if (video.dataset.currentSource !== source) {
      video.dataset.currentSource = source;
      video.src = source;
      video.load();
    }

    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        // Autoplay stays muted by default; if the browser blocks playback,
        // the user can still start it with the built-in controls.
      });
    }
  };

  const updateControl = (key) => {
    const control = controls[key];
    const index = selection[key];
    control.input.value = String(index);
    control.input.setAttribute(
      "aria-valuetext",
      `${labels[key]}: ${index + 1} of 3`,
    );
  };

  const sync = () => {
    updateControl("ombh2");
    updateControl("omch2");
    updateControl("neff");
    updateStatus();
    updateVideo();
  };

  Object.entries(controls).forEach(([key, control]) => {
    control.input.addEventListener("input", () => {
      selection[key] = Number.parseInt(control.input.value, 10);
      updateControl(key);
      updateStatus();
      updateVideo();
    });
  });

  sync();
});
