// Regenerates the golden SVGs for the default Andon lamp. Run after an
// intentional change to the template, nester, or writer: node tests/fixtures/regen.js
import { writeFileSync } from 'node:fs';
import { andonLamp } from '../../js/layout/templates/andonLamp.js';
import { defaultMachine } from '../../js/layout/machine.js';
import { nest } from '../../js/layout/nest.js';
import { sheetToSVG, sheetFileName } from '../../js/layout/svgWriter.js';

const p = andonLamp.defaults();
const sheets = nest(andonLamp.build(p, andonLamp.derive(p)), defaultMachine());
for (const sheet of sheets) {
    if (sheet.index !== 1) continue;
    const name = sheetFileName(andonLamp.id, sheet);
    writeFileSync(new URL(`./${name}`, import.meta.url), sheetToSVG(sheet));
    console.log(`wrote tests/fixtures/${name}`);
}
