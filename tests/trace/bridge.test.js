import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { bitmapFromStrings, bitmapToStrings, getPixel } from '../../js/trace/bitmap.js';
import { labelComponents, findIslands } from '../../js/trace/components.js';
import { stampDisc, bridgeIsland, bridgeIslandTo, deleteIsland, applyOps } from '../../js/trace/bridge.js';

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
    // A border-touching outer frame (definitely the body), a fully closed inner ring
    // around it with a 1-cell gap (a plain island, not walled off itself), and a dot
    // sealed inside that ring with no gap at all. The dot can only ever reach the ring
    // (another island, not the body), never the frame, so bridging it must fail.
    const bm = bitmapFromStrings([
        '#########',
        '#.......#',
        '#.#####.#',
        '#.#...#.#',
        '#.#.#.#.#',
        '#.#...#.#',
        '#.#####.#',
        '#.......#',
        '#########',
    ]);
    const a = labelComponents(bm, 1);
    const islands = findIslands(bm, a);
    assert.equal(islands.length, 2, 'the ring and the dot are both plain islands (a border-touching frame exists)');
    const dot = islands.find((i) => i.area === 1);
    assert.ok(dot);
    assert.equal(bridgeIsland(bm, a, dot.id, 1), null, "the ring walls the dot off; it can't reach the frame");
});

test('bridgeIsland reaches a ring that becomes the body via the white-margin fallback', () => {
    // Same shape as the framed-drawing margin case in components.test.js: nothing here
    // touches the actual bitmap border, so the ring (the larger of the two black
    // components) becomes the body, and the dot sealed inside it can now bridge straight
    // out to its own enclosing wall.
    const bm = bitmapFromStrings([
        '.......',
        '.#####.',
        '.#...#.',
        '.#.#.#.',
        '.#...#.',
        '.#####.',
        '.......',
    ]);
    const a = labelComponents(bm, 1);
    const islands = findIslands(bm, a);
    assert.equal(islands.length, 1, 'the ring is now the body; only the dot remains an island');
    const dot = islands[0];
    assert.equal(dot.area, 1);
    const r = bridgeIsland(bm, a, dot.id, 1);
    assert.ok(r, 'the ring is body now, so the dot can reach it');
    const [lx, ly] = r.path[r.path.length - 1];
    assert.equal(getPixel(bm, lx, ly), 1, 'path ends on a ring pixel');
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
    assert.deepEqual(r.dropped.map((d) => d.reason), ['merged', 'gone'], 'the second delete targets the now-bridged island; the third targets nothing');
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
    assert.deepEqual(r.dropped.map((d) => d.reason), ['merged']);
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
    assert.deepEqual(r.dropped.map((d) => d.reason), ['gone']);
    assert.equal(findIslands(r.bitmap).length, 0);
});

test('applyOps reports an unreachable bridge with reason "unreachable", not silently', () => {
    // Same walled shape as the bridgeIsland test above: a border-touching outer frame, a
    // sealed inner ring (a real island, not the body), and a dot fully walled inside it.
    const bm = bitmapFromStrings([
        '#########',
        '#.......#',
        '#.#####.#',
        '#.#...#.#',
        '#.#.#.#.#',
        '#.#...#.#',
        '#.#####.#',
        '#.......#',
        '#########',
    ]);
    const dot = findIslands(bm).find((i) => i.area === 1);
    const r = applyOps(bm, [{ kind: 'bridge', seed: dot.seed, widthPx: 1 }]);
    assert.equal(r.ops.length, 0);
    assert.deepEqual(r.dropped.map((d) => d.reason), ['unreachable']);
});

test('applyOps takes minBodyAreaPx for the body, matching the speck threshold the rest of the pipeline uses', () => {
    // An 11x11 white-margin frame (a hollow ring, not touching the actual image border) with
    // a 2x2 dot sealed inside it, plus a 1 px black speck sitting right on the image border.
    // With no threshold, the border-touching speck alone qualifies as the body (any area >= 0),
    // and the sealed ring walls the dot off from it - unreachable. Raise the threshold above
    // the speck's area (1) and it no longer qualifies; the ring (the larger component) becomes
    // the body via the largest-component fallback instead, and the dot can reach it directly.
    const bm = bitmapFromStrings([
        '.....#.....',
        '...........',
        '...........',
        '...######..',
        '...#....#..',
        '...#.##.#..',
        '...#.##.#..',
        '...#....#..',
        '...######..',
        '...........',
        '...........',
    ]);
    const dot = findIslands(bm).find((i) => i.area === 4);
    assert.ok(dot, 'the enclosed 2x2 dot is found as an island');

    const strict = applyOps(bm, [{ kind: 'bridge', seed: dot.seed, widthPx: 1 }], 0);
    assert.equal(strict.ops.length, 0, 'the 1 px border speck alone qualifies as the body, walling the ring off');
    assert.deepEqual(strict.dropped.map((d) => d.reason), ['unreachable']);

    const withThreshold = applyOps(bm, [{ kind: 'bridge', seed: dot.seed, widthPx: 1 }], 4);
    assert.equal(withThreshold.ops.length, 1, 'the speck no longer qualifies as body, so the larger ring does instead');
    assert.equal(withThreshold.ops[0].kind, 'bridge');
    assert.ok(withThreshold.ops[0].path.length > 0);
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

test('bridgeIslandTo reaches the given point, ending the path there', () => {
    const bm = framed();
    const a = labelComponents(bm, 1);
    const [island] = findIslands(bm, a);
    const target = [0, 3]; // left wall, straight across from the island at [3, 3]
    const r = bridgeIslandTo(bm, a, island.id, target, 1);
    assert.ok(r);
    assert.deepEqual(r.path[r.path.length - 1], target);
    assert.equal(getPixel(r.bitmap, ...target), 1);
    assert.equal(findIslands(r.bitmap).length, 0);
    assert.equal(findIslands(bm).length, 1, 'input untouched');
});

test('bridgeIslandTo returns null for a target that is not a body pixel', () => {
    const bm = framed();
    const a = labelComponents(bm, 1);
    const [island] = findIslands(bm, a);
    // A plain white interior cell is not black at all, let alone body.
    assert.equal(bridgeIslandTo(bm, a, island.id, [3, 2], 1), null);
    // Out of bounds.
    assert.equal(bridgeIslandTo(bm, a, island.id, [-1, 3], 1), null);
});

test('bridgeIslandTo returns null for a target that is black but belongs to another island', () => {
    const bm = bitmapFromStrings([
        '###########',
        '#.........#',
        '#.#.....#.#',
        '#.........#',
        '###########',
    ]);
    const a = labelComponents(bm, 1);
    const [islandA, islandB] = findIslands(bm, a).sort((p, q) => p.seed[0] - q.seed[0]);
    // islandB's own pixel is black, but it's a different island, not the body.
    assert.equal(bridgeIslandTo(bm, a, islandA.id, islandB.seed, 1), null);
});

test('bridgeIslandTo returns null for a body pixel with no white path across (a sealed corner)', () => {
    const bm = framed();
    const a = labelComponents(bm, 1);
    const [island] = findIslands(bm, a);
    // A frame corner is black (body, part of the border), but both its 4-neighbours are also
    // border cells - no white cell is ever adjacent to it, so no BFS can ever reach it.
    assert.equal(bridgeIslandTo(bm, a, island.id, [0, 0], 1), null);
});

test('applyOps replays a targeted bridge, landing on the same target pixel', () => {
    const bm = framed();
    const target = [0, 3];
    const r = applyOps(bm, [{ kind: 'bridge', seed: [3, 3], widthPx: 1, target }]);
    assert.equal(r.ops.length, 1);
    assert.equal(r.ops[0].kind, 'bridge');
    assert.deepEqual(r.ops[0].target, target);
    assert.deepEqual(r.ops[0].path[r.ops[0].path.length - 1], target);
    assert.equal(findIslands(r.bitmap).length, 0);
});

test('applyOps falls back to the nearest gap when a stale target is no longer body', () => {
    const bm = framed();
    // [3, 2] is a white interior cell in this bitmap, never body - stands in for a target that
    // used to be body before some threshold change invalidated it.
    const staleTarget = [3, 2];
    const r = applyOps(bm, [{ kind: 'bridge', seed: [3, 3], widthPx: 1, target: staleTarget }]);
    assert.equal(r.ops.length, 1, 'the op is kept, not dropped, despite the stale target');
    assert.equal(r.ops[0].kind, 'bridge');
    assert.equal(r.ops[0].fellBack, true, 'flagged so the caller can warn the user');
    assert.equal(r.ops[0].target, undefined, 'the stale target is dropped, not kept around to fail again');
    assert.equal(r.fellBack, 1);
    assert.notDeepEqual(r.ops[0].path[r.ops[0].path.length - 1], staleTarget, 'landed somewhere else via the nearest-gap fallback');
    assert.equal(findIslands(r.bitmap).length, 0);
});

test('applyOps falls back to the nearest gap when the target is body but unreachable across white, and reports it', () => {
    const bm = framed();
    // A frame corner: black (body) but with no adjacent white cell at all, so bridgeIslandTo
    // can never reach it directly - distinct from the "not body at all" case above.
    const target = [0, 0];
    const a = labelComponents(bm, 1);
    const [island] = findIslands(bm, a);
    assert.equal(bridgeIslandTo(bm, a, island.id, target, 1), null, 'unreachable directly, for contrast with the fallback below');

    const r = applyOps(bm, [{ kind: 'bridge', seed: island.seed, widthPx: 1, target }]);
    assert.equal(r.ops.length, 1, 'kept via the fallback, not dropped');
    assert.equal(r.ops[0].fellBack, true);
    assert.equal(r.ops[0].target, undefined);
    assert.equal(r.fellBack, 1);
    assert.equal(findIslands(r.bitmap).length, 0);
});

test('applyOps drops a delete for an island a bridge fused into the body diagonally', () => {
    // A sits alone in a fully walled pocket whose only exit is a single gap; C sits just
    // outside that gap, isolated, not touching the pocket wall or the border. Bridging A
    // routes through the gap, and the stamped path pixel at the gap is 8-adjacent to C
    // (and to the pocket wall itself), physically fusing both into the body even though
    // neither was relabelled. A later delete on C must be dropped, not applied.
    const bm = bitmapFromStrings([
        '###############', // y0
        '#.............#', // y1
        '#.............#', // y2
        '#....#####....#', // y3  pocket top wall
        '#..#.#...#....#', // y4  C at x3; pocket left wall at x5
        '#......#.#....#', // y5  A at x7; gap in the left wall at x5
        '#....#...#....#', // y6
        '#....#####....#', // y7  pocket bottom wall
        '#.............#', // y8
        '#.............#', // y9
        '###############', // y10
    ]);
    const a0 = labelComponents(bm, 1);
    const islands0 = findIslands(bm, a0);
    const A = islands0.find((i) => i.seed[0] === 7 && i.seed[1] === 5);
    const C = islands0.find((i) => i.seed[0] === 3 && i.seed[1] === 4);
    assert.ok(A, 'island A found at its seed');
    assert.ok(C, 'island C found at its seed');

    const ops = [
        { kind: 'bridge', seed: A.seed, widthPx: 1 },
        { kind: 'delete', seed: C.seed },
    ];
    const r = applyOps(bm, ops);
    assert.equal(r.ops.length, 1, 'the delete on C is dropped');
    assert.equal(r.ops[0].kind, 'bridge');
    assert.deepEqual(r.dropped.map((d) => d.reason), ['merged']);
    assert.equal(getPixel(r.bitmap, 3, 4), 1, "C's pixels are still black");
    assert.equal(findIslands(r.bitmap).length, 0);
});
