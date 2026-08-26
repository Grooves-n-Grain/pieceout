import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLayoutState, saveLayoutState, STORAGE_KEY } from '../js/layout/storage.js';

function memoryStore() {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('round-trips state', () => {
    const store = memoryStore();
    const state = { templateId: 'andon-lamp', params: { outerWidth: 160 }, overrides: { legLength: 180 }, machine: { gutter: 9 } };
    saveLayoutState(state, store);
    assert.deepEqual(loadLayoutState(store), state);
});

test('returns null for missing, corrupt, or wrong-version data', () => {
    assert.equal(loadLayoutState(memoryStore()), null);
    const bad = memoryStore();
    bad.setItem(STORAGE_KEY, '{not json');
    assert.equal(loadLayoutState(bad), null);
    const old = memoryStore();
    old.setItem(STORAGE_KEY, JSON.stringify({ version: 0, templateId: 'x' }));
    assert.equal(loadLayoutState(old), null);
});
