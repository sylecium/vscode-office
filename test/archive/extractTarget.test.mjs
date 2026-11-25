// Extracting an archive must never write over something that already exists.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const dir = mkdtempSync(join(tmpdir(), 'office-archive-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const outfile = join(dir, 'archiveUtils.cjs');
await build({
    entryPoints: ['src/service/compress/archiveUtils.ts'],
    bundle: true,
    platform: 'node',
    outfile,
    logLevel: 'error',
    plugins: [{
        name: 'vscode-stub',
        setup(builder) {
            builder.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' }));
            builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const commands = {}, Uri = {};' }));
        },
    }],
});
const { planExtractTarget } = createRequire(import.meta.url)(outfile);
const archive = join(dir, 'data.tar.gz');

test('a single item with a free name goes next to the archive', () => {
    assert.deepEqual(planExtractTarget(archive, ['notes/', 'notes/a.txt']), { targetDir: dir, createSubfolder: false });
});

test('a single item that already exists goes into a new folder', () => {
    writeFileSync(join(dir, 'report.txt'), 'keep');
    assert.deepEqual(planExtractTarget(archive, ['report.txt']), { targetDir: join(dir, 'data'), createSubfolder: true });
});

test('an existing destination folder is not reused', () => {
    mkdirSync(join(dir, 'data'));
    symlinkSync(join(dir, 'missing'), join(dir, 'data (2)'));
    assert.equal(planExtractTarget(archive, ['a', 'b']).targetDir, join(dir, 'data (3)'));
});
