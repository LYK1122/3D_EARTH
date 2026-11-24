import { createRenderer } from './renderer.js';
import { loadElevation } from './terrain.js';

const byId = id => document.getElementById(id);
const canvas = byId('earth');
const status = byId('status');
const capture = byId('capture');
const settings = byId('settings');
const rotation = byId('rotation');
const light = byId('light');
const exaggeration = byId('exaggeration');
const autoRotate = byId('auto-rotate');
const autoLight = byId('auto-light');
const defaults = { rotation: 0, light: -35, distance: 3.9, exaggeration: 28 };

async function start() {
  const elevation = await loadElevation(new URL('../data/etopo-0.5deg.i16', import.meta.url));
  const state = { ...defaults };
  const renderer = createRenderer(canvas, elevation, state.exaggeration);
  let geometryScale = state.exaggeration;
  let lastTime = null;
  let lightMotion = 0;
  let frame = 0;

  function syncControls() {
    rotation.value = Math.floor(state.rotation);
    light.value = Math.round(state.light);
    exaggeration.value = state.exaggeration;
    byId('rotation-value').value = `${rotation.value}°`;
    byId('light-value').value = `${light.value}°`;
    byId('exaggeration-value').value = `${exaggeration.value}배`;
  }

  function drawFrame() {
    if (geometryScale !== state.exaggeration) {
      renderer.setExaggeration(state.exaggeration);
      geometryScale = state.exaggeration;
    }
    renderer.draw(state);
    syncControls();
  }

  function requestFrame() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function tick(now) {
    frame = 0;
    const delta = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.08);
    if (autoRotate.checked) state.rotation = (state.rotation + delta * 14) % 360;
    if (autoLight.checked) {
      lightMotion += delta * 0.6;
      state.light = 75 * Math.sin(lightMotion);
    }
    drawFrame();
    lastTime = autoRotate.checked || autoLight.checked ? now : null;
    if (lastTime !== null) requestFrame();
  }

  rotation.addEventListener('input', () => {
    autoRotate.checked = false;
    state.rotation = rotation.valueAsNumber;
    requestFrame();
  });
  light.addEventListener('input', () => {
    autoLight.checked = false;
    state.light = light.valueAsNumber;
    requestFrame();
  });
  exaggeration.addEventListener('input', () => {
    state.exaggeration = exaggeration.valueAsNumber;
    requestFrame();
  });
  autoRotate.addEventListener('change', requestFrame);
  autoLight.addEventListener('change', () => {
    lightMotion = Math.asin(Math.max(-1, Math.min(1, state.light / 75)));
    requestFrame();
  });
  byId('reset').addEventListener('click', () => {
    Object.assign(state, defaults);
    autoRotate.checked = false;
    autoLight.checked = false;
    lastTime = null;
    requestFrame();
  });
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const step = event.deltaMode === 0 ? 0.001 : 0.04;
    state.distance = Math.max(2, Math.min(8, state.distance * Math.exp(event.deltaY * step)));
    requestFrame();
  }, { passive: false });

  capture.addEventListener('click', () => {
    // Capture in the same event turn as the WebGL draw.
    drawFrame();
    const filename = `earth-r${rotation.value}-light${light.value}-x${exaggeration.value}.png`;
    canvas.toBlob(blob => {
      if (!blob) {
        status.textContent = '화면 캡처를 사용.';
        status.hidden = false;
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  });

  new ResizeObserver(requestFrame).observe(canvas);
  settings.disabled = false;
  capture.disabled = false;
  status.hidden = true;
  requestFrame();
}

start().catch(error => {
  status.textContent = error.message;
  console.error(error);
});
