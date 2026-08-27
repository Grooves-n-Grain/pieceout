import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
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

test('applyOps bridges two islands in sequence using one shared analysis', () => {
    const bm = bitmapFromStrings([
        '###########',
        '#.........#',
        '#.#.....#.#',
        '#.........#',
        '###########',
    ]);
    const a0 = labelComponents(bm, 1);
    const [islandA, islandB] = findIslands(bm, a0).sort((p, q) => p.seed[0] - q.seed[0]);
    const ops = [
        { kind: 'bridge', seed: islandA.seed, widthPx: 1 },
        { kind: 'bridge', seed: islandB.seed, widthPx: 1 },
    ];
    const r = applyOps(bm, ops);
    assert.equal(r.ops.length, 2);
    for (const op of r.ops) {
        assert.equal(op.kind, 'bridge');
        assert.ok(op.path.length > 0);
    }
    assert.equal(findIslands(r.bitmap).length, 0);
});

test('applyOps drops a delete whose island was already bridged into the body', () => {
    const bm = framed();
    const ops = [
        { kind: 'bridge', seed: [3, 3], widthPx: 1 },
        { kind: 'delete', seed: [3, 3] },
    ];
    const r = applyOps(bm, ops);
    assert.equal(r.ops.length, 1);
    assert.equal(r.ops[0].kind, 'bridge');
    assert.equal(findIslands(r.bitmap).length, 0);
});

test('applyOps drops a bridge whose island was already deleted', () => {
    const bm = framed();
    const ops = [
        { kind: 'delete', seed: [3, 3] },
        { kind: 'bridge', seed: [3, 3], widthPx: 1 },
    ];
    const r = applyOps(bm, ops);
    assert.equal(r.ops.length, 1);
    assert.equal(r.ops[0].kind, 'delete');
    assert.equal(findIslands(r.bitmap).length, 0);
});

test('applyOps stays fast when bridging many islands on a large bitmap', () => {
    const W = 1000, H = 1000;
    const rows = [];
    for (let y = 0; y < H; y++) {
        if (y === 0 || y === H - 1) rows.push('#'.repeat(W));
        else rows.push('#' + '.'.repeat(W - 2) + '#');
    }
    const rowChars = rows.map((r) => r.split(''));
    const cols = 8, gridRows = 5; // 8 * 5 = 40 islands
    const seeds = [];
    for (let gr = 0; gr < gridRows; gr++) {
        for (let gc = 0; gc < cols; gc++) {
            const x = 50 + gc * 120;
            const y = 50 + gr * 180;
            rowChars[y][x] = '#';
            seeds.push([x, y]);
        }
    }
    const bm = bitmapFromStrings(rowChars.map((r) => r.join('')));
    const ops = seeds.map((seed) => ({ kind: 'bridge', seed, widthPx: 1 }));

    const t0 = performance.now();
    const r = applyOps(bm, ops);
    const elapsed = performance.now() - t0;

    assert.equal(r.ops.length, 40);
    assert.equal(findIslands(r.bitmap).length, 0);
    assert.ok(elapsed < 400, `applyOps took ${elapsed.toFixed(1)}ms, expected < 400ms`);
});
