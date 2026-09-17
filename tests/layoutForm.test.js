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

test('renderParamInputs rejects a value above the schema max', () => {
    const doc = fakeDocument();
    const container = doc.createElement('div');
    const changes = [];
    const maxSchema = [{ key: 'threshold', label: 'Threshold', min: 1, max: 254, step: 1, integer: true }];
    renderParamInputs(container, maxSchema, { threshold: 128 }, (k, v) => changes.push([k, v]));
    const input = container.querySelector('#param-threshold');
    assert.equal(input.getAttribute('max'), '254');
    input.value = '300'; // above max: 254
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

test('renderParamInputs renders boolean rows as checkboxes', () => {
    const doc = fakeDocument();
    const container = doc.createElement('div');
    const changes = [];
    renderParamInputs(container, [{ key: 'invert', label: 'Invert', group: 'image', type: 'boolean', default: false }], { invert: false }, (k, v) => changes.push([k, v]));
    const box = container.querySelector('#param-invert');
    assert.equal(box.getAttribute('type'), 'checkbox');
    assert.equal(box.checked, false);
    box.checked = true;
    box.dispatch('change');
    assert.deepEqual(changes, [['invert', true]]);
});

test('renderParamInputs puts schema help on the label and input as a native tooltip', () => {
    const doc = fakeDocument();
    const container = doc.createElement('div');
    const helped = [
        { key: 'gutter', label: 'Gutter', min: 0, step: 0.5, unit: 'mm', help: 'Space between parts.' },
        { key: 'invert', label: 'Invert', type: 'boolean', default: false, help: 'Swap which side is cut.' },
        { key: 'plain', label: 'Plain', min: 0, step: 1 },
    ];
    renderParamInputs(container, helped, { gutter: 9, invert: false, plain: 1 }, () => {});
    const labels = container.querySelectorAll('label');
    assert.equal(labels[0].getAttribute('title'), 'Space between parts.');
    assert.ok(labels[0].classList.contains('has-help'));
    assert.equal(container.querySelector('#param-gutter').getAttribute('title'), 'Space between parts.');
    assert.equal(labels[1].getAttribute('title'), 'Swap which side is cut.');
    assert.equal(container.querySelector('#param-invert').getAttribute('title'), 'Swap which side is cut.');
    assert.equal(labels[2].getAttribute('title'), null);
    assert.ok(!labels[2].classList.contains('has-help'));
    assert.equal(container.querySelector('#param-plain').getAttribute('title'), null);
});

test('renderDerived puts help on the label and value, and explains the override box', () => {
    const doc = fakeDocument();
    const container = doc.createElement('div');
    renderDerived(container, [
        { key: 'legLength', label: 'Leg length', help: 'Computed as height minus two thicknesses.' },
        { key: 'lidSize', label: 'Lid size' },
    ], { legLength: 174.6, lidSize: 99.5 }, {}, () => {});
    const labels = container.querySelectorAll('label');
    assert.equal(labels[0].getAttribute('title'), 'Computed as height minus two thicknesses.');
    assert.ok(labels[0].classList.contains('has-help'));
    assert.equal(container.querySelector('#derived-legLength').getAttribute('title'), 'Computed as height minus two thicknesses.');
    assert.equal(labels[1].getAttribute('title'), null);
    assert.ok(!labels[1].classList.contains('has-help'));
    const box = container.querySelector('#override-legLength');
    assert.match(box.getAttribute('title'), /computed/i);
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

test('renderParamInputs with { units: "in" } converts displayed value and round-trips onChange in mm', () => {
    const doc = fakeDocument();
    const container = doc.createElement('div');
    const changes = [];
    renderParamInputs(container, schema, { outerWidth: 12.7, panelDowelsPerRail: 2 }, (k, v) => changes.push([k, v]), { units: 'in' });
    const input = container.querySelector('#param-outerWidth');
    assert.equal(input.value, '0.5');
    const row = container.querySelectorAll('.param-row')[0];
    assert.equal(row.querySelector('.unit').textContent, 'in');
    input.value = '1';
    input.dispatch('input');
    assert.deepEqual(changes, [['outerWidth', 25.4]]);
});

test('renderParamInputs with units: in rejects a value below the schema min, compared in mm', () => {
    const doc = fakeDocument();
    const container = doc.createElement('div');
    const changes = [];
    renderParamInputs(container, schema, { outerWidth: 150, panelDowelsPerRail: 2 }, (k, v) => changes.push([k, v]), { units: 'in' });
    const input = container.querySelector('#param-outerWidth');
    // schema min is 20mm (~0.787in); typing 0.5in (12.7mm) is below that mm-space min.
    input.value = '0.5';
    input.dispatch('input');
    assert.deepEqual(changes, []);
    assert.ok(input.classList.contains('invalid'));
});

test('renderDerived with units: in shows the converted value and appends the unit to the label', () => {
    const doc = fakeDocument();
    const container = doc.createElement('div');
    const changes = [];
    renderDerived(container, [{ key: 'legLength', label: 'Leg length', unit: 'mm', help: 'x' }], { legLength: 12.7 }, {}, (k, v) => changes.push([k, v]), { units: 'in' });
    const input = container.querySelector('#derived-legLength');
    const label = container.querySelectorAll('label')[0];
    assert.equal(input.value, '0.5');
    assert.equal(label.textContent, 'Leg length (in)');
    const box = container.querySelector('#override-legLength');
    box.checked = true;
    box.dispatch('change');
    input.value = '1';
    input.dispatch('input');
    assert.deepEqual(changes, [['legLength', 12.7], ['legLength', 25.4]]);
});

test('renderParamInputs and renderDerived without the units option behave exactly as before', () => {
    const doc = fakeDocument();
    const container = doc.createElement('div');
    renderParamInputs(container, schema, { outerWidth: 150, panelDowelsPerRail: 2 }, () => {});
    assert.equal(container.querySelector('#param-outerWidth').value, '150');
    assert.equal(container.querySelectorAll('.param-row')[0].querySelector('.unit').textContent, 'mm');

    const derivedContainer = doc.createElement('div');
    renderDerived(derivedContainer, [{ key: 'legLength', label: 'Leg length' }], { legLength: 174.6 }, {}, () => {});
    assert.equal(derivedContainer.querySelectorAll('label')[0].textContent, 'Leg length');
});
