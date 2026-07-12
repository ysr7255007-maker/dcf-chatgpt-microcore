'use strict';

const assert = require('assert');
const { computeFenceStyle } = require('../src/ui/app');

const viewport = { width: 1200, height: 800 };
const normal = computeFenceStyle({ left: 848, top: 12, width: 340, height: 700 }, viewport, 12);
assert.strictEqual(normal.width, 340);
assert.strictEqual(normal.left, 848);
const overflow = computeFenceStyle({ left: 1100, top: -50, width: 500, height: 1000 }, viewport, 12);
assert(overflow.left >= 12 && overflow.left + overflow.width <= viewport.width - 12, 'horizontal containment failed');
assert(overflow.top >= 12 && overflow.top + overflow.height <= viewport.height - 12, 'vertical containment failed');
assert(overflow.width <= viewport.width - 24 && overflow.height <= viewport.height - 24, 'size containment failed');

const shiftedViewport = { width: 900, height: 650, left: 120, top: 80 };
const shifted = computeFenceStyle({ left: 950, top: 20, width: 360, height: 700 }, shiftedViewport, 12);
assert(shifted.left >= 132 && shifted.left + shifted.width <= 120 + 900 - 12, 'visual viewport horizontal offset ignored');
assert(shifted.top >= 92 && shifted.top + shifted.height <= 80 + 650 - 12, 'visual viewport vertical offset ignored');

console.log(JSON.stringify({ ok: true, final_rect_containment: true, viewport_coordinates: true, visual_viewport_offsets: true }, null, 2));
