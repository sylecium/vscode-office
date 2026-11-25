import MarkdownIt from 'markdown-it';

// A few screenfuls: the cost stays the same whatever the size of the document.
const PREVIEW_LIMIT = 8000;

// `breaks` matches the editor, which shows soft line breaks.
const markdown = new MarkdownIt({ html: true, breaks: true });
// The preview goes into the webview HTML unchecked: raw HTML from the document must never reach it.
// Everything else markdown-it emits is escaped, and it refuses script URLs in links.
markdown.renderer.rules.html_block = markdown.renderer.rules.html_inline = () => '';

// VS Code reveals a webview once it has loaded: images must not delay that.
const renderImage = markdown.renderer.rules.image;
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
    tokens[index].attrSet('loading', 'lazy');
    return renderImage(tokens, index, options, env, renderer);
};

/** Static HTML of the top of a document, shown while the editor loads. */
export function renderInstantPreview(content: string): string {
    let source = content;
    if (source.length > PREVIEW_LIMIT) {
        const blockEnd = source.lastIndexOf('\n\n', PREVIEW_LIMIT);
        source = source.slice(0, blockEnd > 0 ? blockEnd : PREVIEW_LIMIT);
    }
    source = source.replace(/^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/, '```yaml\n$1\n```');
    return markdown.render(source).replace(/<li>(\n?(?:<p>)?)\[([ xX])\] /g, (_, open: string, mark: string) =>
        `<li class="vditor-task">${open}<input type="checkbox" disabled${mark === ' ' ? '' : ' checked'}> `);
}

export function escapePreviewAttribute(value: string): string {
    return markdown.utils.escapeHtml(value);
}
