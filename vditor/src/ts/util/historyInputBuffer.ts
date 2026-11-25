import { processAfterRender, recordHistory as recordIrHistory } from "../ir/process";
import { afterRenderEvent, recordHistory as recordWysiwygHistory } from "../wysiwyg/afterRenderEvent";
import { clearPendingHistoryTimeout } from "./instantHistory";
import { getHistoryMaxWaitFactor, isUnlimitedHistoryDefer, scheduleIdleHistory } from "./historySchedule";
import {
    clearHistoryInputBuffer,
    getPendingHistory,
    historyInputBufferHasText,
    setHistoryPending,
    trackHistoryInputFromEvent,
    trackHistoryInputFromText,
} from "./historyInputBufferState";

export {
    clearHistoryInputBuffer,
    historyInputBufferHasText,
    trackHistoryInputFromEvent,
    trackHistoryInputFromText,
} from "./historyInputBufferState";

const defaultRecordOptions = {
    enableAddUndoStack: true,
    enableHint: false,
    enableInput: true,
};

export const flushBufferedHistory = (vditor: IVditor, options = defaultRecordOptions) => {
    clearPendingHistoryTimeout(vditor);
    if (vditor.currentMode === "wysiwyg") {
        recordWysiwygHistory(vditor, options);
    } else if (vditor.currentMode === "ir") {
        recordIrHistory(vditor, options);
    }
};

/**
 * Word-boundary flush from typing: run the snapshot when the main thread is idle instead of
 * inside the keystroke handler, so the typed character is painted immediately.
 * Large documents only record once typing pauses: an idle callback cannot be interrupted,
 * so a full serialization per word still delays the next keystrokes.
 */
export const flushBufferedHistoryDeferred = (vditor: IVditor, options = defaultRecordOptions) => {
    if (isUnlimitedHistoryDefer(getHistoryMaxWaitFactor(vditor))) {
        if (vditor.currentMode === "wysiwyg") {
            afterRenderEvent(vditor, { ...options });
        } else if (vditor.currentMode === "ir") {
            processAfterRender(vditor, { ...options });
        }
        return;
    }
    clearPendingHistoryTimeout(vditor);
    setHistoryPending(vditor, options);
    const owner = vditor.currentMode === "ir" ? vditor.ir : vditor.wysiwyg;
    const mode = vditor.currentMode;
    scheduleIdleHistory(owner, () => {
        if (vditor.currentMode !== mode) {
            return;
        }
        if (mode === "wysiwyg") {
            recordWysiwygHistory(vditor, options);
        } else if (mode === "ir") {
            recordIrHistory(vditor, options);
        }
    });
};

/** Record now whatever is still waiting for a debounce, e.g. before the editor loses focus. */
export const flushPendingHistory = (vditor: IVditor) => {
    // Same options as the scheduled record: after undo/redo it must not push a new undo step.
    const pending = getPendingHistory(vditor);
    if (pending) {
        flushBufferedHistory(vditor, { enableHint: false, ...pending });
    }
};

export const flushBufferedHistoryOnClick = (vditor: IVditor) => {
    if (!historyInputBufferHasText(vditor)) {
        return;
    }
    flushBufferedHistory(vditor);
};

export const bindHistoryInputBufferClick = (vditor: IVditor) => {
    vditor.element.addEventListener("mousedown", () => {
        flushBufferedHistoryOnClick(vditor);
    }, true);
};
