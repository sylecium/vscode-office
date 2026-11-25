const bufferMap = new WeakMap<IVditor, string>();
export interface HistoryRecordOptions {
    enableAddUndoStack: boolean;
    enableHint?: boolean;
    enableInput: boolean;
}

const pendingHistory = new WeakMap<IVditor, HistoryRecordOptions>();

/** Options of the record still waiting for a debounce: that edit has not reached the host yet. */
export const getPendingHistory = (vditor: IVditor) => pendingHistory.get(vditor);

export const setHistoryPending = (vditor: IVditor, options?: HistoryRecordOptions) => {
    if (options) {
        pendingHistory.set(vditor, options);
    } else {
        pendingHistory.delete(vditor);
    }
};

export const getHistoryInputBuffer = (vditor: IVditor) => bufferMap.get(vditor) || "";

export const historyInputBufferHasText = (vditor: IVditor) => getHistoryInputBuffer(vditor).length > 0;

export const clearHistoryInputBuffer = (vditor: IVditor) => {
    bufferMap.delete(vditor);
};

export const appendHistoryInputBuffer = (vditor: IVditor, text: string) => {
    if (!text) {
        return;
    }
    bufferMap.set(vditor, getHistoryInputBuffer(vditor) + text);
};

/** 追加输入并判断空白边界是否应立刻入栈 */
export const trackHistoryInputFromText = (vditor: IVditor, text: string): boolean => {
    if (!text) {
        return false;
    }
    const hadNonWhitespace = /\S/.test(getHistoryInputBuffer(vditor));
    appendHistoryInputBuffer(vditor, text);
    return /\s/.test(text) && hadNonWhitespace;
};

export const trackHistoryInputFromEvent = (vditor: IVditor, event: InputEvent): boolean => {
    if (event.isComposing) {
        return false;
    }
    if (!event.data || event.inputType.indexOf("insert") !== 0) {
        if (event.inputType.indexOf("delete") === 0) {
            clearHistoryInputBuffer(vditor);
        }
        return false;
    }
    return trackHistoryInputFromText(vditor, event.data);
};
