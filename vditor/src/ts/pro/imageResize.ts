import { processAfterRender } from "../ir/process";
import { renderHtmlBlockFromMd, renderHtmlInlineFromMd } from "../htmlInline/htmlInlineEditor";
import { hasClosestBlock } from "../util/hasClosest";
import { afterRenderEvent } from "../wysiwyg/afterRenderEvent";

const MIN_WIDTH = 24;
const MD_IMAGE_RE = /^!\[([^\]]*)\]\(\s*<?([^\s>]+)>?(?:\s+"([^"]*)")?\s*\)$/;

type ResizeKind = "markdown" | "html-inline" | "html-block";

interface ResizeTarget {
    img: HTMLImageElement;
    kind: ResizeKind;
    /** Node replaced on commit: the img (wysiwyg md), the IR img node, or the html node. */
    node: HTMLElement;
}

let overlay: HTMLDivElement | null = null;
let activeTarget: ResizeTarget | null = null;
let activeVditor: IVditor | null = null;

const escapeAttr = (value: string) => value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");

const decodeSource = (raw: string | null) => (raw || "").replaceAll("_esc_newline_", "\n");

const commit = (vditor: IVditor) => {
    if (vditor.currentMode === "ir") {
        processAfterRender(vditor);
    } else {
        afterRenderEvent(vditor);
    }
};

const resolveTarget = (vditor: IVditor, img: HTMLImageElement): ResizeTarget | null => {
    if (img.closest(".cm-editor, .vditor-cm-chrome, .vditor-wysiwyg__preview, .vditor-ir__preview, .language-mermaid")) {
        return null;
    }
    const htmlNode = img.closest("[data-type='html-inline'], [data-type='html-block']") as HTMLElement | null;
    if (htmlNode) {
        const source = decodeSource(htmlNode.getAttribute("data-md-source")).trim();
        // Only a single <img> source can be resized safely.
        if (!/^<img\b[^>]*>$/i.test(source)) {
            return null;
        }
        return {
            img,
            kind: htmlNode.getAttribute("data-type") === "html-block" ? "html-block" : "html-inline",
            node: htmlNode,
        };
    }
    if (vditor.currentMode === "ir") {
        const irNode = img.closest(".vditor-ir__node[data-type='img']") as HTMLElement | null;
        return irNode ? { img, kind: "markdown", node: irNode } : null;
    }
    return { img, kind: "markdown", node: img };
};

/** Read src/alt/title of a Markdown image through Lute so paths stay exactly as written. */
const readMarkdownImage = (vditor: IVditor, target: ResizeTarget) => {
    const clone = target.node.cloneNode(true) as HTMLElement;
    const cloneImg = (clone.tagName === "IMG" ? clone : clone.querySelector("img")) as HTMLImageElement | null;
    const originalSrc = target.img.dataset.workspaceAbsoluteSrc;
    if (cloneImg && originalSrc) {
        cloneImg.setAttribute("src", originalSrc);
    }
    const html = `<p data-block="0">${clone.outerHTML}</p>`;
    const md = (vditor.currentMode === "ir" ? vditor.lute.VditorIRDOM2Md(html) : vditor.lute.VditorDOM2Md(html)).trim();
    const match = MD_IMAGE_RE.exec(md);
    if (!match) {
        return null;
    }
    return { alt: match[1], src: match[2], title: match[3] };
};

const setWidthInSource = (source: string, width: number | null) => {
    let next = source.replace(/\s+width\s*=\s*("[^"]*"|'[^']*'|\S+)/i, "");
    next = next.replace(/\s+height\s*=\s*("[^"]*"|'[^']*'|\S+)/i, "");
    if (width !== null) {
        next = next.replace(/\s*(\/?)>$/, (_match, slash: string) => ` width="${width}"${slash ? " /" : ""}>`);
    }
    return next;
};

const isAloneInParagraph = (node: HTMLElement) => {
    const block = hasClosestBlock(node);
    if (!block || block.tagName !== "P") {
        return null;
    }
    const text = (block.textContent || "").replace(/[​\s]/g, "");
    const ownText = (node.textContent || "").replace(/[​\s]/g, "");
    return text === ownText && block.querySelectorAll("img").length === 1 ? block : null;
};

const replaceWithHtml = (target: HTMLElement, html: string) => {
    if (!html) {
        return null;
    }
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const node = wrapper.firstElementChild as HTMLElement | null;
    if (node) {
        target.replaceWith(node);
    }
    return node;
};

/** Persist a new width (or reset with null) for the target image. */
export const applyImageWidth = (vditor: IVditor, target: ResizeTarget, width: number | null) => {
    if (target.kind === "markdown") {
        if (width === null) {
            return;
        }
        const info = readMarkdownImage(vditor, target);
        if (!info) {
            return;
        }
        const titleAttr = info.title ? ` title="${escapeAttr(info.title)}"` : "";
        const source = `<img src="${escapeAttr(info.src)}" alt="${escapeAttr(info.alt)}"${titleAttr} width="${width}">`;
        const paragraph = isAloneInParagraph(target.node);
        if (paragraph) {
            replaceWithHtml(paragraph, renderHtmlBlockFromMd(vditor, source));
        } else {
            replaceWithHtml(target.node, renderHtmlInlineFromMd(vditor, source));
        }
        commit(vditor);
        return;
    }

    const source = decodeSource(target.node.getAttribute("data-md-source")).trim();
    let next = setWidthInSource(source, width);
    if (width === null) {
        // Back to plain Markdown when only src/alt remain.
        const attrs = /^<img\s+src="([^"]*)"(?:\s+alt="([^"]*)")?(?:\s+title="([^"]*)")?\s*\/?>$/i.exec(next);
        if (attrs && !/\s/.test(attrs[1])) {
            const unescape = (value: string) => value.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
            const title = attrs[3] ? ` "${unescape(attrs[3]).replace(/"/g, "\\\"")}"` : "";
            next = `![${unescape(attrs[2] || "")}](${unescape(attrs[1])}${title})`;
            const nodes = vditor.currentMode === "ir" ? vditor.lute.Md2VditorIRDOM(next) : vditor.lute.Md2VditorDOM(next);
            const temp = document.createElement("div");
            temp.innerHTML = nodes;
            if (target.kind === "html-block") {
                const p = temp.firstElementChild;
                if (p) {
                    target.node.replaceWith(p);
                }
            } else {
                const p = temp.querySelector("p");
                if (p) {
                    target.node.replaceWith(...Array.from(p.childNodes));
                }
            }
            commit(vditor);
            return;
        }
    }
    const html = target.kind === "html-block"
        ? renderHtmlBlockFromMd(vditor, next)
        : renderHtmlInlineFromMd(vditor, next);
    replaceWithHtml(target.node, html);
    commit(vditor);
};

const hideOverlay = () => {
    if (overlay) {
        overlay.style.display = "none";
    }
    activeTarget = null;
};

const positionOverlay = () => {
    if (!overlay || !activeTarget) {
        return;
    }
    if (!activeTarget.img.isConnected) {
        hideOverlay();
        return;
    }
    const rect = activeTarget.img.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    const label = overlay.querySelector(".vditor-img-resize__label") as HTMLElement;
    label.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
};

const ensureOverlay = () => {
    if (overlay) {
        return overlay;
    }
    overlay = document.createElement("div");
    overlay.className = "vditor-img-resize";
    overlay.innerHTML = `<span class="vditor-img-resize__handle" data-dir="w"></span>
<span class="vditor-img-resize__handle" data-dir="e"></span>
<span class="vditor-img-resize__handle" data-dir="sw"></span>
<span class="vditor-img-resize__handle" data-dir="se"></span>
<span class="vditor-img-resize__label"></span>
<button type="button" class="vditor-img-resize__reset" title="Reset size">&#x21ba;</button>`;
    document.body.appendChild(overlay);

    overlay.querySelector(".vditor-img-resize__reset").addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (activeTarget && activeVditor) {
            const target = activeTarget;
            hideOverlay();
            applyImageWidth(activeVditor, target, null);
        }
    });

    overlay.querySelectorAll(".vditor-img-resize__handle").forEach((handle: HTMLElement) => {
        handle.addEventListener("pointerdown", (event: PointerEvent) => {
            if (!activeTarget || !activeVditor) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const dir = handle.getAttribute("data-dir") || "e";
            const target = activeTarget;
            const vditor = activeVditor;
            const startX = event.clientX;
            const startWidth = target.img.getBoundingClientRect().width;
            const editor = vditor[vditor.currentMode as "wysiwyg" | "ir"].element;
            const maxWidth = Math.max(MIN_WIDTH, editor.clientWidth - 16);
            const sign = dir.includes("w") ? -1 : 1;
            let latest = startWidth;
            handle.setPointerCapture(event.pointerId);
            overlay.classList.add("vditor-img-resize--dragging");

            const onMove = (moveEvent: PointerEvent) => {
                latest = Math.round(Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + sign * (moveEvent.clientX - startX))));
                target.img.style.width = `${latest}px`;
                target.img.style.maxWidth = "none";
                target.img.style.height = "auto";
                positionOverlay();
            };
            const onUp = () => {
                handle.removeEventListener("pointermove", onMove);
                handle.removeEventListener("pointerup", onUp);
                handle.removeEventListener("pointercancel", onUp);
                overlay.classList.remove("vditor-img-resize--dragging");
                hideOverlay();
                if (Math.abs(latest - startWidth) >= 1) {
                    applyImageWidth(vditor, target, latest);
                }
            };
            handle.addEventListener("pointermove", onMove);
            handle.addEventListener("pointerup", onUp);
            handle.addEventListener("pointercancel", onUp);
        });
    });

    window.addEventListener("resize", positionOverlay);
    document.addEventListener("keydown", hideOverlay, true);
    return overlay;
};

/** Show resize handles when an image in the editor is clicked (wysiwyg and IR). */
export const bindImageResize = (vditor: IVditor, editorElement: HTMLElement) => {
    editorElement.addEventListener("click", (event: MouseEvent) => {
        let img = event.target instanceof HTMLImageElement ? event.target : null;
        if (!img && event.target instanceof HTMLElement) {
            // Readonly inline/block HTML displays use pointer-events:none, the click lands on the wrapper.
            const htmlNode = event.target.closest("[data-type='html-inline'], [data-type='html-block']");
            const imgs = htmlNode?.querySelectorAll("img");
            if (imgs && imgs.length === 1) {
                const rect = imgs[0].getBoundingClientRect();
                if (event.clientX >= rect.left && event.clientX <= rect.right
                    && event.clientY >= rect.top && event.clientY <= rect.bottom) {
                    img = imgs[0];
                }
            }
        }
        if (!img) {
            hideOverlay();
            return;
        }
        const target = resolveTarget(vditor, img);
        if (!target) {
            hideOverlay();
            return;
        }
        ensureOverlay();
        activeTarget = target;
        activeVditor = vditor;
        positionOverlay();
    });
    editorElement.addEventListener("scroll", () => {
        if (activeTarget) {
            positionOverlay();
        }
    }, { passive: true });
};
