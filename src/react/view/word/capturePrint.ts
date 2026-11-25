/** blob: URLs (embedded fonts, images) only resolve inside this webview, so inline them. */
async function inlineBlobUrls(html: string): Promise<string> {
    const urls = new Set(html.match(/blob:[^"'()\s<>&\\]+/g) ?? []);
    for (const url of urls) {
        try {
            const blob = await (await fetch(url)).blob();
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            });
            html = html.split(url).join(dataUrl);
        } catch (error) {
            console.warn("Print: unreadable resource", url, error);
        }
    }
    return html;
}

/**
 * The editor's Print builds the pages in a popup and calls print() on it. The webview sandbox blocks
 * both, so nothing happens. Hand it an off-screen window and give the resulting HTML to the caller.
 */
export function capturePrintWindow(onPrint: (html: string) => void): () => void {
    const nativeOpen = window.open;
    window.open = (url, ...rest) => {
        if (url) return nativeOpen.call(window, url, ...rest);
        const doc = document.implementation.createHTMLDocument();
        doc.write = (markup: string) => {
            doc.documentElement.innerHTML = markup.replace(/^[\s\S]*?<html[^>]*>|<\/html>\s*$/g, "");
        };
        doc.close = () => { };
        let closed = false;
        return {
            document: doc,
            get closed() { return closed; },
            close() { closed = true; },
            print() {
                void inlineBlobUrls(`<!DOCTYPE html>${doc.documentElement.outerHTML}`).then(onPrint);
            },
        } as unknown as Window;
    };
    return () => { window.open = nativeOpen; };
}
