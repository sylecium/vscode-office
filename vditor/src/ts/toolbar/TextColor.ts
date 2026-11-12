import { Constants } from "../constants";
import {
    applyTextStyle,
    BACKGROUND_COLOR_PRESETS,
    clearTextStyles,
    StyleTarget,
    TEXT_COLOR_PRESETS,
} from "../pro/textColor";
import { getEventName } from "../util/compatibility";
import { MenuItem } from "./MenuItem";
import { hidePanel } from "./setToolbar";

const LAST_COLOR_KEY = "vditor-text-color-last";

const readLast = (target: StyleTarget, fallback: string) => {
    try {
        const raw = localStorage.getItem(LAST_COLOR_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const value = parsed[target];
        return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
    } catch {
        return fallback;
    }
};

const writeLast = (target: StyleTarget, value: string) => {
    try {
        const raw = localStorage.getItem(LAST_COLOR_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        parsed[target] = value;
        localStorage.setItem(LAST_COLOR_KEY, JSON.stringify(parsed));
    } catch {
        // storage unavailable: ignore
    }
};

const buildRow = (label: string, target: StyleTarget, presets: string[], last: string) => `
<div class="vditor-text-color__section" data-target="${target}">
  <div class="vditor-text-color__label">${label}</div>
  <div class="vditor-text-color__swatches">
    ${presets.map((color) => `<button type="button" class="vditor-text-color__swatch" data-color="${color}" style="${target === "color" ? `color:${color}` : `background:${color}`}" title="${color}">${target === "color" ? "A" : ""}</button>`).join("")}
    <label class="vditor-text-color__custom" title="Custom">
      <input type="color" value="${last}" data-target="${target}">
    </label>
    <button type="button" class="vditor-text-color__none" data-color="" title="None">&times;</button>
  </div>
</div>`;

/** Toolbar item: font color and background (highlight) color for the selection. */
export class TextColor extends MenuItem {
    public element: HTMLElement;

    constructor(vditor: IVditor, menuItem: IMenuItem) {
        super(vditor, menuItem);
        const actionBtn = this.element.children[0] as HTMLElement;
        const textLast = readLast("color", TEXT_COLOR_PRESETS[0]);
        const bgLast = readLast("background-color", BACKGROUND_COLOR_PRESETS[0]);
        actionBtn.innerHTML = `${menuItem.icon}<span class="vditor-text-color__bar" style="background:${textLast}"></span>`;

        const panelElement = document.createElement("div");
        panelElement.className = "vditor-hint vditor-panel--arrow vditor-text-color";
        panelElement.innerHTML = `${buildRow("Text", "color", TEXT_COLOR_PRESETS, textLast)}
${buildRow("Background", "background-color", BACKGROUND_COLOR_PRESETS, bgLast)}
<button type="button" class="vditor-text-color__clear">Clear colors</button>`;
        this.element.appendChild(panelElement);

        // Keep the editor selection while interacting with the panel.
        panelElement.addEventListener("mousedown", (event) => {
            if (!(event.target instanceof HTMLInputElement)) {
                event.preventDefault();
            }
        });

        actionBtn.addEventListener(getEventName(), (event) => {
            event.preventDefault();
            if (actionBtn.classList.contains(Constants.CLASS_MENU_DISABLED)) {
                return;
            }
            actionBtn.blur();
            const visible = panelElement.style.display === "block";
            hidePanel(vditor, ["subToolbar"]);
            panelElement.style.display = visible ? "none" : "block";
        });

        const apply = (target: StyleTarget, value: string | null) => {
            applyTextStyle(vditor, target, value);
            if (value && /^#[0-9a-f]{6}$/i.test(value)) {
                writeLast(target, value);
                if (target === "color") {
                    const bar = actionBtn.querySelector(".vditor-text-color__bar") as HTMLElement | null;
                    if (bar) {
                        bar.style.background = value;
                    }
                }
            }
            panelElement.style.display = "none";
        };

        panelElement.addEventListener("click", (event) => {
            const button = (event.target as HTMLElement).closest("button");
            if (!button) {
                return;
            }
            event.preventDefault();
            if (button.classList.contains("vditor-text-color__clear")) {
                clearTextStyles(vditor);
                panelElement.style.display = "none";
                return;
            }
            const section = button.closest(".vditor-text-color__section") as HTMLElement | null;
            if (!section) {
                return;
            }
            const target = section.getAttribute("data-target") as StyleTarget;
            const color = button.getAttribute("data-color");
            apply(target, color ? color : null);
        });

        panelElement.querySelectorAll("input[type=color]").forEach((input: HTMLInputElement) => {
            input.addEventListener("change", () => {
                apply(input.getAttribute("data-target") as StyleTarget, input.value);
            });
        });
    }
}
