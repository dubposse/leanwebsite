export const BUSINESS_OPERATOR_DEFAULTS = Object.freeze({
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
  registered: 'false',
  registerCourt: '',
  registerNumber: '',
  vatId: '',
  editorial: 'false',
  editorialName: '',
  editorialAddress: '',
  hostingProvider: '',
  hostingOther: '',
  domainProvider: '',
  domainOther: '',
  confirmPublic: 'false',
  confirmReviewed: 'false',
})

export const BUSINESS_OPERATOR_LIMITS = Object.freeze(Object.fromEntries(
  Object.keys(BUSINESS_OPERATOR_DEFAULTS).map((field) => [field, field === 'email' ? 254 : 500]),
))

export const BUSINESS_OPERATOR_CHOICES = Object.freeze({
  operatorType: ['person', 'gbr', 'association', 'company'],
  registered: ['true', 'false'],
  editorial: ['true', 'false'],
  hostingProvider: ['', 'Hostinger', 'IONOS', 'STRATO', 'other'],
  domainProvider: ['', 'Hostinger', 'IONOS', 'STRATO', 'other'],
  confirmPublic: ['true', 'false'],
  confirmReviewed: ['true', 'false'],
})

export function businessOperatorErrors(data, packageCode) {
  const errors = []
  const required = (field, label) => {
    if (!data[field].trim()) errors.push({ field, message: `Bitte gib ${label} ein.` })
  }
  required('operatorName', 'den Namen des Websitebetreibers')
  if (data.operatorType === 'company') required('legalForm', 'die Rechtsform')
  if (data.operatorType !== 'person') required('representative', 'die Vertretungsberechtigten')
  required('street', 'Straße und Hausnummer')
  required('postalCode', 'die Postleitzahl')
  required('city', 'den Ort')
  required('country', 'das Land')
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(data.email.trim())) {
    errors.push({ field: 'email', message: 'Bitte gib eine gültige öffentliche E-Mail-Adresse ein.' })
  }
  if (data.registered === 'true') {
    required('registerCourt', 'das Registergericht')
    required('registerNumber', 'die Registernummer')
  }
  if (data.editorial === 'true') {
    required('editorialName', 'den Namen des redaktionell Verantwortlichen')
    required('editorialAddress', 'die Anschrift des redaktionell Verantwortlichen')
  }
  if (packageCode === 'business-pure-code') {
    if (data.hostingProvider === 'other') required('hostingOther', 'den Hostinganbieter')
    if (data.domainProvider === 'other') required('domainOther', 'den Domainanbieter')
  }
  if (data.confirmPublic !== 'true') errors.push({ field: 'confirmPublic', message: 'Bitte bestätige die Veröffentlichung deiner Betreiberangaben.' })
  if (data.confirmReviewed !== 'true') errors.push({ field: 'confirmReviewed', message: 'Bitte bestätige, dass du Impressum und Datenschutzerklärung geprüft hast.' })
  return errors
}
