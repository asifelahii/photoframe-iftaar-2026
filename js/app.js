// === Elements ===
const canvas = document.getElementById("canvas"); // display canvas (interactive)
const ctx = canvas.getContext("2d", { alpha: true });

const uploader = document.getElementById("uploader");
const framePicker = document.getElementById("framePicker");
const zoomSlider = document.getElementById("zoom");
const rotateSlider = document.getElementById("rotate");
const fitBtn = document.getElementById("fit");
const resetBtn = document.getElementById("reset");
const downloadBtn = document.getElementById("download");

// ▼ Disable Download until a photo is loaded
downloadBtn.disabled = true;

// === Config ===
const DISPLAY_MAX = 1100; // interactive canvas max size
const UPLOAD_MAX_EDGE = 2500; // clamp uploaded photo for smoothness

// === Images ===
let frameBitmap = null;
let userBitmap = null; // resized for smooth interaction
let userFull = null; // full-size for export
let userLoaded = false;

// === Transform state ===
let state = {
  cx: canvas.width / 2,
  cy: canvas.height / 2,
  scale: 1,
  rot: 0,
  imgW: 1,
  imgH: 1,
};

let needsRender = true;

// === Helpers ===
const deg2rad = (d) => (d * Math.PI) / 180;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const coverScale = (iw, ih, cw, ch) => Math.max(cw / iw, ch / ih);
const dpr = Math.min(window.devicePixelRatio || 1, 2);

// Resize display canvas while keeping frame aspect ratio
// Resize display canvas to the container while keeping frame aspect ratio.
// If keepState=true (on window resize), preserve current zoom/position.
function sizeDisplayCanvas(frameW, frameH, keepState = false) {
  const ratio = frameW / frameH;

  // available width = canvas card's content box
  const container =
    document.querySelector(".canvas-wrap") || canvas.parentElement;
  const maxW = container
    ? container.clientWidth
    : Math.min(window.innerWidth * 0.96, 1080);
  let targetW = Math.min(maxW, 1080);
  let targetH = Math.round(targetW / ratio);

  const prevW = canvas.width || Math.round(targetW);
  const prevH = canvas.height || Math.round(targetH);

  // device pixel ratio for sharpness (capped elsewhere)
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(targetW * dpr);
  canvas.height = Math.round(targetH * dpr);
  canvas.style.width = targetW + "px";
  canvas.style.height = targetH + "px";

  if (keepState) {
    // scale transform to new canvas size so composition stays the same
    const sx = canvas.width / prevW;
    const sy = canvas.height / prevH;
    state.cx *= sx;
    state.cy *= sy;
    state.scale *= sx; // square scaling (frame is square)
  } else {
    state.cx = canvas.width / 2;
    state.cy = canvas.height / 2;
  }

  needsRender = true;
}

// Reflow canvas on orientation/viewport resize (debounced via rAF)
let resizeRaf = null;
window.addEventListener(
  "resize",
  () => {
    if (!frameBitmap) return;
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      sizeDisplayCanvas(frameBitmap.width, frameBitmap.height, true);
    });
  },
  { passive: true },
);

// ---- Draw (single, correct version) ----
function draw() {
  needsRender = false;
  const w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (userLoaded && userBitmap) {
    ctx.save();
    ctx.translate(state.cx, state.cy);
    ctx.rotate(state.rot);
    ctx.scale(state.scale, state.scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(userBitmap, -state.imgW / 2, -state.imgH / 2);
    ctx.restore();
  }

  if (frameBitmap) {
    ctx.drawImage(frameBitmap, 0, 0, w, h);
  }

  // keep preview in sync
  updatePreview();
}

// RAF loop
function loop() {
  if (needsRender) draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Fit photo to frame
function fitToFrame() {
  if (!userLoaded) return;
  const s = coverScale(state.imgW, state.imgH, canvas.width, canvas.height);
  state.scale = s;
  state.rot = 0;
  state.cx = canvas.width / 2;
  state.cy = canvas.height / 2;

  // adapt zoom slider
  zoomSlider.max = Math.max(5, (s * 2).toFixed(2));
  zoomSlider.min = 0.1;
  zoomSlider.step = 0.01;
  zoomSlider.value = s.toFixed(2);

  rotateSlider.value = 0;
  needsRender = true;
}

function resetAll() {
  if (!userLoaded) return;
  state.scale = 1;
  state.rot = 0;
  state.cx = canvas.width / 2;
  state.cy = canvas.height / 2;
  zoomSlider.value = 1;
  rotateSlider.value = 0;
  needsRender = true;
}

// ---- Loading helpers ----
// (single version with error handling)
async function loadFrame(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = async () => {
      try {
        frameBitmap = await createImageBitmap(img);
        sizeDisplayCanvas(frameBitmap.width, frameBitmap.height);
        if (userLoaded) fitToFrame();
        needsRender = true;
        resolve();
      } catch (e) {
        alert("Could not prepare frame bitmap.");
        reject(e);
      }
    };
    img.onerror = () => {
      alert(
        "Frame image not found:\n" +
          src +
          "\n\nCheck the path/filename (case-sensitive).",
      );
      reject(new Error("Frame load error"));
    };
    img.src = src;
  });
}

// Fallback-capable image decoding
async function fileToImageBitmaps(file) {
  if (window.createImageBitmap) {
    const full = await createImageBitmap(file);

    // resize for interaction
    const maxEdge = Math.max(full.width, full.height);
    let targetW = full.width,
      targetH = full.height;
    if (maxEdge > UPLOAD_MAX_EDGE) {
      const scale = UPLOAD_MAX_EDGE / maxEdge;
      targetW = Math.round(full.width * scale);
      targetH = Math.round(full.height * scale);
    }
    const fast = await createImageBitmap(full, {
      resizeWidth: targetW,
      resizeHeight: targetH,
      resizeQuality: "high",
    });
    return { fast, full };
  } else {
    // fallback for older browsers
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const fullCanvas = document.createElement("canvas");
        fullCanvas.width = img.naturalWidth;
        fullCanvas.height = img.naturalHeight;
        fullCanvas.getContext("2d").drawImage(img, 0, 0);

        const maxEdge = Math.max(img.naturalWidth, img.naturalHeight);
        const scale = Math.min(1, UPLOAD_MAX_EDGE / maxEdge);
        const fastCanvas = document.createElement("canvas");
        fastCanvas.width = Math.round(img.naturalWidth * scale);
        fastCanvas.height = Math.round(img.naturalHeight * scale);
        fastCanvas
          .getContext("2d")
          .drawImage(img, 0, 0, fastCanvas.width, fastCanvas.height);

        resolve({ fast: fastCanvas, full: fullCanvas });
      };
      img.src = URL.createObjectURL(file);
    });
  }
}

// ---- Event wiring ----
framePicker.addEventListener("change", () => loadFrame(framePicker.value));
loadFrame(framePicker.value); // initial

uploader.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  // free old bitmaps...
  try {
    userBitmap?.close?.();
  } catch {}
  try {
    userFull?.close?.();
  } catch {}

  const { fast, full } = await fileToImageBitmaps(file);
  userBitmap = fast;
  userFull = full;
  userLoaded = true;
  state.imgW = userBitmap.width;
  state.imgH = userBitmap.height;

  // ▼ Photo ready → enable Download
  downloadBtn.disabled = false;

  fitToFrame();
});

// Sliders
zoomSlider.addEventListener("input", () => {
  if (!userLoaded) return;
  state.scale = clamp(
    parseFloat(zoomSlider.value),
    0.1,
    parseFloat(zoomSlider.max),
  );
  needsRender = true;
});
rotateSlider.addEventListener("input", () => {
  if (!userLoaded) return;
  state.rot = deg2rad(parseFloat(rotateSlider.value));
  needsRender = true;
});

fitBtn.addEventListener("click", fitToFrame);
resetBtn.addEventListener("click", resetAll);

// Dragging
let dragging = false;
let dragStart = { x: 0, y: 0 };
let startCenter = { x: 0, y: 0 };
let cachedRect = null;

canvas.addEventListener("mousedown", (e) => {
  if (!userLoaded) return;
  dragging = true;
  cachedRect = canvas.getBoundingClientRect();
  dragStart = { x: e.clientX - cachedRect.left, y: e.clientY - cachedRect.top };
  startCenter = { x: state.cx, y: state.cy };
});
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const x = e.clientX - cachedRect.left;
  const y = e.clientY - cachedRect.top;
  state.cx = startCenter.x + (x - dragStart.x) * dpr;
  state.cy = startCenter.y + (y - dragStart.y) * dpr;
  needsRender = true;
});
window.addEventListener("mouseup", () => {
  dragging = false;
});

// Wheel zoom (coalesced)
let wheelAccum = 0;
canvas.addEventListener(
  "wheel",
  (e) => {
    if (!userLoaded) return;
    e.preventDefault();
    wheelAccum += e.deltaY;
    if (Math.abs(wheelAccum) > 2) {
      const factor = Math.pow(1.0015, -wheelAccum);
      state.scale = clamp(
        state.scale * factor,
        0.1,
        parseFloat(zoomSlider.max),
      );
      zoomSlider.value = state.scale.toFixed(2);
      wheelAccum = 0;
      needsRender = true;
    }
  },
  { passive: false },
);

// Touch: drag & pinch
let touchState = null;
const distance = (t1, t2) =>
  Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

canvas.addEventListener(
  "touchstart",
  (e) => {
    if (!userLoaded) return;
    cachedRect = canvas.getBoundingClientRect();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchState = {
        mode: "drag",
        startX: t.clientX - cachedRect.left,
        startY: t.clientY - cachedRect.top,
        startCX: state.cx,
        startCY: state.cy,
      };
    } else if (e.touches.length === 2) {
      const d = distance(e.touches[0], e.touches[1]);
      touchState = { mode: "pinch", startDist: d, startScale: state.scale };
    }
  },
  { passive: true },
);

canvas.addEventListener(
  "touchmove",
  (e) => {
    if (!touchState) return;
    if (touchState.mode === "drag" && e.touches.length === 1) {
      const t = e.touches[0];
      const x = t.clientX - cachedRect.left;
      const y = t.clientY - cachedRect.top;
      state.cx = touchState.startCX + (x - touchState.startX) * dpr;
      state.cy = touchState.startCY + (y - touchState.startY) * dpr;
      needsRender = true;
    } else if (touchState.mode === "pinch" && e.touches.length === 2) {
      const d = distance(e.touches[0], e.touches[1]);
      const factor = d / touchState.startDist;
      state.scale = clamp(
        touchState.startScale * factor,
        0.1,
        parseFloat(zoomSlider.max),
      );
      zoomSlider.value = state.scale.toFixed(2);
      needsRender = true;
    }
  },
  { passive: true },
);

window.addEventListener("touchend", () => {
  touchState = null;
});

// Keep the social/share preview in sync with the on-screen canvas
function updatePreview() {
  const preview = document.getElementById("previewImg");
  if (!preview) return;
  try {
    // Use a lightweight JPEG to avoid huge data URLs
    preview.src = canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    // Some very old browsers might throw on toDataURL with tainted canvas
  }
}

function drawWatermark(ctx, canvas) {
  const text = "Made by by Asif Elahi";
  ctx.save();
  const size = Math.round(canvas.width * 0.025); // ~2.5% of width
  ctx.font = `${size}px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  const pad = canvas.width * 0.02;

  // subtle shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillText(text, canvas.width - pad + 1, canvas.height - pad + 1);

  // main text
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText(text, canvas.width - pad, canvas.height - pad);
  ctx.restore();
}

// Download at full resolution
downloadBtn.addEventListener("click", async () => {
  if (!frameBitmap || !userLoaded) return;

  const w = frameBitmap.width;
  const h = frameBitmap.height;
  const src = userFull || userBitmap;

  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const octx = off.getContext("2d", { alpha: true });

  const canvasToOut = w / canvas.width; // map display -> export pixels
  const srcRatio = src.width / userBitmap.width; // compensate for full-res source
  const totalScale = state.scale * canvasToOut * srcRatio;

  // draw user photo
  octx.save();
  octx.translate(state.cx * canvasToOut, state.cy * canvasToOut);
  octx.rotate(state.rot);
  octx.scale(totalScale, totalScale);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(src, -src.width / 2, -src.height / 2);
  octx.restore();

  // draw frame
  octx.drawImage(frameBitmap, 0, 0, w, h);

  // ✅ add watermark on the export canvas
  drawWatermark(octx, off);

  // export
  const link = document.createElement("a");
  link.download = "BIM_2025_DIU_CSE_EEE.jpg"; // (use .jpg to match MIME, but .JPG also works)
  link.href = off.toDataURL("image/jpeg", 0.95);
  link.click();
});
