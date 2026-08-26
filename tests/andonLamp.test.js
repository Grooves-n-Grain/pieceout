import { test } from 'node:test';
import assert from 'node:assert/strict';
import { andonLamp } from '../js/layout/templates/andonLamp.js';

const params = andonLamp.defaults();

test('defaults match the spec', () => {
    assert.deepEqual(params, {
        outerWidth: 150, overallHeight: 200, stockThickness: 12.7, railWidth: 25, legSize: 12.7,
        panelInset: 13, panelThickness: 3.2, panelClearance: 0.5, panelOverlap: 6,
        dowelHoleDia: 6.2, panelDowelsPerRail: 2,
    });
});

test('derive computes every derived dimension', () => {
    const d = andonLamp.derive(params);
    assert.equal(d.railLength, 150);
    assert.equal(d.lapLength, 25);
    assert.equal(d.lapDepth, 6.35);
    assert.equal(d.legLength, 200 - 2 * 12.7);
    assert.equal(d.sidePanelWidth, 150 - 26 - 0.5);
    assert.equal(d.sidePanelHeight, (200 - 25.4) + 12 - 0.5);
    assert.equal(d.lidSize, 150 - 50 - 0.5);
    assert.deepEqual(d.panelHoleXs.map(x => Math.round(x * 100) / 100), [54.23, 95.77]);
});

test('derive applies overrides and keeps dependents consistent', () => {
    const d = andonLamp.derive(params, { legLength: 180 });
    assert.equal(d.legLength, 180);
    assert.equal(d.sidePanelHeight, 180 + 12 - 0.5);
});

test('validate passes for defaults with zero messages', () => {
    const d = andonLamp.derive(params);
    const msgs = andonLamp.validate(params, d);
    assert.deepEqual(msgs, []);
});

test('validate flags the leg-crossing warning for an explicit panelInset/legSize input', () => {
    const crossing = { ...params, panelInset: 8, legSize: 19 };
    const d = andonLamp.derive(crossing);
    const msgs = andonLamp.validate(crossing, d);
    assert.equal(msgs.filter(m => m.level === 'error').length, 0);
    assert.ok(msgs.some(m => m.level === 'warn' && m.field === 'panelInset'));
});

test('validate warns when legSize exceeds stockThickness', () => {
    const wide = { ...params, legSize: 19 };
    const d = andonLamp.derive(wide);
    const msgs = andonLamp.validate(wide, d);
    assert.ok(msgs.some(m => m.level === 'warn' && m.field === 'legSize'));
});

test('validate errors on impossible geometry', () => {
    const bad = { ...params, overallHeight: 20 };
    const d = andonLamp.derive(bad);
    const msgs = andonLamp.validate(bad, d);
    assert.ok(msgs.some(m => m.level === 'error' && m.field === 'overallHeight'));

    const tightRail = { ...params, panelInset: 2 };
    const d2 = andonLamp.derive(tightRail);
    assert.ok(andonLamp.validate(tightRail, d2).some(m => m.level === 'error' && m.field === 'panelInset'));

    const deepOverlap = { ...params, panelOverlap: 20 };
    const d3 = andonLamp.derive(deepOverlap);
    assert.ok(andonLamp.validate(deepOverlap, d3).some(m => m.level === 'error' && m.field === 'panelOverlap'));

    const tooManyDowels = { ...params, panelDowelsPerRail: 9 };
    const d4 = andonLamp.derive(tooManyDowels);
    assert.ok(andonLamp.validate(tooManyDowels, d4).some(m => m.level === 'error' && m.field === 'panelDowelsPerRail'));
});

test('build produces the full parts list with joinery', () => {
    const d = andonLamp.derive(params);
    const parts = andonLamp.build(params, d);
    const byName = Object.fromEntries(parts.map(p => [p.name, p]));

    assert.deepEqual(parts.map(p => [p.name, p.qty, p.material]), [
        ['Rail', 8, 'hardwood'], ['Leg', 4, 'hardwood'],
        ['Side panel', 4, 'basswood'], ['Lid panel', 1, 'basswood'], ['Base panel', 1, 'basswood'],
    ]);

    const rail = byName['Rail'];
    assert.equal(rail.width, 150);
    assert.equal(rail.height, 25);
    assert.equal(rail.grain, 'along-x');
    const pockets = rail.features.filter(f => f.layer === 'POCKET');
    const drills = rail.features.filter(f => f.layer === 'DRILL');
    assert.equal(pockets.length, 2);
    assert.deepEqual(pockets.map(p => p.shape.x), [0, 125]);
    assert.equal(drills.length, 4);
    assert.deepEqual(drills.map(h => [h.shape.cx, h.shape.cy]).slice(0, 2), [[12.5, 12.5], [137.5, 12.5]]);
    assert.equal(drills[2].shape.cy, 13);
    assert.ok(drills.every(h => h.diameter === 6.2));

    const leg = byName['Leg'];
    assert.equal(leg.width, 200 - 25.4);
    assert.equal(leg.height, 12.7);
    assert.equal(leg.features.filter(f => f.layer !== 'GUIDE').length, 0);

    const side = byName['Side panel'];
    assert.equal(side.grain, 'any');
    const guide = side.features.find(f => f.layer === 'GUIDE' && f.shape.kind === 'rect');
    assert.deepEqual(guide.shape, { kind: 'rect', x: 6, y: 6, width: side.width - 12, height: side.height - 12 });

    assert.equal(byName['Lid panel'].width, 99.5);
    assert.equal(byName['Base panel'].height, 99.5);
});

test('validate flags non-positive side panel height without throwing an exception', () => {
    const bad = { ...params, overallHeight: 40, panelOverlap: 0, panelClearance: 30 };
    let d;
    assert.doesNotThrow(() => { d = andonLamp.derive(bad); });
    assert.ok(d.sidePanelHeight < 0);

    let msgs;
    assert.doesNotThrow(() => { msgs = andonLamp.validate(bad, d); });
    assert.ok(msgs.some(m => m.level === 'error' && m.field === 'overallHeight' && /side panel height/i.test(m.message)));
});

test('panel dowel hole margin against the half-lap uses a wall clearance, not a full diameter', () => {
    const d = andonLamp.derive(params);
    // lo = lapLength + dowelHoleDia/2 + MIN_WALL = 25 + 3.1 + 1 = 29.1

    const tooClose = { ...d, panelHoleXs: [29.0] };
    const msgsTooClose = andonLamp.validate(params, tooClose);
    assert.ok(msgsTooClose.some(m => m.level === 'error' && m.field === 'panelDowelsPerRail' && /half-laps/i.test(m.message)));

    const clear = { ...d, panelHoleXs: [29.2] };
    const msgsClear = andonLamp.validate(params, clear);
    assert.equal(msgsClear.filter(m => m.field === 'panelDowelsPerRail').length, 0);
});

test('validate reports an error for legSize 0 without derive or validate throwing', () => {
    const zeroLeg = { ...params, legSize: 0 };
    let d;
    assert.doesNotThrow(() => { d = andonLamp.derive(zeroLeg); });
    let msgs;
    assert.doesNotThrow(() => { msgs = andonLamp.validate(zeroLeg, d); });
    assert.ok(msgs.some(m => m.level === 'error' && m.field === 'legSize'));
});

test('validate reports an error for an overridden lapLength too short for the dowel hole', () => {
    let d;
    assert.doesNotThrow(() => { d = andonLamp.derive(params, { lapLength: 5 }); });
    let msgs;
    assert.doesNotThrow(() => { msgs = andonLamp.validate(params, d); });
    assert.ok(msgs.some(m => m.level === 'error' && m.field === 'railWidth' && /half-lap is too short/i.test(m.message)));
});
