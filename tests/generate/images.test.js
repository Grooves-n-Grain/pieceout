import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { decodeDataUrl, encodeDataUrl, detectMime } = require('../../server/generate/images.js');

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF_HEADER = Buffer.from('GIF89a', 'ascii');
const SVG_TEXT = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>', 'ascii');

function webp(bodyLength = 20) {
    const buf = Buffer.alloc(12 + bodyLength);
    buf.write('RIFF', 0, 'ascii');
    buf.write('WEBP', 8, 'ascii');
    return buf;
}

function dataUrl(mime, buffer) {
    return `data:${mime};base64,${buffer.toString('base64')}`;
}

test('detectMime: accepts PNG, JPEG, WebP magic bytes', () => {
    assert.equal(detectMime(Buffer.concat([PNG_HEADER, Buffer.alloc(50)])), 'image/png');
    assert.equal(detectMime(Buffer.concat([JPEG_HEADER, Buffer.alloc(50)])), 'image/jpeg');
    assert.equal(detectMime(webp()), 'image/webp');
});

test('detectMime: a full PNG header on an otherwise-empty (too-short-to-be-real) file still sniffs as PNG', () => {
    // The contract only specifies magic-byte sniffing, not full image decoding; a header-only
    // buffer is indistinguishable from a real one at that level.
    assert.equal(detectMime(PNG_HEADER), 'image/png');
});

test('detectMime: a truncated header (fewer bytes than the full signature) is rejected, not misread', () => {
    assert.equal(detectMime(PNG_HEADER.subarray(0, 3)), null);
    assert.equal(detectMime(JPEG_HEADER.subarray(0, 2)), null);
    assert.equal(detectMime(webp().subarray(0, 10)), null);
});

test('detectMime: rejects an SVG and a GIF', () => {
    assert.equal(detectMime(SVG_TEXT), null);
    assert.equal(detectMime(GIF_HEADER), null);
});

test('decodeDataUrl: round-trips a real PNG payload and returns the sniffed mime', () => {
    const buffer = Buffer.concat([PNG_HEADER, Buffer.from('hello world')]);
    const { buffer: out, mime } = decodeDataUrl(dataUrl('image/png', buffer), { maxBytes: 1024 });
    assert.equal(mime, 'image/png');
    assert.ok(out.equals(buffer));
});

test('decodeDataUrl: rejects malformed data URLs', () => {
    assert.throws(() => decodeDataUrl('not a data url', {}), /reason.*invalid|Expected/);
    assert.throws(() => decodeDataUrl('data:text/plain;base64,aGk=', {}));
    try { decodeDataUrl('nope', {}); assert.fail('should have thrown'); }
    catch (err) { assert.equal(err.reason, 'invalid'); }
});

test('decodeDataUrl: rejects a declared mime the bytes do not match (SVG posing as PNG)', () => {
    try {
        decodeDataUrl(dataUrl('image/png', SVG_TEXT), { maxBytes: 1024 });
        assert.fail('should have thrown');
    } catch (err) {
        assert.equal(err.reason, 'bad_format');
    }
});

test('decodeDataUrl: rejects an unsupported declared mime outright', () => {
    try {
        decodeDataUrl(dataUrl('image/gif', GIF_HEADER), { maxBytes: 1024 });
        assert.fail('should have thrown');
    } catch (err) {
        assert.equal(err.reason, 'bad_format');
    }
});

test('decodeDataUrl: enforces the size cap on the decoded bytes', () => {
    const big = Buffer.concat([PNG_HEADER, Buffer.alloc(2000)]);
    try {
        decodeDataUrl(dataUrl('image/png', big), { maxBytes: 100 });
        assert.fail('should have thrown');
    } catch (err) {
        assert.equal(err.reason, 'too_large');
    }
});

test('decodeDataUrl: pre-checks the base64 length cap before decoding (still too_large)', () => {
    // A base64 string long enough to imply an oversized payload should fail fast, before any decode.
    const hugeB64 = 'A'.repeat(1000);
    try {
        decodeDataUrl(`data:image/png;base64,${hugeB64}`, { maxBytes: 10 });
        assert.fail('should have thrown');
    } catch (err) {
        assert.equal(err.reason, 'too_large');
    }
});

test('encodeDataUrl round-trips through decodeDataUrl', () => {
    const buffer = Buffer.concat([PNG_HEADER, Buffer.from('payload')]);
    const url = encodeDataUrl(buffer, 'image/png');
    const { buffer: out, mime } = decodeDataUrl(url, { maxBytes: 1024 });
    assert.ok(out.equals(buffer));
    assert.equal(mime, 'image/png');
});
