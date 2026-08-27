// js/trace/islandNumbers.js
/**
 * Assigns each island a number that stays stable for the life of an image: a number is
 * handed out the first time its island is seen and kept as long as that island keeps
 * reappearing (bridging, deleting, then changing your mind on the threshold shouldn't
 * shuffle every other island's number). Numbers of islands that stop appearing are
 * retired, never reused - the next new island always gets the next unused number.
 */

export function seedKey(seed) {
    return seed[0] + ',' + seed[1];
}

export function createNumbering() {
    const numbers = new Map(); // seedKey -> number
    let next = 1;

    function assign(islands) {
        const numbered = islands.map((island) => {
            const key = seedKey(island.seed);
            let number = numbers.get(key);
            if (number === undefined) {
                number = next++;
                numbers.set(key, number);
            }
            return { ...island, number };
        });
        numbered.sort((a, b) => a.number - b.number);
        return numbered;
    }

    return { assign };
}

/**
 * Which islands a bulk op (Bridge all / Delete all) applies to: everything except an island
 * the user has explicitly marked "kept" as a separate piece. Pulled out as its own pure
 * function so both the button handlers and their disabled-state checks agree on the same rule.
 */
export function bulkTargets(islands) {
    return islands.filter((island) => !island.kept);
}
