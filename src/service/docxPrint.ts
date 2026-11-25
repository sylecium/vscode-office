/// <reference lib="dom" />
import { isWebExtensionHost } from '@/common/extensionHost';
import { Output } from '@/common/Output';
import { parse } from 'path';
import * as vscode from 'vscode';
import { MarkdownService } from './markdownService';

/** One CSS named page per distinct page size, so that landscape sections keep their orientation. */
function applyPageSizes() {
    const sizes: string[] = [];
    let css = '';
    for (const page of Array.from(document.querySelectorAll<HTMLElement>('.layout-page'))) {
        const { width, height } = page.getBoundingClientRect();
        const size = `${width}px ${height}px`;
        let index = sizes.indexOf(size);
        if (index === -1) {
            index = sizes.push(size) - 1;
            css += `@page office${index} { size: ${size}; margin: 0; }`;
        }
        page.style.setProperty('page', `office${index}`);
    }
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
}

/** Turns the pages captured from the docx editor into a PDF, then opens it so that it can be printed. */
export async function printDocxToPdf(context: vscode.ExtensionContext, uri: vscode.Uri, html: string) {
    if (isWebExtensionHost()) {
        vscode.window.showWarningMessage('Printing a document requires the desktop version of VS Code.');
        return;
    }
    const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(uri, '..', `${parse(uri.path).name}.pdf`),
        filters: { PDF: ['pdf'] },
    });
    if (!target) return;
    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Creating PDF...' },
            async () => {
                const { executablePath, puppeteerArgs } = new MarkdownService(context).getConfig({});
                // The package ships puppeteer-core as a single file, which only require() resolves.
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const puppeteer = require('puppeteer-core');
                const browser = await puppeteer.launch({ headless: true, executablePath, args: puppeteerArgs });
                try {
                    const page = await browser.newPage();
                    // The markup comes from an untrusted document: no scripts.
                    await page.setJavaScriptEnabled(false);
                    await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
                    await page.evaluate(applyPageSizes);
                    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
                    await vscode.workspace.fs.writeFile(target, pdf);
                } finally {
                    await browser.close();
                }
            },
        );
        await vscode.env.openExternal(target);
    } catch (error) {
        Output.log(error);
        vscode.window.showErrorMessage(`Print: ${error?.message ?? error}`);
    }
}
