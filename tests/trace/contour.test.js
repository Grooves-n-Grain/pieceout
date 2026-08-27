import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bitmapFromStrings } from '../../js/trace/bitmap.js';
import { traceContours, signedArea } from '../../js/trace/contour.js';

test('signedArea is positive for a clockwise-on-screen square', () => {
    assert.equal(signedArea([[0, 0], [1, 0], [1, 1], [0, 1]]), 1);
    assert.equal(signedArea([[0, 0], [0, 1], [1, 1], [1, 0]]), -1);
});

test('a single white pixel yields one 4-point outer loop', () => {
    const bm = bitmapFromStrings(['###', '#.#', '###']);
    const [c] = traceContours(bm);
    assert.equal(c.area, 1);
    assert.equal(c.touchesBorder, false);
    assert.deepEqual(c.outer, [[1, 1], [2, 1], [2, 2], [1, 2]]);
    assert.deepEqual(c.holes, []);
});

test('a ring produces an outer white region with one hole and an inner region', () => {
    const bm = bitmapFromStrings([
        '.....',
        '.###.',
        '.#.#.',
        '.###.',
        '.....',
    ]);
    const cs = traceContours(bm);
    assert.equal(cs.length, 2);
    const outside = cs.find(c => c.touchesBorder);
    const inside = cs.find(c => !c.touchesBorder);
    assert.equal(outside.outer.length, 20, 'unit edges around a 5x5 square');
    assert.equal(outside.holes.length, 1);
    assert.equal(outside.holes[0].length, 12, 'unit edges around the 3x3 ring');
    assert.ok(signedArea(outside.outer) > 0);
    assert.ok(signedArea(outside.holes[0]) < 0);
    assert.equal(Math.abs(signedArea(outside.holes[0])), 9);
    assert.equal(inside.outer.length, 4);
    assert.equal(inside.holes.length, 0);
});

test('a diagonal pinch does not merge into a figure eight', () => {
    // Two white pixels touching only at a corner are separate 4-connected components.
    const bm = bitmapFromStrings([
        '.#',
        '#.',
    ]);
    const cs = traceContours(bm);
    assert.equal(cs.length, 2);
    assert.deepEqual(cs.map(c => c.outer.length), [4, 4]);
});

test('every loop is closed: last point connects back to first by a unit step', () => {
    const bm = bitmapFromStrings([
        '.......',
        '.##.##.',
        '.#...#.',
        '.##.##.',
        '.......',
    ]);
    for (const c of traceContours(bm)) {
        for (const loop of [c.outer, ...c.holes]) {
            for (let i = 0; i < loop.length; i++) {
                const a = loop[i], b = loop[(i + 1) % loop.length];
                assert.equal(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1);
            }
        }
    }
});
