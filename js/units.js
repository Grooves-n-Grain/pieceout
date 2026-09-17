// js/units.js
/**
 * Global metric/imperial display toggle. Pure and DOM-free: internal state, math, storage and
 * SVG export stay in millimetres everywhere else in the app; this module only converts what the
 * user sees. Imperial display is always decimal inches (never fractions), rounded to 3 decimals
 * with trailing zeros trimmed.
 */

export const UNITS = { MM: 'mm', IN: 'in' };
export const STORAGE_KEY = 'pieceout-units';

const MM_PER_IN = 25.4;
const MM2_PER_IN2 = 645.16;

// Inch step ladder for arrow-key increments on <input type="number">; picking a value off this
// ladder keeps steps at "nice" inch fractions instead of an ugly mm-derived decimal.
const IN_STEP_LADDER = [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1];

let currentUnits = UNITS.MM;
const listeners = new Set();

/** Reads the saved units preference; defaults to 'mm' when missing, garbage, or the store throws. */
export function loadUnits(store = globalThis.localStorage) {
    try {
        const raw = store?.getItem(STORAGE_KEY);
        return raw === UNITS.IN ? UNITS.IN : UNITS.MM;
    } catch {
        return UNITS.MM;
    }
}

/** Persists the units preference; silently no-ops when the store is unavailable. */
export function saveUnits(units, store = globalThis.localStorage) {
    try {
        store?.setItem(STORAGE_KEY, units === UNITS.IN ? UNITS.IN : UNITS.MM);
    } catch {
        // Storage unavailable (private mode, quota); the toggle still works for this session.
    }
}

export function getUnits() {
    return currentUnits;
}

/** Sets the active units and notifies listeners, but only when the value actually changed. */
export function setUnits(units) {
    const next = units === UNITS.IN ? UNITS.IN : UNITS.MM;
    if (next === currentUnits) return;
    currentUnits = next;
    for (const fn of listeners) fn(currentUnits);
}

/** Subscribes to units changes; returns an unsubscribe function. */
export function onUnitsChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Maps a schema unit ('mm', 'mm2', or anything else) to what should be shown for the active units. */
export function displayUnit(schemaUnit, units) {
    if (units !== UNITS.IN) return schemaUnit;
    if (schemaUnit === 'mm') return 'in';
    if (schemaUnit === 'mm2') return 'in2';
    return schemaUnit;
}

/** Converts a value stored in mm (or mm2) into the active display units. Identity otherwise. */
export function toDisplay(valueMm, schemaUnit, units) {
    if (valueMm === null || valueMm === undefined) return valueMm;
    if (units !== UNITS.IN) return valueMm;
    if (schemaUnit === 'mm') return valueMm / MM_PER_IN;
    if (schemaUnit === 'mm2') return valueMm / MM2_PER_IN2;
    return valueMm;
}

/** Converts a value the user typed in the active display units back into mm (or mm2). */
export function fromDisplay(value, schemaUnit, units) {
    if (value === null || value === undefined) return value;
    if (units !== UNITS.IN) return value;
    if (schemaUnit === 'mm') return value * MM_PER_IN;
    if (schemaUnit === 'mm2') return value * MM2_PER_IN2;
    return value;
}

function round3(n) {
    return Math.round(n * 1000) / 1000;
}

/**
 * Formats a stored mm value for display: mm keeps today's behaviour (the raw number, unrounded);
 * inches round to 3 decimals with trailing zeros trimmed (String() on a rounded number does that
 * for free). Non-length/area units are never converted or rounded.
 */
export function formatDisplay(valueMm, schemaUnit, units) {
    if (valueMm === null || valueMm === undefined) return String(valueMm);
    const isLengthOrArea = schemaUnit === 'mm' || schemaUnit === 'mm2';
    if (units === UNITS.IN && isLengthOrArea) {
        return String(round3(toDisplay(valueMm, schemaUnit, units)));
    }
    return String(valueMm);
}

/**
 * Picks the display-space step for a number input from an mm step: for inches, the largest rung
 * of IN_STEP_LADDER that is <= stepMm/25.4 (minimum 0.001 inch). Identity for mm and for any
 * schema unit that isn't a length/area ('mm' or 'mm2').
 */
export function displayStep(stepMm, schemaUnit, units) {
    const isLengthOrArea = schemaUnit === 'mm' || schemaUnit === 'mm2';
    if (units !== UNITS.IN || !isLengthOrArea) return stepMm;
    const target = stepMm / MM_PER_IN;
    let chosen = IN_STEP_LADDER[0];
    for (const rung of IN_STEP_LADDER) {
        if (rung <= target) chosen = rung;
    }
    return chosen;
}

/** "1 mm" / "0.039 in" - a length with its unit suffix, for messages and readouts. */
export function formatLength(mm, units) {
    return `${formatDisplay(mm, 'mm', units)} ${displayUnit('mm', units)}`;
}

/**
 * "12.5 mm2" / "0.019 in2" - an area with its unit suffix. mm2 keeps the existing threshold
 * (one decimal under 10, whole numbers above) that traceSidebar.js used before this module
 * existed; in2 always rounds to 3 decimals like every other inch value.
 */
export function formatArea(mm2, units) {
    const unit = displayUnit('mm2', units);
    if (units !== UNITS.IN) {
        const s = mm2 < 10 ? mm2.toFixed(1) : String(Math.round(mm2));
        return `${s} ${unit}`;
    }
    const in2 = toDisplay(mm2, 'mm2', units);
    // Islands are often well under a hundredth of a square inch; three decimals would show 0.
    if (in2 > 0 && in2 < 0.01) return `${in2.toFixed(4)} ${unit}`;
    return `${formatDisplay(mm2, 'mm2', units)} ${unit}`;
}
