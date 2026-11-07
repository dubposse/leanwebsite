import { getPackage } from './packages.js'
import {
  CHECKOUT_TAX_NOTICE,
  HOSTING_DOMAIN_DETAILS,
  PACKAGE_COPY,
} from './builder-copy.js'

const LEGAL_LINKS = [
  ['Impressum', 'https://matthiasbrehm.de/impressum'],
  ['Datenschutz', '/datenschutz'],
  ['Widerrufsbelehrung', '/widerruf'],
]

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

export function renderCheckoutReview({ packageCode, builderLabel }) {
  const pkg = getPackage(packageCode)
  const copy = PACKAGE_COPY[packageCode]
  const expectedBuilder = pkg?.builderSlug === 'business' ? 'Business' : 'Artist & Band'
  if (!pkg || !copy || builderLabel !== expectedBuilder) {
    throw new Error('Das ausgewählte Paket kann nicht in der Bestellübersicht dargestellt werden.')
  }

  const price = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
    .format(pkg.amountCents / 100)
  const services = copy.included
    ? `<ul>${copy.included.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : `<p>${escapeHtml(copy.description)}</p>`
  const hosting = pkg.code.endsWith('-rundum-sorglos')
    ? `<section class="checkout-review-hosting"><h4>Hosting und Domain – Rundum Sorglos</h4><p>${escapeHtml(HOSTING_DOMAIN_DETAILS)}</p></section>`
    : ''
  const links = LEGAL_LINKS
    .map(([label, href]) => `<a href="${href}"${href.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`)
    .join('')

  return `<p><strong>Builder:</strong> ${escapeHtml(builderLabel)}</p>
    <p><strong>Paket:</strong> ${escapeHtml(copy.title)}</p>
    <p><strong>Enthaltene Leistungen</strong></p>${services}
    ${hosting}
    <p class="checkout-review-total"><strong>Einmaliger Gesamtpreis: ${escapeHtml(price)}</strong></p>
    <p>${CHECKOUT_TAX_NOTICE}</p>
    <nav class="checkout-review-links" aria-label="Rechtliche Informationen">${links}</nav>`
}
