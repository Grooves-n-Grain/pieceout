/**
 * Size rule: drop islands under a minimum area in one pass. Runs after ops are
 * replayed (see traceUI's runPipeline) so an island the user already bridged is
 * body and exempt for free, one they already deleted is simply gone, and kept
 * islands are exempt by key without any extra bookkeeping here.
 */
import { labelComponents, findIslands } from './components.js';
import { cloneBitmap } from './bitmap.js';
import { seedKey } from './islandNumbers.js';

export function removeSmallIslands(bitmap, { minAreaPx, minSpeckPx = 0, keptKeys = new Set() }) {
    if (minAreaPx <= 0) return { bitmap, removed: 0 };
    // Same body threshold as the rest of the pipeline (see applyOps/tracePipeline) so "the
    // body" here matches what despeckling and bridging already agreed it is.
    const analysis = labelComponents(bitmap, 1, minSpeckPx);
    const islands = findIslands(bitmap, analysis);
    const toRemove = islands.filter((i) => i.area < minAreaPx && !keptKeys.has(seedKey(i.seed)));
    if (!toRemove.length) return { bitmap, removed: 0 };

    // Modeled on deleteIsland in bridge.js, but flips every targeted island's pixels in one
    // clone/scan instead of cloning once per island.
    const out = cloneBitmap(bitmap);
    const ids = new Set(toRemove.map((i) => i.id));
    const { labels } = analysis;
    for (let i = 0; i < labels.length; i++) {
        if (ids.has(labels[i])) out.data[i] = 0;
    }
    return { bitmap: out, removed: toRemove.length };
}
