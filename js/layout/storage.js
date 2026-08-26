/** Persists the Layout tab's inputs in localStorage. Versioned so a future schema change can discard stale data. */
export const STORAGE_KEY = 'pieceout-layout-state';
const VERSION = 1;

export function loadLayoutState(store = globalThis.localStorage) {
    try {
        const raw = store?.getItem(STORAGE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (data?.version !== VERSION) return null;
        const { templateId, params, overrides, machine } = data;
        return { templateId, params, overrides, machine };
    } catch {
        return null;
    }
}

export function saveLayoutState(state, store = globalThis.localStorage) {
    try {
        store?.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, ...state }));
    } catch {
        // localStorage unavailable (private mode, quota); the form still works for this session.
    }
}
