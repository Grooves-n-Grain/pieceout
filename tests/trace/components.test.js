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

test('findIslands falls back to the largest black component as the body when none touch the border', () => {
    // `ring` has a 1-cell white margin all the way around, so neither the ring nor the
    // dot inside it touches the bitmap's actual border. The ring (area 16) is the larger
    // of the two, so it becomes the body and only the dot remains an island.
    const a = labelComponents(ring, 1);
    assert.equal(a.touchesBorder.some(Boolean), false);
    const ringId = a.areas.indexOf(16);
    const dotId = a.areas.indexOf(1);
    assert.equal(a.body[ringId], true);
    assert.equal(a.body[dotId], false);

    const islands = findIslands(ring);
    assert.equal(islands.length, 1);
    assert.equal(islands[0].area, 1);
    assert.deepEqual(islands[0].seed, [3, 3]);
    assert.deepEqual(islands[0].bbox, { x0: 3, y0: 3, x1: 3, y1: 3 });

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

test('a framed drawing with a wide white margin: the frame is the body, everything else is an island', () => {
    // 9x9, all white, with a black 5x5 ring (rows/cols 2..6) and a black dot at the centre.
    const framed = bitmapFromStrings([
        '.........',
        '.........',
        '..#####..',
        '..#...#..',
        '..#.#.#..',
        '..#...#..',
        '..#####..',
        '.........',
        '.........',
    ]);
    const a = labelComponents(framed, 1);
    assert.equal(a.count, 2);
    assert.equal(a.touchesBorder.some(Boolean), false, 'nothing touches the actual bitmap border');
    const ringId = a.areas.indexOf(16);
    const dotId = a.areas.indexOf(1);
    assert.equal(a.body[ringId], true, 'the largest component (the frame) becomes the body');
    assert.equal(a.body[dotId], false);

    const islands = findIslands(framed, a);
    assert.equal(islands.length, 1);
    assert.deepEqual(islands[0].seed, [4, 4]);
});

test('findIslands sorts islands largest first when a border-touching frame is present', () => {
    // A real border-touching frame (so the white-margin fallback never engages) with a 2x2
    // blob and a single dot floating free inside it, at different distances from nothing in
    // particular - just two plain islands of different sizes to check the sort order.
    const bm = bitmapFromStrings([
        '#########',
        '#.......#',
        '#.##....#',
        '#.##....#',
        '#.......#',
        '#.....#.#',
        '#.......#',
        '#.......#',
        '#########',
    ]);
    const islands = findIslands(bm);
    assert.equal(islands.length, 2);
    assert.equal(islands[0].area, 4, 'the 2x2 blob is listed first');
    assert.equal(islands[1].area, 1, 'the single dot is listed second');
});

test('body for a white (colour 0) analysis is just a copy of touchesBorder', () => {
    const a = labelComponents(ring, 0);
    assert.deepEqual(a.body, a.touchesBorder);
    assert.notEqual(a.body, a.touchesBorder, 'body is a fresh array, not the same reference');
});

test('labelComponents never recurses (large blob)', () => {
    const size = 600;
    const data = new Uint8Array(size * size).fill(1);
    const a = labelComponents({ width: size, height: size, data }, 1);
    assert.equal(a.count, 1);
    assert.equal(a.areas[1], size * size);
});

test('a border-touching speck under minBodyAreaPx does not defeat the body fallback', () => {
    // 9x9: a 1px white margin, a 5x5 black frame (rows/cols 1..5) with a dot inside it, and a
    // single black pixel riding the actual bitmap border at (8, 8) - a 1px "speck" that
    // touches the border but is too small to count as a body candidate at minBodyAreaPx 4.
    // Before this fix, that lone border touch alone would satisfy touchesBorder.some(Boolean)
    // and suppress the largest-component fallback entirely, wrongly leaving the frame (which
    // never touches the border, thanks to the margin) as just another island.
    const framed = bitmapFromStrings([
        '.........',
        '.#####...',
        '.#...#...',
        '.#.#.#...',
        '.#...#...',
        '.#####...',
        '.........',
        '.........',
        '........#',
    ]);
    const a = labelComponents(framed, 1, 4);
    assert.equal(a.count, 3, 'frame, dot, and the border speck');
    const frameId = a.areas.indexOf(16);
    const speckId = a.bboxes.findIndex(b => b && b.x0 === 8 && b.y0 === 8);
    const dotId = 6 - frameId - speckId; // the remaining id of {1, 2, 3}

    assert.equal(a.touchesBorder[speckId], true, 'the speck really does touch the border');
    assert.equal(a.body[speckId], false, 'too small to qualify as body despite touching the border');
    assert.equal(a.body[frameId], true, 'the frame becomes the body via the largest-component fallback');
    assert.equal(a.body[dotId], false);

    // findIslands is unchanged: it still just asks `body`, so the disqualified speck - not
    // being body - is still reported as its own (tiny) island alongside the enclosed dot.
    const islands = findIslands(framed, a).map(isl => isl.id).sort();
    assert.deepEqual(islands, [dotId, speckId].sort());
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
