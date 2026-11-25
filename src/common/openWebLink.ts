import * as vscode from 'vscode';

const ALLOWED_SCHEMES = ['http', 'https', 'mailto'];

/**
 * Opens a link coming from a webview. Only web and mail links are allowed,
 * so a crafted link cannot launch local files or other handlers.
 */
export function openWebLink(url: unknown): void {
    if (typeof url !== 'string') {
        return;
    }
    const uri = vscode.Uri.parse(url);
    if (ALLOWED_SCHEMES.includes(uri.scheme)) {
        void vscode.env.openExternal(uri);
    }
}
