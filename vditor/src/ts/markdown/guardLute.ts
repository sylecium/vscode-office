// Lute's sanitizer lets through tags that act as soon as they reach the page: a meta refresh
// navigates the whole editor away. They are renamed rather than removed, and Lute gets the
// original names back when it reads the DOM, so the saved Markdown keeps them.
// Event handlers and script URLs are the job of the page's Content-Security-Policy.
const BLOCKED_TAG = /<(\/?)(base|embed|fencedframe|form|frame|frameset|iframe|link|meta|object|portal)(?=[\s/>])/gi;
const INERT_TAG = /<(\/?)vditor-blocked-/g;
// The browser closes the inert stand-in of a void element, the original has no end tag.
const INERT_VOID_END_TAG = /<\/vditor-blocked-(?:base|embed|frame|link|meta)>/g;

const neutralize = (html: string) => html.replace(BLOCKED_TAG, "<$1vditor-blocked-$2");
const restore = (html: string) => html.replace(INERT_VOID_END_TAG, "").replace(INERT_TAG, "<$1");
const keep = (text: string) => text;

export const guardLute = (lute: Lute): Lute => {
    const guard = (names: string[], input: (value: string) => string, output: (value: string) => string) => {
        const methods = lute as unknown as Record<string, (value: string) => string>;
        names.forEach((name) => {
            const method = methods[name].bind(lute);
            methods[name] = (value) => output(method(input(value)));
        });
    };
    guard(["Md2VditorDOM", "Md2VditorIRDOM"], keep, neutralize);
    guard(["SpinVditorDOM", "SpinVditorIRDOM", "HTML2VditorDOM", "HTML2VditorIRDOM"], restore, neutralize);
    guard(["VditorDOM2Md", "VditorIRDOM2Md", "VditorDOM2HTML", "VditorIRDOM2HTML", "HTML2Md"], restore, keep);
    return lute;
};
