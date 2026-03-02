/**
 * SVG Parser - loads SVG files and extracts layer/path structure
 */

/**
 * Parse an SVG string and extract layer structure.
 * Handles Vectric-style exports where layers are <g> elements with
 * id or inkscape:label attributes.
 */
export function parseSVG(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');

    if (!svgEl) {
        throw new Error('No SVG element found in file');
    }

    const layers = extractLayers(svgEl);
    const viewBox = svgEl.getAttribute('viewBox');
    const width = parseFloat(svgEl.getAttribute('width')) || 0;
    const height = parseFloat(svgEl.getAttribute('height')) || 0;

    return {
        svgElement: svgEl,
        layers,
        viewBox,
        width,
        height,
        originalSVGText: svgText,
    };
}

/**
 * Extract layers from SVG. Vectric exports layers as top-level <g> elements.
 * Also handles flat SVGs (no groups) by treating all paths as one layer.
 */
function extractLayers(svgEl) {
    const layers = [];
    const topLevelGroups = svgEl.querySelectorAll(':scope > g');

    if (topLevelGroups.length > 0) {
        topLevelGroups.forEach((g, index) => {
            const name = g.getAttribute('inkscape:label')
                || g.getAttribute('id')
                || `Layer ${index + 1}`;

            const paths = getPathElements(g);
            layers.push({
                name,
                element: g,
                pathCount: paths.length,
                paths,
            });
        });
    } else {
        // Flat SVG - no layer groups, treat all paths as one layer
        const paths = getPathElements(svgEl);
        if (paths.length > 0) {
            layers.push({
                name: 'Default',
                element: svgEl,
                pathCount: paths.length,
                paths,
                isFlat: true,
            });
        }
    }

    return layers;
}

/**
 * Get all renderable path elements within a container.
 * Includes <path>, <polygon>, <polyline>, <rect>, <circle>, <ellipse>, <line>
 */
function getPathElements(container) {
    const selectors = 'path, polygon, polyline, rect, circle, ellipse, line';
    return Array.from(container.querySelectorAll(selectors));
}

/**
 * Get the bounding box of the entire SVG content.
 * Falls back to viewBox or width/height attributes.
 */
export function getSVGBounds(parsedSVG) {
    if (parsedSVG.viewBox) {
        const parts = parsedSVG.viewBox.split(/[\s,]+/).map(Number);
        if (parts.length === 4) {
            return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
        }
    }
    if (parsedSVG.width && parsedSVG.height) {
        return { x: 0, y: 0, width: parsedSVG.width, height: parsedSVG.height };
    }
    return { x: 0, y: 0, width: 1000, height: 1000 };
}
