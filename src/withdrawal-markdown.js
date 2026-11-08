import { renderMarkdown } from './markdown.js'

export function renderWithdrawalMarkdown(markdown) {
  return renderMarkdown(markdown, {
    preserveLineBreaks: true,
    paragraphClass(lines) {
      if (lines[0] === 'Matthias Brehm') return 'withdrawal-contact-address'
      if (lines[0].startsWith('Telefon:') && lines.some((line) => line.startsWith('E-Mail:'))) {
        return 'withdrawal-contact-details'
      }
      return ''
    },
  })
}
