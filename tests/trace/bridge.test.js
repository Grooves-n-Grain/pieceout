import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bitmapFromStrings, bitmapToStrings, getPixel } from '../../js/trace/bitmap.js';
import { labelComponents, findIslands } from '../../js/trace/components.js';
import { stampDisc, bridgeIsland, deleteIsland, applyOps } from '../../js/trace/bridge.js';

const framed = () => bitmapFromStrings([
    '#######',
    '#.....#',
    '#.....#',
    '#..#..#',
    '#.....#',
    '#.....#',
    '#######',
]);

test('stampDisc fills a disc in place', () => {
    const bm = bitmapFromStrings(['.....', '.....', '.....', '.....', '.....']);
    stampDisc(bm, 2, 2, 1);
    assert.deepEqual(bitmapToStrings(bm), ['.....', '..#..', '.###.', '..#..', '.....']);
});

test('bridgeIsland connects the island to the body by the shortest gap', () => {
    const bm = framed();
    const a = labelComponents(bm, 1);
    const [island] = findIslands(bm, a);
    const r = bridgeIsland(bm, a, island.id, 1);
    assert.ok(r);
    assert.equal(r.path.length, 3, 'two white pixels plus the body pixel');
    const [fx, fy] = r.path[0];
    assert.equal(Math.abs(fx - 3) + Math.abs(fy - 3), 1, 'path starts next to the island');
    const [lx, ly] = r.path[r.path.length - 1];
    assert.equal(getPixel(bm, lx, ly), 1, 'path ends on the body');
    assert.equal(findIslands(r.bitmap).length, 0);
    assert.equal(findIslands(bm).length, 1, 'input untouched');
    for (const [x, y] of r.path) assert.equal(getPixel(r.bitmap, x, y), 1);
});

test('bridgeIsland treats other islands as walls and returns null when unreachable', () => {
    const bm = bitmapFromStrings([
        '.....',
        '.###.',
        '.#.#.',
        '.###.',
        '.....',
    ]);
    const a = labelComponents(bm, 1);
    const ring = findIslands(bm, a)[0];
    assert.equal(bridgeIsland(bm, a, ring.id, 1), null);
});

test('deleteIsland flips the island to white', () => {
    const bm = framed();
    const a = labelComponents(bm, 1);
    const out = deleteIsland(bm, a, findIslands(bm, a)[0].id);
    assert.equal(getPixel(out, 3, 3), 0);
    assert.equal(findIslands(out).length, 0);
});

test('applyOps replays bridges and deletes, dropping ops whose island is gone', () => {
    const bm = framed();
    const ops = [
        { kind: 'bridge', seed: [3, 3], widthPx: 1 },
        { kind: 'delete', seed: [3, 3] },
        { kind: 'delete', seed: [1, 1] },
    ];
    const r = applyOps(bm, ops);
    assert.equal(r.ops.length, 1);
    assert.equal(r.ops[0].kind, 'bridge');
    assert.equal(r.ops[0].path.length, 3);
    assert.equal(findIslands(r.bitmap).length, 0);
});
