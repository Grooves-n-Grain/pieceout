/**
 * Machine and sheet settings shared by every template. Flat object so it can
 * be rendered by the same schema-driven form as template params.
 */
import { Material } from './parts.js';

// `help` is shown as hover text in the sidebar; keep each to one or two plain sentences.
export const MACHINE_PARAMS = [
    { key: 'bitDiameter',         label: 'Bit diameter',          group: 'machine', default: 6,   min: 0.5, step: 0.1, unit: 'mm',
      help: 'Diameter of the cutting bit. Only used to check the gutter is wide enough; no tool offset is applied to the geometry, Aspire does that.' },
    { key: 'gutter',              label: 'Gutter between parts',  group: 'machine', default: 9,   min: 0.5, step: 0.5, unit: 'mm',
      help: 'Empty space left between neighbouring parts on a sheet. Must be at least the bit diameter.' },
    { key: 'edgeMargin',          label: 'Sheet edge margin',     group: 'machine', default: 15,  min: 0,   step: 0.5, unit: 'mm',
      help: 'Unusable border on all four sheet edges, for clamps and tabs. Parts are nested inside it.' },
    { key: 'hardwoodSheetWidth',  label: 'Hardwood sheet width',  group: 'machine', default: 300, min: 10,  step: 1,   unit: 'mm',
      help: 'Width of the hardwood blank the rails and legs are nested onto. Parts that do not fit spill onto another sheet.' },
    { key: 'hardwoodSheetHeight', label: 'Hardwood sheet height', group: 'machine', default: 600, min: 10,  step: 1,   unit: 'mm',
      help: 'Height of the hardwood blank. Rails and legs keep their grain along their length and are never rotated.' },
    { key: 'basswoodSheetWidth',  label: 'Basswood sheet width',  group: 'machine', default: 300, min: 10,  step: 1,   unit: 'mm',
      help: 'Width of the basswood blank the panels are nested onto. Panels may be rotated 90 degrees to fit.' },
    { key: 'basswoodSheetHeight', label: 'Basswood sheet height', group: 'machine', default: 300, min: 10,  step: 1,   unit: 'mm',
      help: 'Height of the basswood blank the panels are nested onto.' },
];

export function defaultMachine() {
    return Object.fromEntries(MACHINE_PARAMS.map(p => [p.key, p.default]));
}

export function sheetSize(machine, material) {
    switch (material) {
        case Material.HARDWOOD: return { width: machine.hardwoodSheetWidth, height: machine.hardwoodSheetHeight };
        case Material.BASSWOOD: return { width: machine.basswoodSheetWidth, height: machine.basswoodSheetHeight };
        default: throw new Error(`No sheet configured for material ${material}`);
    }
}

export function validateMachine(m) {
    const msgs = [];
    const error = (field, message) => msgs.push({ level: 'error', field, message });
    if (m.gutter < m.bitDiameter) error('gutter', 'Gutter must be at least the bit diameter or the bit will eat the neighbour.');
    for (const material of Object.values(Material)) {
        const { width, height } = sheetSize(m, material);
        if (width - 2 * m.edgeMargin <= 0 || height - 2 * m.edgeMargin <= 0) {
            error('edgeMargin', `Edge margin leaves no usable area on the ${material} sheet.`);
        }
    }
    return msgs;
}
