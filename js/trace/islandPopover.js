// js/trace/islandPopover.js
/**
 * Per-island (or per-selection) action popover: bridge, place a targeted bridge, delete, or
 * keep - all from a small box anchored next to whatever was clicked. Pure DOM building, same
 * style as traceSidebar.js; no state lives here beyond what's already in the DOM it builds.
 * renderIslandPopover branches into a group mode (no "Place bridge", since a targeted bridge
 * only makes sense for one island) whenever `data.islands` is an array instead of a single
 * island's own fields.
 */
import { formatMm2 } from './traceSidebar.js';

function button(doc, text, title, onClick) {
    const btn = doc.createElement('button');
    btn.className = 'small-btn';
    btn.type = 'button';
    btn.title = title;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
}

export function renderIslandPopover(el, data, { bridgeMm, kept, onBridge, onPlace, onDelete, onKeep, onClose }) {
    const doc = el.ownerDocument;
    el.innerHTML = '';
    const group = Array.isArray(data.islands);

    const header = doc.createElement('div');
    header.className = 'popover-header';
    header.textContent = group
        ? `${data.islands.length} islands selected (${formatMm2(data.mm2)} mm2 total)`
        : `Island ${data.number} (${formatMm2(data.mm2)} mm2)`;
    el.appendChild(header);

    const row = doc.createElement('div');
    row.className = 'popover-row';
    const label = doc.createElement('label');
    label.textContent = 'Bridge';
    label.setAttribute('for', 'trace-popover-width');
    const input = doc.createElement('input');
    input.type = 'number';
    input.id = 'trace-popover-width';
    input.step = '0.1';
    input.min = '0.2';
    input.value = String(bridgeMm);
    const unit = doc.createElement('span');
    unit.className = 'unit';
    unit.textContent = 'mm';
    row.append(label, input, unit);
    el.appendChild(row);

    // Escape while focused in this input never reaches app.js's global handler (it ignores
    // keydown from INPUT elements), so this is the only way to close the popover with the
    // keyboard while the width field has focus.
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') onClose();
    });

    function currentWidthMm() {
        const n = parseFloat(input.value);
        return Number.isFinite(n) && n > 0 ? n : bridgeMm;
    }

    const buttons = doc.createElement('div');
    buttons.className = 'popover-buttons';
    buttons.appendChild(button(doc, group ? 'Bridge selected' : 'Bridge', 'Bridge to the body', () => onBridge(currentWidthMm())));
    if (!group) {
        // Placing a targeted bridge only makes sense for one island at a time.
        buttons.appendChild(button(doc, 'Place bridge', 'Click the material to place this bridge', () => onPlace(currentWidthMm())));
    }
    buttons.appendChild(button(doc, group ? 'Delete selected' : 'Delete', group ? 'Remove the selected islands' : 'Remove this island', onDelete));
    const keepLabel = (kept ? 'Unkeep' : 'Keep') + (group ? ' selected' : '');
    const keepTitle = kept
        ? (group ? 'Stop keeping the selected islands' : 'Stop keeping this island')
        : (group ? 'Keep the selected islands as separate pieces' : 'Keep this island as a separate piece');
    buttons.appendChild(button(doc, keepLabel, keepTitle, onKeep));
    el.appendChild(buttons);
}

/**
 * Positions the popover just right of the anchor, flipping to the left when it wouldn't fit,
 * and clamped inside viewportRect with an 8px margin on every side. Both rects are expected in
 * client (viewport pixel) coordinates, matching the popover's own `position: fixed`.
 */
export function positionPopover(el, anchorRect, viewportRect) {
    const margin = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    let left = anchorRect.right + margin;
    if (left + w > viewportRect.right - margin) left = anchorRect.left - margin - w;
    const maxLeft = Math.max(viewportRect.left + margin, viewportRect.right - margin - w);
    left = Math.min(Math.max(left, viewportRect.left + margin), maxLeft);

    const maxTop = Math.max(viewportRect.top + margin, viewportRect.bottom - margin - h);
    const top = Math.min(Math.max(anchorRect.top, viewportRect.top + margin), maxTop);

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
}
