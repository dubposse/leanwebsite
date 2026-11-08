export const LEGAL_DEFAULTS = Object.freeze({
  operatorType: 'person',
  operatorName: '',
  legalForm: '',
  representative: '',
  street: '',
  postalCode: '',
  city: '',
  country: '',
  email: '',
  phone: '',
  registered: false,
  registerCourt: '',
  registerNumber: '',
  vatId: '',
  editorial: false,
  editorialName: '',
  editorialAddress: '',
  hostingProvider: '',
  hostingOther: '',
  domainProvider: '',
  domainOther: '',
  confirmPublic: false,
  confirmReviewed: false,
})

export const LEGAL_TYPES = Object.freeze(['person', 'gbr', 'association', 'company'])
export const LEGAL_PROVIDERS = Object.freeze(['', 'Hostinger', 'IONOS', 'STRATO', 'other'])

export function artistBandLegalErrors(legal, packageCode) {
  const errors = []
  const required = (field, label) => {
    if (!legal[field].trim()) errors.push({ field, message: `Bitte gib ${label} ein.` })
  }
  required('operatorName', 'den Namen des Websitebetreibers')
  if (legal.operatorType === 'company') required('legalForm', 'die Rechtsform')
  if (legal.operatorType !== 'person') required('representative', 'die Vertretungsberechtigten')
  required('street', 'Straße und Hausnummer')
  required('postalCode', 'die Postleitzahl')
  required('city', 'den Ort')
  required('country', 'das Land')
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(legal.email.trim())) {
    errors.push({ field: 'email', message: 'Bitte gib eine gültige öffentliche E-Mail-Adresse ein.' })
  }
  if (legal.registered) {
    required('registerCourt', 'das Registergericht')
    required('registerNumber', 'die Registernummer')
  }
  if (legal.editorial) {
    required('editorialName', 'den Namen des redaktionell Verantwortlichen')
    required('editorialAddress', 'die Anschrift des redaktionell Verantwortlichen')
  }
  if (packageCode === 'artist-band-code-and-go') {
    if (legal.hostingProvider === 'other') required('hostingOther', 'den Hostinganbieter')
    if (legal.domainProvider === 'other') required('domainOther', 'den Domainanbieter')
  }
  if (!legal.confirmPublic) errors.push({ field: 'confirmPublic', message: 'Bitte bestätige die Veröffentlichung deiner Betreiberangaben.' })
  if (!legal.confirmReviewed) errors.push({ field: 'confirmReviewed', message: 'Bitte bestätige, dass du Impressum und Datenschutzerklärung geprüft hast.' })
  return errors
}
