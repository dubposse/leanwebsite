import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { BUSINESS_FULFILLMENT_PACKAGE_CODE, FULFILLMENT_PACKAGE_CODE } from './fulfillment.js'
import { getPackage } from './packages.js'
import { CHECKOUT_TAX_NOTICE, HOSTING_DOMAIN_DETAILS, PACKAGE_COPY } from '../../shared/builder-copy.js'
import { WITHDRAWAL_NOTICE } from '../../shared/withdrawal-copy.js'
import { MANAGED_FILE_DELIVERY_NOTICE } from '../../shared/order-instructions.js'
import { getPdfServices } from './pdf-services.js'

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 42
const CONTENT_TOP = 106
const CONTENT_BOTTOM = PAGE_HEIGHT - 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
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
  // Split by explicit newlines first, then wrap each line separately
  const paragraphs = String(text).split(/\r?\n/)
  const allLines = []

  for (const paragraph of paragraphs) {
    const words = paragraph.replace(/\s+/gu, ' ').trim().split(' ')
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
    allLines.push(...lines)
  }

  return allLines.length ? allLines : ['-']
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
      if (entry.type === 'paragraph') {
        return {
          type: 'paragraph',
          lines: wrapText(entry.value, regular, 9.5, width),
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
  if (entry.type === 'paragraph') return entry.lines.length * 12 + 5
  return entry.labelLines.length * 9.5 + entry.valueLines.length * 12 + 3
}

export async function createOrderConfirmationPdf({
  order,
  fulfillment = null,
  amountCents,
  artistName,
  stripeCustomer = null,
  withdrawalUrl = '/widerruf',
}) {
  const pkg = getPackage(order.package_code)
  const copy = PACKAGE_COPY[order.package_code]
  if (!pkg || !copy) {
    throw new Error('Unsupported order confirmation package')
  }
  const isBusiness = pkg.builderSlug === 'business'
  const isManaged = [FULFILLMENT_PACKAGE_CODE, BUSINESS_FULFILLMENT_PACKAGE_CODE].includes(order.package_code)
  if (isManaged && !fulfillment) throw new Error('Fulfillment details are required for Rundum Sorglos')

  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  document.setTitle('Vertragsbestätigung – LeanWebsite Studio')
  document.setAuthor('LeanWebsite Studio')
  document.setSubject(`Vertragsbestätigung ${pkg.builderSlug === 'business' ? 'Business' : 'Artist & Band'} – ${copy.title}`)

  const formattedPrice = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: order.currency,
  }).format(amountCents / 100)
  const customerName = stripeCustomer?.individual_name
    || (fulfillment ? `${fulfillment.first_name} ${fulfillment.last_name}`.trim() : '')
  const businessName = stripeCustomer?.business_name || fulfillment?.company_name
  const customerEmail = stripeCustomer?.email || order.customer_email || fulfillment?.communication_email

  const sections = [
    {
      title: 'Bestellinformationen',
      entries: [
        field('Bestellnummer', order.id),
        field('Bestelldatum', formatDate(order.created_at)),
        field('Builder', isBusiness ? 'Business' : 'Artist & Band'),
        field('Paket', copy.title),
        field('Einmaliger Paketpreis', formattedPrice),
        field('Steuerhinweis', CHECKOUT_TAX_NOTICE),
        field('Zahlungsstatus', 'Bezahlt'),
      ],
    },
    {
      title: 'Anbieter und Kunde',
      entries: [
        field('Anbieter', 'Matthias Brehm, Nordwestring 89, 90419 Nürnberg, Deutschland'),
        field('Anbieter-E-Mail', 'kontakt@matthiasbrehm.de'),
        ...(customerName ? [field('Kundenname', customerName)] : []),
        ...(businessName ? [field('Firmenname', businessName)] : []),
        field('Kunden-E-Mail', customerEmail),
        ...(fulfillment
          ? [
            field('Auftraggebertyp', isBusiness
              ? fulfillment.customer_type === 'company' ? 'Unternehmen' : 'Selbstständige Person'
              : 'Privatperson'),
            field('Rechnungsanschrift', [
              fulfillment.billing_street,
              `${fulfillment.billing_postal_code} ${fulfillment.billing_city}`,
              fulfillment.billing_country_code,
            ].join(', ')),
          ]
          : []),
      ],
    },
    ...(artistName ? [{
      title: 'Website',
      entries: [field('Künstler-/Bandname aus dem Entwurf', artistName)],
    }] : []),
    {
      title: 'Vereinbarte Leistungen',
      entries: (() => {
        const pdfServices = getPdfServices(order.package_code)
        const included = pdfServices?.included ?? copy.included ?? []
        const excluded = pdfServices?.excluded ?? copy.excluded ?? []
        return [
          ...included.map((value) => ({ type: 'bullet', value })),
          ...excluded.map((value) => ({ type: 'bullet', value: `Nicht enthalten: ${value}` })),
        ]
      })(),
    },
    ...(isManaged ? [
      {
        title: 'Hosting und Domain – Rundum Sorglos',
        entries: [
          { type: 'paragraph', value: MANAGED_FILE_DELIVERY_NOTICE },
          { type: 'paragraph', value: HOSTING_DOMAIN_DETAILS },
          field('Gewünschte neue .de-Domain', fulfillment.desired_domain),
          ...(fulfillment.alternative_domain
            ? [field('Alternative .de-Domain', fulfillment.alternative_domain)]
            : []),
          ...(fulfillment.domain_holder_differs
            ? [field('Abweichender Domaininhaber', [
              ...(fulfillment.domain_holder_type === 'organization'
                ? [`Organisation: ${fulfillment.domain_holder_organization_name}`]
                : [`Person: ${fulfillment.domain_holder_first_name} ${fulfillment.domain_holder_last_name}`]),
              fulfillment.domain_holder_street,
              `${fulfillment.domain_holder_postal_code} ${fulfillment.domain_holder_city}`,
              fulfillment.domain_holder_country_code,
              fulfillment.domain_holder_email,
            ].join(', '))]
            : []),
          field('Zustimmungsversion', fulfillment.hostinger_consent_version),
          field('Zugestimmt am', formatDate(fulfillment.hostinger_consented_at)),
        ],
      },
    ] : []),
    {
      title: 'Widerrufsbelehrung',
      entries: [
        { type: 'paragraph', value: `Vollständige Widerrufsbelehrung: ${withdrawalUrl}` },
        ...WITHDRAWAL_NOTICE.flatMap((section) => [
          { type: 'paragraph', value: section.title },
          ...section.paragraphs.map((value) => ({ type: 'paragraph', value })),
        ]),
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
      ? 'Vertragsbestätigung (Fortsetzung)'
      : 'Vertragsbestätigung', {
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
    if (entry.type === 'paragraph') {
      for (const line of entry.lines) {
        page.drawText(line, {
          x,
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

  const prepared = sections.map((section) => prepareSection(section, CONTENT_WIDTH, regular, bold))
  addPage()

  // Identify withdrawal section
  const withdrawalIndex = prepared.findIndex((s) => s.title === 'Widerrufsbelehrung')
  const regularSections = withdrawalIndex >= 0 ? prepared.slice(0, withdrawalIndex) : prepared
  const withdrawalSections = withdrawalIndex >= 0 ? prepared.slice(withdrawalIndex) : []

  // Render regular sections
  for (const section of regularSections) {
    if (y + 24 > CONTENT_BOTTOM) addPage(true)
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

  // Withdrawal always starts on new page
  if (withdrawalSections.length > 0) {
    addPage(true)
    for (const section of withdrawalSections) {
      if (y + 24 > CONTENT_BOTTOM) addPage(true)
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
