import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { BUSINESS_FULFILLMENT_PACKAGE_CODE, FULFILLMENT_PACKAGE_CODE } from './fulfillment.js'

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 42
const COLUMN_GAP = 18
const CONTENT_TOP = 106
const CONTENT_BOTTOM = PAGE_HEIGHT - 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const COLUMN_WIDTH = (CONTENT_WIDTH - COLUMN_GAP) / 2
const TEXT = rgb(0.13, 0.16, 0.19)
const MUTED = rgb(0.38, 0.42, 0.46)
const ACCENT = rgb(0.55, 0.78, 0.08)
const PALE = rgb(0.95, 0.97, 0.92)

function formatDate(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid confirmation date')
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
  }).format(date)
}

function wrapText(text, font, fontSize, maxWidth) {
  const words = String(text).replace(/\s+/gu, ' ').trim().split(' ')
  const lines = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      line = candidate
      continue
    }

    if (line) lines.push(line)
    if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
      line = word
      continue
    }

    line = ''
    let fragment = ''
    for (const character of word) {
      const next = fragment + character
      if (fragment && font.widthOfTextAtSize(next, fontSize) > maxWidth) {
        lines.push(fragment)
        fragment = character
      } else {
        fragment = next
      }
    }
    line = fragment
  }

  if (line) lines.push(line)
  return lines.length ? lines : ['-']
}

function field(label, value) {
  return { type: 'field', label, value: value || '-' }
}

function prepareSection(section, width, regular, bold) {
  return {
    title: section.title,
    entries: section.entries.map((entry) => {
      if (entry.type === 'bullet') {
        return {
          type: 'bullet',
          lines: wrapText(entry.value, regular, 9.5, width - 12),
        }
      }

      const labelLines = wrapText(entry.label, bold, 7.5, width)
      const valueLines = wrapText(entry.value, regular, 9.5, width)
      return { type: 'field', labelLines, valueLines }
    }),
  }
}

function entryHeight(entry) {
  if (entry.type === 'bullet') return entry.lines.length * 12 + 4
  return entry.labelLines.length * 9.5 + entry.valueLines.length * 12 + 3
}

function sectionHeight(section) {
  return 24 + section.entries.reduce((height, entry) => height + entryHeight(entry), 0)
}

export async function createOrderConfirmationPdf({ order, fulfillment, amountCents, artistName }) {
  const isBusiness = order.package_code === BUSINESS_FULFILLMENT_PACKAGE_CODE
  if (!isBusiness && order.package_code !== FULFILLMENT_PACKAGE_CODE) {
    throw new Error('Unsupported order confirmation package')
  }

  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  document.setTitle('Auftragsbestätigung – Rundum Sorglos')
  document.setAuthor('LeanWebsite Studio')
  document.setSubject(isBusiness
    ? 'Auftragsbestätigung Business – Rundum Sorglos'
    : 'Auftragsbestätigung Artist & Band – Rundum Sorglos')

  const formattedPrice = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: order.currency,
  }).format(amountCents / 100)

  const sections = [
    {
      title: 'Bestellinformationen',
      entries: [
        field('Bestellnummer', order.id),
        field('Bestelldatum', formatDate(order.created_at)),
        ...(!isBusiness && artistName ? [field('Künstler-/Bandname', artistName)] : []),
        field('Paket', isBusiness ? 'Business – Rundum Sorglos' : 'Artist & Band – Rundum Sorglos'),
        field('Einmaliger Paketpreis', formattedPrice),
        field('Zahlungsstatus', 'Bezahlt'),
        ...(isBusiness ? [field('Dokumenthinweis', 'Auftragsbestätigung – keine Rechnung')] : []),
      ],
    },
    {
      title: 'Auftraggeber',
      entries: [
        ...(isBusiness
          ? [
            field('Auftraggebertyp', fulfillment.customer_type === 'company'
              ? 'Unternehmen'
              : 'Selbstständige Person'),
            ...(fulfillment.company_name ? [field('Firma / Geschäftsbezeichnung', fulfillment.company_name)] : []),
          ]
          : []),
        field('Name', `${fulfillment.first_name} ${fulfillment.last_name}`),
        field('Rechnungsanschrift', [
          fulfillment.billing_street,
          `${fulfillment.billing_postal_code} ${fulfillment.billing_city}`,
          fulfillment.billing_country_code,
        ].join(', ')),
        field('E-Mail für die Auftragskommunikation', fulfillment.communication_email),
      ],
    },
    {
      title: 'Domain',
      entries: [
        field('Gewünschte neue .de-Domain', fulfillment.desired_domain),
        ...(fulfillment.alternative_domain
          ? [field('Alternative .de-Domain', fulfillment.alternative_domain)]
          : []),
        ...(fulfillment.domain_holder_differs
          ? [field('Abweichender Domaininhaber', [
            ...(fulfillment.domain_holder_type === 'organization'
              ? [isBusiness
                ? `Organisation: ${fulfillment.domain_holder_organization_name}`
                : fulfillment.domain_holder_organization_name]
              : [isBusiness
                ? `Person: ${fulfillment.domain_holder_first_name} ${fulfillment.domain_holder_last_name}`
                : `${fulfillment.domain_holder_first_name} ${fulfillment.domain_holder_last_name}`]),
            fulfillment.domain_holder_street,
            `${fulfillment.domain_holder_postal_code} ${fulfillment.domain_holder_city}`,
            fulfillment.domain_holder_country_code,
            fulfillment.domain_holder_email,
          ].join(', '))]
          : []),
      ],
    },
    {
      title: 'Vereinbarte Leistungen',
      entries: [
        'Einrichtung einer statischen Website bei Hostinger.',
        'Einrichtung eines Hostinger-Accounts mit der E-Mail-Adresse des Kunden.',
        'Registrierung einer neuen verfügbaren .de-Domain auf den angegebenen Domaininhaber.',
        'LeanWebsite Studio übernimmt den ersten Hostingmonat und das erste Domainjahr.',
        'Ab dem zweiten Hostingmonat trägt der Kunde die Hostingkosten.',
        'Ab dem zweiten Jahr trägt der Kunde die Kosten der Domainverlängerung.',
        'Es wird kein E-Mail-Postfach eingerichtet.',
        'Bestehende Domains werden nicht übernommen.',
        'Die Veröffentlichung erfolgt in der Regel innerhalb von fünf Werktagen nach Eingang aller erforderlichen Informationen und Zugänge.',
      ].map((value) => ({ type: 'bullet', value })),
    },
    {
      title: 'Zustimmung',
      entries: [
        field('Zustimmungsversion', fulfillment.hostinger_consent_version),
        field('Zugestimmt am', formatDate(fulfillment.hostinger_consented_at)),
      ],
    },
  ]

  const pages = []
  let page
  let y

  const addPage = (continuation = false) => {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    pages.push(page)
    page.drawText('LeanWebsite Studio', {
      x: MARGIN,
      y: PAGE_HEIGHT - 38 - 11,
      size: 9,
      font: bold,
      color: MUTED,
    })
    page.drawText(continuation
      ? 'Auftragsbestätigung – Rundum Sorglos (Fortsetzung)'
      : 'Auftragsbestätigung – Rundum Sorglos', {
      x: MARGIN,
      y: PAGE_HEIGHT - 60 - 19,
      size: 16,
      font: bold,
      color: TEXT,
    })
    y = continuation ? 96 : CONTENT_TOP
  }

  const drawSectionHeading = (title, x, width) => {
    page.drawRectangle({
      x,
      y: PAGE_HEIGHT - y - 18,
      width,
      height: 18,
      color: PALE,
    })
    page.drawRectangle({
      x,
      y: PAGE_HEIGHT - y - 18,
      width: 3,
      height: 18,
      color: ACCENT,
    })
    page.drawText(title, {
      x: x + 9,
      y: PAGE_HEIGHT - y - 12.5,
      size: 9,
      font: bold,
      color: TEXT,
    })
    y += 24
  }

  const drawEntry = (entry, x, width) => {
    if (entry.type === 'bullet') {
      page.drawRectangle({
        x: x + 1,
        y: PAGE_HEIGHT - y - 5.5,
        width: 3,
        height: 3,
        color: ACCENT,
      })
      y += 1
      for (const line of entry.lines) {
        page.drawText(line, {
          x: x + 10,
          y: PAGE_HEIGHT - y - 9.5,
          size: 9.5,
          font: regular,
          color: TEXT,
        })
        y += 12
      }
      y += 3
      return
    }

    for (const line of entry.labelLines) {
      page.drawText(line, {
        x,
        y: PAGE_HEIGHT - y - 7.5,
        size: 7.5,
        font: bold,
        color: MUTED,
      })
      y += 9.5
    }
    y += 1
    for (const line of entry.valueLines) {
      page.drawText(line, {
        x,
        y: PAGE_HEIGHT - y - 9.5,
        size: 9.5,
        font: regular,
        color: TEXT,
      })
      y += 12
    }
    y += 2
  }

  const preparedColumns = [
    sections.slice(0, 3).map((section) => prepareSection(section, COLUMN_WIDTH, regular, bold))
      .concat([prepareSection(sections[4], COLUMN_WIDTH, regular, bold)]),
    [prepareSection(sections[3], COLUMN_WIDTH, regular, bold)],
  ]
  const columnHeights = preparedColumns.map((column) =>
    column.reduce((height, section) => height + sectionHeight(section) + 7, 0))
  const availableHeight = CONTENT_BOTTOM - CONTENT_TOP

  if (columnHeights.every((height) => height <= availableHeight)) {
    addPage()
    const starts = [MARGIN, MARGIN + COLUMN_WIDTH + COLUMN_GAP]
    preparedColumns.forEach((column, columnIndex) => {
      y = CONTENT_TOP
      for (const section of column) {
        drawSectionHeading(section.title, starts[columnIndex], COLUMN_WIDTH)
        for (const entry of section.entries) drawEntry(entry, starts[columnIndex], COLUMN_WIDTH)
        y += 7
      }
    })
  } else {
    const prepared = sections.map((section) => prepareSection(section, CONTENT_WIDTH, regular, bold))
    addPage()

    for (const section of prepared) {
      const height = sectionHeight(section)
      if (y + height > CONTENT_BOTTOM && y > CONTENT_TOP) addPage(true)
      drawSectionHeading(section.title, MARGIN, CONTENT_WIDTH)

      for (const entry of section.entries) {
        const heightNeeded = entryHeight(entry)
        if (y + heightNeeded > CONTENT_BOTTOM && y > CONTENT_TOP + 24) {
          addPage(true)
          drawSectionHeading(`${section.title} – Fortsetzung`, MARGIN, CONTENT_WIDTH)
        }
        drawEntry(entry, MARGIN, CONTENT_WIDTH)
      }
      y += 5
    }
  }

  pages.forEach((currentPage, index) => {
    currentPage.drawLine({
      start: { x: MARGIN, y: 35 },
      end: { x: PAGE_WIDTH - MARGIN, y: 35 },
      thickness: 0.5,
      color: rgb(0.82, 0.84, 0.85),
    })
    currentPage.drawText(`LeanWebsite Studio  |  Seite ${index + 1} von ${pages.length}`, {
      x: MARGIN,
      y: 21,
      size: 8,
      font: regular,
      color: MUTED,
    })
  })

  return document.save()
}
