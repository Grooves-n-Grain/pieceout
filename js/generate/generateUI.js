/** Generate controller: prompt + optional subject image to artwork via a chosen provider,
 * shown as a raster on the shared canvas, plus a saved style profile applied to every request. */
import * as api from './api.js';
import { setInitialView } from '../viewport.js';
import {
    STORAGE_KEY, PROMPT_MAX, PREAMBLE_MAX, SUBJECT_MAX_BYTES, REFERENCE_MAX_BYTES, MAX_REFERENCES,
    ASPECT_OPTIONS, GENERATE_FIELDS, defaultPersisted, validatePrompt, validatePreamble,
    isAllowedImageType, isWithinSize, formatElapsed, timestampName, dataURLToFile,
} from './params.js';

const NS = 'http://www.w3.org/2000/svg';
const HELP = Object.fromEntries(GENERATE_FIELDS.map(f => [f.key, f.help]));

function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
        reader.readAsDataURL(file);
    });
}

// Mirrors js/relief/imagePreview.js's decode-for-dimensions pattern (object URL / data URL ->
// Image().decode()), since the API contract doesn't return the result's pixel size.
async function decodeDimensions(dataUrl) {
    const image = new Image();
    image.src = dataUrl;
    try {
        await image.decode();
    } catch {
        throw new Error('The generated image could not be decoded.');
    }
    return { width: image.naturalWidth, height: image.naturalHeight };
}

export function initGenerate({ canvas, isActive, onSendToTrace, onNewResult }) {
    const $ = id => document.getElementById(id);
    const providerSelect = $('generate-provider');
    const promptInput = $('generate-prompt');
    const promptCounter = $('generate-prompt-counter');
    const subjectOpenBtn = $('btn-generate-subject-open');
    const subjectInput = $('generate-subject-input');
    const subjectClearBtn = $('btn-generate-subject-clear');
    const subjectPreview = $('generate-subject-preview');
    const subjectThumb = $('generate-subject-thumb');
    const subjectName = $('generate-subject-name');
    const aspectSelect = $('generate-aspect');
    const useStyleInput = $('generate-use-style');
    const runBtn = $('btn-generate-run');
    const cancelBtn = $('btn-generate-cancel');
    const timerEl = $('generate-timer');
    const slowNoteEl = $('generate-slow-note');
    const statusEl = $('generate-status');
    const preambleInput = $('generate-style-preamble');
    const preambleCounter = $('generate-style-counter');
    const refsContainer = $('generate-style-refs');
    const refAddBtn = $('btn-generate-ref-add');
    const refInput = $('generate-ref-input');
    const styleSaveBtn = $('btn-generate-style-save');
    const styleResetBtn = $('btn-generate-style-reset');
    const styleUnsavedEl = $('generate-style-unsaved');
    const styleStatusEl = $('generate-style-status');
    const sendTraceBtn = $('btn-generate-send-trace');
    const downloadBtn = $('btn-generate-download');
    // Controls disabled while a generation is in flight; the subject Clear button is handled
    // separately since its own disabled state also depends on whether a subject is loaded.
    const formControls = [providerSelect, promptInput, subjectOpenBtn, aspectSelect, useStyleInput];

    // Every control's hover help comes from the pure schema (js/generate/params.js), matched
    // to the markup by data-help-key, so the text lives in one place and paramHelp.test.js can
    // catch a control that ships without one.
    document.querySelectorAll('#generate-sidebar [data-help-key]').forEach(el => {
        const text = HELP[el.dataset.helpKey];
        if (text) el.title = text;
    });

    aspectSelect.replaceChildren(...ASPECT_OPTIONS.map(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        return option;
    }));

    let providers = [];
    let providersUsable = false;
    let subjectFile = null, subjectDataUrl = '';
    let running = false, controller = null, startedAt = 0, timerHandle = null;
    let result = null; // { image, width, height, provider, model, seconds }
    let pendingRender = false; // a result arrived while another tab was active
    let needsFit = false;

    // Style profile state. `savedSnapshot` is the JSON of what the server last held, used to
    // show "unsaved changes"; `defaultPreamble` is the first preamble this session ever saw
    // from GET /style. Per the contract, the simplest correct "reset" is re-saving that text,
    // since the API has no separate endpoint for the built-in default.
    let stylePreamble = '';
    let styleReferences = []; // [{ id, name, dataUrl }]; id is assigned by the server once saved
    let defaultPreamble = null;
    let savedSnapshot = null;
    let styleLoaded = false;

    // Restore persisted choices before anything async runs, so they show even if the server
    // chunk isn't reachable yet - only provider selection needs the provider list to arrive.
    const persisted = { ...defaultPersisted(), ...restorePersisted() };
    promptInput.value = persisted.prompt || '';
    aspectSelect.value = persisted.aspect || 'portrait';
    useStyleInput.checked = persisted.useStyle !== false;

    function restorePersisted() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch { return {}; } // corrupt or unavailable storage falls back to defaults
    }
    function persist() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                provider: providerSelect.value, prompt: promptInput.value,
                aspect: aspectSelect.value, useStyle: useStyleInput.checked,
            }));
        } catch { /* private mode / quota - persistence is a convenience only */ }
    }

    function setMessage(text, level = '') {
        statusEl.textContent = text;
        statusEl.classList.toggle('error', level === 'error');
        statusEl.classList.toggle('warn', level === 'warn');
    }
    function setStyleMessage(text, level = '') {
        styleStatusEl.textContent = text;
        styleStatusEl.classList.toggle('error', level === 'error');
        styleStatusEl.classList.toggle('warn', level === 'warn');
    }

    function selectedProvider() {
        return providers.find(p => p.id === providerSelect.value) || null;
    }

    function updatePromptCounter() { promptCounter.textContent = `${promptInput.value.length} / ${PROMPT_MAX}`; }
    function updatePreambleCounter() { preambleCounter.textContent = `${preambleInput.value.length} / ${PREAMBLE_MAX}`; }

    // Compares the live textarea value, not the `stylePreamble` variable (that only tracks
    // what the server last confirmed), so typing actually flips the unsaved indicator.
    function styleDirty() {
        if (!styleLoaded) return false;
        return JSON.stringify({ preamble: preambleInput.value, references: styleReferences }) !== savedSnapshot;
    }

    function renderStyleRefs() {
        refsContainer.replaceChildren();
        styleReferences.forEach((ref, index) => {
            const item = document.createElement('div');
            item.className = 'generate-ref';
            const img = document.createElement('img');
            img.src = ref.dataUrl;
            img.alt = ref.name;
            const label = document.createElement('span');
            label.textContent = ref.name;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'small-btn';
            remove.textContent = 'Remove';
            remove.title = `Remove ${ref.name} from the style profile.`;
            remove.addEventListener('click', () => {
                styleReferences.splice(index, 1);
                renderStyleRefs();
                updateStyleUI();
            });
            item.append(img, label, remove);
            refsContainer.appendChild(item);
        });
        refAddBtn.disabled = styleReferences.length >= MAX_REFERENCES;
    }

    function updateStyleUI() {
        updatePreambleCounter();
        const dirty = styleDirty();
        styleUnsavedEl.hidden = !dirty;
        styleSaveBtn.disabled = !dirty;
        styleResetBtn.disabled = defaultPreamble === null;
    }

    async function loadStyle() {
        try {
            const profile = await api.getStyle();
            stylePreamble = profile.preamble || '';
            styleReferences = (profile.references || []).map(r => ({ id: r.id, name: r.name, dataUrl: r.dataUrl }));
            if (defaultPreamble === null) defaultPreamble = stylePreamble;
            savedSnapshot = JSON.stringify({ preamble: stylePreamble, references: styleReferences });
            styleLoaded = true;
            preambleInput.value = stylePreamble;
            renderStyleRefs();
            updateStyleUI();
        } catch (err) {
            setStyleMessage(err.message, 'error');
        }
    }

    async function saveStyleProfile(preambleOverride) {
        const preamble = preambleOverride !== undefined ? preambleOverride : preambleInput.value;
        const { valid, error } = validatePreamble(preamble);
        if (!valid) { setStyleMessage(error, 'error'); return; }
        setStyleMessage('Saving…');
        try {
            const saved = await api.saveStyle({
                preamble: preamble.trim(),
                references: styleReferences.map(r => ({ name: r.name, dataUrl: r.dataUrl })),
            });
            stylePreamble = saved.preamble || '';
            styleReferences = (saved.references || []).map(r => ({ id: r.id, name: r.name, dataUrl: r.dataUrl }));
            savedSnapshot = JSON.stringify({ preamble: stylePreamble, references: styleReferences });
            preambleInput.value = stylePreamble;
            renderStyleRefs();
            setStyleMessage('Style profile saved.');
        } catch (err) {
            setStyleMessage(err.message, 'error');
        } finally {
            updateStyleUI();
        }
    }

    preambleInput.addEventListener('input', updateStyleUI);
    styleSaveBtn.addEventListener('click', () => saveStyleProfile());
    styleResetBtn.addEventListener('click', () => {
        if (defaultPreamble === null) return;
        preambleInput.value = defaultPreamble;
        saveStyleProfile(defaultPreamble);
    });
    refAddBtn.addEventListener('click', () => refInput.click());
    refInput.addEventListener('change', async () => {
        const file = refInput.files[0];
        refInput.value = '';
        if (!file) return;
        if (styleReferences.length >= MAX_REFERENCES) { setStyleMessage(`Up to ${MAX_REFERENCES} style references.`, 'error'); return; }
        if (!isAllowedImageType(file)) { setStyleMessage('Choose a PNG, JPEG or WebP image.', 'error'); return; }
        if (!isWithinSize(file, REFERENCE_MAX_BYTES)) { setStyleMessage('That reference image is over 8 MB.', 'error'); return; }
        try {
            const dataUrl = await readAsDataURL(file);
            styleReferences.push({ name: file.name, dataUrl });
            renderStyleRefs();
            updateStyleUI();
        } catch (err) {
            setStyleMessage(err.message, 'error');
        }
    });

    // --- Providers ---

    function renderProviders(selectedId) {
        providerSelect.replaceChildren(...providers.map(p => {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = p.label;
            option.disabled = !p.available;
            if (!p.available && p.reason) option.title = p.reason;
            return option;
        }));
        providerSelect.value = selectedId;
    }

    async function loadProviders() {
        setMessage('Loading providers…');
        try {
            const body = await api.getProviders();
            providers = body.providers || [];
            const available = providers.filter(p => p.available);
            providersUsable = available.length > 0;
            const choice = providers.find(p => p.id === persisted.provider && p.available)?.id
                || available[0]?.id || providers[0]?.id || '';
            renderProviders(choice);
            if (!providersUsable) {
                const reasons = providers.filter(p => p.reason).map(p => `${p.label}: ${p.reason}`).join(' ');
                setMessage(reasons ? `No image provider is available. ${reasons}` : 'No image provider is available.', 'error');
            } else {
                setMessage('Ready.');
            }
        } catch (err) {
            providers = [];
            providersUsable = false;
            setMessage(err.message, 'error');
        } finally {
            updateRunUI();
        }
    }

    providerSelect.addEventListener('change', () => { persist(); updateRunUI(); });
    promptInput.addEventListener('input', () => { updatePromptCounter(); persist(); updateRunUI(); });
    aspectSelect.addEventListener('change', persist);
    useStyleInput.addEventListener('change', persist);

    // --- Subject image ---

    async function setSubject(file) {
        if (!isAllowedImageType(file)) { setMessage('Choose a PNG, JPEG or WebP image for the subject.', 'error'); return; }
        if (!isWithinSize(file, SUBJECT_MAX_BYTES)) { setMessage('That subject image is over 20 MB.', 'error'); return; }
        try {
            subjectDataUrl = await readAsDataURL(file);
            subjectFile = file;
            subjectThumb.src = subjectDataUrl;
            subjectName.textContent = file.name;
            subjectPreview.hidden = false;
            setMessage('Subject image ready.');
        } catch (err) {
            setMessage(err.message, 'error');
        } finally {
            updateRunUI();
        }
    }
    function clearSubject() {
        subjectFile = null;
        subjectDataUrl = '';
        subjectThumb.removeAttribute('src');
        subjectName.textContent = '';
        subjectPreview.hidden = true;
        updateRunUI();
    }
    subjectOpenBtn.addEventListener('click', () => subjectInput.click());
    subjectInput.addEventListener('change', () => {
        if (subjectInput.files[0]) setSubject(subjectInput.files[0]);
        subjectInput.value = '';
    });
    subjectClearBtn.addEventListener('click', clearSubject);

    // --- Generate / cancel ---

    function updateRunUI() {
        const provider = selectedProvider();
        runBtn.disabled = running || !providersUsable || !provider?.available;
        cancelBtn.hidden = !running;
        formControls.forEach(el => { el.disabled = running; });
        subjectClearBtn.disabled = running || !subjectFile;
        slowNoteEl.hidden = !(running && provider?.slow);
        timerEl.hidden = !running;
        downloadBtn.disabled = !result;
        sendTraceBtn.disabled = !result;
    }

    function tickTimer() {
        timerEl.textContent = `Elapsed: ${formatElapsed((Date.now() - startedAt) / 1000)}`;
    }

    async function runGenerate() {
        const { valid, error } = validatePrompt(promptInput.value);
        if (!valid) { setMessage(error, 'error'); return; }
        const provider = selectedProvider();
        if (!provider?.available) { setMessage('Choose an available provider.', 'error'); return; }

        running = true;
        controller = new AbortController();
        startedAt = Date.now();
        timerHandle = setInterval(tickTimer, 1000);
        tickTimer();
        setMessage(`Generating with ${provider.label}…`);
        updateRunUI();

        try {
            const body = await api.generateImage({
                provider: provider.id,
                prompt: promptInput.value.trim(),
                subject: subjectDataUrl || null,
                useStyle: useStyleInput.checked,
                aspect: aspectSelect.value,
            }, controller.signal);
            const { width, height } = await decodeDimensions(body.image);
            result = { ...body, width, height };
            needsFit = true;
            onNewResult?.(); // a fresh result always gets a fresh fit-to-view (see app.js)
            setMessage(`Done in ${typeof body.seconds === 'number' ? body.seconds.toFixed(1) : '?'} seconds${body.model ? ` using ${body.model}` : ''}.`);
            renderCanvas();
        } catch (err) {
            if (err.name === 'AbortError') setMessage('Generation cancelled.', 'warn');
            else setMessage(err.message, 'error');
        } finally {
            running = false;
            controller = null;
            clearInterval(timerHandle);
            timerHandle = null;
            updateRunUI();
        }
    }

    runBtn.addEventListener('click', runGenerate);
    cancelBtn.addEventListener('click', () => { controller?.abort(); });

    // --- Canvas / result ---

    // Called after a result arrives and whenever this tab becomes active again. A result that
    // lands while another tab is showing must not touch the shared canvas or its viewport - it
    // waits here (pendingRender) until the next show().
    function renderCanvas() {
        if (!isActive()) { pendingRender = true; return; }
        pendingRender = false;
        canvas.replaceChildren();
        if (!result) return;
        const image = document.createElementNS(NS, 'image');
        image.setAttribute('href', result.image);
        image.setAttribute('width', result.width);
        image.setAttribute('height', result.height);
        canvas.appendChild(image);
        if (needsFit) {
            setInitialView({ x: 0, y: 0, width: result.width, height: result.height });
            needsFit = false;
        }
    }

    sendTraceBtn.addEventListener('click', () => {
        if (!result) return;
        const file = dataURLToFile(result.image, `${timestampName()}.png`);
        onSendToTrace?.(file);
    });
    downloadBtn.addEventListener('click', () => {
        if (!result) return;
        const a = document.createElement('a');
        a.href = result.image;
        a.download = `${timestampName()}.png`;
        a.click();
    });

    updatePromptCounter();
    updateRunUI();
    loadProviders();
    loadStyle();

    return {
        show() {
            if (pendingRender) renderCanvas();
        },
        hide() {}, // nothing to tear down; the running fetch survives a tab switch on purpose
        loadSubjectFile(file) { setSubject(file); },
        hasResult: () => Boolean(result),
    };
}
