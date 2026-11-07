import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  CHECKOUT_TAX_NOTICE,
  HOSTING_DOMAIN_DETAILS,
  PACKAGE_COPY,
  POST_PURCHASE_CHANGES_TEXT,
} from '../shared/builder-copy.js'
import { renderCheckoutReview } from '../shared/checkout-review.js'
import { packages } from '../shared/packages.js'
import { HOSTINGER_CONSENT_TEXT } from '../shared/hostinger-consent.js'

const artistBuilder = readFileSync(new URL('../src/artist-band-builder.js', import.meta.url), 'utf8')
const businessBuilder = readFileSync(new URL('../src/business-builder.js', import.meta.url), 'utf8')

describe('builder package and hosting copy', () => {
  it('describes all existing packages without changing their identifiers or prices', () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(packages).map(([code, item]) => [code, item.amountCents])),
      {
        'artist-band-code-and-go': 3900,
        'artist-band-rundum-sorglos': 7900,
        'business-pure-code': 29900,
        'business-rundum-sorglos': 47900,
      },
    )
    assert.deepEqual(PACKAGE_COPY['artist-band-code-and-go'].included, [
      'Responsive Website', 'Live-Vorschau', 'HTML-Download',
    ])
    assert.deepEqual(PACKAGE_COPY['artist-band-code-and-go'].excluded, [
      'Hosting', 'Domain', 'Veröffentlichung', 'Nachträgliche Änderungen',
    ])
    assert.equal(PACKAGE_COPY['artist-band-rundum-sorglos'].title, 'Rundum Sorglos')
    assert.equal(PACKAGE_COPY['business-pure-code'].title, 'Pure Code')
    assert.equal(PACKAGE_COPY['business-rundum-sorglos'].title, 'Rundum Sorglos')
    assert.match(PACKAGE_COPY['business-pure-code'].description, /Leistungen, Galerie und Kontaktbereich/)
    assert.match(PACKAGE_COPY['artist-band-code-and-go'].description, /Künstler- oder Bandwebsite/)
  })

  it('uses one shared post-purchase notice and detailed hosting text in both builders', () => {
    assert.equal(CHECKOUT_TAX_NOTICE, 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.')
    assert.match(POST_PURCHASE_CHANGES_TEXT, /29 € pro Änderungsauftrag/)
    assert.match(POST_PURCHASE_CHANGES_TEXT, /solange die Bearbeitung noch nicht begonnen hat/)
    assert.match(POST_PURCHASE_CHANGES_TEXT, /Größere Umbauten und zusätzliche Funktionen/)
    for (const source of [artistBuilder, businessBuilder]) {
      assert.match(source, /POST_PURCHASE_CHANGES_TEXT/)
      assert.match(source, /HOSTING_DOMAIN_DETAILS/)
      assert.match(source, /PACKAGE_COPY\[item\.code\]/)
      assert.equal((source.match(/name="hostingerConsent"/g) || []).length, 1)
      assert.match(source, /name="hostingerConsent" type="checkbox" required/)
    }

    for (const phrase of [
      'eigenes Hosting-Konto bei Hostinger',
      'vorbehaltlich der tatsächlichen Verfügbarkeit',
      'fünf Werktagen',
      'Zugangsdaten und eine Abschlussbestätigung',
      'Gesetzliche Mängelrechte bleiben unberührt',
      'keine E-Mail-Postfächer eingerichtet',
      'keine bestehenden Domains übernommen',
    ]) {
      assert.ok(HOSTING_DOMAIN_DETAILS.includes(phrase), `missing hosting detail: ${phrase}`)
    }

    assert.ok(HOSTING_DOMAIN_DETAILS.includes(`Kosten und Laufzeiten: Der erste Hostingmonat und das erste Jahr deiner .de-Domain sind im Paketpreis enthalten. Das Hosting wird zunächst mit monatlicher Vertragslaufzeit eingerichtet, die Domain für ein Jahr registriert.

Nach Ablauf der enthaltenen Zeiträume betragen die Verlängerungskosten nach aktuellem Anbieterpreis 9,51 € pro Monat für das Hosting und 14,27 € pro Jahr für die Domain (jeweils inklusive 19 % Umsatzsteuer). Du kannst später selbst andere verfügbare Tarife und Laufzeiten wählen. Preisänderungen durch den Anbieter sind möglich.`))
  })

  it('renders the same verified order details for all four existing packages', () => {
    const cases = [
      ['artist-band-code-and-go', 'Artist & Band', 'Code & Go', '39,00'],
      ['artist-band-rundum-sorglos', 'Artist & Band', 'Rundum Sorglos', '79,00'],
      ['business-pure-code', 'Business', 'Pure Code', '299,00'],
      ['business-rundum-sorglos', 'Business', 'Rundum Sorglos', '479,00'],
    ]

    for (const [packageCode, builderLabel, title, price] of cases) {
      const summary = renderCheckoutReview({ packageCode, builderLabel })
      assert.ok(summary.includes(builderLabel.replace('&', '&amp;')))
      assert.ok(summary.includes(title.replace('&', '&amp;')))
      assert.ok(summary.includes(price))
      assert.ok(summary.includes(CHECKOUT_TAX_NOTICE))
      assert.ok(summary.includes('href="https://matthiasbrehm.de/impressum"'))
      assert.ok(summary.includes('href="/datenschutz"'))
      assert.ok(summary.includes('href="/widerruf"'))
      assert.equal(
        summary.includes('Kosten und Laufzeiten:'),
        packageCode.endsWith('-rundum-sorglos'),
      )
    }

    for (const source of [artistBuilder, businessBuilder]) {
      assert.match(source, /renderCheckoutReview\(\{/)
      assert.match(source, /Weiter zum zahlungspflichtigen Checkout/)
      assert.match(source, /Bestellung prüfen/)
      assert.match(source, /CHECKOUT_TAX_NOTICE/)
    }
  })

  it('keeps domain wishes required and alternatives optional in both builders', () => {
    for (const source of [artistBuilder, businessBuilder]) {
      assert.match(source, /name="desiredDomain"[^>]*required/)
      assert.match(source, /name="alternativeDomain"[^>]*>/)
      assert.doesNotMatch(source.match(/name="alternativeDomain"[^>]*>/)?.[0] ?? '', /required/)
    }

    assert.match(artistBuilder, /function updateSelectedPackage\(\)[\s\S]*?packageRequiresFulfillment\(selectedPackage\)/)
    assert.match(businessBuilder, /function updateFulfillmentVisibility\(\)[\s\S]*?BUSINESS_FULFILLMENT_PACKAGE_CODE/)
    assert.equal(HOSTINGER_CONSENT_TEXT, 'Ich beauftrage LeanWebsite Studio mit der beschriebenen einmaligen Einrichtung von Hosting und Domain sowie der Veröffentlichung meiner Website. Ich habe die Informationen zu Folgekosten und Übergabe zur Kenntnis genommen.')
  })
})
