import type * as vscode from 'vscode';
import { toggleEditor } from '@/common/reopenEditor';

export function switchCsvEditor(uri?: vscode.Uri) {
    return toggleEditor(uri, 'cweijan.officeViewer');
}
