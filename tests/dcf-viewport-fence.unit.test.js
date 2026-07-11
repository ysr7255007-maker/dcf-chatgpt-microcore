const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'dcf-chatgpt-microcore.user.js'), 'utf8');
const start = source.indexOf('function viewportFenceBounds()');
const end = source.indexOf('function surfs()', start);
if (start < 0 || end < 0) throw new Error('viewport fence functions missing');
const fenceSource = source.slice(start, end);

function makeStyle() {
  const values = new Map();
  const priorities = new Map();
  return {
    setProperty(name, value, priority = '') {
      values.set(name, String(value));
      priorities.set(name, String(priority));
    },
    getPropertyValue(name) { return values.get(name) || ''; },
    removeProperty(name) {
      const old = values.get(name) || '';
      values.delete(name);
      priorities.delete(name);
      return old;
    },
    priority(name) { return priorities.get(name) || ''; }
  };
}

function px(value) {
  const n = parseFloat(String(value || '0'));
  return Number.isFinite(n) ? n : 0;
}

function createFenceRuntime({ viewport, baseRect, desired }) {
  const style = makeStyle();
  const sh = {
    style,
    getBoundingClientRect() {
      const maxW = px(style.getPropertyValue('max-width')) || baseRect.width;
      const maxH = px(style.getPropertyValue('max-height')) || baseRect.height;
      const width = Math.min(baseRect.width, maxW);
      const height = Math.min(baseRect.height, maxH);
      const transform = style.getPropertyValue('transform');
      const match = /translate3d\((-?[\d.]+)px,(-?[\d.]+)px,0\)/.exec(transform);
      const dx = match ? Number(match[1]) : 0;
      const dy = match ? Number(match[2]) : 0;
      const left = baseRect.left + dx;
      const top = baseRect.top + dy;
      return {
        x: left, y: top, left, top,
        width, height,
        right: left + width,
        bottom: top + height
      };
    }
  };
  const window = {
    visualViewport: { ...viewport },
    innerWidth: viewport.width,
    innerHeight: viewport.height
  };
  const document = {
    documentElement: {
      clientWidth: viewport.width,
      clientHeight: viewport.height
    }
  };
  const reg = { appearance: { side: 'right', vars: { ...desired } } };
  let fenceState = { active: false };
  let fenceFrame = 0;
  const requestAnimationFrame = (fn) => { fn(); return 1; };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const factory = new Function(
    'window', 'document', 'sh', 'reg', 'requestAnimationFrame', 'clone',
    'getFenceState', 'setFenceState', 'getFenceFrame', 'setFenceFrame',
    `
      let fenceState = getFenceState();
      let fenceFrame = getFenceFrame();
      ${fenceSource}
      return {
        viewportFenceBounds,
        enforceViewportFence,
        scheduleViewportFence,
        sync() {
          setFenceState(fenceState);
          setFenceFrame(fenceFrame);
        }
      };
    `
  );
  const api = factory(
    window, document, sh, reg, requestAnimationFrame, clone,
    () => fenceState,
    (value) => { fenceState = value; },
    () => fenceFrame,
    (value) => { fenceFrame = value; }
  );
  return { api, sh, reg, getState: () => fenceState };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("window.visualViewport?.addEventListener('resize',scheduleViewportFence"), 'visual viewport resize listener missing');
assert(source.includes("window.visualViewport?.addEventListener('scroll',scheduleViewportFence"), 'visual viewport scroll listener missing');
assert(source.includes("maxs={w:Math.min(680,b.safe_width),h:Math.min(1200,b.safe_height)"), 'step target cap is not tied to the current safe viewport');

const runtime = createFenceRuntime({
  viewport: { width: 800, height: 600, offsetLeft: 0, offsetTop: 0 },
  baseRect: { left: 100, top: -50, width: 900, height: 900 },
  desired: { w: '900px', h: '900px', top: '12px', bottom: '112px', anchor: 'bottom' }
});
const result = runtime.api.enforceViewportFence();
runtime.api.sync();

assert(result.contained === true, 'oversized shell was not contained');
assert(result.rect.x >= 12 && result.rect.y >= 12, 'shell crossed viewport start edge');
assert(result.rect.right <= 788 && result.rect.bottom <= 588, 'shell crossed viewport end edge');
assert(result.rect.width === 776 && result.rect.height === 576, 'safe size did not use visual viewport');
assert(result.correction.x !== 0 && result.correction.y !== 0, 'rect correction was not applied');
assert(runtime.sh.style.priority('width') === 'important', 'width fence is not authoritative');
assert(runtime.sh.style.priority('height') === 'important', 'height fence is not authoritative');
assert(runtime.reg.appearance.vars.w === '900px' && runtime.reg.appearance.vars.h === '900px', 'fence destroyed desired registry size');

const offsetRuntime = createFenceRuntime({
  viewport: { width: 500, height: 400, offsetLeft: 50, offsetTop: 30 },
  baseRect: { left: 0, top: 0, width: 300, height: 300 },
  desired: { w: '300px', h: '300px', top: '0px', bottom: '0px', anchor: 'top' }
});
const offsetResult = offsetRuntime.api.enforceViewportFence();
offsetRuntime.api.sync();
assert(offsetResult.rect.x === 62 && offsetResult.rect.y === 42, 'visual viewport offset was ignored');
assert(offsetResult.contained === true, 'offset visual viewport containment failed');

console.log(JSON.stringify({
  ok: true,
  version: '0.9.13',
  actual_rect_guard: true,
  visual_viewport_coordinates: true,
  desired_registry_preserved: true,
  anchor_independent: true
}, null, 2));