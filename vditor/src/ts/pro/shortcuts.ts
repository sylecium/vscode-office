import { isInsideCodeMirror } from "../codeBlock/codeMirrorManager";
import { processHeading } from "../ir/process";
import { getEventName } from "../util/compatibility";
import { matchHotKey } from "../util/hotKey";
import { BLOCK_COMMANDS, BlockCommand, runBlockCommand } from "../util/vscodeShortcut";
import { afterRenderEvent } from "../wysiwyg/afterRenderEvent";
import { removeHeading, setHeading } from "../wysiwyg/setHeading";

/**
 * Configurable shortcuts.
 * Combo syntax (VS Code like, case-insensitive): "ctrl+shift+k", "alt+up", "mod+b", "f2".
 * - mod: Cmd on macOS, Ctrl elsewhere; ctrl / alt (option) / shift / meta (cmd, win)
 * - keys: a-z, 0-9, up/down/left/right, enter, tab, space, escape, backspace, delete, f1-f12, or a symbol.
 * An empty string disables the default shortcut of the command.
 */

export const HEADING_COMMANDS = ["heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "paragraph"];

interface ParsedCombo {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    key: string;
}

const isMac = () => /Mac/.test(navigator.platform);

const KEY_ALIASES: Record<string, string> = {
    up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright",
    esc: "escape", del: "delete", space: " ", return: "enter",
    plus: "+", minus: "-", equal: "=", comma: ",", period: ".", slash: "/", backslash: "\\",
};

export const parseCombo = (combo: string): ParsedCombo | null => {
    const parts = combo.toLowerCase().split("+").map((part) => part.trim());
    // "ctrl++" -> trailing empty parts mean the "+" key.
    if (combo.trim().endsWith("++")) {
        parts.splice(parts.length - 2, 2, "+");
    }
    const parsed: ParsedCombo = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
    for (const part of parts) {
        switch (part) {
            case "mod":
                if (isMac()) {
                    parsed.meta = true;
                } else {
                    parsed.ctrl = true;
                }
                break;
            case "ctrl":
            case "control":
                parsed.ctrl = true;
                break;
            case "alt":
            case "option":
            case "opt":
                parsed.alt = true;
                break;
            case "shift":
                parsed.shift = true;
                break;
            case "meta":
            case "cmd":
            case "command":
            case "win":
            case "super":
                parsed.meta = true;
                break;
            default:
                if (!part || parsed.key) {
                    return null;
                }
                parsed.key = KEY_ALIASES[part] ?? part;
        }
    }
    return parsed.key ? parsed : null;
};

const keyMatches = (key: string, event: KeyboardEvent) => {
    if (/^[a-z]$/.test(key)) {
        return event.code === `Key${key.toUpperCase()}` || event.key.toLowerCase() === key;
    }
    if (/^[0-9]$/.test(key)) {
        return event.code === `Digit${key}` || event.code === `Numpad${key}` || event.key === key;
    }
    return event.key.toLowerCase() === key;
};

export const matchCombo = (combo: ParsedCombo, event: KeyboardEvent) =>
    combo.ctrl === event.ctrlKey
    && combo.alt === event.altKey
    && combo.shift === event.shiftKey
    && combo.meta === event.metaKey
    && keyMatches(combo.key, event);

const runHeading = (vditor: IVditor, command: string) => {
    const level = command === "paragraph" ? 0 : Number(command.slice(-1));
    if (vditor.currentMode === "wysiwyg") {
        if (level) {
            setHeading(vditor, `h${level}`);
        } else {
            removeHeading(vditor);
        }
        afterRenderEvent(vditor);
        return true;
    }
    if (vditor.currentMode === "ir") {
        processHeading(vditor, level ? `${"#".repeat(level)} ` : "");
        return true;
    }
    return false;
};

/** Execute a named command. Toolbar items are triggered like a click on their button. */
export const runShortcutCommand = (vditor: IVditor, command: string): boolean => {
    if ((BLOCK_COMMANDS as string[]).includes(command)) {
        return runBlockCommand(vditor, command as BlockCommand);
    }
    if (HEADING_COMMANDS.includes(command)) {
        return runHeading(vditor, command);
    }
    const button = vditor.toolbar?.elements?.[command]?.children[0] as HTMLElement | undefined;
    if (!button) {
        return false;
    }
    button.dispatchEvent(new CustomEvent(getEventName()));
    return true;
};

let compiled: Array<{ command: string; combo: ParsedCombo }> = [];
/** Default hotkeys (vditor syntax) of remapped toolbar commands: swallowed so the browser's
 * native contenteditable shortcuts (Ctrl+B / Ctrl+I...) do not fire either. */
let disabledDefaults: string[] = [];

/**
 * Apply a shortcut map: removes the default hotkey of remapped toolbar items and compiles
 * the custom combos. Safe to call again when the configuration changes.
 */
export const applyShortcuts = (vditor: IVditor, shortcuts: Record<string, string> | undefined) => {
    const map: Record<string, string> = {};
    for (const [command, combo] of Object.entries(shortcuts || {})) {
        if (typeof combo === "string") {
            map[command] = combo;
        }
    }
    vditor.options.shortcuts = map;
    const defaults = (vditor as IVditor & { __defaultHotkeys?: Record<string, string> });
    defaults.__defaultHotkeys = defaults.__defaultHotkeys || {};
    for (const item of vditor.options.toolbar as IMenuItem[]) {
        if (!item || typeof item !== "object" || !item.name) {
            continue;
        }
        if (!(item.name in defaults.__defaultHotkeys)) {
            defaults.__defaultHotkeys[item.name] = item.hotkey || "";
        }
        // A remapped (or disabled) toolbar command no longer answers to its default hotkey.
        item.hotkey = item.name in map ? "" : defaults.__defaultHotkeys[item.name];
    }
    disabledDefaults = Object.keys(map)
        .map((name) => defaults.__defaultHotkeys[name])
        .filter((hotkey): hotkey is string => !!hotkey);
    compiled = [];
    for (const [command, combo] of Object.entries(map)) {
        const parsed = combo ? parseCombo(combo) : null;
        if (parsed) {
            compiled.push({ command, combo: parsed });
        }
    }
};

/** Keydown hook, runs before the built-in shortcuts. */
export const handleCustomShortcut = (vditor: IVditor, event: KeyboardEvent): boolean => {
    if ((compiled.length === 0 && disabledDefaults.length === 0) || event.isComposing
        || isInsideCodeMirror(event.target)) {
        return false;
    }
    for (const { command, combo } of compiled) {
        if (matchCombo(combo, event) && runShortcutCommand(vditor, command)) {
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
    }
    if (disabledDefaults.some((hotkey) => matchHotKey(hotkey, event))) {
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    return false;
};
