import { getMarkdown } from "../markdown/getMarkdown";
import { saveCacheFocus } from "../util/cacheFocus";
import { fireContentInput } from "../util/saveToolbarState";
import { accessLocalStorage } from "../util/compatibility";
import { clearHistoryInputBuffer, getHistoryBurstStart, setHistoryPending } from "../util/historyInputBufferState";
import {
    cancelIdleHistory,
    getHistoryMaxWaitFactor,
    getHistoryRecordWait,
    scheduleIdleHistory,
} from "../util/historySchedule";
import { matchHotkeyNew } from "../util/hotKey";
import { formatMs, logPerf } from "../util/log";


export function handlerHistoryEvent(event: KeyboardEvent, vditor: IVditor,): boolean {

    if (matchHotkeyNew("^s", event) || matchHotkeyNew("^x", event)) {
        clearTimeout(vditor.wysiwyg.afterRenderTimeoutId);
        recordHistory(vditor)
    }

    return false;
}

export const afterRenderEvent = (vditor: IVditor, options = {
    enableAddUndoStack: true,
    enableHint: false,
    enableInput: true,
}) => {
    if (options.enableHint) {
        vditor.hint.render(vditor);
    }
    clearTimeout(vditor.wysiwyg.afterRenderTimeoutId);
    cancelIdleHistory(vditor.wysiwyg);
    setHistoryPending(vditor, options);
    const wait = getHistoryRecordWait(
        getHistoryBurstStart(vditor),
        vditor.options.undoDelay,
        getHistoryMaxWaitFactor(vditor),
    );
    vditor.wysiwyg.afterRenderTimeoutId = window.setTimeout(() => {
        scheduleIdleHistory(vditor.wysiwyg, () => recordHistory(vditor, options));
    }, wait);
};

export function recordHistory(vditor: IVditor, options = { enableAddUndoStack: true, enableInput: true, }) {
    if (vditor.wysiwyg.composingLock) {
        return;
    }
    cancelIdleHistory(vditor.wysiwyg);
    setHistoryPending(vditor);

    const debug = vditor.options.debugger;
    const totalStart = debug ? performance.now() : 0;

    let stepStart = debug ? performance.now() : 0;
    // Full-document serialization: skipped when nothing reads it, e.g. when a document opens.
    const needsText = options.enableInput || vditor.options.counter.enable || vditor.options.cache.enable;
    const text = needsText ? getMarkdown(vditor) : "";
    const getMarkdownMs = debug ? performance.now() - stepStart : 0;

    stepStart = debug ? performance.now() : 0;
    if (options.enableInput) {
        fireContentInput(vditor, text);
    }
    const inputCallbackMs = debug ? performance.now() - stepStart : 0;

    stepStart = debug ? performance.now() : 0;
    if (vditor.options.counter.enable) {
        vditor.counter.render(vditor, text);
    }

    if (vditor.options.cache.enable && accessLocalStorage()) {
        localStorage.setItem(vditor.options.cache.id, text);
        saveCacheFocus(vditor);
        if (vditor.options.cache.after) {
            vditor.options.cache.after(text);
        }
    }
    const cacheAndCounterMs = debug ? performance.now() - stepStart : 0;

    stepStart = debug ? performance.now() : 0;
    if (options.enableAddUndoStack) {
        vditor.undo.addToUndoStack(vditor);
    }
    const undoStackMs = debug ? performance.now() - stepStart : 0;

    logPerf(debug, "[vditor input] recordHistory", {
        getMarkdownMs: formatMs(getMarkdownMs),
        inputCallbackMs: formatMs(inputCallbackMs),
        cacheAndCounterMs: formatMs(cacheAndCounterMs),
        undoStackMs: formatMs(undoStackMs),
        totalMs: formatMs(debug ? performance.now() - totalStart : 0),
    });

    clearHistoryInputBuffer(vditor);
}
