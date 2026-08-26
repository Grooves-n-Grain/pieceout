import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPart, addRect, addCircle, addLabel, Material, Grain, Layer } from '../js/layout/parts.js';
import { defaultMachine, sheetSize, validateMachine } from '../js/layout/machine.js';
import { nest, rotatePart, NestError } from '../js/layout/nest.js';

test('defaultMachine and sheetSize', () => {
    const m = defaultMachine();
    assert.deepEqual(m, {
        bitDiameter: 6, gutter: 9, edgeMargin: 15,
        hardwoodSheetWidth: 300, hardwoodSheetHeight: 600,
        basswoodSheetWidth: 300, basswoodSheetHeight: 300,
    });
    assert.deepEqual(sheetSize(m, Material.BASSWOOD), { width: 300, height: 300 });
    assert.equal(validateMachine(m).length, 0);
    assert.ok(validateMachine({ ...m, gutter: 4 }).some(e => e.field === 'gutter'));
    assert.ok(validateMachine({ ...m, edgeMargin: 200 }).some(e => e.field === 'edgeMargin'));
});

test('rotatePart rotates size and features clockwise', () => {
    const p = createPart({ name: 'P', material: Material.BASSWOOD, width: 100, height: 40, grain: Grain.ANY });
    addRect(p, { layer: Layer.GUIDE, x: 10, y: 5, width: 20, height: 10 });
    addCircle(p, { layer: Layer.DRILL, cx: 90, cy: 30, diameter: 6 });
    addLabel(p, { text: 'P', x: 3, y: 6 });
    const r = rotatePart(p);
    assert.equal(r.width, 40);
    assert.equal(r.height, 100);
    assert.deepEqual(r.features[0].shape, { kind: 'rect', x: 40 - 5 - 10, y: 10, width: 10, height: 20 });
    assert.deepEqual(r.features[1].shape, { kind: 'circle', cx: 10, cy: 90, r: 3 });
    assert.deepEqual(r.features[2].shape, { kind: 'text', x: 34, y: 3, text: 'P' });
    assert.equal(p.width, 100, 'original untouched');
});

function overlaps(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function boxes(sheet, gutter) {
    return sheet.placements.map(pl => ({
        x: pl.x, y: pl.y, w: pl.part.width + gutter, h: pl.part.height + gutter,
    }));
}

test('nest packs by material, respects margins, gutter and grain', () => {
    const m = defaultMachine();
    const rail = createPart({ name: 'Rail', material: Material.HARDWOOD, width: 150, height: 25, qty: 8 });
    const leg = createPart({ name: 'Leg', material: Material.HARDWOOD, width: 174.6, height: 19, qty: 4 });
    const panel = createPart({ name: 'Side panel', material: Material.BASSWOOD, width: 133.5, height: 186.1, grain: Grain.ANY, qty: 4 });
    const sheets = nest([rail, leg, panel], m);

    const hard = sheets.filter(s => s.material === 'hardwood');
    const soft = sheets.filter(s => s.material === 'basswood');
    assert.equal(hard.length, 1);
    assert.equal(hard[0].placements.length, 12);
    assert.deepEqual([hard[0].width, hard[0].height], [300, 600]);
    assert.ok(soft.length >= 2, 'four big panels need more than one 300x300 sheet');
    assert.deepEqual(soft.map(s => s.index), soft.map((_, i) => i + 1));

    for (const sheet of sheets) {
        const gutter = m.gutter;
        const bs = boxes(sheet, gutter);
        for (const pl of sheet.placements) {
            assert.ok(pl.x >= m.edgeMargin && pl.y >= m.edgeMargin, 'inside margin');
            assert.ok(pl.x + pl.part.width <= sheet.width - m.edgeMargin, 'inside right margin');
            assert.ok(pl.y + pl.part.height <= sheet.height - m.edgeMargin, 'inside bottom margin');
            assert.equal(pl.part.qty, 1);
            if (pl.part.grain === Grain.ALONG_X) assert.equal(pl.rotated, false);
        }
        for (let i = 0; i < bs.length; i++) {
            for (let j = i + 1; j < bs.length; j++) {
                assert.ok(!overlaps(bs[i], bs[j]), `parts ${i} and ${j} overlap or violate the gutter on ${sheet.material} ${sheet.index}`);
            }
        }
    }

    const names = hard[0].placements.map(pl => pl.part.name).sort();
    assert.equal(names[0], 'Leg 1');
    assert.ok(names.includes('Rail 8'));
});

test('nest rotates a grain-any part that only fits sideways', () => {
    const m = { ...defaultMachine(), basswoodSheetWidth: 200, basswoodSheetHeight: 400 };
    const wide = createPart({ name: 'Wide', material: Material.BASSWOOD, width: 250, height: 50, grain: Grain.ANY });
    const [sheet] = nest([wide], m);
    assert.equal(sheet.placements[0].rotated, true);
    assert.equal(sheet.placements[0].part.width, 50);
    assert.equal(sheet.placements[0].part.height, 250);
});

test('nest throws NestError for a part that cannot fit', () => {
    const m = defaultMachine();
    const huge = createPart({ name: 'Huge', material: Material.HARDWOOD, width: 700, height: 20 });
    assert.throws(() => nest([huge], m), (err) => err instanceof NestError && err.part === 'Huge');
});
