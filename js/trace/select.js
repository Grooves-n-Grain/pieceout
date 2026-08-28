// js/trace/select.js
/** Pure selection-rect geometry for the Trace tab's Ctrl+drag marquee. */

/**
 * Which islands have their bbox fully inside rect (both in bitmap px, both inclusive on all
 * four sides). An island that only partially overlaps the rect is excluded - a marquee that
 * grazes a big neighbouring island should not grab it.
 */
export function islandsInRect(islands, rect) {
    return islands.filter((island) => {
        const b = island.bbox;
        return b.x0 >= rect.x0 && b.x1 <= rect.x1 && b.y0 >= rect.y0 && b.y1 <= rect.y1;
    });
}
