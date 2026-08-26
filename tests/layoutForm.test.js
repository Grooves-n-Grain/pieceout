// tests/layoutForm.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderParamInputs, renderDerived, renderMessages, markInvalid } from '../js/layout/layoutForm.js';

// Minimal DOM stand-in: enough for createElement/appendChild/querySelector by id/class, events, classList.
function fakeDocument() {
    const makeEl = (tag) => {
        const el = {
            tagName: tag.toUpperCase(), children: [], attributes: {}, listeners: {}, dataset: {},
            _text: '', value: '', checked: false, disabled: false, id: '', className: '',
            get ownerDocument() { return doc; },
            set textContent(v) { el._text = String(v); el.children = []; },
            get textContent() { return el._text + el.children.map(c => c.textContent).join(''); },
            set innerHTML(v) { if (v === '') el.children = []; else throw new Error('fake DOM only supports innerHTML = ""'); },
            appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
            append(...cs) { cs.forEach(c => el.appendChild(typeof c === 'string' ? Object.assign(makeEl('#text'), { _text: c }) : c)); },
            setAttribute(k, v) { el.attributes[k] = String(v); if (k === 'id') el.id = v; },
            getAttribute(k) { return el.attributes[k] ?? null; },
            addEventListener(t, fn) { (el.listeners[t] ||= []).push(fn); },
            dispatch(t) { (el.listeners[t] || []).forEach(fn => fn({ target: el })); },
            classList: {
                add: (c) => { const s = new Set(el.className.split(' ').filter(Boolean)); s.add(c); el.className = [...s].join(' '); },
                remove: (c) => { el.className = el.className.split(' ').filter(x => x && x !== c).join(' '); },
                toggle: (c, on) => (on ? el.classList.add(c) : el.classList.remove(c)),
                contains: (c) => el.className.split(' ').includes(c),
            },
            querySelectorAll(sel) { return all(el).filter(e => matches(e, sel)); },
            querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
        };
        return el;
    };
    const all = (el) => el.children.flatMap(c => [c, ...all(c)]);
    const matches = (e, sel) => sel.startsWith('#') ? e.id === sel.slice(1)
        : sel.startsWith('.') ? e.classList.contains(sel.slice(1))
        : e.tagName === sel.toUpperCase();
    const doc = { createElement: makeEl };
    return doc;
}

const schema = [
    { key: 'outerWidth', label: 'Outer width', group: 'lamp', default: 150, min: 20, step: 0.5, unit: 'mm' },
    { key: 'panelDowelsPerRail', label: 'Dowels', group: 'lamp', default: 2, min: 1, step: 1, unit: '', integer: true },
];

test('renderParamInputs builds rows and reports numeric changes', () => {
    const doc = fakeDocument();
    const container = doc.createElement('div');
    const changes = [];
    renderParamInputs(container, schema, { outerWidth: 150, panelDowelsPerRail: 2 }, (k, v) => changes.push([k, v]));
    const rows = container.querySelectorAll('.param-row');
    assert.equal(rows.length, 2);
    const input = container.querySelector('#param-outerWidth');
    assert.equal(input.value, '150');
    assert.equal(input.getAttribute('step'), '0.5');
    input.value = '160';
    input.dispatch('input');
    input.value = 'abc';
    input.dispatch('input');
    assert.deepEqual(changes, [['outerWidth', 160]]);
    assert.ok(input.classList.contains('invalid'));
});

test('renderParamInputs rejects a value below the schema min', () => {
    const doc = fakeDocument();
    const container = doc.createElement('div');
    const changes = [];
    renderParamInputs(container, schema, { outerWidth: 150, panelDowelsPerRail: 2 }, (k, v) => changes.push([k, v]));
    const input = container.querySelector('#param-outerWidth');
    input.value = '10'; // below min: 20
    input.dispatch('input');
    assert.deepEqual(changes, []);
    assert.ok(input.classList.contains('invalid'));
});

test('renderDerived disables inputs until overridden', () => {
    const doc = fakeDocument();
    const container = doc.createElement('div');
    const changes = [];
    renderDerived(container, [{ key: 'legLength', label: 'Leg length' }], { legLength: 174.6 }, {}, (k, v) => changes.push([k, v]));
    const input = container.querySelector('#derived-legLength');
    const box = container.querySelector('#override-legLength');
    assert.equal(input.disabled, true);
    assert.equal(input.value, '174.6');
    box.checked = true;
    box.dispatch('change');
    assert.deepEqual(changes, [['legLength', 174.6]]);
    input.value = '180';
    input.dispatch('input');
    box.checked = false;
    box.dispatch('change');
    assert.deepEqual(changes, [['legLength', 174.6], ['legLength', 180], ['legLength', undefined]]);
});

test('renderMessages and markInvalid', () => {
    const doc = fakeDocument();
    const form = doc.createElement('div');
    renderParamInputs(form, schema, { outerWidth: 150, panelDowelsPerRail: 2 }, () => {});
    const box = doc.createElement('div');
    const fields = renderMessages(box, [
        { level: 'error', field: 'outerWidth', message: 'too small' },
        { level: 'warn', field: 'panelInset', message: 'crosses legs' },
    ]);
    assert.equal(box.querySelectorAll('.msg-error').length, 1);
    assert.equal(box.querySelectorAll('.msg-warn').length, 1);
    assert.deepEqual([...fields], ['outerWidth']);
    markInvalid(form, fields);
    assert.ok(form.querySelector('#param-outerWidth').classList.contains('invalid'));
    assert.ok(!form.querySelector('#param-panelDowelsPerRail').classList.contains('invalid'));
});
