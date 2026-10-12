// js/generate/params.js
/**
 * Generate tab schema and pure helpers. No DOM, so tests can import it directly
 * alongside the Layout/Trace schemas.
 *
 * `help` is shown as hover text in the sidebar; keep each to one or two plain sentences.
 */

export const STORAGE_KEY = 'pieceout-generate';

export const PROMPT_MAX = 2000;
export const PREAMBLE_MAX = 4000;
export const SUBJECT_MAX_BYTES = 20 * 1024 * 1024;
export const REFERENCE_MAX_BYTES = 8 * 1024 * 1024;
export const MAX_REFERENCES = 4;
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const ASPECT_OPTIONS = [
    { value: 'portrait', label: 'Portrait' },
    { value: 'landscape', label: 'Landscape' },
    { value: 'square', label: 'Square' },
];

// Every user-facing control on this tab, with hover help. Checked by tests/paramHelp.test.js
// so a new control can't ship without an explanation.
export const GENERATE_FIELDS = [
    { key: 'provider', label: 'Provider',
      help: 'Which image generation service creates the artwork. Unavailable providers are listed but cannot be picked; hover one to see why.' },
    { key: 'prompt', label: 'Prompt',
      help: `Describe the design you want, up to ${PROMPT_MAX} characters.` },
    { key: 'subject', label: 'Subject image',
      help: 'A rough sketch or photo for the design to follow. PNG, JPEG or WebP, up to 20 MB.' },
    { key: 'aspect', label: 'Aspect',
      help: 'Portrait, landscape, or square framing for the result.' },
    { key: 'useStyle', label: 'Apply style profile',
      help: 'Apply your saved style preamble and reference images, so results stay consistent across designs.' },
    { key: 'preamble', label: 'Preamble',
      help: `Instructions appended to every prompt when Apply style profile is on, up to ${PREAMBLE_MAX} characters.` },
    { key: 'references', label: 'Style references',
      help: 'Up to four images that guide the visual style of every generation, not a subject to copy.' },
];

export function defaultPersisted() {
    return { provider: '', prompt: '', aspect: 'portrait', useStyle: true };
}

/** Validates prompt text per the API contract: 1 to PROMPT_MAX characters after trimming. */
export function validatePrompt(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return { valid: false, error: 'Enter a prompt to generate from.' };
    if (trimmed.length > PROMPT_MAX) return { valid: false, error: `Prompt is too long (max ${PROMPT_MAX} characters).` };
    return { valid: true, error: '' };
}

/** Validates the style preamble: up to PREAMBLE_MAX characters. Empty is allowed. */
export function validatePreamble(text) {
    const trimmed = (text || '').trim();
    if (trimmed.length > PREAMBLE_MAX) return { valid: false, error: `Preamble is too long (max ${PREAMBLE_MAX} characters).` };
    return { valid: true, error: '' };
}

/** True when a File's MIME type is one of the allowed image types. */
export function isAllowedImageType(file) {
    return ALLOWED_IMAGE_TYPES.includes((file?.type || '').toLowerCase());
}

/** True when a File is at or under the given byte limit. */
export function isWithinSize(file, maxBytes) {
    return typeof file?.size === 'number' && file.size <= maxBytes;
}

/** Formats whole seconds elapsed as "M:SS" for the running-generation timer. */
export function formatElapsed(totalSeconds) {
    const whole = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const minutes = Math.floor(whole / 60);
    const seconds = whole % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Extracts the MIME type from a data URL, e.g. "data:image/png;base64,..." -> "image/png". */
export function dataURLMimeType(dataUrl) {
    const match = /^data:([^;,]+)/.exec(dataUrl || '');
    return match ? match[1] : '';
}

/** Builds the "generated-YYYYMMDD-HHMMSS" base name (no extension) from a Date, local time. */
export function timestampName(date = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    return `generated-${y}${m}${d}-${hh}${mm}${ss}`;
}

/**
 * Converts a data URL to a File, so a generated image can be handed to another tab's
 * loadFile(File). Throws if the string isn't a data URL.
 */
export function dataURLToFile(dataUrl, filename) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || '');
    if (!match) throw new Error('Not a valid data URL.');
    const [, mime, isBase64, data] = match;
    const binary = isBase64 ? atob(data) : decodeURIComponent(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], filename, { type: mime || 'application/octet-stream' });
}
