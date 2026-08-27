import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNumbering, seedKey, bulkTargets } from '../../js/trace/islandNumbers.js';

function island(id, seed, area = 10) {
    return { id, area, bbox: { x0: 0, y0: 0, x1: 0, y1: 0 }, seed };
}

test('first call numbers islands 1..n in the given order', () => {
    const numbering = createNumbering();
    const islands = [island(1, [5, 5]), island(2, [10, 10]), island(3, [15, 15])];
    const result = numbering.assign(islands);
    assert.deepEqual(result.map(i => i.number), [1, 2, 3]);
    assert.deepEqual(result.map(i => seedOf(i)), [[5, 5], [10, 10], [15, 15]]);
});

function seedOf(i) {
    return i.seed;
}

test('removing the middle island keeps the others\' numbers', () => {
    const numbering = createNumbering();
    const a = island(1, [1, 1]);
    const b = island(2, [2, 2]);
    const c = island(3, [3, 3]);
    numbering.assign([a, b, c]);

    const result = numbering.assign([a, c]);
    const byKey = Object.fromEntries(result.map(i => [i.seed.join(','), i.number]));
    assert.equal(byKey['1,1'], 1);
    assert.equal(byKey['3,3'], 3);
});

test('a new island gets n+1, not a freed number', () => {
    const numbering = createNumbering();
    const a = island(1, [1, 1]);
    const b = island(2, [2, 2]);
    const c = island(3, [3, 3]);
    numbering.assign([a, b, c]);
    numbering.assign([a, c]); // b (number 2) retired

    const d = island(4, [4, 4]);
    const result = numbering.assign([a, c, d]);
    const byKey = Object.fromEntries(result.map(i => [i.seed.join(','), i.number]));
    assert.equal(byKey['4,4'], 4, 'new island gets next unused number, not the freed 2');
});

test('a re-appearing key (same seed) gets its old number back', () => {
    const numbering = createNumbering();
    const a = island(1, [1, 1]);
    const b = island(2, [2, 2]);
    const c = island(3, [3, 3]);
    numbering.assign([a, b, c]);
    numbering.assign([a, c]); // b gone

    const bAgain = island(99, [2, 2]); // same seed, different id
    const result = numbering.assign([a, bAgain, c]);
    const byKey = Object.fromEntries(result.map(i => [i.seed.join(','), i.number]));
    assert.equal(byKey['2,2'], 2, 're-appearing seed keeps its original number');
});

test('the returned array is sorted by number and does not mutate the input', () => {
    const numbering = createNumbering();
    const a = island(1, [1, 1]);
    const b = island(2, [2, 2]);
    const c = island(3, [3, 3]);
    numbering.assign([a, b, c]);
    numbering.assign([a, c]); // b retired, number 2 freed

    const d = island(4, [4, 4]);
    // Give them out of number order to confirm sorting happens.
    const input = [d, a, c];
    const inputSnapshot = input.map(i => ({ ...i }));
    const result = numbering.assign(input);

    assert.deepEqual(result.map(i => i.number), [1, 3, 4]);
    // Input array/objects must be untouched.
    assert.deepEqual(input, inputSnapshot);
    assert.equal('number' in input[0], false);
});

test('seedKey formats a [x, y] seed as "x,y"', () => {
    assert.equal(seedKey([5, 12]), '5,12');
    assert.equal(seedKey([0, 0]), '0,0');
});

test('bulkTargets returns only the non-kept islands', () => {
    const a = { ...island(1, [1, 1]), kept: false };
    const b = { ...island(2, [2, 2]), kept: true };
    const c = { ...island(3, [3, 3]), kept: false };
    assert.deepEqual(bulkTargets([a, b, c]), [a, c]);
});

test('bulkTargets treats a missing kept flag as not kept', () => {
    const a = island(1, [1, 1]);
    assert.deepEqual(bulkTargets([a]), [a]);
});
