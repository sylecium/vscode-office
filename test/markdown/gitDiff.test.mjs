import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';

const loadTs = async (path) => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const { code } = transformSync(source, { loader: 'ts', format: 'esm' });
    return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};
const loadJs = (path) => import(`data:text/javascript;base64,${readFileSync(new URL(path, import.meta.url)).toString('base64')}`);

const { diffRole } = await loadTs('../../src/service/markdown/diffSides.ts');
const { changedIndexes } = await loadJs('../../resource/markdown/gitDiff.js');

const git = (ref) => ({ scheme: 'git', query: JSON.stringify({ path: 'a.md', ref }) });
const file = { scheme: 'file', query: '' };

test('diffRole: the git side is the original, the working copy the modified one', () => {
    assert.equal(diffRole(git('HEAD'), file), 'original');
    assert.equal(diffRole(file, git('HEAD')), 'modified');
    assert.equal(diffRole(git('~'), file), 'original');
});

test('diffRole: the index is newer than HEAD', () => {
    assert.equal(diffRole(git('HEAD'), git('')), 'original');
    assert.equal(diffRole(git(''), git('HEAD')), 'modified');
});

test('diffRole: a commit is older than its child', () => {
    assert.equal(diffRole(git('abc^'), git('abc')), 'original');
    assert.equal(diffRole(git('abc'), git('abc^1')), 'modified');
    assert.equal(diffRole(git('abc~1'), git('abc')), 'original');
});

test('diffRole: unrelated commits and two files have no order', () => {
    assert.equal(diffRole(git('abc'), git('def')), 'changed');
    assert.equal(diffRole(file, { scheme: 'file', query: '' }), 'changed');
});

test('diffRole: an unreadable query does not throw', () => {
    assert.equal(diffRole({ scheme: 'git', query: '{bad' }, file), 'changed');
    assert.equal(diffRole(file, { scheme: 'git', query: '{}' }), 'changed');
});

test('changedIndexes: identical and empty inputs have no change', () => {
    assert.deepEqual(changedIndexes(['a', 'b'], ['a', 'b']), []);
    assert.deepEqual(changedIndexes([], []), []);
    assert.deepEqual(changedIndexes([], ['a']), []);
    assert.deepEqual(changedIndexes(['a'], []), [0]);
});

test('changedIndexes: an insertion, a deletion and a modification', () => {
    assert.deepEqual(changedIndexes(['a', 'b', 'c'], ['a', 'c']), [1]);
    assert.deepEqual(changedIndexes(['a', 'c'], ['a', 'b', 'c']), []);
    assert.deepEqual(changedIndexes(['a', 'X', 'c'], ['a', 'Y', 'c']), [1]);
});

test('changedIndexes: several changes around a common subsequence', () => {
    assert.deepEqual(changedIndexes(['a', 'b', 'c', 'd', 'e'], ['a', 'c', 'e', 'z']), [1, 3]);
});
