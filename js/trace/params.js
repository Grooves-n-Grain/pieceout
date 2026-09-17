// js/trace/params.js
/**
 * Trace tab parameter schemas. Pure data, no DOM, so tests can import it and
 * the help text can be checked alongside the Layout schemas.
 *
 * `help` is shown as hover text in the sidebar; keep each to one or two plain sentences.
 */

export const IMAGE_PARAMS = [
    { key: 'threshold', label: 'Threshold', default: 128, min: 1, max: 254, step: 1, unit: '', integer: true,
      help: 'Brightness cut-off from 1 to 254. Pixels darker than this count as art (material that stays); lighter pixels become cut-outs. Try around 60 for colour logos.' },
    { key: 'invert', label: 'Invert colours', default: false, type: 'boolean',
      help: 'Swap which side is cut: light pixels become the art and dark pixels the cut-out. Use for white-on-dark artwork or to cut the negative of a design. Clears any bridges, deletes and kept islands.' },
    { key: 'smoothness', label: 'Smoothness', default: 40, min: 0, max: 100, step: 5, unit: '%', integer: true,
      help: 'How much the traced outline is simplified and curve-fitted. 0 follows every pixel step; higher removes jaggies but rounds fine detail.' },
    { key: 'minSpeck', label: 'Min speck size', default: 12, min: 0, max: 200, step: 1, unit: 'px', integer: true,
      help: 'Specks and pinholes smaller than this many pixels are dropped before tracing.' },
];

export const CHECK_PARAMS = [
    { key: 'kerfMm', label: 'Kerf / bit', default: 0.1, min: 0, max: 10, step: 0.05, unit: 'mm',
      help: 'Width of your bit or laser kerf. Features narrower than this are boxed in the GUIDE layer as unlikely to survive cutting.' },
    { key: 'bridgeMm', label: 'Bridge width', default: 0.8, min: 0.2, max: 10, step: 0.1, unit: 'mm',
      help: 'Width of the tab that ties an island to the body so it does not fall out. Should be wider than the kerf.' },
    { key: 'minIslandMm2', label: 'Delete islands under', default: 0, min: 0, max: 10000, step: 0.5, unit: 'mm2',
      help: 'Islands with less area than this are deleted automatically. 0 keeps every island; islands you mark as kept are never deleted.' },
];

export const SIZE_PARAMS = [
    { key: 'widthMm', label: 'Width', default: 100, min: 5, max: 2000, step: 1, unit: 'mm',
      help: 'Physical width of the finished panel. Height follows the image aspect ratio and everything is scaled to match.' },
    { key: 'includeOutline', label: 'Include outline', default: true, type: 'boolean',
      help: 'Also cut the panel\'s rectangular perimeter. Turn off when the image is being cut from an already-sized blank.' },
];

export const ALL_PARAMS = [...IMAGE_PARAMS, ...CHECK_PARAMS, ...SIZE_PARAMS];

export function defaults() {
    return Object.fromEntries(ALL_PARAMS.map(p => [p.key, p.default]));
}
