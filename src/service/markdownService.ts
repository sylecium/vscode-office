import { adjustImgPath } from "@/common/fileUtil";
import { Output } from "@/common/Output";
import { spawn } from 'child_process';
import chromeFinder from 'chrome-finder';
import { fileTypeFromFile } from 'file-type';
import { copyFileSync, existsSync, lstatSync, mkdirSync, renameSync } from 'fs';
import { homedir } from 'os';
import path, { dirname, extname, isAbsolute, join, parse } from 'path';
import * as vscode from 'vscode';
import { Holder } from './markdown/holder';
import { convertMd } from "./markdown/markdown-pdf";
import type { ExportStyle } from "./markdown/exportTheme";
import { Global, i18n } from "@/common/global";

export type ExportType = 'pdf' | 'html' | 'docx';

interface ExportOption {
    type?: ExportType;
    withoutOutline?: boolean;
    /** Theme / fonts chosen in the export dialog. */
    style?: ExportStyle;
    /** PDF page format (A4, Letter, A5, Legal). */
    format?: string;
    /** PDF margins in millimeters. */
    marginsMm?: { top?: number; right?: number; bottom?: number; left?: number };
    /** Ask where to save the exported file. */
    saveAs?: boolean;
}

const MM_TO_PX = 96 / 25.4;
const PDF_FORMATS = new Set(['A3', 'A4', 'A5', 'Letter', 'Legal']);

/** Editor showing this file in the tab, or undefined for another file or kind of tab. */
function editorTypeOf(tab: vscode.Tab | undefined, uri: vscode.Uri): string | undefined {
    const input = tab?.input;
    if (input instanceof vscode.TabInputText && input.uri.toString() === uri.toString()) return 'default';
    if (input instanceof vscode.TabInputCustom && input.uri.toString() === uri.toString()) return input.viewType;
    return undefined;
}

export class MarkdownService {

    constructor(private context: vscode.ExtensionContext) {
    }

    /**
     * export markdown to another type
     * @param type pdf, html, docx 
     */
    public async exportMarkdown(uri: vscode.Uri, option: ExportOption = {}) {
        const { type = 'pdf' } = option;
        try {
            if (type != 'html') { // html导出速度快, 无需等待
                vscode.window.showInformationMessage(i18n('ext.markdown.exportStart', type))
            }
            const config: ReturnType<MarkdownService['getConfig']> & { outputPath?: string } = this.getConfig(option);
            if (option.saveAs) {
                const parsed = parse(uri.fsPath);
                const target = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(join(parsed.dir, `${parsed.name}.${type}`)),
                    filters: { [type.toUpperCase()]: [type] },
                });
                if (!target) return;
                config.outputPath = target.fsPath;
            }
            await convertMd({ markdownFilePath: uri.fsPath, config })
            vscode.window.showInformationMessage(i18n('ext.markdown.exportSuccess', type))
        } catch (error) {
            Output.log(error)
            vscode.window.showErrorMessage(`Export ${type}: ${error?.message ?? error}`)
        }
    }

    public getConfig(option: ExportOption) {
        const top = Global.getConfig<number>("pdfMarginTop")
        const { type = 'pdf', withoutOutline = false, style, marginsMm, format } = option;
        const toPx = (mm: unknown) => typeof mm === 'number' && mm >= 0 && mm <= 100 ? Math.round(mm * MM_TO_PX) : undefined;
        let margin: { top?: number; right?: number; bottom?: number; left?: number } = marginsMm
            ? { top: toPx(marginsMm.top) ?? top, right: toPx(marginsMm.right), bottom: toPx(marginsMm.bottom), left: toPx(marginsMm.left) }
            : { top };
        // Editor-themed PDF: paint the background edge to edge (PDF margins stay white otherwise),
        // margins become an inner frame repeated on every page.
        let printFrame: { top: number; right: number; bottom: number; left: number } | undefined;
        if (type === 'pdf' && style?.theme === 'editor') {
            printFrame = { top: margin.top ?? 0, right: margin.right ?? 0, bottom: margin.bottom ?? 0, left: margin.left ?? 0 };
            margin = { top: 0, right: 0, bottom: 0, left: 0 };
        }
        return {
            type,
            "styles": [],
            withoutOutline,
            // chromium path
            "executablePath": this.getChromiumPath(),
            // puppeteer launch args (useful for Linux servers running as root)
            "puppeteerArgs": this.getPuppeteerArgs(),
            // Set `true` to convert `\n` in paragraphs into `<br>`.
            "breaks": false,
            // pdf print option
            "printBackground": true,
            format: format && PDF_FORMATS.has(format) ? format : "A4",
            margin,
            style,
            printFrame,
        };
    }

    private getPuppeteerArgs(): string[] {
        // Custom args from settings
        const customArgs = Global.getConfig<string[]>("puppeteerArgs");
        if (customArgs && customArgs.length > 0) {
            return customArgs;
        }
        // On Linux, running as root requires --no-sandbox
        if (process.platform === 'linux') {
            try {
                const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
                if (uid === 0) {
                    return ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
                }
            } catch {
                // getuid not available on this platform
            }
        }
        return [];
    }

    private paths: string[] = [
        // Windows
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge Beta\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge Dev\\Application\\msedge.exe",
        join(homedir(), "AppData\\Local\\Microsoft\\Edge SxS\\Application\\msedge.exe"),
        // macOS
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        // Linux
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "/usr/bin/microsoft-edge",
    ]

    private getChromiumPath() {
        const chromiumPath = Global.getConfig<string>("chromiumPath")
        const paths = [chromiumPath, ...this.paths]
        for (const path of paths) {
            if (existsSync(path)) {
                console.debug(`using chromium path is ${path}`)
                return path;
            }
        }
        try {
            const chromePath = chromeFinder();
            console.debug(`using chrome path is ${chromePath}`)
            return chromePath;
        } catch (e) {
            const msg = i18n('ext.markdown.noChromium');
            vscode.window.showErrorMessage(msg)
            throw new Error(msg)
        }
    }

    public async loadClipboardImage() {

        const document = vscode.window.activeTextEditor?.document || Holder.activeDocument
        if (await vscode.env.clipboard.readText()) {
            vscode.commands.executeCommand("editor.action.clipboardPasteAction")
            return
        }

        if (!document || document.isUntitled || document.isClosed) {
            return
        }

        const uri = document.uri;
        const info = adjustImgPath(uri, 'png'), { fullPath } = info;
        let { relPath } = info;
        const imagePath = isAbsolute(fullPath) ? fullPath : `${dirname(uri.fsPath)}/${relPath}`.replace(/\\/g, "/");
        this.createImgDir(imagePath);
        this.saveClipboardImageToFileAndGetPath(imagePath, async (savedImagePath) => {
            if (!savedImagePath) return;
            if (savedImagePath === 'no image') {
                vscode.window.showErrorMessage(i18n('ext.markdown.noClipboardImage'));
                return;
            }
            this.copyFromPath(savedImagePath, imagePath);
            const editor = vscode.window.activeTextEditor;
            const imgName = parse(relPath).name;
            relPath = await MarkdownService.imgExtGuide(imagePath, relPath);
            if (editor) {
                editor?.edit(edit => {
                    const current = editor.selection;
                    if (current.isEmpty) {
                        edit.insert(current.start, `![${imgName}](${relPath})`);
                    } else {
                        edit.replace(current, `![${imgName}](${relPath})`);
                    }
                });
            }
        })
    }

    public static async imgExtGuide(absPath: string, relPath: string) {
        const oldExt = extname(absPath)
        const { ext = "png" } = (await fileTypeFromFile(absPath)) ?? {};
        if (oldExt != `.${ext}`) {
            relPath = relPath.replace(oldExt, `.${ext}`)
            renameSync(absPath, absPath.replace(oldExt, `.${ext}`))
        }
        return relPath
    }

    /**
     * 如果粘贴板内是复制了一个文件, 取得路径进行复制
     */
    private copyFromPath(savedImagePath: string, targetPath: string) {
        if (savedImagePath.startsWith("copied:")) {
            const copiedFile = savedImagePath.replace("copied:", "");
            if (lstatSync(copiedFile).isDirectory()) {
                vscode.window.showErrorMessage(i18n('ext.markdown.noPasteDirectory'));
            } else {
                copyFileSync(copiedFile, targetPath);
            }
        }
    }

    private createImgDir(imagePath: string) {
        const dir = path.dirname(imagePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
    }

    private saveClipboardImageToFileAndGetPath(imagePath: string, cb: (value: string) => void) {
        if (!imagePath) return;
        const platform = process.platform;
        if (platform === 'win32') {
            // Windows
            const scriptPath = path.join(this.context.extensionPath, '/lib/pc.ps1');
            const powershell = spawn('powershell', [
                '-noprofile',
                '-noninteractive',
                '-nologo',
                '-sta',
                '-executionpolicy', 'unrestricted',
                '-windowstyle', 'hidden',
                '-file', scriptPath,
                imagePath
            ]);
            powershell.on('exit', function (code, signal) {
            });
            powershell.stdout.on('data', function (data) {
                cb(data.toString().trim());
            });
        } else if (platform === 'darwin') {
            // Mac
            const scriptPath = path.join(this.context.extensionPath, './lib/mac.applescript');
            const ascript = spawn('osascript', [scriptPath, imagePath]);
            ascript.on('exit', function (code, signal) {
            });
            ascript.stdout.on('data', function (data) {
                cb(data.toString().trim());
            });
        } else {
            // Linux 
            const scriptPath = path.join(this.context.extensionPath, './lib/linux.sh');

            const ascript = spawn('sh', [scriptPath, imagePath]);
            ascript.on('exit', function (code, signal) {
            });
            ascript.stdout.on('data', function (data) {
                const result = data.toString().trim();
                if (result == "no xclip") {
                    vscode.window.showInformationMessage(i18n('ext.markdown.installXclip'));
                    return;
                }
                cb(result);
            });
        }
    }

    public switchEditor(uri: vscode.Uri) {
        const editor = vscode.window.activeTextEditor;
        if (!uri) uri = editor?.document.uri;
        // activeTextEditor may still point to a split text editor while a custom editor is active.
        const isCustom = vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom;
        const type = editor && !isCustom ? 'cweijan.markdownViewer' : 'default';
        return this.reopenInPlace(uri, type);
    }

    /** vscode.openWith adds a second tab for another editor type, so close the previous one. */
    public async reopenInPlace(uri: vscode.Uri, viewType: string) {
        const group = vscode.window.tabGroups.activeTabGroup;
        const viewColumn = group.viewColumn;
        const previousType = editorTypeOf(group.activeTab, uri);
        const isSwitch = previousType !== undefined && previousType !== viewType;
        if (isSwitch) {
            // Closing a dirty tab prompts the user, and "Don't Save" would discard the edits.
            const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
            if (document?.isDirty && !await document.save()) return;
        }
        await vscode.commands.executeCommand('vscode.openWith', uri, viewType, viewColumn);
        if (!isSwitch) return;
        // Look the tab up again: VS Code can rebuild every Tab object while opening, which makes old references invalid.
        const previous = vscode.window.tabGroups.all.find(g => g.viewColumn === viewColumn)
            ?.tabs.find(tab => editorTypeOf(tab, uri) === previousType);
        // Nothing to close when openWith already replaced it (preview tab).
        if (previous) await vscode.window.tabGroups.close(previous);
    }

}
