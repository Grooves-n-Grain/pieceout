// js/layout/layoutForm.js
/**
 * Schema-driven form rendering for the Layout sidebar. Pure DOM building;
 * no state lives here. Every function reads `document` from the container so
 * it can be exercised under Node with a fake DOM.
 */

function el(doc, tag, attrs = {}, text) {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'className') node.className = v;
        else node.setAttribute(k, v);
    }
    if (text !== undefined) node.textContent = text;
    return node;
}

function parseNumber(input, integer) {
    const n = integer ? parseInt(input.value, 10) : parseFloat(input.value);
    return Number.isFinite(n) ? n : null;
}

export function renderParamInputs(container, schema, values, onChange) {
    const doc = container.ownerDocument;
    container.innerHTML = '';
    for (const def of schema) {
        const row = el(doc, 'div', { className: 'param-row' });
        const id = `param-${def.key}`;
        row.appendChild(el(doc, 'label', { for: id }, def.label));
        const input = el(doc, 'input', { type: 'number', id, min: def.min, step: def.step });
        input.value = String(values[def.key]);
        input.addEventListener('input', () => {
            const n = parseNumber(input, def.integer);
            input.classList.toggle('invalid', n === null);
            if (n !== null) onChange(def.key, n);
        });
        row.appendChild(input);
        row.appendChild(el(doc, 'span', { className: 'unit' }, def.unit || ''));
        container.appendChild(row);
    }
}

export function renderDerived(container, derivedFields, derived, overrides, onChange) {
    const doc = container.ownerDocument;
    container.innerHTML = '';
    for (const def of derivedFields) {
        const row = el(doc, 'div', { className: 'param-row' });
        const id = `derived-${def.key}`;
        const overridden = overrides[def.key] !== undefined;
        row.appendChild(el(doc, 'label', { for: id }, def.label));
        const input = el(doc, 'input', { type: 'number', id, step: 0.1 });
        input.value = String(derived[def.key]);
        input.disabled = !overridden;
        input.addEventListener('input', () => {
            const n = parseNumber(input, false);
            input.classList.toggle('invalid', n === null);
            if (n !== null) onChange(def.key, n);
        });
        row.appendChild(input);
        const box = el(doc, 'input', { type: 'checkbox', id: `override-${def.key}`, title: 'Override this value' });
        box.checked = overridden;
        box.addEventListener('change', () => {
            input.disabled = !box.checked;
            onChange(def.key, box.checked ? parseNumber(input, false) ?? derived[def.key] : undefined);
        });
        row.appendChild(box);
        container.appendChild(row);
    }
}

/** Render messages; returns the Set of field keys that have errors. */
export function renderMessages(container, messages) {
    const doc = container.ownerDocument;
    container.innerHTML = '';
    const errorFields = new Set();
    for (const m of messages) {
        container.appendChild(el(doc, 'div', { className: `msg msg-${m.level}` }, `${m.field}: ${m.message}`));
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
