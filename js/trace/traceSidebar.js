// js/trace/traceSidebar.js
/** Island list and stats rendering for the Trace sidebar. Pure DOM building, no state. */

export function renderIslandList(container, countEl, islands, scaleMmPerPx, { selected, onSelect, onBridge, onDelete, onKeep }) {
    container.innerHTML = '';
    countEl.textContent = String(islands.length);
    if (!islands.length) {
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = 'No islands. Everything is attached.';
        container.appendChild(p);
        return;
    }
    islands.forEach((island) => {
        const row = document.createElement('div');
        row.className = 'island-row' + (island.number === selected ? ' selected' : '') + (island.kept ? ' kept' : '');
        const mm2 = island.area * scaleMmPerPx * scaleMmPerPx;
        const keepLabel = island.kept ? 'Unkeep' : 'Keep';
        const keepTitle = island.kept ? 'Stop keeping this island' : 'Keep this island as a separate piece';
        row.innerHTML = `
            <span class="island-index">${island.number}</span>
            <span class="island-area">${mm2 < 10 ? mm2.toFixed(1) : Math.round(mm2)} mm2</span>
            <button class="small-btn" data-action="bridge" title="Bridge to the body">Bridge</button>
            <button class="small-btn" data-action="delete" title="Remove this island">Delete</button>
            <button class="small-btn" data-action="keep" title="${keepTitle}">${keepLabel}</button>
        `;
        row.addEventListener('click', (e) => {
            const action = e.target.dataset?.action;
            if (action === 'bridge') onBridge(island);
            else if (action === 'delete') onDelete(island);
            else if (action === 'keep') onKeep(island);
            else onSelect(island, row);
        });
        container.appendChild(row);
    });
}

export function renderStats(container, { width, height, contours, segments, timingMs, thinCount }) {
    container.textContent = width
        ? `${width} x ${height} px, ${contours} contours, ${segments} curves, ${thinCount} thin, ${Math.round(timingMs)} ms`
        : 'Open an image to start.';
}
