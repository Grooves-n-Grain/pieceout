// Regenerates ring.svg from ring.json. Run after an intentional change to the tracer: node tests/trace/fixtures/regen.js
import { readFileSync, writeFileSync } from 'node:fs';
import { bitmapFromStrings } from '../../../js/trace/bitmap.js';
import { tracePipeline, shapesToSVG } from '../../../js/trace/svg.js';

const rows = JSON.parse(readFileSync(new URL('./ring.json', import.meta.url), 'utf8'));
const r = tracePipeline(bitmapFromStrings(rows), { tolerancePx: 0.5, kerfPx: 2, minSpeckPx: 0 });
const svg = shapesToSVG({ shapes: r.shapes, widthPx: rows[0].length, heightPx: rows.length, scale: 5, includeOutline: false, islands: r.islands, thin: r.thin });
writeFileSync(new URL('./ring.svg', import.meta.url), svg);
console.log(`wrote tests/trace/fixtures/ring.svg (${r.islands.length} islands, ${r.thin.length} thin, ${r.shapes.length} shapes)`);
