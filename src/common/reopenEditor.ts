import * as vscode from 'vscode';

/** Viewers with edits that VS Code does not know about: closing their tab would lose them. */
export const unsavedViewers = new Set<string>();

/** Editor showing this file in the tab, or undefined for another file or kind of tab. */
function editorTypeOf(tab: vscode.Tab | undefined, uri: vscode.Uri): string | undefined {
    const input = tab?.input;
    if (input instanceof vscode.TabInputText && input.uri.toString() === uri.toString()) return 'default';
    if (input instanceof vscode.TabInputCustom && input.uri.toString() === uri.toString()) return input.viewType;
    return undefined;
}

/** vscode.openWith adds a second tab for another editor type, so close the previous one. */
export async function reopenInPlace(uri: vscode.Uri, viewType: string) {
    const group = vscode.window.tabGroups.activeTabGroup;
    const viewColumn = group.viewColumn;
    const previousType = editorTypeOf(group.activeTab, uri);
    const isSwitch = previousType !== undefined && previousType !== viewType;
    // A viewer with unsaved edits stays open next to the new editor.
    const closePrevious = isSwitch && !(previousType !== 'default' && unsavedViewers.has(uri.toString()));
    if (isSwitch) {
        // Closing a dirty tab prompts the user, and "Don't Save" would discard the edits.
        const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
        if (document?.isDirty && !await document.save()) return;
    }
    await vscode.commands.executeCommand('vscode.openWith', uri, viewType, viewColumn);
    if (!closePrevious) return;
    // Look the tab up again: VS Code can rebuild every Tab object while opening, which makes old references invalid.
    const previous = vscode.window.tabGroups.all.find(g => g.viewColumn === viewColumn)
        ?.tabs.find(tab => editorTypeOf(tab, uri) === previousType);
    // Nothing to close when openWith already replaced it (preview tab).
    if (previous) await vscode.window.tabGroups.close(previous);
}

/** Alternate between the text editor and the given viewer. */
export function toggleEditor(uri: vscode.Uri | undefined, viewerType: string) {
    const editor = vscode.window.activeTextEditor;
    const target = uri ?? editor?.document.uri;
    if (!target) return;
    // activeTextEditor may still point to a split text editor while a custom editor is active.
    const isCustom = vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom;
    return reopenInPlace(target, editor && !isCustom ? viewerType : 'default');
}
