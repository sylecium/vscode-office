// Export options dialog: theme, fonts, sizes, PDF page setup and output location.

const STORAGE_KEY = 'office-export-options';

const FORMAT_LABELS = { pdf: 'PDF', html: 'HTML', docx: 'DOCX' };

function loadSaved() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function save(options) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
    } catch {
        // storage unavailable
    }
}

const px = (value) => {
    const n = parseFloat(String(value || ''));
    return Number.isFinite(n) ? n : undefined;
};

function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === 'text') node.textContent = value;
        else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children) node.appendChild(child);
    return node;
}

function field(label, input) {
    return el('label', { class: 'office-export__field' }, [el('span', { text: label }), input]);
}

/**
 * Open the dialog. Resolves with the export option payload, or null when cancelled.
 * @param {'pdf'|'html'|'docx'} type
 * @param {any} editor Vditor instance (provides getExportSettings)
 * @param {{withoutOutline?: boolean}} extra
 */
export function openExportDialog(type, editor, extra = {}) {
    let settings = null;
    try {
        settings = editor?.getExportSettings?.() ?? null;
    } catch {
        settings = null;
    }
    const layout = settings?.layout || {};
    const saved = loadSaved();
    const defaults = {
        theme: saved.theme || 'editor',
        fontFamily: saved.fontFamily ?? layout.fontFamily ?? '',
        fontSize: saved.fontSize ?? px(layout.fontSize) ?? 16,
        lineHeight: saved.lineHeight ?? (px(layout.lineHeight) && px(layout.lineHeight) < 4 ? px(layout.lineHeight) : 1.6),
        codeFontFamily: saved.codeFontFamily ?? layout.codeFontFamily ?? '',
        pageWidth: saved.pageWidth ?? (px(layout.pageWidth) || 860),
        format: saved.format || 'A4',
        margins: saved.margins || { top: 15, right: 15, bottom: 15, left: 15 },
        saveAs: saved.saveAs ?? false,
    };

    return new Promise((resolve) => {
        const themeSelect = el('select', {}, [
            el('option', { value: 'editor', text: `Editor theme (${settings?.editorTheme || 'current'})` }),
            el('option', { value: 'classic', text: 'Classic light' }),
        ]);
        themeSelect.value = defaults.theme;
        const fontInput = el('input', { type: 'text', value: defaults.fontFamily, placeholder: 'Default' });
        const sizeInput = el('input', { type: 'number', min: '8', max: '48', step: '1', value: String(defaults.fontSize) });
        const lineInput = el('input', { type: 'number', min: '1', max: '3', step: '0.05', value: String(defaults.lineHeight) });
        const codeFontInput = el('input', { type: 'text', value: defaults.codeFontFamily, placeholder: 'Default' });
        const widthInput = el('input', { type: 'number', min: '400', max: '2400', step: '10', value: String(defaults.pageWidth) });
        const formatSelect = el('select', {}, ['A4', 'A5', 'A3', 'Letter', 'Legal'].map((f) => el('option', { value: f, text: f })));
        formatSelect.value = defaults.format;
        const marginInputs = ['top', 'right', 'bottom', 'left'].map((side) => {
            const input = el('input', { type: 'number', min: '0', max: '100', step: '1', value: String(defaults.margins[side] ?? 15), 'data-side': side, title: side });
            return input;
        });
        const saveAsInput = el('input', { type: 'checkbox' });
        saveAsInput.checked = !!defaults.saveAs;

        const rows = [
            field('Style', themeSelect),
            field('Font', fontInput),
            field('Font size (px)', sizeInput),
            field('Line height', lineInput),
            field('Code font', codeFontInput),
        ];
        if (type === 'html') rows.push(field('Content width (px)', widthInput));
        if (type === 'pdf') {
            rows.push(field('Page format', formatSelect));
            rows.push(field('Margins mm (T R B L)', el('span', { class: 'office-export__margins' }, marginInputs)));
        }
        rows.push(el('label', { class: 'office-export__check' }, [saveAsInput, el('span', { text: 'Choose output location' })]));

        const cancelBtn = el('button', { type: 'button', class: 'office-export__btn', text: 'Cancel' });
        const okBtn = el('button', { type: 'button', class: 'office-export__btn office-export__btn--primary', text: `Export ${FORMAT_LABELS[type] || type}` });
        const dialog = el('div', { class: 'office-export', role: 'dialog', 'aria-modal': 'true' }, [
            el('div', { class: 'office-export__title', text: `Export ${FORMAT_LABELS[type] || type}` }),
            el('div', { class: 'office-export__body' }, rows),
            el('div', { class: 'office-export__actions' }, [cancelBtn, okBtn]),
        ]);
        const backdrop = el('div', { class: 'office-export__backdrop' }, [dialog]);
        document.body.appendChild(backdrop);
        okBtn.focus();

        const close = (result) => {
            backdrop.remove();
            document.removeEventListener('keydown', onKey, true);
            resolve(result);
        };
        const onKey = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close(null);
            } else if (event.key === 'Enter' && !(event.target instanceof HTMLSelectElement)) {
                event.preventDefault();
                submit();
            }
        };
        const submit = () => {
            const margins = {};
            for (const input of marginInputs) margins[input.dataset.side] = px(input.value) ?? 15;
            const chosen = {
                theme: themeSelect.value,
                fontFamily: fontInput.value.trim(),
                fontSize: px(sizeInput.value),
                lineHeight: px(lineInput.value),
                codeFontFamily: codeFontInput.value.trim(),
                pageWidth: px(widthInput.value),
                format: formatSelect.value,
                margins,
                saveAs: saveAsInput.checked,
            };
            save(chosen);
            const style = {
                theme: chosen.theme,
                fontFamily: chosen.fontFamily || undefined,
                fontSize: chosen.fontSize,
                lineHeight: chosen.lineHeight,
                codeFontFamily: chosen.codeFontFamily || undefined,
                pageWidth: type === 'html' ? chosen.pageWidth : undefined,
            };
            if (chosen.theme === 'editor' && settings) {
                style.isDark = settings.isDark;
                style.cssVariables = settings.cssVariables;
                style.codeThemeColors = settings.codeThemeColors;
            }
            close({
                type,
                withoutOutline: !!extra.withoutOutline,
                style,
                format: type === 'pdf' ? chosen.format : undefined,
                marginsMm: type === 'pdf' ? margins : undefined,
                saveAs: chosen.saveAs,
            });
        };
        cancelBtn.addEventListener('click', () => close(null));
        okBtn.addEventListener('click', submit);
        backdrop.addEventListener('mousedown', (event) => {
            if (event.target === backdrop) close(null);
        });
        document.addEventListener('keydown', onKey, true);
    });
}
