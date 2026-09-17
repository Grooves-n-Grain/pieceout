// tests/units.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    UNITS, STORAGE_KEY, loadUnits, saveUnits, getUnits, setUnits, onUnitsChange,
    displayUnit, toDisplay, fromDisplay, formatDisplay, displayStep, formatLength, formatArea,
} from '../js/units.js';

test('displayUnit maps mm/mm2 to in/in2 only for inches, everything else passes through', () => {
    assert.equal(displayUnit('mm', 'mm'), 'mm');
    assert.equal(displayUnit('mm', 'in'), 'in');
    assert.equal(displayUnit('mm2', 'mm'), 'mm2');
    assert.equal(displayUnit('mm2', 'in'), 'in2');
    assert.equal(displayUnit('px', 'in'), 'px');
    assert.equal(displayUnit('%', 'in'), '%');
    assert.equal(displayUnit('', 'in'), '');
});

test('toDisplay/fromDisplay convert only mm and mm2, identity otherwise, and round-trip', () => {
    assert.equal(toDisplay(25.4, 'mm', 'in'), 1);
    assert.equal(fromDisplay(1, 'mm', 'in'), 25.4);
    assert.equal(toDisplay(645.16, 'mm2', 'in'), 1);
    assert.equal(fromDisplay(1, 'mm2', 'in'), 645.16);
    assert.equal(toDisplay(12.7, 'mm', 'mm'), 12.7);
    assert.equal(toDisplay(5, 'px', 'in'), 5);
    assert.equal(fromDisplay(5, '', 'in'), 5);
    assert.equal(toDisplay(null, 'mm', 'in'), null);
    assert.equal(toDisplay(undefined, 'mm', 'in'), undefined);
    assert.equal(fromDisplay(null, 'mm', 'in'), null);

    // 12.7 mm -> "0.5" in -> back to 12.7 mm
    const displayed = toDisplay(12.7, 'mm', 'in');
    assert.equal(displayed, 0.5);
    assert.equal(fromDisplay(displayed, 'mm', 'in'), 12.7);
});

test('formatDisplay: mm keeps the raw value, inches round to 3 decimals and trim trailing zeros', () => {
    assert.equal(formatDisplay(12.7, 'mm', 'mm'), '12.7');
    assert.equal(formatDisplay(12.7, 'mm', 'in'), '0.5');
    assert.equal(formatDisplay(13, 'mm', 'in'), '0.512');
    assert.equal(formatDisplay(0, 'mm', 'in'), '0');
    assert.equal(formatDisplay(128, '', 'in'), '128');
    assert.equal(formatDisplay(null, 'mm', 'in'), 'null');
});

test('formatDisplay handles mm2 the same way', () => {
    assert.equal(formatDisplay(645.16, 'mm2', 'in'), '1');
    assert.equal(formatDisplay(100, 'mm2', 'mm'), '100');
});

test('displayStep picks the largest ladder rung <= stepMm/25.4, minimum 0.001, identity for mm', () => {
    assert.equal(displayStep(0.5, 'mm', 'mm'), 0.5);
    assert.equal(displayStep(1, 'mm', 'in'), 0.01); // 1/25.4 = 0.0394 -> largest rung <= that is 0.01
    assert.equal(displayStep(25.4, 'mm', 'in'), 1); // exactly 1 inch step
    assert.equal(displayStep(0.1, '', 'in'), 0.1); // non-length unit: identity
    assert.equal(displayStep(0.01, 'mm', 'in'), 0.001); // 0.01/25.4 is tiny -> floor to minimum
});

test('displayStep worked example: a 0.5mm step in inches', () => {
    // 0.5 / 25.4 = 0.0196... -> largest rung <= that is 0.01
    assert.equal(displayStep(0.5, 'mm', 'in'), 0.01);
});

test('formatLength and formatArea append the right unit suffix', () => {
    assert.equal(formatLength(1, 'mm'), '1 mm');
    assert.equal(formatLength(25.4, 'in'), '1 in');
    assert.equal(formatArea(5, 'mm'), '5.0 mm2');
    assert.equal(formatArea(0.3, 'in'), '0.0005 in2');
    assert.equal(formatArea(0, 'in'), '0 in2');
    assert.equal(formatArea(645.16, 'in'), '1 in2');
    assert.equal(formatArea(645.16, 'in'), '1 in2');
});

test('loadUnits defaults to mm and is tolerant of a missing or garbage store', () => {
    assert.equal(loadUnits(undefined), 'mm');
    assert.equal(loadUnits({ getItem: () => null }), 'mm');
    assert.equal(loadUnits({ getItem: () => 'garbage' }), 'mm');
    assert.equal(loadUnits({ getItem: () => 'in' }), 'in');
    assert.equal(loadUnits({ getItem: () => { throw new Error('nope'); } }), 'mm');
});

test('saveUnits tolerates a throwing store and writes through a working one', () => {
    assert.doesNotThrow(() => saveUnits('in', { setItem: () => { throw new Error('nope'); } }));
    const writes = [];
    saveUnits('in', { setItem: (k, v) => writes.push([k, v]) });
    assert.deepEqual(writes, [[STORAGE_KEY, 'in']]);
});

test('setUnits notifies listeners once and only when the value actually changes', () => {
    setUnits('mm'); // reset any state from earlier tests in this process
    const calls = [];
    const unsubscribe = onUnitsChange((u) => calls.push(u));
    setUnits('mm'); // no-op, already mm
    assert.deepEqual(calls, []);
    setUnits('in');
    assert.deepEqual(calls, ['in']);
    setUnits('in'); // no-op, already in
    assert.deepEqual(calls, ['in']);
    setUnits('mm');
    assert.deepEqual(calls, ['in', 'mm']);
    assert.equal(getUnits(), 'mm');
    unsubscribe();
    setUnits('in');
    assert.deepEqual(calls, ['in', 'mm']); // no longer listening
    setUnits('mm'); // reset for other tests
});

test('UNITS enum has the expected values', () => {
    assert.deepEqual(UNITS, { MM: 'mm', IN: 'in' });
});
