const SHELL_KEY = 'office-preview-shell';

/** Remembers how the editor looks, so that the next preview appears at the same place. */
export function savePreviewShell(editor) {
  const { element, currentMode } = editor.vditor;
  const content = editor.vditor[currentMode]?.element;
  if (!content?.offsetWidth) return;
  const { top, left } = content.getBoundingClientRect();
  localStorage.setItem(SHELL_KEY, JSON.stringify({
    theme: element.dataset.editorTheme,
    pageWidthMode: element.dataset.pageWidthMode,
    className: element.className,
    style: element.style.cssText,
    mode: currentMode,
    padding: content.style.padding,
    top,
    left,
  }));
}

export function dismissInstantPreview(editor) {
  // Two frames: the editor restores its own scroll position first.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const preview = document.getElementById('instant-preview');
    const scrollTop = preview?.querySelector('.vditor-reset').scrollTop;
    if (scrollTop) {
      editor.vditor[editor.vditor.currentMode].element.scrollTop = scrollTop;
    }
    preview?.remove();
    savePreviewShell(editor);
  }));
}
