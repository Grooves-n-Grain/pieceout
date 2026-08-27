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

test('a single-component pinch (bowtie hole) links into one loop, not a figure eight', () => {
    // Two black pixels touching only at a corner, inside one white sea: the
    // hole loop must revisit the shared corner (2,2) rather than splitting
    // into two separate holes or crossing itself.
    const bm = bitmapFromStrings([
        '.....',
        '.#...',
        '..#..',
        '.....',
    ]);
    const cs = traceContours(bm);
    assert.equal(cs.length, 1, 'exactly one white component');
    const [c] = cs;
    assert.equal(c.holes.length, 1, 'exactly one hole, not two, not a figure eight');
    const [hole] = c.holes;
    assert.equal(hole.length, 8, 'unit edges around both pinched black pixels');
    assert.equal(Math.abs(signedArea(hole)), 2);
    for (let i = 0; i < hole.length; i++) {
        const a = hole[i], b = hole[(i + 1) % hole.length];
        assert.equal(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1);
    }
    const sharedCornerCount = hole.filter(([x, y]) => x === 2 && y === 2).length;
    assert.equal(sharedCornerCount, 2, 'the shared corner (2,2) is visited twice by the pinch');
});

test('a single-component pinch on the outer loop is instead two separate components', () => {
    // Contrast case: the pinch pixels are WHITE (not black), so 4-connectivity
    // keeps them as two distinct components, each with its own 4-vertex outer
    // loop, rather than one component with a pinched outer loop.
    const bm = bitmapFromStrings([
        '####',
        '#.##',
        '##.#',
        '####',
    ]);
    const cs = traceContours(bm);
    assert.equal(cs.length, 2);
    assert.deepEqual(cs.map(c => c.outer.length), [4, 4]);
    assert.deepEqual(cs.map(c => c.holes.length), [0, 0]);
});
