import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const styleStore = require('../../server/generate/styleStore.js');

const DEFAULT_PREAMBLE = 'default preamble text';
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngDataUrl(tag) {
    return `data:image/png;base64,${Buffer.concat([PNG_HEADER, Buffer.from(tag)]).toString('base64')}`;
}

function tempDataDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pieceout-style-'));
}

test('GET shape defaults to the built-in preamble and no references when nothing was saved', async () => {
    const dataDir = tempDataDir();
    const profile = await styleStore.getStyle(dataDir, DEFAULT_PREAMBLE);
    assert.deepEqual(profile, { preamble: DEFAULT_PREAMBLE, references: [] });
});

test('PUT then GET round-trips preamble and reference bytes/names exactly', async () => {
    const dataDir = tempDataDir();
    const saved = await styleStore.putStyle(dataDir, {
        preamble: 'my custom style',
        references: [{ name: 'loon.png', dataUrl: pngDataUrl('one') }, { name: 'owl.png', dataUrl: pngDataUrl('two') }],
    }, DEFAULT_PREAMBLE);

    assert.equal(saved.preamble, 'my custom style');
    assert.equal(saved.references.length, 2);
    assert.equal(saved.references[0].name, 'loon.png');
    assert.equal(saved.references[1].name, 'owl.png');
    assert.ok(saved.references[0].dataUrl.startsWith('data:image/png;base64,'));

    const reread = await styleStore.getStyle(dataDir, DEFAULT_PREAMBLE);
    assert.deepEqual(reread, saved);
});

test('server assigns ids; a client-supplied id (if any) is ignored', async () => {
    const dataDir = tempDataDir();
    const saved = await styleStore.putStyle(dataDir, {
        preamble: 'p',
        references: [{ id: '../../etc/passwd', name: 'x.png', dataUrl: pngDataUrl('a') }],
    }, DEFAULT_PREAMBLE);
    assert.match(saved.references[0].id, /^[a-f0-9]{16}$/);
});

test('a hostile reference name never influences the stored file path', async () => {
    const dataDir = tempDataDir();
    const saved = await styleStore.putStyle(dataDir, {
        preamble: 'p',
        references: [{ name: '../../../../etc/passwd', dataUrl: pngDataUrl('hostile') }],
    }, DEFAULT_PREAMBLE);

    // The name is stored as opaque display text...
    assert.equal(saved.references[0].name, '../../../../etc/passwd');
    // ...but every file actually written stayed inside dataDir, named only by the generated id.
    const filesOnDisk = fs.readdirSync(dataDir);
    assert.ok(filesOnDisk.every(name => !name.includes('..') && !name.includes('/')));
    assert.ok(filesOnDisk.includes(`${saved.references[0].id}.png`));
    // Nothing escaped dataDir.
    assert.ok(!fs.existsSync(path.join(dataDir, '..', '..', '..', '..', 'etc', 'passwd-marker')));
});

test('at most 4 references are allowed; a 5th is rejected with 400', async () => {
    const dataDir = tempDataDir();
    const refs = Array.from({ length: 4 }, (_, i) => ({ name: `r${i}.png`, dataUrl: pngDataUrl(`r${i}`) }));
    const ok = await styleStore.putStyle(dataDir, { preamble: 'p', references: refs }, DEFAULT_PREAMBLE);
    assert.equal(ok.references.length, 4);

    const tooMany = [...refs, { name: 'r5.png', dataUrl: pngDataUrl('r5') }];
    await assert.rejects(
        styleStore.putStyle(dataDir, { preamble: 'p', references: tooMany }, DEFAULT_PREAMBLE),
        err => { assert.equal(err.status, 400); return true; },
    );
});

test('preamble over 4000 characters is rejected with 400', async () => {
    const dataDir = tempDataDir();
    await assert.rejects(
        styleStore.putStyle(dataDir, { preamble: 'x'.repeat(4001), references: [] }, DEFAULT_PREAMBLE),
        err => { assert.equal(err.status, 400); return true; },
    );
});

test('a bad reference image (not PNG/JPEG/WebP) is rejected with 400', async () => {
    const dataDir = tempDataDir();
    await assert.rejects(
        styleStore.putStyle(dataDir, {
            preamble: 'p',
            references: [{ name: 'x.svg', dataUrl: 'data:image/png;base64,' + Buffer.from('<svg></svg>').toString('base64') }],
        }, DEFAULT_PREAMBLE),
        err => { assert.equal(err.status, 400); return true; },
    );
});

test('replacing the profile atomically swaps to the new set and cleans up the old reference files', async () => {
    const dataDir = tempDataDir();
    const first = await styleStore.putStyle(dataDir, {
        preamble: 'first',
        references: [{ name: 'a.png', dataUrl: pngDataUrl('a') }, { name: 'b.png', dataUrl: pngDataUrl('b') }],
    }, DEFAULT_PREAMBLE);
    const oldFiles = [`${first.references[0].id}.png`, `${first.references[1].id}.png`];
    assert.ok(oldFiles.every(name => fs.existsSync(path.join(dataDir, name))));

    const second = await styleStore.putStyle(dataDir, {
        preamble: 'second',
        references: [{ name: 'c.png', dataUrl: pngDataUrl('c') }],
    }, DEFAULT_PREAMBLE);

    // Old reference files are gone; only the new one plus profile.json remain.
    assert.ok(oldFiles.every(name => !fs.existsSync(path.join(dataDir, name))));
    assert.ok(fs.existsSync(path.join(dataDir, `${second.references[0].id}.png`)));

    // No leftover temp files from the atomic write.
    const leftoverTemp = fs.readdirSync(dataDir).filter(name => name.startsWith('.tmp-'));
    assert.deepEqual(leftoverTemp, []);

    const finalProfile = await styleStore.getStyle(dataDir, DEFAULT_PREAMBLE);
    assert.equal(finalProfile.preamble, 'second');
    assert.equal(finalProfile.references.length, 1);
});

test('getReferenceBuffers returns raw decoded buffers in stored order, skipping a missing file', async () => {
    const dataDir = tempDataDir();
    const saved = await styleStore.putStyle(dataDir, {
        preamble: 'p',
        references: [{ name: 'a.png', dataUrl: pngDataUrl('AAA') }, { name: 'b.png', dataUrl: pngDataUrl('BBB') }],
    }, DEFAULT_PREAMBLE);

    let buffers = await styleStore.getReferenceBuffers(dataDir, DEFAULT_PREAMBLE);
    assert.equal(buffers.length, 2);
    assert.ok(buffers[0].buffer.includes('AAA'));
    assert.ok(buffers[1].buffer.includes('BBB'));

    // Simulate a stale profile.json entry whose file was deleted out from under it.
    fs.unlinkSync(path.join(dataDir, `${saved.references[0].id}.png`));
    buffers = await styleStore.getReferenceBuffers(dataDir, DEFAULT_PREAMBLE);
    assert.equal(buffers.length, 1);
    assert.ok(buffers[0].buffer.includes('BBB'));
});

test('readPreamble reads just the preamble without touching reference files', async () => {
    const dataDir = tempDataDir();
    await styleStore.putStyle(dataDir, { preamble: 'only the text', references: [] }, DEFAULT_PREAMBLE);
    assert.equal(await styleStore.readPreamble(dataDir, DEFAULT_PREAMBLE), 'only the text');
});
