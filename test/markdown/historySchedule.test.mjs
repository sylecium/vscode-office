import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';

const load = async (name) => {
    const source = readFileSync(new URL(`../../vditor/src/ts/util/${name}.ts`, import.meta.url), 'utf8');
    const { code } = transformSync(source, { loader: 'ts', format: 'esm' });
    return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

const { getHistoryBurstStart, setHistoryPending } = await load('historyInputBufferState');
const { getHistoryRecordWait } = await load('historySchedule');

const typed = { enableAddUndoStack: true, enableInput: true };
const wait = editor => getHistoryRecordWait(getHistoryBurstStart(editor), 600, 1);

test('typing after a pause is recorded once the burst ends, not between its first keys', t => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const editor = {};
    setHistoryPending(editor, typed);
    setHistoryPending(editor);
    t.mock.timers.tick(5000);

    setHistoryPending(editor, typed);
    assert.equal(wait(editor), 600);
    t.mock.timers.tick(350);
    setHistoryPending(editor, typed);
    assert.equal(wait(editor), 600);

    // Continuous typing is still forced into the history past the max wait.
    t.mock.timers.tick(350);
    setHistoryPending(editor, typed);
    assert.equal(wait(editor), 0);
});

test('undo and redo are sent at once, except in large documents', () => {
    assert.equal(getHistoryRecordWait(Date.now(), 600, 1, false), 0);
    assert.equal(getHistoryRecordWait(Date.now(), 600, -1, false), 600);
});

test('a pending document load does not age the first edit', t => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const editor = {};
    setHistoryPending(editor, { enableAddUndoStack: true, enableInput: false });
    t.mock.timers.tick(5000);
    setHistoryPending(editor, typed);
    assert.equal(wait(editor), 600);
});
