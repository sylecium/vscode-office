import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { parse } from 'node-html-parser';

const { outputFiles } = buildSync({
    entryPoints: [fileURLToPath(new URL('../../src/service/markdown/instantPreview.ts', import.meta.url))],
    bundle: true, format: 'esm', platform: 'node', write: false,
});
const { renderInstantPreview } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);

// The output is injected into the webview HTML as is.
test('a hostile document cannot put active content in the preview', () => {
    const html = renderInstantPreview([
        '<script>alert(1)</script>',
        'texte <img src=x onerror=alert(1)> <iframe src="https://example.com"></iframe>',
        '</pre></div><script>alert(2)</script>',
        '<meta http-equiv="refresh" content="0;url=https://example.com">',
        '[a](javascript:alert(1)) [b](JaVaScRiPt&#58;alert(1)) <javascript:alert(1)> ![c](vbscript:x)',
        '![d](x"onerror="alert(1)) [e](https://example.com "t\\" onmouseover=\\"x")',
        '```"><script>alert(3)</script>\ncode </pre><script>alert(4)</script>\n```',
        '- [ ] <b onclick=x>tâche</b>',
        '---\n<svg onload=alert(5)>',
    ].join('\n\n'));
    for (const element of parse(`<div>${html}</div>`).querySelectorAll('*')) {
        assert.doesNotMatch(element.tagName ?? '', /^(SCRIPT|IFRAME|META|SVG|OBJECT|EMBED|FORM|BASE|STYLE|LINK)$/);
        for (const [name, value] of Object.entries(element.attributes)) {
            assert.doesNotMatch(name, /^on/i);
            assert.doesNotMatch(value, /^\s*(javascript|vbscript):/i);
        }
    }
});

test('front matter and tasks look like the editor, and long documents are cut at a block', () => {
    const html = renderInstantPreview('---\ntitle: x\n---\n\n- [x] fait\n- [ ] à faire\n');
    assert.match(html, /<code class="language-yaml">title: x/);
    assert.match(html, /<li class="vditor-task"><input type="checkbox" disabled checked> fait/);
    assert.match(html, /<input type="checkbox" disabled> à faire/);

    const long = renderInstantPreview('Un paragraphe entier.\n\n'.repeat(2000));
    assert.ok(long.length < 12000);
    assert.ok(long.trimEnd().endsWith('Un paragraphe entier.</p>'));
});
