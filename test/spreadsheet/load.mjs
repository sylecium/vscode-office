// Bundles the viewer's reader and writer for Node, with the webview bridge replaced by a recorder.
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const stub = `
let content;
export const handler = { emit: (_, payload) => { content = payload?.content ?? payload; } };
export const saved = () => content;
export const vscodeApi = undefined;
`;

const entry = `
export { default as ExcelJS } from '@cweijan/exceljs';
export * as XLSX from 'xlsx';
export { loadSheets } from './excel_reader';
export { export_xlsx } from './excel_writer';
export { detectCsvEncoding } from './csvEncoding';
export { saved } from 'webview-bridge';
`;

export async function loadModules() {
    const dir = mkdtempSync(join(tmpdir(), 'office-test-'));
    const outfile = join(dir, 'bundle.cjs');
    try {
        await build({
            stdin: { contents: entry, resolveDir: resolve('src/react/view/excel'), loader: 'ts' },
            bundle: true,
            platform: 'node',
            outfile,
            logLevel: 'error',
            loader: { '.css': 'empty', '.less': 'empty', '.svg': 'empty', '.png': 'empty' },
            plugins: [{
                name: 'webview-bridge',
                setup(builder) {
                    builder.onResolve({ filter: /(util\/vscode|^webview-bridge)$/ }, () => ({ path: 'bridge', namespace: 'bridge' }));
                    builder.onLoad({ filter: /.*/, namespace: 'bridge' }, () => ({ contents: stub, loader: 'js' }));
                },
            }],
        });
        return createRequire(import.meta.url)(outfile);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
