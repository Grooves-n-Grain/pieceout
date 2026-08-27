import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bitmapFromStrings, bitmapToStrings } from '../../js/trace/bitmap.js';
import { labelComponents, findIslands } from '../../js/trace/components.js';
import { removeSpecks } from '../../js/trace/despeckle.js';

const ring = bitmapFromStrings([
    '.......',
    '.#####.',
    '.#...#.',
    '.#.#.#.',
    '.#...#.',
    '.#####.',
    '.......',
]);

test('black components use 8-connectivity and report border contact', () => {
    const bm = bitmapFromStrings([
        '#..',
        '.#.',
        '..#',
    ]);
    const a = labelComponents(bm, 1);
    assert.equal(a.count, 1);
    assert.equal(a.areas[1], 3);
    assert.equal(a.touchesBorder[1], true);
    assert.deepEqual(a.bboxes[1], { x0: 0, y0: 0, x1: 2, y1: 2 });
    assert.deepEqual(a.seeds[1], [0, 0]);
});

test('white components use 4-connectivity', () => {
    const bm = bitmapFromStrings([
        '.#',
        '#.',
    ]);
    const a = labelComponents(bm, 0);
    assert.equal(a.count, 2);
    assert.equal(a.labels[0], 1);
    assert.equal(a.labels[3], 2);
});

test('findIslands returns black components that do not touch the border, largest first', () => {
    const islands = findIslands(ring);
    assert.equal(islands.length, 2);
    assert.equal(islands[0].area, 16);
    assert.equal(islands[1].area, 1);
    assert.deepEqual(islands[1].seed, [3, 3]);
    assert.deepEqual(islands[1].bbox, { x0: 3, y0: 3, x1: 3, y1: 3 });

    const framed = bitmapFromStrings([
        '#####',
        '#...#',
        '#.#.#',
        '#...#',
        '#####',
    ]);
    const only = findIslands(framed);
    assert.equal(only.length, 1);
    assert.deepEqual(only[0].seed, [2, 2]);
});

test('labelComponents never recurses (large blob)', () => {
    const size = 600;
    const data = new Uint8Array(size * size).fill(1);
    const a = labelComponents({ width: size, height: size, data }, 1);
    assert.equal(a.count, 1);
    assert.equal(a.areas[1], size * size);
});

test('removeSpecks drops small black then small white components, never border-touching ones', () => {
    const bm = bitmapFromStrings([
        '#.......',
        '..##....',
        '..##..#.',
        '........',
        '.####...',
        '.#..#...',
        '.#.##...',
        '.####...',
    ]);
    const out = removeSpecks(bm, 4);
    assert.deepEqual(bitmapToStrings(out), [
        '#.......',
        '..##....',
        '..##....',
        '........',
        '.####...',
        '.####...',
        '.####...',
        '.####...',
    ]);
    assert.notEqual(out.data, bm.data, 'returns a new bitmap');
});
