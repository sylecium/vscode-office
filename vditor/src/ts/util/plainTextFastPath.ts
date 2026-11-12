/**
 * 非符号 insertText 快路径：跳过 wbr / SpinVditorDOM / outerHTML 替换。
 * Enabled for every document size: plain characters never change the block structure,
 * so re-spinning the block on each keystroke is wasted work.
 */

export const PLAIN_TEXT_FAST_PATH_MIN_LENGTH = 0;

/** 会触发 Markdown 结构或 spin 处理的字符（含空白） */
const MARKDOWN_TRIGGER_RE = /[`*_~#\-+>\[\]()|!$\\=\s]/;

export const containsMarkdownTriggerChar = (text: string): boolean => {
    return MARKDOWN_TRIGGER_RE.test(text);
};

export const isPlainTextFastPathEnabled = (vditor: IVditor): boolean => {
    return (vditor.documentInitialLength ?? 0) >= PLAIN_TEXT_FAST_PATH_MIN_LENGTH;
};

export const canUsePlainTextFastPath = (vditor: IVditor, event: InputEvent): boolean => {
    if (!isPlainTextFastPathEnabled(vditor)) {
        return false;
    }
    if (event.isComposing) {
        return false;
    }
    if (event.inputType !== "insertText") {
        return false;
    }
    if (!event.data) {
        return false;
    }
    return !containsMarkdownTriggerChar(event.data);
};
