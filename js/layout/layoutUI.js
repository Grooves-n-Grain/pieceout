// js/layout/layoutUI.js
/**
 * Layout tab controller: owns the form state, regenerates parts -> sheets ->
 * SVG on every change, and renders the selected sheet on the shared canvas
 * through the existing renderer.
 */
import { andonLamp } from './templates/andonLamp.js';
import { MACHINE_PARAMS, defaultMachine, validateMachine } from './machine.js';
import { nest, NestError } from './nest.js';
import { sheetToSVG, sheetFileName } from './svgWriter.js';
import { loadLayoutState, saveLayoutState } from './storage.js';
import { downloadText } from './download.js';
import { renderParamInputs, renderDerived, renderMessages, markInvalid } from './layoutForm.js';
import { parseSVG } from '../svgParser.js';
import { injectSVG, showWireframe } from '../renderer.js';
import { createLayerState } from '../layerTagger.js';
import { setInitialView, refreshViewBox } from '../viewport.js';

const TEMPLATES = [andonLamp];

function pickKnown(defaults, saved) {
    const out = { ...defaults };
    if (!saved) return out;
    for (const key of Object.keys(defaults)) {
        if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) out[key] = saved[key];
    }
    return out;
}

function pickOverrides(derivedFields, saved) {
    const out = {};
    if (!saved) return out;
    const validKeys = new Set(derivedFields.map(d => d.key));
    for (const key of Object.keys(saved)) {
        if (validKeys.has(key) && typeof saved[key] === 'number' && Number.isFinite(saved[key])) {
            out[key] = saved[key];
        }
    }
    return out;
}

export function initLayout({ canvas, onSendToPreview }) {
    const saved = loadLayoutState();
    const template = TEMPLATES.find(t => t.id === saved?.templateId) || TEMPLATES[0];

    const state = {
        template,
        params: pickKnown(template.defaults(), saved?.params),
        overrides: pickOverrides(template.derivedFields, saved?.overrides),
        machine: pickKnown(defaultMachine(), saved?.machine),
        sheets: [],
        svgs: [],
        sheetIndex: 0,
        lastShown: null, // `${index}:${w}x${h}` of the sheet last fitted to view
    };

    const $ = (id) => document.getElementById(id);
    const lampList = $('group-lamp').querySelector('.param-list');
    const derivedList = $('group-derived').querySelector('.param-list');
    const machineList = $('group-machine').querySelector('.param-list');
    const messagesEl = $('layout-messages');
    const formEl = $('layout-form');
    const sheetSelect = $('sheet-select');
    const templateSelect = $('template-select');
    const btnExport = $('btn-export-sheet');
    const btnExportAll = $('btn-export-all');
    const btnSend = $('btn-send-preview');
    const btnReset = $('btn-layout-reset');

    templateSelect.innerHTML = '';
    for (const t of TEMPLATES) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name;
        templateSelect.appendChild(opt);
    }
    templateSelect.value = template.id;

    function persist() {
        saveLayoutState({
            templateId: state.template.id,
            params: state.params,
            overrides: state.overrides,
            machine: state.machine,
        });
    }

    function renderForm(derived) {
        renderParamInputs(lampList, state.template.params, state.params, (key, value) => {
            state.params[key] = value;
            regenerate({ rebuildForm: false });
        });
        renderDerived(derivedList, state.template.derivedFields, derived, state.overrides, (key, value) => {
            if (value === undefined) delete state.overrides[key];
            else state.overrides[key] = value;
            regenerate({ rebuildForm: false });
        });
        renderParamInputs(machineList, MACHINE_PARAMS, state.machine, (key, value) => {
            state.machine[key] = value;
            regenerate({ rebuildForm: false });
        });
    }

    function refreshDerivedValues(derived) {
        for (const def of state.template.derivedFields) {
            const input = document.getElementById(`derived-${def.key}`);
            if (input && input.disabled) input.value = String(Math.round(derived[def.key] * 1000) / 1000);
        }
    }

    function renderSheetSelect() {
        sheetSelect.innerHTML = '';
        state.sheets.forEach((sheet, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            const total = state.sheets.filter(s => s.material === sheet.material).length;
            opt.textContent = `${sheet.material} ${sheet.index} of ${total}`;
            sheetSelect.appendChild(opt);
        });
        if (state.sheetIndex >= state.sheets.length) state.sheetIndex = 0;
        sheetSelect.value = String(state.sheetIndex);
    }

    function showSheet() {
        const sheet = state.sheets[state.sheetIndex];
        const svg = state.svgs[state.sheetIndex];
        if (!sheet || !svg) return;
        const parsed = parseSVG(svg);
        injectSVG(parsed, canvas);
        showWireframe(canvas, createLayerState(parsed.layers));
        const key = `${state.sheetIndex}:${sheet.width}x${sheet.height}`;
        if (key !== state.lastShown) {
            setInitialView({ x: 0, y: 0, width: sheet.width, height: sheet.height });
            state.lastShown = key;
        } else {
            // injectSVG overwrote the viewBox from the SVG's own dimensions;
            // re-apply the current zoom/pan instead of losing it.
            refreshViewBox();
        }
    }

    function regenerate({ rebuildForm }) {
        const derived = state.template.derive(state.params, state.overrides);
        const messages = [
            ...state.template.validate(state.params, derived),
            ...validateMachine(state.machine),
        ];
        let hasErrors = messages.some(m => m.level === 'error');

        if (!hasErrors) {
            try {
                const parts = state.template.build(state.params, derived);
                state.sheets = nest(parts, state.machine);
                state.svgs = state.sheets.map(sheetToSVG);
            } catch (err) {
                if (!(err instanceof NestError)) throw err;
                messages.push({ level: 'error', field: 'sheet', message: err.message });
                hasErrors = true;
            }
        }

        if (rebuildForm) renderForm(derived);
        else refreshDerivedValues(derived);
        const errorFields = renderMessages(messagesEl, messages);
        markInvalid(formEl, errorFields);
        renderSheetSelect();
        btnExport.disabled = btnExportAll.disabled = btnSend.disabled = hasErrors || !state.sheets.length;
        showSheet();
        persist();
    }

    sheetSelect.addEventListener('change', () => {
        state.sheetIndex = parseInt(sheetSelect.value, 10) || 0;
        showSheet();
    });

    btnExport.addEventListener('click', () => {
        const sheet = state.sheets[state.sheetIndex];
        if (sheet) downloadText(sheetFileName(state.template.id, sheet), state.svgs[state.sheetIndex]);
    });

    btnExportAll.addEventListener('click', () => {
        state.sheets.forEach((sheet, i) => downloadText(sheetFileName(state.template.id, sheet), state.svgs[i]));
    });

    btnSend.addEventListener('click', () => {
        if (state.svgs[state.sheetIndex]) onSendToPreview(state.svgs[state.sheetIndex]);
    });

    btnReset.addEventListener('click', () => {
        state.params = state.template.defaults();
        state.overrides = {};
        state.machine = defaultMachine();
        regenerate({ rebuildForm: true });
    });

    templateSelect.addEventListener('change', () => {
        state.template = TEMPLATES.find(t => t.id === templateSelect.value) || TEMPLATES[0];
        state.params = state.template.defaults();
        state.overrides = {};
        regenerate({ rebuildForm: true });
    });

    regenerate({ rebuildForm: true });

    return {
        show() {
            state.lastShown = null;
            showSheet();
        },
    };
}
