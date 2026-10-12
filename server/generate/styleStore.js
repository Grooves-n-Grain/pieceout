// Persists the style profile (preamble + up to 4 reference images) under the generate data
// dir. profile.json never stores path-shaped data from the client: reference ids are random
// hex generated here, and the client-supplied `name` is opaque display text that is never
// used to build a filesystem path.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { decodeDataUrl, encodeDataUrl, EXT_BY_MIME } = require('./images.js');

const MAX_REFERENCES = 4;
const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
const MAX_PREAMBLE_CHARS = 4000;
const MAX_NAME_CHARS = 200;
const ID_RE = /^[a-f0-9]{16}$/;

function badRequest(message) {
    return Object.assign(new Error(message), { status: 400 });
}

function profilePath(dataDir) {
    return path.join(dataDir, 'profile.json');
}

// Every stored reference file is named `<id>.<ext>` where id and ext come only from data this
// module generated or from the fixed EXT_BY_MIME table, never from client input.
function referencePath(dataDir, id, mime) {
    return path.join(dataDir, `${id}.${EXT_BY_MIME[mime]}`);
}

function readProfileMeta(dataDir, defaultPreamble) {
    try {
        const raw = fs.readFileSync(profilePath(dataDir), 'utf8');
        const parsed = JSON.parse(raw);
        const references = Array.isArray(parsed.references) ? parsed.references : [];
        return {
            preamble: typeof parsed.preamble === 'string' ? parsed.preamble : defaultPreamble,
            references: references.filter(ref => ref && ID_RE.test(ref.id) && EXT_BY_MIME[ref.mime]),
        };
    } catch {
        return { preamble: defaultPreamble, references: [] };
    }
}

async function atomicWrite(filePath, data) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = path.join(path.dirname(filePath), `.tmp-${crypto.randomBytes(8).toString('hex')}`);
    await fs.promises.writeFile(tmpPath, data);
    await fs.promises.rename(tmpPath, filePath);
}

async function readPreamble(dataDir, defaultPreamble) {
    return readProfileMeta(dataDir, defaultPreamble).preamble;
}

// Raw decoded buffers, in stored order, for handing to a provider. Skips (rather than fails
// on) an entry whose file has gone missing, so a stale profile.json never breaks generation.
async function getReferenceBuffers(dataDir, defaultPreamble) {
    const meta = readProfileMeta(dataDir, defaultPreamble);
    const out = [];
    for (const ref of meta.references) {
        try {
            const buffer = await fs.promises.readFile(referencePath(dataDir, ref.id, ref.mime));
            out.push({ buffer, mime: ref.mime });
        } catch {
            // Missing file: skip rather than fail the whole request.
        }
    }
    return out;
}

// Public GET shape: preamble plus data-URL-encoded references.
async function getStyle(dataDir, defaultPreamble) {
    const meta = readProfileMeta(dataDir, defaultPreamble);
    const references = [];
    for (const ref of meta.references) {
        try {
            const buffer = await fs.promises.readFile(referencePath(dataDir, ref.id, ref.mime));
            references.push({ id: ref.id, name: typeof ref.name === 'string' ? ref.name : ref.id, dataUrl: encodeDataUrl(buffer, ref.mime) });
        } catch {
            // Missing file: skip a stale entry rather than fail the whole profile.
        }
    }
    return { preamble: meta.preamble, references };
}

// Replaces the whole profile. Validates and decodes everything before touching disk, writes
// new reference files, atomically swaps profile.json to point at them, then best-effort
// removes files the previous profile referenced that are no longer in use.
async function putStyle(dataDir, body, defaultPreamble) {
    if (!body || typeof body !== 'object') throw badRequest('Request body must be an object.');
    if (typeof body.preamble !== 'string') throw badRequest('preamble must be a string.');
    if (body.preamble.length > MAX_PREAMBLE_CHARS) {
        throw badRequest(`preamble must be at most ${MAX_PREAMBLE_CHARS} characters.`);
    }
    if (!Array.isArray(body.references)) throw badRequest('references must be an array.');
    if (body.references.length > MAX_REFERENCES) {
        throw badRequest(`At most ${MAX_REFERENCES} style references are allowed.`);
    }

    const decoded = body.references.map((ref, i) => {
        if (!ref || typeof ref !== 'object') throw badRequest(`reference ${i + 1} is invalid.`);
        const name = typeof ref.name === 'string' ? ref.name.slice(0, MAX_NAME_CHARS) : `reference-${i + 1}`;
        let image;
        try {
            image = decodeDataUrl(ref.dataUrl, { maxBytes: MAX_REFERENCE_BYTES });
        } catch (err) {
            throw badRequest(`reference ${i + 1}: ${err.message}`);
        }
        return { name, buffer: image.buffer, mime: image.mime };
    });

    const previous = readProfileMeta(dataDir, defaultPreamble);

    const savedReferences = [];
    for (const { name, buffer, mime } of decoded) {
        const id = crypto.randomBytes(8).toString('hex');
        await atomicWrite(referencePath(dataDir, id, mime), buffer);
        savedReferences.push({ id, name, mime });
    }

    const profileJson = JSON.stringify({ preamble: body.preamble, references: savedReferences }, null, 2);
    await atomicWrite(profilePath(dataDir), profileJson);

    // Now that profile.json points only at the new files, drop the old ones that survived.
    const keep = new Set(savedReferences.map(ref => referencePath(dataDir, ref.id, ref.mime)));
    await Promise.all(previous.references.map(async ref => {
        const oldPath = referencePath(dataDir, ref.id, ref.mime);
        if (!keep.has(oldPath)) {
            try { await fs.promises.unlink(oldPath); } catch { /* already gone; fine */ }
        }
    }));

    return getStyle(dataDir, defaultPreamble);
}

module.exports = {
    getStyle, putStyle, readPreamble, getReferenceBuffers,
    MAX_REFERENCES, MAX_REFERENCE_BYTES, MAX_PREAMBLE_CHARS,
};
