import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { transformSync } from 'esbuild';

createRequire(import.meta.url)('../../vditor/src/js/lute/lute.min.js');
const source = readFileSync(new URL('../../vditor/src/ts/markdown/guardLute.ts', import.meta.url), 'utf8');
const { code } = transformSync(source, { loader: 'ts', format: 'esm' });
const { guardLute } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const lute = globalThis.Lute.New();
lute.SetSanitize(true);
guardLute(lute);

const blockedTag = /<\/?(?:base|embed|fencedframe|form|frame|frameset|iframe|link|meta|object|portal)[\s/>]/i;
const modes = [['Md2VditorDOM', 'SpinVditorDOM', 'VditorDOM2Md'], ['Md2VditorIRDOM', 'SpinVditorIRDOM', 'VditorIRDOM2Md']];
const refresh = '<meta http-equiv="refresh" content="0;url=https://example.com">';
const blocks = [
    refresh,
    refresh.toUpperCase(),
    `<div>${refresh}</div>`,
    '<base href="https://example.com/">',
    '<link rel="stylesheet" href="https://example.com/a.css">',
    '<iframe src="https://example.com"></iframe>',
    '<form action="https://example.com"><input type="submit"></form>',
    '<embed src="https://example.com">',
];
const inline = [
    `a ${refresh} b`,
    `| a |\n| --- |\n| ${refresh} |`,
    // Lute does not sanitize HTML inside a link text.
    '[<meta http-equiv=refresh content=0>](x)',
    'a <iframe src="https://example.com"> b <object data="x"> c',
];

test('no tag that navigates or loads a document reaches the editor DOM', () => {
    for (const [fromMarkdown, spin] of modes) {
        for (const markdown of [...blocks, ...inline]) {
            const dom = lute[fromMarkdown](`${markdown}\n\ntext\n`);
            assert.doesNotMatch(dom, blockedTag, `${fromMarkdown} ${markdown}`);
            assert.doesNotMatch(lute[spin](dom), blockedTag, `${spin} ${markdown}`);
        }
    }
    assert.doesNotMatch(lute.HTML2VditorDOM(`<p>a</p>${refresh}<iframe></iframe>`), blockedTag);
});

test('saving gives the blocked HTML back untouched', () => {
    for (const [fromMarkdown, spin, toMarkdown] of modes) {
        for (const markdown of blocks) {
            const document = `${markdown}\n\ntext\n`;
            const dom = lute[fromMarkdown](document);
            assert.equal(lute[toMarkdown](dom), document);
            assert.equal(lute[toMarkdown](lute[spin](dom)), document);
        }
    }
});
