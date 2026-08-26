/**
 * Andon lamp template: square frames of half-lapped rails pinned with dowels,
 * four square legs, basswood side panels held by split dowels, lid and base
 * panels resting in the frames.
 *
 * Every function here is pure. Rail coordinates: length along x, y = 0 is the
 * rail's OUTER edge, top face up. All eight rails are identical; two per frame
 * are flipped at assembly so the laps mate.
 *
 * Assembly note: the two rails per frame that need their laps on the bottom
 * face are flipped END OVER END (rotated about the rail's width axis), never
 * rolled about the long axis. That keeps the outer edge outward; the panel
 * holes are symmetric about the rail centre so the hole pattern is unchanged.
 * Rolling a rail would put the panel holes at `railWidth - panelInset` from
 * the outer edge instead.
 */
import { createPart, addRect, Material, Grain, Layer } from '../parts.js';
import { halfLap } from '../joints/halfLap.js';
import { dowelHole } from '../joints/dowelHole.js';

const MIN_WALL = 1; // mm of wood that must remain beside a hole

const params = [
    { key: 'outerWidth',        label: 'Outer width',          group: 'lamp', default: 150,  min: 20,  step: 0.5, unit: 'mm' },
    { key: 'overallHeight',     label: 'Overall height',       group: 'lamp', default: 200,  min: 20,  step: 0.5, unit: 'mm' },
    { key: 'stockThickness',    label: 'Stock thickness',      group: 'lamp', default: 12.7, min: 3,   step: 0.1, unit: 'mm' },
    { key: 'railWidth',         label: 'Rail width',           group: 'lamp', default: 25,   min: 5,   step: 0.5, unit: 'mm' },
    { key: 'legSize',           label: 'Leg size (square)',    group: 'lamp', default: 12.7, min: 5,   step: 0.5, unit: 'mm' },
    { key: 'panelInset',        label: 'Panel inset',          group: 'lamp', default: 13,   min: 1,   step: 0.5, unit: 'mm' },
    // Recorded for the cut list and future joint types; v1 geometry does not use it.
    { key: 'panelThickness',    label: 'Panel thickness',      group: 'lamp', default: 3.2,  min: 0.5, step: 0.1, unit: 'mm' },
    { key: 'panelClearance',    label: 'Panel clearance',      group: 'lamp', default: 0.5,  min: 0,   step: 0.1, unit: 'mm' },
    { key: 'panelOverlap',      label: 'Panel overlap into frame', group: 'lamp', default: 6, min: 0, step: 0.5, unit: 'mm' },
    { key: 'dowelHoleDia',      label: 'Dowel hole diameter',  group: 'lamp', default: 6.2,  min: 1,   step: 0.1, unit: 'mm' },
    { key: 'panelDowelsPerRail', label: 'Panel dowels per rail', group: 'lamp', default: 2,  min: 1,   step: 1,   unit: '', integer: true },
];

const derivedFields = [
    { key: 'railLength',      label: 'Rail length' },
    { key: 'lapLength',       label: 'Half-lap length' },
    { key: 'lapDepth',        label: 'Half-lap depth' },
    { key: 'legLength',       label: 'Leg length' },
    { key: 'sidePanelWidth',  label: 'Side panel width' },
    { key: 'sidePanelHeight', label: 'Side panel height' },
    { key: 'lidSize',         label: 'Lid / base panel size' },
];

function defaults() {
    return Object.fromEntries(params.map(p => [p.key, p.default]));
}

function derive(p, overrides = {}) {
    const pick = (key, computed) => (overrides[key] !== undefined ? overrides[key] : computed);
    const railLength = pick('railLength', p.outerWidth);
    const lapLength = pick('lapLength', p.railWidth);
    const lapDepth = pick('lapDepth', p.stockThickness / 2);
    const legLength = pick('legLength', p.overallHeight - 2 * p.stockThickness);
    const sidePanelWidth = pick('sidePanelWidth', p.outerWidth - 2 * p.panelInset - p.panelClearance);
    const sidePanelHeight = pick('sidePanelHeight', legLength + 2 * p.panelOverlap - p.panelClearance);
    const lidSize = pick('lidSize', p.outerWidth - 2 * p.railWidth - p.panelClearance);

    const span = railLength - 2 * p.legSize;
    const n = p.panelDowelsPerRail;
    const panelHoleXs = Array.from({ length: n }, (_, i) => p.legSize + span * (i + 1) / (n + 1));

    return { railLength, lapLength, lapDepth, legLength, sidePanelWidth, sidePanelHeight, lidSize, panelHoleXs };
}

function validate(p, d) {
    const msgs = [];
    const error = (field, message) => msgs.push({ level: 'error', field, message });
    const warn = (field, message) => msgs.push({ level: 'warn', field, message });
    const r = p.dowelHoleDia / 2;

    for (const def of params) {
        if (def.key === 'panelClearance' || def.key === 'panelOverlap') continue;
        if (p[def.key] <= 0) error(def.key, `${def.label} must be a positive number.`);
    }

    if (d.legLength <= 0) error('overallHeight', 'Overall height must exceed two stock thicknesses.');
    if (d.sidePanelWidth <= 0) error('panelInset', 'Panel inset leaves no width for the side panel.');
    if (d.sidePanelHeight <= 0) error('overallHeight', 'Side panel height is zero or negative; increase overall height or panel overlap.');
    if (d.lidSize <= 0) error('railWidth', 'Rail width leaves no opening for the lid.');
    if (d.lapLength * 2 > d.railLength) error('railWidth', 'Half-laps overlap: rail width is more than half the rail length.');
    if (d.lapLength < p.dowelHoleDia + 2 * MIN_WALL) error('railWidth', 'Half-lap is too short to hold the corner dowel hole.');
    if (d.lapDepth >= p.stockThickness) error('stockThickness', 'Half-lap depth must be less than the stock thickness.');
    if (d.lapDepth <= 0) error('stockThickness', 'Half-lap depth must be positive; check stock thickness.');
    if (p.panelOverlap > p.stockThickness) error('panelOverlap', 'Panel overlap cannot exceed the stock thickness (the panel would poke out of the frame).');
    if (p.panelInset - r < MIN_WALL || p.panelInset + r > p.railWidth - MIN_WALL) {
        error('panelInset', `Panel dowel hole needs ${MIN_WALL} mm of wood on each side; move the inset or widen the rail.`);
    }
    if (d.railLength - 2 * p.legSize <= 0) error('legSize', 'Legs are wider than the rail leaves room for.');
    const lo = d.lapLength + r + MIN_WALL;
    const hi = d.railLength - d.lapLength - r - MIN_WALL;
    if (d.panelHoleXs.some(x => x < lo || x > hi)) {
        error('panelDowelsPerRail', 'Panel dowel holes land in the half-laps; use fewer dowels or a longer rail.');
    }
    if (d.panelHoleXs.some((x, i) => i > 0 && x - d.panelHoleXs[i - 1] < 2 * p.dowelHoleDia)) {
        error('panelDowelsPerRail', 'Panel dowel holes are too close together.');
    }
    if (p.panelInset < p.legSize) {
        warn('panelInset', 'Panel plane crosses the legs. Either the legs need a groove, or set the inset past the leg size.');
    }
    if (p.legSize > p.stockThickness) {
        warn('legSize', 'Legs will be legSize x stockThickness, not square; rails and legs come from the same slab.');
    }
    return msgs;
}

function build(p, d) {
    const rail = createPart({ name: 'Rail', material: Material.HARDWOOD, width: d.railLength, height: p.railWidth, qty: 8 });
    halfLap(rail, 'start', { depth: d.lapDepth, length: d.lapLength });
    halfLap(rail, 'end', { depth: d.lapDepth, length: d.lapLength });
    dowelHole(rail, { x: d.lapLength / 2, y: p.railWidth / 2, diameter: p.dowelHoleDia });
    dowelHole(rail, { x: d.railLength - d.lapLength / 2, y: p.railWidth / 2, diameter: p.dowelHoleDia });
    for (const x of d.panelHoleXs) {
        dowelHole(rail, { x, y: p.panelInset, diameter: p.dowelHoleDia });
    }

    const leg = createPart({ name: 'Leg', material: Material.HARDWOOD, width: d.legLength, height: p.legSize, qty: 4 });

    const panel = (name, width, height, qty) => {
        const part = createPart({ name, material: Material.BASSWOOD, width, height, grain: Grain.ANY, qty });
        const inset = p.panelOverlap;
        if (width - 2 * inset > 0 && height - 2 * inset > 0) {
            addRect(part, { layer: Layer.GUIDE, x: inset, y: inset, width: width - 2 * inset, height: height - 2 * inset });
        }
        return part;
    };

    return [
        rail,
        leg,
        panel('Side panel', d.sidePanelWidth, d.sidePanelHeight, 4),
        panel('Lid panel', d.lidSize, d.lidSize, 1),
        panel('Base panel', d.lidSize, d.lidSize, 1),
    ];
}

export const andonLamp = Object.freeze({
    id: 'andon-lamp',
    name: 'Andon lamp (dowel and half-lap)',
    params,
    derivedFields,
    defaults,
    derive,
    validate,
    build,
});
