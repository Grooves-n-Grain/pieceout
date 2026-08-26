import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPart, addRect, addCircle, addLabel, Material, Grain, Layer } from '../js/layout/parts.js';

test('createPart builds a part with defaults', () => {
    const p = createPart({ name: 'Leg', material: Material.HARDWOOD, width: 100, height: 19 });
    assert.deepEqual(p, {
        name: 'Leg', material: 'hardwood', width: 100, height: 19,
        grain: Grain.ALONG_X, qty: 1, features: [],
    });
});

test('createPart rejects bad input', () => {
    assert.throws(() => createPart({ name: 'x', material: 'plastic', width: 1, height: 1 }), /material/);
    assert.throws(() => createPart({ name: 'x', material: Material.HARDWOOD, width: 0, height: 1 }), /width/);
    assert.throws(() => createPart({ name: 'x', material: Material.HARDWOOD, width: 1, height: 1, qty: 0 }), /qty/);
    assert.throws(() => createPart({ name: 'x', material: Material.HARDWOOD, width: 1, height: 1, grain: 'diagonal' }), /grain/);
});

test('addRect appends a pocket feature inside the part', () => {
    const p = createPart({ name: 'Rail', material: Material.HARDWOOD, width: 150, height: 25 });
    const f = addRect(p, { layer: Layer.POCKET, x: 0, y: 0, width: 25, height: 25, depth: 6.35 });
    assert.equal(p.features.length, 1);
    assert.deepEqual(f, { layer: 'POCKET', depth: 6.35, shape: { kind: 'rect', x: 0, y: 0, width: 25, height: 25 } });
});

test('addRect rejects a rect outside the part', () => {
    const p = createPart({ name: 'Rail', material: Material.HARDWOOD, width: 150, height: 25 });
    assert.throws(() => addRect(p, { layer: Layer.POCKET, x: 140, y: 0, width: 25, height: 25, depth: 1 }), /outside/);
});

test('addCircle stores diameter and radius', () => {
    const p = createPart({ name: 'Rail', material: Material.HARDWOOD, width: 150, height: 25 });
    const f = addCircle(p, { layer: Layer.DRILL, cx: 12.5, cy: 12.5, diameter: 6.2 });
    assert.deepEqual(f, { layer: 'DRILL', diameter: 6.2, shape: { kind: 'circle', cx: 12.5, cy: 12.5, r: 3.1 } });
    assert.throws(() => addCircle(p, { layer: Layer.DRILL, cx: 2, cy: 12.5, diameter: 6.2 }), /outside/);
});

test('addRect, addCircle, addLabel reject non-numeric position fields', () => {
    const p = createPart({ name: 'Rail', material: Material.HARDWOOD, width: 150, height: 25 });
    assert.throws(() => addRect(p, { layer: Layer.POCKET, x: '0', y: 0, width: 25, height: 25, depth: 1 }), /x/);
    assert.throws(() => addCircle(p, { layer: Layer.DRILL, cx: 12.5, cy: '12.5', diameter: 6.2 }), /cy/);
    assert.throws(() => addLabel(p, { text: 'Leg', x: 5, y: '12' }), /y/);
});

test('addLabel is always on GUIDE', () => {
    const p = createPart({ name: 'Leg', material: Material.HARDWOOD, width: 100, height: 19 });
    const f = addLabel(p, { text: 'Leg', x: 5, y: 12 });
    assert.deepEqual(f, { layer: 'GUIDE', shape: { kind: 'text', x: 5, y: 12, text: 'Leg' } });
});
