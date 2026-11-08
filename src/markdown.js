function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+|mailto:[^)]+)\)/g, (_, label, url) => {
      const external = url.startsWith('https://')
      return `<a href="${url}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

export function renderMarkdown(markdown, { preserveLineBreaks = false, paragraphClass = () => '' } = {}) {
  const output = []
  let paragraph = []
  let listOpen = false
  let sectionOpen = false
  let sectionNumber = 0

  const flushParagraph = () => {
    if (!paragraph.length) return
    const className = paragraphClass(paragraph)
    const attribute = className ? ` class="${escapeHtml(className)}"` : ''
    output.push(`<p${attribute}>${paragraph.map(renderInlineMarkdown).join(preserveLineBreaks ? '<br>' : ' ')}</p>`)
    paragraph = []
  }
  const closeList = () => {
    if (!listOpen) return
    output.push('</ul>')
    listOpen = false
  }
  const closeSection = () => {
    if (!sectionOpen) return
    output.push('</section>')
    sectionOpen = false
  }

  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim()) {
      flushParagraph()
      closeList()
      continue
    }

    if (line.startsWith('# ')) {
      flushParagraph()
      closeList()
      output.push(`<h1>${renderInlineMarkdown(line.slice(2))}</h1>`)
      continue
    }

    if (line.startsWith('### ')) {
      flushParagraph()
      closeList()
      closeSection()
      sectionNumber += 1
      output.push(`<section class="privacy-section legal-section" id="legal-section-${sectionNumber}"><h2>${renderInlineMarkdown(line.slice(4))}</h2>`)
      sectionOpen = true
      continue
    }

    if (line.startsWith('- ')) {
      flushParagraph()
      if (!listOpen) {
        output.push('<ul>')
        listOpen = true
      }
      output.push(`<li>${renderInlineMarkdown(line.slice(2))}</li>`)
      continue
    }

    closeList()
    paragraph.push(line)
  }

  flushParagraph()
  closeList()
  closeSection()
  return output.join('\n')
}
