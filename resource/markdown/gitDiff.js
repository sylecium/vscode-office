const STYLE_ID = 'office-git-diff';
const MODES = [['wysiwyg', 'Md2VditorDOM'], ['ir', 'Md2VditorIRDOM']];
const ROLE_COLORS = {
  modified: ['var(--vscode-diffEditor-insertedTextBackground, rgba(46,160,67,.2))', 'var(--vscode-gitDecoration-addedResourceForeground, #2ea043)'],
  original: ['var(--vscode-diffEditor-removedTextBackground, rgba(248,81,73,.2))', 'var(--vscode-gitDecoration-deletedResourceForeground, #f85149)'],
  changed: ['rgba(56,139,253,.18)', 'var(--vscode-gitDecoration-modifiedResourceForeground, #388bfd)'],
};

/** Indexes of `own` that are not part of the longest common subsequence with `other`. */
export function changedIndexes(own, other) {
  let start = 0;
  while (start < own.length && start < other.length && own[start] === other[start]) start++;
  let ownEnd = own.length;
  let otherEnd = other.length;
  while (ownEnd > start && otherEnd > start && own[ownEnd - 1] === other[otherEnd - 1]) {
    ownEnd--;
    otherEnd--;
  }
  const n = ownEnd - start;
  const m = otherEnd - start;
  const width = m + 1;
  // lcs[i * width + j]: LCS length of own[start + i..] and other[start + j..].
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = own[start + i] === other[start + j]
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const changed = [];
  let i = 0;
  let j = 0;
  while (i < n) {
    if (j < m && own[start + i] === other[start + j]) {
      i++;
      j++;
    } else if (j < m && lcs[(i + 1) * width + j] < lcs[i * width + j + 1]) {
      j++;
    } else {
      changed.push(start + i);
      i++;
    }
  }
  return changed;
}

// Attributes that change without the content changing, such as list numbering, are ignored.
const unitKey = (block, unit) => `${block.tagName}${unit.outerHTML.replace(/ data-marker="[^"]*"/g, '')}`;

/** Highlightable units of a markdown text, as selectors relative to `.vditor-reset`. */
function splitUnits(lute, method, markdown) {
  const template = document.createElement('template');
  template.innerHTML = lute[method](markdown);
  const units = [];
  const blocks = template.content.children;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    // The editor inserts a hidden vditor-editor-boundary span around the blocks, which the lute output lacks.
    const blockSelector = `>:nth-child(${i + 1} of :not(.vditor-editor-boundary))`;
    if (block.tagName === 'UL' || block.tagName === 'OL') {
      for (let j = 0; j < block.children.length; j++) {
        units.push({ selector: `${blockSelector}>:nth-child(${j + 1})`, key: unitKey(block, block.children[j]) });
      }
    } else if (block.tagName === 'TABLE') {
      for (const row of block.rows) {
        const section = row.parentElement.tagName.toLowerCase();
        units.push({
          selector: `${blockSelector}>${section}>:nth-child(${row.sectionRowIndex + 1})`,
          key: unitKey(block, row),
        });
      }
    } else {
      units.push({ selector: blockSelector, key: unitKey(block, block) });
    }
  }
  return units;
}

/** Highlights the blocks that differ from the other side of a diff, without touching the editor DOM. */
export function bindGitDiff(handler, editor) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  document.head.appendChild(style);
  let revealed = false;

  const render = ({ role, own, other }) => {
    const [background, bar] = ROLE_COLORS[role];
    const currentMode = editor.vditor.currentMode;
    const rules = [];
    let firstChange;
    for (const [mode, method] of MODES) {
      const ownUnits = splitUnits(editor.vditor.lute, method, own);
      const otherKeys = splitUnits(editor.vditor.lute, method, other).map(unit => unit.key);
      for (const index of changedIndexes(ownUnits.map(unit => unit.key), otherKeys)) {
        const selector = `.vditor-${mode}>.vditor-reset${ownUnits[index].selector}`;
        rules.push(`${selector} { background-color: ${background} !important; box-shadow: -4px 0 0 ${bar}; }`);
        if (mode === currentMode && firstChange === undefined) firstChange = selector;
      }
    }
    style.textContent = rules.join('\n');
    if (!revealed && firstChange) {
      revealed = true;
      requestAnimationFrame(() => {
        document.querySelector(firstChange)?.scrollIntoView({ block: 'center' });
      });
    }
  };

  handler.on('gitDiff', render);
  handler.emit('queryGitDiff');
}
