// PDF-specific service descriptions for complete package information
// These are separate from builder-copy.js to maintain independent builder UI
export const PDF_SERVICES = Object.freeze({
  'artist-band-code-and-go': {
    included: [
      'Responsive Website mit modernem Design',
      'Live-Vorschau während der Erstellung',
      'HTML-Download nach Abschluss',
      'Künstler- oder Bandname und alle Inhalte',
    ],
    excluded: [
      'Hosting und Domain',
      'Veröffentlichung im Internet',
      'Laufende Wartung und Support',
      'Nachträgliche Änderungen',
    ],
  },
  'artist-band-rundum-sorglos': {
    included: [
      'Responsive Website mit modernem Design',
      'Live-Vorschau während der Erstellung',
      'HTML-Download nach Abschluss',
      'Künstler- oder Bandname und alle Inhalte',
      'Einmaliges Hosting-Setup bei Hostinger',
      'Registrierung einer verfügbaren .de-Domain',
      'Veröffentlichung der Website',
      'Erster Hostingmonat (im Paketpreis enthalten)',
      'Erstes Domainjahr (im Paketpreis enthalten)',
    ],
    excluded: [
      'Laufende Hosting- und Domainverwaltung nach Ablauf der kostenlosen Zeiträume',
      'Technischer Support und Wartung',
      'E-Mail-Postfächer',
      'Nachträgliche inhaltliche Änderungen',
      'Übernahme bestehender Domains',
    ],
  },
  'business-pure-code': {
    included: [
      'Responsive Business-Website mit modernem Design',
      'Leistungs- und Galeriebereich',
      'Kontaktbereich mit Formular',
      'Live-Vorschau während der Erstellung',
      'HTML-Download nach Abschluss',
    ],
    excluded: [
      'Hosting und Domain',
      'Veröffentlichung im Internet',
      'Laufende Wartung und Support',
      'Nachträgliche Änderungen',
    ],
  },
  'business-rundum-sorglos': {
    included: [
      'Responsive Business-Website mit modernem Design',
      'Leistungs- und Galeriebereich',
      'Kontaktbereich mit Formular',
      'Live-Vorschau während der Erstellung',
      'HTML-Download nach Abschluss',
      'Einmaliges Hosting-Setup bei Hostinger',
      'Registrierung einer verfügbaren .de-Domain',
      'Veröffentlichung der Website',
      'Erster Hostingmonat (im Paketpreis enthalten)',
      'Erstes Domainjahr (im Paketpreis enthalten)',
    ],
    excluded: [
      'Laufende Hosting- und Domainverwaltung nach Ablauf der kostenlosen Zeiträume',
      'Technischer Support und Wartung',
      'E-Mail-Postfächer',
      'Nachträgliche inhaltliche Änderungen',
      'Übernahme bestehender Domains',
    ],
  },
})

export function getPdfServices(packageCode) {
  return PDF_SERVICES[packageCode] || null
}
