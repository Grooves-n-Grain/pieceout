import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPart, Material } from '../js/layout/parts.js';
import { halfLap } from '../js/layout/joints/halfLap.js';
import { dowelHole } from '../js/layout/joints/dowelHole.js';

function rail() {
    return createPart({ name: 'Rail', material: Material.HARDWOOD, width: 150, height: 25 });
}

test('halfLap at start pockets the first `length` mm across the full width', () => {
    const p = rail();
    const f = halfLap(p, 'start', { depth: 6.35, length: 25 });
    assert.deepEqual(f, { layer: 'POCKET', depth: 6.35, shape: { kind: 'rect', x: 0, y: 0, width: 25, height: 25 } });
});

test('halfLap at end pockets the last `length` mm', () => {
    const p = rail();
    const f = halfLap(p, 'end', { depth: 6.35, length: 25 });
    assert.deepEqual(f.shape, { kind: 'rect', x: 125, y: 0, width: 25, height: 25 });
});

test('halfLap rejects a bad end or a lap longer than the part', () => {
    assert.throws(() => halfLap(rail(), 'middle', { depth: 6, length: 25 }), /end/);
    assert.throws(() => halfLap(rail(), 'start', { depth: 6, length: 200 }), /outside/);
});

test('dowelHole adds a DRILL circle', () => {
    const p = rail();
    const f = dowelHole(p, { x: 12.5, y: 12.5, diameter: 6.2 });
    assert.deepEqual(f, { layer: 'DRILL', diameter: 6.2, shape: { kind: 'circle', cx: 12.5, cy: 12.5, r: 3.1 } });
});
