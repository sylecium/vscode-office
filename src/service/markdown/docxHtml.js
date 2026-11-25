const { parse } = require("node-html-parser")
const JSZip = require("jszip")

const INLINE_TAGS = new Set(['A', 'B', 'CODE', 'DEL', 'EM', 'I', 'IMG', 'INS', 'MARK', 'S', 'SPAN', 'STRONG', 'SUB', 'SUP', 'U'])
// Widest image that fits the text area of the generated document.
const MAX_IMAGE_WIDTH = 576

const escapeText = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const replaceElement = (element, html) => element.replaceWith(...parse(html).childNodes)

/**
 * Rewrite the exported HTML into the subset that vscode-html-to-docx renders:
 * it ignores whitespace-only text nodes (so newlines of code blocks and spaces between
 * inline elements), the img width attribute, labels, and text held by nested divs.
 */
export function prepareDocxHtml(html) {
    const root = parse(html, { blockTextElements: { script: true, style: true } })

    // One <pre> per line: monospaced, and the only way to keep line breaks.
    for (const pre of root.querySelectorAll('pre')) {
        const lines = pre.textContent.replace(/\n$/, '').replace(/\t/g, '    ').split('\n')
        replaceElement(pre, lines.map(line => `<pre>${line.trim() ? escapeText(line) : '&nbsp;'}</pre>`).join(''))
    }

    for (const input of root.querySelectorAll('input[type=checkbox]')) {
        const label = input.nextElementSibling
        const text = label && label.rawTagName === 'label' ? label.innerHTML : ''
        if (text) label.remove()
        replaceElement(input, `<span>${input.hasAttribute('checked') ? '☒' : '☐'} </span><span>${text}</span>`)
    }

    for (const mark of root.querySelectorAll('mark')) {
        replaceElement(mark, `<span style="background-color:#fff3a3">${mark.innerHTML}</span>`)
    }

    for (const title of root.querySelectorAll('.callout-title')) {
        const inner = title.querySelector('.callout-title-inner')
        replaceElement(title, `<p><strong>${inner ? inner.innerHTML : ''}</strong></p>`)
    }

    // A blockquote is rendered as a single paragraph: give each paragraph its own. Innermost first.
    for (const quote of root.querySelectorAll('blockquote').reverse()) {
        const children = quote.childNodes.filter(node => node.rawTagName)
        if (children.length < 2) continue
        replaceElement(quote, children.map(child =>
            child.rawTagName === 'p' ? `<blockquote>${child.outerHTML}</blockquote>` : child.outerHTML).join(''))
    }

    for (let img of root.querySelectorAll('img')) {
        const width = /^\s*(\d+)(px)?\s*$/.exec(img.getAttribute('width') || '')
        if (width && !img.getAttribute('style')) {
            img.setAttribute('style', `width:${Math.min(Number(width[1]), MAX_IMAGE_WIDTH)}px`)
        }
        // An image wrapped alone in a link or span is dropped by the converter.
        let wrapper = img.parentNode
        while (wrapper && ['a', 'span'].includes(wrapper.rawTagName)
            && wrapper.childNodes.every(node => node === img || (!node.rawTagName && !node.text.trim()))) {
            const parent = wrapper.parentNode
            const [moved] = parse(img.outerHTML).childNodes
            wrapper.replaceWith(moved)
            img = moved
            wrapper = parent
        }
    }

    keepInlineSpaces(root)
    return root.toString()
}

function keepInlineSpaces(element) {
    const nodes = element.childNodes
    nodes.forEach((node, index) => {
        if (node.rawTagName) {
            keepInlineSpaces(node)
            return
        }
        const isInline = sibling => INLINE_TAGS.has((sibling?.rawTagName || '').toUpperCase())
        if (typeof node.rawText === 'string' && node.rawText && !node.rawText.trim()
            && isInline(nodes[index - 1]) && isInline(nodes[index + 1])) {
            node.rawText = '&nbsp;'
        }
    })
}

/** The converter always writes US Letter pages: switch to A4, keeping the same text width. */
export async function setA4PageSize(docx) {
    const zip = await JSZip.loadAsync(docx)
    const entry = 'word/document.xml'
    const xml = (await zip.file(entry).async('string'))
        .replace(/<w:pgSz w:w="12240" w:h="15840"/, '<w:pgSz w:w="11906" w:h="16838"')
        .replace(/(<w:pgMar [^>]*?)w:right="1800"([^>]*?)w:left="1800"/, '$1w:right="1633"$2w:left="1633"')
    zip.file(entry, xml)
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
