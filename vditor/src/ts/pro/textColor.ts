import { processAfterRender } from "../ir/process";
import { renderHtmlInlineFromMd } from "../htmlInline/htmlInlineEditor";
import { hasClosestBlock, hasClosestByAttribute } from "../util/hasClosest";
import { getEditorRange, setSelectionFocus } from "../util/selection";
import { afterRenderEvent } from "../wysiwyg/afterRenderEvent";

export type StyleTarget = "color" | "background-color";

const SPAN_SOURCE_RE = /^<span\s+style="([^"]*)">([\s\S]*)<\/span>$/i;
const SAFE_COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;

export const TEXT_COLOR_PRESETS = [
    "#e03e2d", "#e67e23", "#f1c40f", "#2dc26b", "#3598db", "#8e44ad",
    "#c0392b", "#d35400", "#7f8c8d", "#16a085", "#2c3e50", "#ffffff",
];

export const BACKGROUND_COLOR_PRESETS = [
    "#fbeeb8", "#fde2e1", "#e2f5e9", "#e1effa", "#efe4f6", "#eeeeee",
    "#f8d26a", "#f5a3a0", "#9bdcb4", "#9cc9ee", "#c9a8e0", "#bdbdbd",
];

const escapeHtml = (text: string) => text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const parseStyle = (style: string) => {
    const map = new Map<string, string>();
    for (const decl of style.split(";")) {
        const index = decl.indexOf(":");
        if (index < 0) {
            continue;
        }
        const key = decl.slice(0, index).trim().toLowerCase();
        const value = decl.slice(index + 1).trim();
        if (key && value) {
            map.set(key, value);
        }
    }
    return map;
};

const serializeStyle = (map: Map<string, string>) =>
    Array.from(map.entries()).map(([key, value]) => `${key}:${value}`).join(";");

const decodeSource = (raw: string | null) => (raw || "").replaceAll("_esc_newline_", "\n");

const getModeElement = (vditor: IVditor) => vditor[vditor.currentMode as "wysiwyg" | "ir"].element;

const commit = (vditor: IVditor) => {
    if (vditor.currentMode === "ir") {
        processAfterRender(vditor);
    } else {
        afterRenderEvent(vditor);
    }
};

/** Render inline Markdown (without wrapping span) back into editor DOM nodes. */
const renderInlineMarkdownNodes = (vditor: IVditor, markdown: string): Node[] => {
    if (!markdown) {
        return [];
    }
    const html = vditor.currentMode === "ir"
        ? vditor.lute.Md2VditorIRDOM(markdown)
        : vditor.lute.Md2VditorDOM(markdown);
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const paragraph = temp.querySelector("p");
    const source = paragraph ?? temp;
    return Array.from(source.childNodes);
};

const placeCaretAfter = (node: Node) => {
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    setSelectionFocus(range);
};

const findStyledSpanNode = (vditor: IVditor, range: Range): HTMLElement | null => {
    const editor = getModeElement(vditor);
    const candidates = [range.startContainer, range.commonAncestorContainer];
    for (const node of candidates) {
        const found = hasClosestByAttribute(node, "data-type", "html-inline");
        if (found && editor.contains(found) && SPAN_SOURCE_RE.test(decodeSource(found.getAttribute("data-md-source")))) {
            return found;
        }
    }
    // Selection exactly around a readonly inline node.
    if (!range.collapsed) {
        const fragment = range.cloneContents();
        if (fragment.childNodes.length === 1 && fragment.firstChild instanceof HTMLElement
            && fragment.firstChild.getAttribute("data-type") === "html-inline") {
            const startNode = range.startContainer.childNodes?.[range.startOffset];
            if (startNode instanceof HTMLElement && startNode.getAttribute("data-type") === "html-inline") {
                return startNode;
            }
        }
    }
    return null;
};

const replaceWithSource = (vditor: IVditor, target: HTMLElement, source: string) => {
    const html = renderHtmlInlineFromMd(vditor, source);
    if (!html) {
        return null;
    }
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const node = wrapper.firstElementChild as HTMLElement | null;
    if (!node) {
        return null;
    }
    target.replaceWith(node);
    return node;
};

/**
 * Apply (or clear with `value = null`) a text color / background color to the current selection.
 * The result is stored as inline HTML `<span style="...">…</span>`, which round-trips through Lute.
 */
export const applyTextStyle = (vditor: IVditor, target: StyleTarget | "all", value: string | null) => {
    if (vditor.currentMode !== "wysiwyg" && vditor.currentMode !== "ir") {
        return;
    }
    if (value !== null && (target === "all" || !SAFE_COLOR_RE.test(value.trim()))) {
        return;
    }
    const range = getEditorRange(vditor);
    const editor = getModeElement(vditor);
    if (!editor.contains(range.startContainer)) {
        return;
    }

    // Update an existing colored span.
    const existing = findStyledSpanNode(vditor, range);
    if (existing) {
        const match = SPAN_SOURCE_RE.exec(decodeSource(existing.getAttribute("data-md-source")));
        if (!match) {
            return;
        }
        const styles = parseStyle(match[1]);
        if (target === "all") {
            styles.delete("color");
            styles.delete("background-color");
        } else if (value === null) {
            styles.delete(target);
        } else {
            styles.set(target, value.trim());
        }
        if (styles.size === 0) {
            const nodes = renderInlineMarkdownNodes(vditor, match[2]);
            const last = nodes[nodes.length - 1];
            existing.replaceWith(...nodes);
            if (last) {
                placeCaretAfter(last);
            }
        } else {
            const node = replaceWithSource(vditor, existing, `<span style="${serializeStyle(styles)}">${match[2]}</span>`);
            if (node) {
                placeCaretAfter(node);
            }
        }
        commit(vditor);
        return;
    }

    if (range.collapsed || value === null) {
        return;
    }
    const startBlock = hasClosestBlock(range.startContainer);
    const endBlock = hasClosestBlock(range.endContainer);
    if (!startBlock || startBlock !== endBlock) {
        // Multi-block selections are not supported (inline HTML cannot span blocks).
        return;
    }
    const blockType = startBlock.getAttribute("data-type");
    if (blockType === "code-block" || blockType === "math-block" || blockType === "html-block") {
        return;
    }
    if (vditor.currentMode === "ir") {
        // IR serializes inline nodes (strong, em, link...) from their markers: a span nested inside
        // would be flattened and lost. Not supported in IR.
        let node: Node | null = range.commonAncestorContainer;
        while (node && node !== startBlock) {
            if (node instanceof HTMLElement && node.classList.contains("vditor-ir__node")
                && node.getAttribute("data-type") !== "html-inline") {
                return;
            }
            node = node.parentNode;
        }
    }
    // Lute cannot round-trip Markdown nested inside inline HTML: keep the span content plain text.
    // Refuse selections whose content would lose data (links, code, math, images, inline HTML).
    const fragment = range.cloneContents();
    if (fragment.querySelector?.("a, code, img, [data-type='a'], [data-type='link'], [data-type='inline-math'], [data-type='math-inline'], [data-type='html-inline'], [data-type='code'], [data-type='img'], [data-type='inline-code']")) {
        return;
    }
    const inner = escapeHtml(range.toString().replace(/\u200b/g, ""));
    if (!inner.trim()) {
        return;
    }
    const html = renderHtmlInlineFromMd(vditor, `<span style="${target}:${value.trim()}">${inner}</span>`);
    if (!html) {
        return;
    }
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const node = wrapper.firstElementChild;
    if (!node) {
        return;
    }
    range.deleteContents();
    range.insertNode(node);
    placeCaretAfter(node);
    commit(vditor);
};

export const clearTextStyles = (vditor: IVditor) => {
    applyTextStyle(vditor, "all", null);
};
