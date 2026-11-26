import * as vscode from 'vscode';
import { Handler } from '@/common/handler';
import { DiffRole, diffRole } from './diffSides';

interface Side {
    document: vscode.TextDocument;
    handler: Handler;
    peer?: Side;
    role?: Promise<DiffRole>;
}

// The two sides of a diff are opened one after the other, in no reliable order.
const waiting = new Map<string, Side>();

const refOf = (uri: vscode.Uri): string | undefined => {
    const ref = JSON.parse(uri.query).ref;
    return typeof ref === 'string' ? ref : undefined;
};

/** Timeline and history diffs compare two full hashes: only git knows which one is the ancestor. */
async function roleOf(own: vscode.Uri, peer: vscode.Uri): Promise<DiffRole> {
    const role = diffRole(own, peer);
    if (role !== 'changed' || own.scheme !== 'git' || peer.scheme !== 'git') return role;
    try {
        const a = refOf(own);
        const b = refOf(peer);
        if (!a || !b || a === '~' || b === '~') return 'changed';
        const git = vscode.extensions.getExtension('vscode.git')?.exports?.getAPI(1);
        const repository = git?.getRepository(vscode.Uri.file(own.fsPath));
        const base = await repository?.getMergeBase(a, b);
        if (base === a) return 'original';
        if (base === b) return 'modified';
        return 'changed';
    } catch {
        return 'changed';
    }
}

const send = async (side: Side) => {
    const role = side.role;
    if (!role) return;
    const resolved = await role;
    // The peer may have been disposed while the role was being computed.
    const peer = side.peer;
    if (!peer) return;
    side.handler.emit('gitDiff', {
        role: resolved,
        own: side.document.getText(),
        other: peer.document.getText(),
    });
};

/** Pairs the editor showing a document with the other side of a diff, when there is one. */
export function registerGitDiff(document: vscode.TextDocument, handler: Handler): void {
    const panel = handler.panel;
    const tab = vscode.window.tabGroups?.all.find(group => group.viewColumn === panel.viewColumn)?.activeTab;
    if (!tab || tab.input) return;

    const key = `${panel.viewColumn}\n${tab.label}`;
    const side: Side = { document, handler };
    const waited = waiting.get(key);
    if (waited && waited.document.uri.toString() !== document.uri.toString()) {
        waiting.delete(key);
        waited.peer = side;
        side.peer = waited;
        waited.role = roleOf(waited.document.uri, document.uri);
        side.role = roleOf(document.uri, waited.document.uri);
        void send(waited);
        void send(side);
    } else {
        waiting.set(key, side);
    }

    handler.on('queryGitDiff', () => send(side));
    const subscription = vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
            void send(side);
            if (side.peer) void send(side.peer);
        }
    });
    panel.onDidDispose(() => {
        subscription.dispose();
        if (waiting.get(key) === side) waiting.delete(key);
        if (side.peer) side.peer.peer = undefined;
    });
}
