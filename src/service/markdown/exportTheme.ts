/**
 * Builds the extra CSS injected into exported HTML/PDF/DOCX so the export matches
 * the theme, fonts and sizes chosen in the export dialog.
 */

export type ExportThemeMode = 'classic' | 'editor';

export interface ExportCodeColors {
    bg?: string; fg?: string; comment?: string; keyword?: string; string?: string; number?: string;
    atom?: string; property?: string; attribute?: string; variable?: string; def?: string;
    bracket?: string; tag?: string; link?: string; error?: string;
}

export interface ExportStyle {
    theme?: ExportThemeMode;
    isDark?: boolean;
    fontFamily?: string;
    /** px */
    fontSize?: number;
    lineHeight?: number;
    codeFontFamily?: string;
    /** px, HTML only (content max width) */
    pageWidth?: number;
    cssVariables?: Record<string, string>;
    codeThemeColors?: ExportCodeColors;
}

/** Keep values that cannot break out of a CSS declaration. */
const cssValue = (value: unknown): string | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const text = String(value).trim();
    if (!text || /[{}<>;]/.test(text) || text.length > 300) return undefined;
    return text;
};

const decl = (prop: string, value: unknown) => {
    const v = cssValue(value);
    return v ? `${prop}:${v} !important;` : '';
};

const rule = (selector: string, body: string) => body ? `${selector}{${body}}\n` : '';

export const buildExportCss = (style: ExportStyle | undefined): string => {
    if (!style) return '';
    let css = '';

    const fontSize = typeof style.fontSize === 'number' && style.fontSize >= 8 && style.fontSize <= 48
        ? `${style.fontSize}px` : undefined;
    const lineHeight = typeof style.lineHeight === 'number' && style.lineHeight >= 1 && style.lineHeight <= 3
        ? String(style.lineHeight) : undefined;
    const pageWidth = typeof style.pageWidth === 'number' && style.pageWidth >= 400 && style.pageWidth <= 2400
        ? `${style.pageWidth}px` : undefined;

    css += rule('body', decl('font-family', style.fontFamily) + decl('font-size', fontSize) + decl('line-height', lineHeight));
    css += rule('.content-wrapper', decl('max-width', pageWidth));
    css += rule('code, pre, pre code, kbd, samp, .hljs', decl('font-family', style.codeFontFamily));

    if (style.theme === 'editor') {
        const v = style.cssVariables || {};
        const c = style.codeThemeColors || {};
        css += rule('html, body',
            decl('background-color', v['--bg-color'])
            + decl('color', v['--front-color'])
            + '-webkit-print-color-adjust:exact;print-color-adjust:exact;');
        css += rule('a', decl('color', v['--link-color']));
        css += rule('strong, b', decl('color', v['--bold-color']));
        css += rule('em, i', decl('color', v['--italic-color']));
        css += rule('blockquote',
            decl('color', v['--blockquote-color'])
            + decl('border-left-color', v['--blockquote-border'])
            + decl('background', v['--blockquote-bg']));
        css += rule('hr', decl('background-color', v['--hr-bg']) + decl('border-color', v['--hr-bg']));
        css += rule('table th', decl('background-color', v['--table-header-bg']));
        css += rule('table td', decl('background-color', v['--table-body-bg']));
        css += rule('table, table th, table td', decl('border-color', v['--table-border']));
        css += rule(':not(pre) > code', decl('background-color', v['--code-bg-color']) + decl('color', v['--code-fg-color']));
        css += rule('pre, pre.hljs, pre code, .hljs',
            decl('background-color', c.bg || v['--cm-bg-color'])
            + decl('color', c.fg || v['--cm-fg-color'])
            + decl('border-color', v['--border-color']));
        css += rule('.hljs-comment, .hljs-quote', decl('color', c.comment));
        css += rule('.hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-type', decl('color', c.keyword));
        css += rule('.hljs-string, .hljs-regexp, .hljs-template-string', decl('color', c.string));
        css += rule('.hljs-number, .hljs-literal', decl('color', c.number));
        css += rule('.hljs-symbol, .hljs-bullet, .hljs-meta', decl('color', c.atom));
        css += rule('.hljs-attr, .hljs-property', decl('color', c.property));
        css += rule('.hljs-attribute, .hljs-selector-attr', decl('color', c.attribute));
        css += rule('.hljs-variable, .hljs-params', decl('color', c.variable));
        css += rule('.hljs-title, .hljs-function, .hljs-class .hljs-title, .hljs-section', decl('color', c.def));
        css += rule('.hljs-punctuation', decl('color', c.bracket));
        css += rule('.hljs-tag, .hljs-name, .hljs-selector-id, .hljs-selector-class', decl('color', c.tag));
        css += rule('.hljs-link', decl('color', c.link));
        css += rule('.hljs-deletion', decl('color', c.error));
    }
    return css ? `<style id="office-export-theme">\n${css}</style>` : '';
};

/** First family name of a CSS font-family list, for DOCX (which takes a single font). */
export const primaryFontName = (fontFamily: string | undefined): string | undefined => {
    if (!fontFamily) return undefined;
    const first = fontFamily.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
    return first && !/^(sans-serif|serif|monospace|system-ui|-apple-system)$/i.test(first) ? first : undefined;
};
