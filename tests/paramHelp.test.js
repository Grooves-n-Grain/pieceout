// tests/paramHelp.test.js
// Every user-facing parameter must ship with hover help so the sidebars stay self-explaining.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { andonLamp } from '../js/layout/templates/andonLamp.js';
import { MACHINE_PARAMS } from '../js/layout/machine.js';
import { ALL_PARAMS as TRACE_PARAMS } from '../js/trace/params.js';

const schemas = {
    'andonLamp.params': andonLamp.params,
    'andonLamp.derivedFields': andonLamp.derivedFields,
    'MACHINE_PARAMS': MACHINE_PARAMS,
    'trace ALL_PARAMS': TRACE_PARAMS,
};

for (const [name, schema] of Object.entries(schemas)) {
    test(`${name}: every entry has non-empty help text`, () => {
        assert.ok(schema.length > 0, `${name} is empty`);
        for (const def of schema) {
            assert.equal(typeof def.help, 'string', `${name}.${def.key} has no help`);
            assert.ok(def.help.trim().length > 0, `${name}.${def.key} help is blank`);
            assert.ok(!def.help.includes('—'), `${name}.${def.key} help contains an em dash`);
        }
    });
}
