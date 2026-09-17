// js/layout/layoutForm.js
/**
 * Schema-driven form rendering for the Layout sidebar. Pure DOM building;
 * no state lives here. Every function reads `document` from the container so
 * it can be exercised under Node with a fake DOM.
 */
import { toDisplay, fromDisplay, formatDisplay, displayUnit, displayStep } from '../units.js';

function el(doc, tag, attrs = {}, text) {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'className') node.className = v;
        else node.setAttribute(k, v);
    }
    if (text !== undefined) node.textContent = text;
    return node;
}

/**
 * Native hover help: the schema's `help` string becomes a `title` on both the label
 * and its control, and the label is flagged so CSS can hint that help exists.
 */
function applyHelp(label, control, help) {
    if (!help) return;
    label.setAttribute('title', help);
    label.classList.add('has-help');
    control.setAttribute('title', help);
}

const OVERRIDE_HELP = 'Tick to type your own value instead of the computed one. Untick to return to the formula.';

function parseNumber(input, integer) {
    const n = integer ? parseInt(input.value, 10) : parseFloat(input.value);
    return Number.isFinite(n) ? n : null;
}

/**
 * A schema min/max/derived-floor value, in mm, rendered as a plain number for an input
 * attribute: identity in mm, converted and rounded to 3 decimals in inches (matching
 * formatDisplay's rounding for typed/displayed values, but returning a number, not a string).
 */
function roundedDisplay(mmValue, schemaUnit, units) {
    if (mmValue === undefined) return undefined;
    const v = toDisplay(mmValue, schemaUnit, units);
    const isLengthOrArea = schemaUnit === 'mm' || schemaUnit === 'mm2';
    return units === 'in' && isLengthOrArea ? Math.round(v * 1000) / 1000 : v;
}

export function renderParamInputs(container, schema, values, onChange, { units = 'mm' } = {}) {
    const doc = container.ownerDocument;
    container.innerHTML = '';
    for (const def of schema) {
        const row = el(doc, 'div', { className: 'param-row' });
        const id = `param-${def.key}`;
        const label = el(doc, 'label', { for: id }, def.label);
        row.appendChild(label);
        if (def.type === 'boolean') {
            const box = el(doc, 'input', { type: 'checkbox', id });
            box.checked = Boolean(values[def.key]);
            box.addEventListener('change', () => onChange(def.key, box.checked));
            applyHelp(label, box, def.help);
            row.appendChild(box);
            row.appendChild(el(doc, 'span', { className: 'unit' }, ''));
            container.appendChild(row);
            continue;
        }
        const schemaUnit = def.unit || '';
        const attrs = {
            type: 'number', id,
            min: roundedDisplay(def.min, schemaUnit, units),
            step: displayStep(def.step, schemaUnit, units),
        };
        if (def.max !== undefined) attrs.max = roundedDisplay(def.max, schemaUnit, units);
        const input = el(doc, 'input', attrs);
        input.value = formatDisplay(values[def.key], schemaUnit, units);
        input.addEventListener('input', () => {
            const typed = parseNumber(input, def.integer);
            const n = typed !== null ? fromDisplay(typed, schemaUnit, units) : null;
            const belowMin = n !== null && def.min !== undefined && n < def.min;
            const aboveMax = n !== null && def.max !== undefined && n > def.max;
            input.classList.toggle('invalid', n === null || belowMin || aboveMax);
            if (n !== null && !belowMin && !aboveMax) onChange(def.key, n);
        });
        applyHelp(label, input, def.help);
        row.appendChild(input);
        row.appendChild(el(doc, 'span', { className: 'unit' }, displayUnit(schemaUnit, units)));
        container.appendChild(row);
    }
}

export function renderDerived(container, derivedFields, derived, overrides, onChange, { units = 'mm' } = {}) {
    const doc = container.ownerDocument;
    container.innerHTML = '';
    for (const def of derivedFields) {
        const row = el(doc, 'div', { className: 'param-row' });
        const id = `derived-${def.key}`;
        const overridden = overrides[def.key] !== undefined;
        const schemaUnit = def.unit || 'mm';
        // No room for a fourth (unit) column here (label | input | override checkbox), so the
        // unit rides along on the label text instead - only for inches, so the plain-mm case
        // (the overwhelming common one) renders exactly as it always has.
        const labelText = units === 'in' ? `${def.label} (${displayUnit(schemaUnit, units)})` : def.label;
        const label = el(doc, 'label', { for: id }, labelText);
        row.appendChild(label);
        const input = el(doc, 'input', {
            type: 'number', id,
            step: displayStep(0.1, schemaUnit, units),
            min: roundedDisplay(0.1, schemaUnit, units),
        });
        input.value = formatDisplay(derived[def.key], schemaUnit, units);
        input.disabled = !overridden;
        applyHelp(label, input, def.help);
        input.addEventListener('input', () => {
            const typed = parseNumber(input, false);
            const n = typed !== null ? fromDisplay(typed, schemaUnit, units) : null;
            const belowMin = n !== null && n < 0.1;
            input.classList.toggle('invalid', n === null || belowMin);
            if (n !== null && !belowMin) onChange(def.key, n);
        });
        row.appendChild(input);
        const box = el(doc, 'input', { type: 'checkbox', id: `override-${def.key}`, title: OVERRIDE_HELP });
        box.checked = overridden;
        box.addEventListener('change', () => {
            input.disabled = !box.checked;
            if (!box.checked) { onChange(def.key, undefined); return; }
            const typed = parseNumber(input, false);
            onChange(def.key, typed !== null ? fromDisplay(typed, schemaUnit, units) : derived[def.key]);
        });
        row.appendChild(box);
        container.appendChild(row);
    }
}

/** Render messages; returns the Set of field keys that have errors. */
export function renderMessages(container, messages, labels = {}) {
    const doc = container.ownerDocument;
    container.innerHTML = '';
    const errorFields = new Set();
    for (const m of messages) {
        const label = labels[m.field] || m.field;
        container.appendChild(el(doc, 'div', { className: `msg msg-${m.level}` }, `${label}: ${m.message}`));
        if (m.level === 'error') errorFields.add(m.field);
    }
    return errorFields;
}

export function markInvalid(formContainer, errorFields) {
    for (const input of formContainer.querySelectorAll('input')) {
        if (!input.id.startsWith('param-')) continue;
        const key = input.id.slice('param-'.length);
        input.classList.toggle('invalid', errorFields.has(key));
    }
}
