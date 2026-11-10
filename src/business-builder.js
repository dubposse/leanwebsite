import { generateBusinessHtml } from '../shared/business-template.js'
import { businessOperatorErrors, BUSINESS_OPERATOR_CHOICES, BUSINESS_OPERATOR_DEFAULTS, BUSINESS_OPERATOR_LIMITS } from '../shared/business-operator.js'
import {
  HOSTING_DOMAIN_DETAILS,
  PACKAGE_COPY,
  POST_PURCHASE_CHANGES_TEXT,
  POST_PURCHASE_CHANGES_TITLE,
  CHECKOUT_TAX_NOTICE,
} from '../shared/builder-copy.js'
import { getPackagesForBuilder } from '../shared/packages.js'
import { renderCheckoutReview } from '../shared/checkout-review.js'
import { setupBusinessMobileView } from './business-mobile-view.js'
import { wireBusinessSingleImage } from './business-single-image.js'
import { encodeBusinessLogo, hasImageTransparency, imageByteLength, isImageDataUrl } from './business-image.js'
import {
  BUSINESS_FULFILLMENT_PACKAGE_CODE,
  BusinessFulfillmentValidationError,
  collectBusinessFulfillment,
  createBusinessCheckoutPayload,
  HOSTINGER_CONSENT_TEXT,
  resetBusinessFulfillment,
  restoreBusinessFulfillment,
  validateBusinessFulfillmentForUI,
} from './business-fulfillment.js'
import './business-builder.css'

const STORAGE_KEY = 'leanwebsite-business-builder-v1'
const DRAFT_REFERENCE_KEY = 'leanwebsite-business-draft-reference-v1'
const MAX_SERVICES = 8
const MAX_FACTS = 4
const MAX_GALLERY = 3
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024
const MAX_DRAFT_REQUEST_BYTES = 4 * 1024 * 1024

const FIELD_LIMITS = {
  'company.name': 100,
  'company.tagline': 180,
  'company.industry': 120,
  'hero.headline': 180,
  'hero.sub': 3000,
  'hero.cta': 100,
  'hero.badge': 120,
  'services.icon': 4,
  'services.title': 120,
  'services.text': 1000,
  'about.title': 120,
  'about.text': 5000,
  'facts.value': 40,
  'facts.label': 120,
  'contact.email': 254,
  'contact.phone': 80,
  'contact.address': 1000,
  'contact.hours': 2000,
  'contact.instagram': 2048,
  'legal.owner': 200,
  'legal.vat': 32,
  'legal.domain': 253,
  'legal.notes': 5000,
  ...Object.fromEntries(Object.entries(BUSINESS_OPERATOR_LIMITS).map(([field, limit]) => [`operator.${field}`, limit])),
}

const INVALID_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

const DEFAULT_DATA = {
  company: { name: '', tagline: '', industry: '' },
  logo: '',
  hero: { headline: '', sub: '', cta: '', badge: '', image: '' },
  services: [{ icon: '🚀', title: '', text: '' }],
  about: { title: '', text: '', image: '' },
  facts: [],
  gallery: [],
  contact: { email: '', phone: '', address: '', hours: '', instagram: '' },
  design: { accent: '#8b5cf6', accent2: '#22d3ee', mode: 'dark', radius: '16' },
  legal: { owner: '', vat: '', domain: '', notes: '' },
  operator: { ...BUSINESS_OPERATOR_DEFAULTS },
}

const PALETTES = [
  ['#8b5cf6', '#22d3ee'],
  ['#f43f5e', '#fb923c'],
  ['#22c55e', '#a3e635'],
  ['#3b82f6', '#e879f9'],
  ['#f59e0b', '#ef4444'],
  ['#14b8a6', '#6366f1'],
]

const SINGLE_IMAGE_PATHS = ['logo', 'hero.image', 'about.image']
const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DRAFT_TOKEN = /^[A-Za-z0-9_-]{43}$/

const SECTION_FIELDS = {
  company: ['name', 'tagline', 'industry'],
  hero: ['headline', 'sub', 'cta', 'badge', 'image'],
  about: ['title', 'text', 'image'],
  contact: ['email', 'phone', 'address', 'hours', 'instagram'],
  design: ['accent', 'accent2', 'mode', 'radius'],
  legal: ['owner', 'vat', 'domain', 'notes'],
  operator: Object.keys(BUSINESS_OPERATOR_DEFAULTS),
}

function isBusinessDataStructure(value, { serverData = false } = {}) {
  if (!isObject(value)) return false
  const known = new Set([...Object.keys(SECTION_FIELDS), 'logo', 'services', 'facts', 'gallery'])
  if (Object.keys(value).some((key) => !known.has(key))) return false
  if (value.logo !== undefined && !isImageDataUrl(value.logo, { logo: true })) return false

  for (const [section, fields] of Object.entries(SECTION_FIELDS)) {
    const data = value[section]
    if (data === undefined) continue
    if (!isObject(data) || Object.keys(data).some((field) => !fields.includes(field))) return false
    for (const [field, fieldValue] of Object.entries(data)) {
      if (typeof fieldValue !== 'string') return false
      if (section === 'operator' && (fieldValue.length > BUSINESS_OPERATOR_LIMITS[field]
        || INVALID_CONTROL_CHARACTERS.test(fieldValue)
        || (Object.hasOwn(BUSINESS_OPERATOR_CHOICES, field) && !BUSINESS_OPERATOR_CHOICES[field].includes(fieldValue)))) return false
      if (field === 'image' && !isImageDataUrl(fieldValue, { hero: section === 'hero' })) return false
    }
  }

  for (const [key, fields, max] of [
    ['services', ['icon', 'title', 'text'], MAX_SERVICES],
    ['facts', ['value', 'label'], MAX_FACTS],
  ]) {
    const items = value[key]
    if (items === undefined) continue
    if (!Array.isArray(items) || (serverData && items.length > max)) return false
    if (items.some((item) => !isObject(item)
      || Object.keys(item).some((field) => !fields.includes(field))
      || Object.values(item).some((field) => typeof field !== 'string'))) return false
  }

  if (value.gallery !== undefined) {
    if (!Array.isArray(value.gallery) || (serverData && value.gallery.length > MAX_GALLERY)) return false
    if (value.gallery.some((image) => !isImageDataUrl(image))) return false
  }
  return true
}

function isDraftReference(value) {
  return isObject(value)
    && Object.keys(value).length === 2
    && Object.hasOwn(value, 'draftId')
    && Object.hasOwn(value, 'draftToken')
    && typeof value.draftId === 'string'
    && DRAFT_ID.test(value.draftId)
    && typeof value.draftToken === 'string'
    && DRAFT_TOKEN.test(value.draftToken)
}

function apiErrorMessage(message, status) {
  const known = {
    'This draft is locked': 'Dieser Entwurf ist gesperrt und kann nicht mehr geändert werden.',
    'This builder is currently not available': 'Der Business-Builder ist momentan nicht zum Speichern verfügbar.',
    'This builder is not available for saving and purchase yet': 'Der Business-Builder ist momentan nicht zum Speichern verfügbar.',
    'Builder does not match the draft': 'Die gespeicherte Serverreferenz gehört nicht zum Business-Builder.',
    'Invalid image': 'Mindestens ein Bild ist ungültig. Bitte prüfe die Bildauswahl.',
    'Image is invalid or too large': 'Ein Bild ist ungültig oder größer als 1,5 MiB.',
    'Image data is invalid': 'Mindestens ein Bild enthält ungültige Bilddaten.',
    'Images exceed the draft size limit': 'Die Bilder überschreiten gemeinsam das Draft-Limit von 4 MiB.',
    'Draft content is too large': 'Die gesamten Formulardaten überschreiten das Draft-Limit von 4 MiB.',
    'Invalid business data': 'Einige Eingaben entsprechen nicht dem erwarteten Business-Datenformat.',
    'Invalid design colors': 'Die Designfarben müssen gültige Hex-Farben sein.',
    'Invalid design options': 'Bitte wähle gültige Designoptionen aus.',
    'Invalid email address': 'Bitte gib eine gültige E-Mail-Adresse ein.',
    'Invalid URL': 'Instagram muss eine gültige HTTP- oder HTTPS-Adresse ohne Zugangsdaten sein.',
    'Business company name is required': 'Bitte gib vor dem Kauf den Firmennamen ein.',
    'Business contact email is required': 'Bitte gib vor dem Kauf eine gültige E-Mail-Adresse ein.',
  }
  if (known[message]) return known[message]
  if (status === 401) return 'Der Zugriffstoken fehlt oder ist ungültig. Der gespeicherte Entwurf wurde nicht ersetzt.'
  if (status === 404) return 'Der Entwurf wurde nicht gefunden oder der Zugriff ist ungültig. Die gespeicherte Referenz bleibt erhalten.'
  if (status === 409) return 'Der Entwurf ist gesperrt oder derzeit nicht verfügbar. Deine lokalen Eingaben bleiben erhalten.'
  if (status === 413) return 'Die Anfrage ist größer als 4 MiB. Verkleinere oder entferne Bilder, bevor du erneut speicherst.'
  if (status === 422) return 'Einige Eingaben sind ungültig oder zu lang. Bitte prüfe die Hinweise im Formular.'
  if (status >= 500) return 'Der Speicherdienst ist momentan nicht verfügbar. Deine lokalen Eingaben bleiben erhalten.'
  return message || 'Die Anfrage konnte nicht abgeschlossen werden.'
}

async function requestJson(path, { method = 'GET', token, body } = {}) {
  let response
  try {
    response = await fetch(path, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new Error('Keine Verbindung zum Speicherdienst. Deine lokalen Eingaben bleiben erhalten; bitte prüfe deine Verbindung und versuche es erneut.')
  }

  let payload = null
  try {
    payload = await response.json()
  } catch {
    if (response.ok) throw new Error('Der Speicherdienst hat eine ungültige Antwort gesendet.')
  }
  if (!response.ok) {
    const error = new Error(apiErrorMessage(payload?.error, response.status))
    error.status = response.status
    throw error
  }
  if (!isObject(payload)) throw new Error('Der Speicherdienst hat eine ungültige Antwort gesendet.')
  return payload
}

function dataEqual(left, right) {
  return JSON.stringify(normalizeState(left)) === JSON.stringify(normalizeState(right))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function mergeSection(defaults, value) {
  const saved = isObject(value) ? value : {}
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      typeof saved[key] === 'string' ? saved[key] : fallback,
    ]),
  )
}

function normalizeState(value) {
  const saved = isObject(value) ? value : {}
  const data = {
    company: mergeSection(DEFAULT_DATA.company, saved.company),
    logo: isImageDataUrl(saved.logo, { logo: true }) ? saved.logo : '',
    hero: mergeSection(DEFAULT_DATA.hero, saved.hero),
    services: Array.isArray(saved.services)
      ? saved.services.filter(isObject).map((item) => ({
          icon: typeof item.icon === 'string' ? item.icon : '',
          title: typeof item.title === 'string' ? item.title : '',
          text: typeof item.text === 'string' ? item.text : '',
        }))
      : DEFAULT_DATA.services.map((item) => ({ ...item })),
    about: mergeSection(DEFAULT_DATA.about, saved.about),
    facts: Array.isArray(saved.facts)
      ? saved.facts.filter(isObject).map((item) => ({
          value: typeof item.value === 'string' ? item.value : '',
          label: typeof item.label === 'string' ? item.label : '',
        }))
      : [],
    gallery: Array.isArray(saved.gallery)
      ? saved.gallery.filter((image) => image && isImageDataUrl(image))
      : [],
    contact: mergeSection(DEFAULT_DATA.contact, saved.contact),
    design: mergeSection(DEFAULT_DATA.design, saved.design),
    legal: mergeSection(DEFAULT_DATA.legal, saved.legal),
    operator: mergeSection(DEFAULT_DATA.operator, saved.operator),
  }

  for (const path of ['hero.image', 'about.image']) {
    const [section, key] = path.split('.')
    if (!isImageDataUrl(data[section][key], { hero: section === 'hero' })) data[section][key] = ''
  }

  return data
}

function cloneDefaults() {
  return normalizeState(DEFAULT_DATA)
}

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { data: cloneDefaults(), exists: false, invalid: false, warning: '' }

    const parsed = JSON.parse(stored)
    if (!isBusinessDataStructure(parsed)) {
      return {
        data: cloneDefaults(),
        exists: true,
        invalid: true,
        warning: 'Der lokale Entwurf enthält ungültige oder unbekannte Daten. Er wurde nicht verändert. Bitte lade einen vorhandenen Serverstand oder setze den lokalen Entwurf ausdrücklich zurück.',
      }
    }

    return { data: normalizeState(parsed), exists: true, invalid: false, warning: '' }
  } catch {
    return {
      data: cloneDefaults(),
      exists: false,
      invalid: true,
      warning: 'Gespeicherte Eingaben konnten nicht geladen werden. Der Builder startet mit leeren Daten.',
    }
  }
}

function loadGsap() {
  if (window.gsap) return Promise.resolve(window.gsap)
  if (window.businessGsapPromise) return window.businessGsapPromise

  window.businessGsapPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js'
    script.async = true
    script.onload = () => resolve(window.gsap)
    script.onerror = () => reject(new Error('Die Builder-Animationen konnten nicht geladen werden.'))
    document.head.append(script)
  })

  return window.businessGsapPromise
}

function draftRequestBytes(data) {
  return new TextEncoder().encode(JSON.stringify({ builder: 'business', data })).byteLength
}

function imageEntries(data) {
  return [
    ['Logo', data.logo],
    ['Titelbild', data.hero.image],
    ['Über-uns-Bild', data.about.image],
    ...data.gallery.map((image, index) => [`Galeriebild ${index + 1}`, image]),
  ]
}

function withImage(data, path, value) {
  if (path === 'logo') return { ...data, logo: value }
  if (path.startsWith('gallery.')) {
    const gallery = [...data.gallery]
    gallery[Number(path.slice('gallery.'.length))] = value
    return { ...data, gallery }
  }
  const [section, key] = path.split('.')
  return { ...data, [section]: { ...data[section], [key]: value } }
}

function isValidEmail(value) {
  return !value || /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(value)
}

function isValidUrl(value) {
  if (!value) return true
  if (/[\u0000-\u0020\u007f]/.test(value)) return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

function validationWarnings(data) {
  const warnings = []
  if (data.gallery.length > MAX_GALLERY) {
    warnings.push(`Dieser lokale Entwurf enthält ${data.gallery.length} Galeriebilder. Vor der Serverspeicherung bitte auf höchstens ${MAX_GALLERY} reduzieren; Bilder lassen sich unten einzeln entfernen.`)
  }
  if (data.services.length > MAX_SERVICES) warnings.push(`Es sind höchstens ${MAX_SERVICES} Leistungen erlaubt.`)
  if (data.facts.length > MAX_FACTS) warnings.push(`Es sind höchstens ${MAX_FACTS} Fakten erlaubt.`)

  for (const [section, entries] of Object.entries({
    company: data.company,
    hero: data.hero,
    about: data.about,
    contact: data.contact,
    legal: data.legal,
    operator: data.operator,
  })) {
    for (const [field, value] of Object.entries(entries)) {
      if (field === 'image') continue
      const path = `${section}.${field}`
      const max = FIELD_LIMITS[path]
      if (typeof value === 'string' && max && value.length > max) {
        warnings.push(`${path}: maximal ${max} Zeichen.`)
      }
      if (typeof value === 'string' && INVALID_CONTROL_CHARACTERS.test(value)) {
        warnings.push(`${path}: enthält nicht erlaubte Steuerzeichen.`)
      }
    }
  }
  for (const [group, items] of [['services', data.services], ['facts', data.facts]]) {
    items.forEach((item, index) => {
      for (const [field, value] of Object.entries(item)) {
        const path = `${group}.${field}`
        const max = FIELD_LIMITS[path]
        if (typeof value === 'string' && max && value.length > max) {
          warnings.push(`${group} ${index + 1}, ${field}: maximal ${max} Zeichen.`)
        }
        if (typeof value === 'string' && INVALID_CONTROL_CHARACTERS.test(value)) {
          warnings.push(`${group} ${index + 1}, ${field}: enthält nicht erlaubte Steuerzeichen.`)
        }
      }
    })
  }

  if (!isValidEmail(data.contact.email)) warnings.push('Bitte eine gültige E-Mail-Adresse eingeben.')
  if (!isValidUrl(data.contact.instagram)) warnings.push('Instagram muss eine gültige HTTP- oder HTTPS-Adresse ohne Zugangsdaten sein.')
  if (!/^#[0-9a-f]{6}$/i.test(data.design.accent) || !/^#[0-9a-f]{6}$/i.test(data.design.accent2)) {
    warnings.push('Die Designfarben müssen gültige Hex-Farben sein.')
  }
  if (!['dark', 'light'].includes(data.design.mode)) warnings.push('Bitte Dunkel- oder Hellmodus auswählen.')
  if (!['4', '16', '28'].includes(data.design.radius)) warnings.push('Bitte eine der vorhandenen Rundungsoptionen auswählen.')

  for (const [label, image] of imageEntries(data)) {
    const bytes = imageByteLength(image, { logo: label === 'Logo', hero: label === 'Titelbild' })
    if (image && bytes === null) warnings.push(`${label}: ungültiges Bildformat.`)
    else if (bytes > MAX_IMAGE_BYTES) warnings.push(`${label}: maximal 1,5 MiB Bildgröße.`)
  }
  if (draftRequestBytes(data) > MAX_DRAFT_REQUEST_BYTES) {
    warnings.push('Die gesamten Formulardaten überschreiten das spätere Draft-Request-Limit von 4 MiB.')
  }
  return warnings
}

export function renderBusinessBuilder(app) {
  document.title = 'Business Website erstellen – LeanWebsite'
  app.classList.remove('app-builder')
  app.classList.add('business-builder')
  app.innerHTML = `
    <div class="business-page">
      <div class="bg-orbs" aria-hidden="true"><i></i><i></i><i></i></div>
      <header class="topbar">
        <a class="brand" href="/" aria-label="LeanWebsite Startseite">
          <span class="brand-dot" aria-hidden="true"></span>
          <span>LeanWebsite Studio <small>Business-Builder</small></span>
        </a>
        <div class="topbar-actions">
          <span class="draft-status" id="draft-status" role="status" aria-live="polite" data-state="pending">Nicht gespeichert</span>
          <button class="btn ghost" id="draft-save" type="button">Serverentwurf speichern</button>
          <button class="btn ghost" id="draft-retry" type="button" hidden>Erneut laden</button>
          <button class="btn ghost" id="draft-restart" type="button" hidden>Serverentwurf neu starten</button>
          <button class="btn ghost" id="btn-reset" type="button">Zurücksetzen</button>
        </div>
      </header>

      <div class="mobile-view-switch" role="group" aria-label="Ansicht wählen">
        <button type="button" data-view="edit" aria-pressed="true" aria-controls="business-editor">Bearbeiten</button>
        <button type="button" data-view="preview" aria-pressed="false" aria-controls="business-preview">Vorschau</button>
      </div>
      <main class="layout" data-view="edit">
        <section id="business-editor" class="panel" aria-label="Business-Website bearbeiten">
          <div class="progress"><div class="progress-bar" id="progress-bar"></div></div>
          <nav class="steps" id="steps" aria-label="Schritte"></nav>

          <div class="step-wrap" id="step-wrap">
            <div class="step on" data-step="Firma">
              <h2>Wer seid ihr?</h2>
              <p class="hint">Name, Slogan und Logo – das Gesicht eurer Website.</p>
              <label>Firmenname *<input data-bind="company.name" maxlength="100" placeholder="z. B. Müller Fahrradwerkstatt"></label>
              <label>Slogan<input data-bind="company.tagline" maxlength="180" placeholder="z. B. Dein Bike. Unsere Leidenschaft."></label>
              <label>Branche<input data-bind="company.industry" maxlength="120" placeholder="z. B. Fahrrad-Service"></label>
              <div class="image-field">
                <label for="business-logo">Logo (optional)</label>
                <div class="drop" data-img="logo" data-max="500">
                  <span data-drop-label>Bild hierher ziehen oder klicken</span><input id="business-logo" type="file" accept="image/*" aria-label="Logo auswählen oder hier ablegen" aria-describedby="business-logo-status">
                </div>
                <p class="image-status" id="business-logo-status" role="status" aria-live="polite"></p>
              </div>
            </div>

            <div class="step" data-step="Start">
              <h2>Der erste Eindruck</h2>
              <p class="hint">Das sehen Besucher zuerst. Kurz und kraftvoll.</p>
              <label>Überschrift<input data-bind="hero.headline" maxlength="180" placeholder="Wir bringen dein Business nach vorn."></label>
              <label>Unterzeile<textarea rows="3" maxlength="3000" data-bind="hero.sub" placeholder="Ein bis zwei Sätze, was ihr macht und für wen."></textarea></label>
              <div class="row">
                <label>Button-Text<input data-bind="hero.cta" maxlength="100" placeholder="Jetzt anfragen"></label>
                <label>Badge (optional)<input data-bind="hero.badge" maxlength="120" placeholder="Seit 2009 in Berlin"></label>
              </div>
              <div class="image-field">
                <label for="business-hero-image">Titelbild</label>
                <div class="drop" data-img="hero.image" data-max="1800">
                  <span data-drop-label>Bild hierher ziehen oder klicken</span><input id="business-hero-image" type="file" accept="image/*" aria-label="Titelbild auswählen oder hier ablegen" aria-describedby="business-hero-image-status">
                </div>
                <p class="image-status" id="business-hero-image-status" role="status" aria-live="polite"></p>
                <details class="hero-image-help">
                  <summary>Tipps für dein Titelbild</summary>
                  <div>
                    <p>Verwende möglichst ein hochauflösendes Querformat, beispielsweise 1920 × 1080 Pixel. Platziere wichtige Motive möglichst mittig und lasse ausreichend Abstand zu den Bildrändern.</p>
                    <p>Je nach Bildschirmgröße kann sich der sichtbare Bildausschnitt verändern.</p>
                    <p>Tipp: Verkleinere dein Browserfenster am Computer, um unterschiedliche Bildschirmbreiten zu prüfen. Alternativ kannst du die Darstellung auf deinem Smartphone kontrollieren.</p>
                    <p>Bearbeite und bestelle deine Website möglichst auf demselben Gerät, damit dein gespeicherter Entwurf eindeutig zugeordnet bleibt.</p>
                  </div>
                </details>
              </div>
            </div>

            <div class="step" data-step="Leistungen">
              <h2>Was bietet ihr an?</h2>
              <p class="hint">Bis zu 8 Leistungen. Ein Emoji dient als Icon.</p>
              <div id="list-services" class="list"></div>
              <button class="btn ghost add" type="button" data-add="services">＋ Leistung hinzufügen</button>
            </div>

            <div class="step" data-step="Über uns">
              <h2>Über euch</h2>
              <p class="hint">Erzählt eure Geschichte und nennt ein paar Zahlen.</p>
              <label>Titel<input data-bind="about.title" maxlength="120" placeholder="Handwerk mit Herz"></label>
              <label>Text<textarea rows="5" maxlength="5000" data-bind="about.text" placeholder="Wer seid ihr, wofür steht ihr?"></textarea></label>
              <div class="image-field">
                <label for="business-about-image">Bild</label>
                <div class="drop" data-img="about.image" data-max="1400">
                  <span data-drop-label>Bild hierher ziehen oder klicken</span><input id="business-about-image" type="file" accept="image/*" aria-label="Über-uns-Bild auswählen oder hier ablegen" aria-describedby="business-about-image-status">
                </div>
                <p class="image-status" id="business-about-image-status" role="status" aria-live="polite"></p>
              </div>
              <h3>Zahlen &amp; Fakten</h3>
              <div id="list-facts" class="list"></div>
              <button class="btn ghost add" type="button" data-add="facts">＋ Zahl hinzufügen</button>
            </div>

            <div class="step" data-step="Galerie">
              <h2>Bilder</h2>
              <p class="hint">Projekte, Team, Produkte – bis zu 3 Bilder. Sie werden automatisch verkleinert.</p>
              <p class="gallery-warning" id="gallery-warning" role="status" hidden></p>
              <div class="drop big" id="gallery-drop" tabindex="0" role="button" aria-label="Mehrere Galeriebilder auswählen oder hier ablegen">
                <span>Mehrere Bilder hierher ziehen oder klicken</span><input type="file" accept="image/*" multiple hidden>
              </div>
              <div id="gallery-grid" class="gallery-grid"></div>
            </div>

            <div class="step" data-step="Kontakt">
              <h2>Wie erreicht man euch?</h2>
              <label>E-Mail *<input type="text" inputmode="email" data-bind="contact.email" maxlength="254" data-format="email" placeholder="hallo@firma.de"></label>
              <div class="row">
                <label>Telefon<input data-bind="contact.phone" maxlength="80" placeholder="+49 30 1234567"></label>
                <label>Instagram (optional)<input type="text" inputmode="url" data-bind="contact.instagram" maxlength="2048" data-format="url" placeholder="https://instagram.com/…"></label>
              </div>
              <label>Adresse<textarea rows="2" maxlength="1000" data-bind="contact.address" placeholder="Musterstraße 1&#10;10115 Berlin"></textarea></label>
              <label>Öffnungszeiten<textarea rows="3" maxlength="2000" data-bind="contact.hours" placeholder="Mo–Fr 9–18 Uhr&#10;Sa 10–14 Uhr"></textarea></label>
            </div>

            <div class="step" data-step="Design">
              <h2>Look &amp; Feel</h2>
              <p class="hint">Wähle Farben und Stil. Alles lässt sich später ändern.</p>
              <div class="swatches" id="swatches"></div>
              <div class="row">
                <label>Hauptfarbe<input type="color" data-bind="design.accent"></label>
                <label>Zweitfarbe<input type="color" data-bind="design.accent2"></label>
              </div>
              <div class="row">
                <label>Modus
                  <select data-bind="design.mode"><option value="dark">Dunkel</option><option value="light">Hell</option></select>
                </label>
                <label>Ecken
                  <select data-bind="design.radius"><option value="4">Eckig</option><option value="16">Weich</option><option value="28">Sehr rund</option></select>
                </label>
              </div>
            </div>

            <div class="step" data-step="Fertig">
              <h2>Fast geschafft</h2>
              <p class="hint">Für das Impressum (Pflicht in Deutschland).</p>
              <label>Inhaber / Geschäftsführung<input data-bind="legal.owner" maxlength="200" placeholder="Max Mustermann"></label>
              <label>USt-IdNr. (falls vorhanden)<input data-bind="legal.vat" maxlength="32" placeholder="DE123456789"></label>
              <label>Eure Domain (bleibt bestehen)<input data-bind="legal.domain" maxlength="253" placeholder="www.eure-firma.de"></label>
              <label>Wünsche &amp; Anmerkungen für mich<textarea rows="3" maxlength="5000" data-bind="legal.notes" placeholder="Z. B. Newsletter, Shop, Mehrsprachigkeit …"></textarea></label>
              <section id="business-operator" aria-labelledby="business-operator-title">
                <h3 id="business-operator-title">Impressum &amp; Datenschutz</h3>
                <p class="hint">Angaben zum rechtlich verantwortlichen Betreiber deiner Website, unabhängig von Rechnungsadresse und Domaininhaber.</p>
                <label>Betreiberform<select data-bind="operator.operatorType"><option value="person">Einzelperson</option><option value="gbr">GbR</option><option value="association">Verein</option><option value="company">Unternehmen</option></select></label>
                <label>Name des rechtlich verantwortlichen Betreibers<input data-bind="operator.operatorName"></label>
                <label data-operator-company>Rechtsform<input data-bind="operator.legalForm" placeholder="z. B. UG oder GmbH"></label>
                <label data-operator-representative>Vertretungsberechtigte Personen<input data-bind="operator.representative" placeholder="Namen der vertretungsberechtigten Personen"></label>
                <p class="hint">Diese Anschrift wird öffentlich im Impressum deiner Website angezeigt. Verwende eine geeignete, ladungsfähige Anschrift.</p>
                <label>Straße und Hausnummer<input data-bind="operator.street"></label>
                <div class="row"><label>Postleitzahl<input data-bind="operator.postalCode"></label><label>Ort<input data-bind="operator.city"></label></div>
                <label>Land<input data-bind="operator.country"></label>
                <label>Öffentliche E-Mail-Adresse<input data-bind="operator.email" type="text" inputmode="email"></label>
                <label>Telefonnummer (optional)<input data-bind="operator.phone"></label>
                <label>Registereintragung vorhanden<select data-bind="operator.registered"><option value="false">Nein</option><option value="true">Ja</option></select></label>
                <div data-operator-register>
                  <label>Registergericht<input data-bind="operator.registerCourt"></label>
                  <label>Registernummer<input data-bind="operator.registerNumber"></label>
                </div>
                <label>Umsatzsteuer-ID (falls vorhanden)<input data-bind="operator.vatId"></label>
                <label>Journalistisch-redaktionelle Inhalte<select data-bind="operator.editorial"><option value="false">Nein</option><option value="true">Ja</option></select></label>
                <div data-operator-editorial>
                  <label>Name der verantwortlichen Person<input data-bind="operator.editorialName"></label>
                  <label>Anschrift der verantwortlichen Person<input data-bind="operator.editorialAddress"></label>
                </div>
                <label data-operator-code>Hostinganbieter<select data-bind="operator.hostingProvider"><option value="">Noch nicht entschieden</option><option>Hostinger</option><option>IONOS</option><option>STRATO</option><option value="other">Anderer Anbieter</option></select></label>
                <label data-operator-hosting-other>Anderer Hostinganbieter<input data-bind="operator.hostingOther"></label>
                <label data-operator-code>Domainanbieter<select data-bind="operator.domainProvider"><option value="">Noch nicht entschieden</option><option>Hostinger</option><option>IONOS</option><option>STRATO</option><option value="other">Anderer Anbieter</option></select></label>
                <label data-operator-domain-other>Anderer Domainanbieter<input data-bind="operator.domainOther"></label>
                <p data-operator-managed class="hint">Bei Rundum Sorglos ist Hostinger als Anbieter vorgesehen.</p>
                <label class="business-operator-confirm"><input type="checkbox" data-bind="operator.confirmPublic"><span>Ich bestätige, dass die Betreiberangaben korrekt sind und öffentlich auf meiner Website angezeigt werden dürfen.</span></label>
                <label class="business-operator-confirm"><input type="checkbox" data-bind="operator.confirmReviewed"><span>Ich habe Impressum und Datenschutzerklärung geprüft und werde die Angaben bei Bedarf vor der Veröffentlichung anpassen.</span></label>
                <p class="hint">Prüfe Impressum und Datenschutzerklärung über die Links in der Live-Vorschau.</p>
              </section>
              <div class="finish">
                <p class="hint">Deine Eingaben bleiben lokal gesichert. Mit „Serverentwurf speichern“ werden sie online gespeichert; weitere Änderungen werden danach automatisch übernommen.</p>
              </div>
              <section class="business-purchase" aria-labelledby="business-purchase-title">
                <h3 id="business-purchase-title">Deine Website kaufen</h3>
                <p class="hint">Wähle ein Paket. Für den Checkout werden Firmenname (bei Unternehmen) und eine Kontakt-E-Mail im Website-Entwurf benötigt.</p>
                <div class="package-options" id="business-packages" role="radiogroup" aria-label="Website-Paket"></div>
                <aside class="package-changes-note">
                  <h4>${POST_PURCHASE_CHANGES_TITLE}</h4>
                  <p>${POST_PURCHASE_CHANGES_TEXT}</p>
                </aside>
                <p class="business-tax-note">${CHECKOUT_TAX_NOTICE}</p>
                <form id="business-fulfillment" class="business-fulfillment" hidden novalidate>
                  <fieldset id="business-fulfillment-fields" disabled>
                    <legend>Auftragsangaben für Rundum sorglos</legend>
                    <p class="hint">Diese Angaben werden getrennt von deinen Website-Inhalten nur für Hosting und Domainregistrierung verwendet. Die bestehende Domain aus dem Website-Entwurf wird nicht übernommen.</p>
                    <label>Auftraggebertyp *
                      <select name="customerType" required>
                        <option value="company">Unternehmen</option>
                        <option value="self_employed">Selbstständige Person</option>
                      </select>
                    </label>
                    <label id="business-company-name-field">Firmenname / Geschäftsbezeichnung *
                      <input name="companyName" maxlength="200" autocomplete="organization" required>
                    </label>
                    <div class="row">
                      <label>Vorname *
                        <input name="firstName" maxlength="100" autocomplete="given-name" required>
                      </label>
                      <label>Nachname *
                        <input name="lastName" maxlength="100" autocomplete="family-name" required>
                      </label>
                    </div>
                    <label>Straße und Hausnummer *
                      <input name="billingStreet" maxlength="200" autocomplete="street-address" required>
                    </label>
                    <div class="row">
                      <label>Postleitzahl *
                        <input name="billingPostalCode" maxlength="20" autocomplete="postal-code" required>
                      </label>
                      <label>Ort *
                        <input name="billingCity" maxlength="100" autocomplete="address-level2" required>
                      </label>
                    </div>
                    <div class="row">
                      <label>Land (Ländercode) *
                        <input name="billingCountryCode" maxlength="2" placeholder="DE" autocomplete="country" required>
                      </label>
                      <label>E-Mail für die Auftragskommunikation *
                        <input name="communicationEmail" type="email" maxlength="254" autocomplete="email" required>
                      </label>
                    </div>
                    <div class="row">
                      <label>Gewünschte neue .de-Domain *
                        <input name="desiredDomain" maxlength="253" placeholder="dein-unternehmen.de" autocapitalize="none" spellcheck="false" required>
                      </label>
                      <label>Alternative .de-Domain (optional)
                        <input name="alternativeDomain" maxlength="253" placeholder="dein-unternehmen-2.de" autocapitalize="none" spellcheck="false">
                      </label>
                    </div>
                    <label>Domaininhaber *
                      <select name="domainHolderDiffers" required>
                        <option value="false">Der Domaininhaber entspricht dem Auftraggeber.</option>
                        <option value="true">Der Domaininhaber ist abweichend.</option>
                      </select>
                    </label>
                    <div id="business-domain-holder-fields" hidden>
                      <label>Art des abweichenden Domaininhabers *
                        <select name="domainHolderType">
                          <option value="person">Person</option>
                          <option value="organization">Organisation</option>
                        </select>
                      </label>
                      <label id="business-holder-organization-field" hidden>Name der Organisation *
                        <input name="domainHolderOrganizationName" maxlength="200" autocomplete="off">
                      </label>
                      <div id="business-holder-person-fields" class="row">
                        <label>Vorname des Domaininhabers *
                          <input name="domainHolderFirstName" maxlength="100" autocomplete="off">
                        </label>
                        <label>Nachname des Domaininhabers *
                          <input name="domainHolderLastName" maxlength="100" autocomplete="off">
                        </label>
                      </div>
                      <label>Straße und Hausnummer des Domaininhabers *
                        <input name="domainHolderStreet" maxlength="200" autocomplete="off">
                      </label>
                      <div class="row">
                        <label>Postleitzahl des Domaininhabers *
                          <input name="domainHolderPostalCode" maxlength="20" autocomplete="off">
                        </label>
                        <label>Ort des Domaininhabers *
                          <input name="domainHolderCity" maxlength="100" autocomplete="off">
                        </label>
                      </div>
                      <div class="row">
                        <label>Land (Ländercode) *
                          <input name="domainHolderCountryCode" maxlength="2" placeholder="DE" autocomplete="off">
                        </label>
                        <label>E-Mail-Adresse des Domaininhabers *
                          <input name="domainHolderEmail" type="email" maxlength="254" autocomplete="off">
                        </label>
                      </div>
                    </div>
                    <section class="business-hostinger-consent" aria-labelledby="business-hostinger-title">
                      <h4 id="business-hostinger-title">Hosting und Domain – Rundum Sorglos</h4>
                      <p id="business-hostinger-copy"></p>
                      <label class="business-consent-check">
                        <input name="hostingerConsent" type="checkbox" required>
                        <span>${HOSTINGER_CONSENT_TEXT}</span>
                      </label>
                    </section>
                  </fieldset>
                </form>
                <section id="business-checkout-review" class="business-checkout-review" aria-labelledby="business-checkout-review-title" hidden>
                  <h4 id="business-checkout-review-title">Bestellung prüfen</h4>
                  <div id="business-checkout-review-content"></div>
                  <div class="business-checkout-review-actions">
                    <button class="btn" id="business-review-edit" type="button">Zurück zur Auswahl</button>
                    <button class="btn primary" id="business-review-confirm" type="button">Weiter zum zahlungspflichtigen Checkout</button>
                  </div>
                </section>
                <button class="btn primary big" id="business-checkout" type="button">Bestellung prüfen <span aria-hidden="true">→</span></button>
                <p class="checkout-status" id="business-checkout-status" role="status" aria-live="polite"></p>
              </section>
            </div>
          </div>

          <div class="step-nav">
            <button class="btn ghost" id="prev" type="button">← Zurück</button>
            <span id="step-count"></span>
            <button class="btn primary" id="next" type="button">Weiter →</button>
          </div>
          <nav class="business-privacy-links" aria-label="Rechtliche Informationen">
            <a href="/datenschutz">Datenschutzerklärung</a>
            <a href="/widerruf">Widerruf</a>
            <a href="https://matthiasbrehm.de/impressum" target="_blank" rel="noopener noreferrer">Impressum</a>
            <a href="https://github.com/dubposse/leanwebsite/blob/main/LICENSING.md" target="_blank" rel="noopener noreferrer">Lizenz</a>
          </nav>
          <div class="validation-warning" id="validation-warning" role="status" aria-live="polite" hidden></div>
          <div class="draft-conflict" id="draft-conflict" hidden>
            <p id="draft-conflict-message"></p>
            <div class="draft-conflict-actions">
              <button class="btn ghost" id="use-local-draft" type="button">Lokalen Stand verwenden</button>
              <button class="btn ghost" id="use-server-draft" type="button">Serverstand laden</button>
              <button class="btn ghost" id="discard-invalid-local" type="button" hidden>Ungültige lokale Daten verwerfen</button>
            </div>
          </div>
        </section>

        <section id="business-preview" class="preview" aria-label="Live-Vorschau deiner Website">
          <div class="preview-bar">
            <span>Live-Vorschau</span>
            <div class="seg" id="device" aria-label="Vorschaugröße">
              <button type="button" data-w="100%" class="on" aria-pressed="true">Desktop</button>
              <button type="button" data-w="390px" aria-pressed="false">Mobil</button>
            </div>
          </div>
          <div class="frame-wrap"><iframe id="preview" title="Vorschau" sandbox="allow-scripts allow-popups"></iframe></div>
        </section>
      </main>
      <div class="toast" id="toast" role="status" aria-live="polite"></div>
    </div>
  `

  const $ = (selector, root = app) => root.querySelector(selector)
  const $$ = (selector, root = app) => [...root.querySelectorAll(selector)]
  const localState = loadState()
  const state = localState.data
  const frame = $('#preview')
  const stepElements = $$('.step')
  const stepsNav = $('#steps')
  const validationWarning = $('#validation-warning')
  const galleryWarning = $('#gallery-warning')
  const draftStatus = $('#draft-status')
  const saveButton = $('#draft-save')
  const retryButton = $('#draft-retry')
  const restartButton = $('#draft-restart')
  const conflict = $('#draft-conflict')
  const conflictMessage = $('#draft-conflict-message')
  const useLocalButton = $('#use-local-draft')
  const useServerButton = $('#use-server-draft')
  const discardInvalidLocalButton = $('#discard-invalid-local')
  const packageBox = $('#business-packages')
  const fulfillmentForm = $('#business-fulfillment')
  const fulfillmentFields = $('#business-fulfillment-fields')
  const checkoutButton = $('#business-checkout')
  const checkoutReview = $('#business-checkout-review')
  const checkoutReviewContent = $('#business-checkout-review-content')
  const reviewEditButton = $('#business-review-edit')
  const reviewConfirmButton = $('#business-review-confirm')
  const checkoutStatus = $('#business-checkout-status')
  const packages = getPackagesForBuilder('business')
  $('#business-hostinger-copy').textContent = HOSTING_DOMAIN_DETAILS
  let localDataExists = localState.exists
  let localDataInvalid = localState.invalid
  let preserveLocalRaw = localState.invalid
  let draft = null
  let serverDraftData = null
  let serverStatus = ''
  let draftReconciled = false
  let referenceError = false
  let revision = 0
  let savedRevision = -1
  let savePromise = null
  let currentStep = 0
  let previewTimer
  let toastTimer
  let autoSaveTimer
  let checkoutPending = false
  let editorDisabled = false
  let operatorValidationStarted = false
  const imageTasks = new Set()
  let storageWarningShown = false
  let preservedDataWarningShown = false

  setupBusinessMobileView($('.layout'), $('.mobile-view-switch'), () => {
    frame.getBoundingClientRect()
    renderPreview()
  })

  function toast(message) {
    const element = $('#toast')
    element.textContent = message
    element.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => element.classList.remove('show'), 3200)
  }

  function setSaveStatus(message, kind = 'pending') {
    draftStatus.textContent = message
    draftStatus.dataset.state = kind
  }

  function setEditorDisabled(disabled) {
    editorDisabled = disabled
    $$('.step-wrap input, .step-wrap textarea, .step-wrap select, .step-wrap button, #gallery-drop').forEach((element) => {
      element.disabled = disabled || element.dataset.imageProcessing === 'true'
    })
    updateFulfillmentVisibility()
    saveButton.disabled = disabled || referenceError || !draftReconciled || serverStatus === 'locked'
  }

  function save() {
    if (preserveLocalRaw) {
      if (!preservedDataWarningShown) {
        preservedDataWarningShown = true
        toast('Der ursprüngliche lokale Datensatz bleibt unverändert erhalten. Änderungen am geladenen Serverstand werden serverseitig gespeichert.')
      }
      return false
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      localDataExists = true
      return true
    } catch {
      if (!storageWarningShown) {
        storageWarningShown = true
        toast('Der Browserspeicher ist voll. Änderungen sind nicht dauerhaft gesichert.')
      }
      return false
    }
  }

  function showConflict(message, { allowLocal = true, allowServer = true, allowDiscard = false } = {}) {
    conflictMessage.textContent = message
    useLocalButton.hidden = !allowLocal
    useServerButton.hidden = !allowServer
    discardInvalidLocalButton.hidden = !allowDiscard
    conflict.hidden = false
    setEditorDisabled(true)
  }

  function hideConflict() {
    conflict.hidden = true
  }

  function updateSaveControls() {
    saveButton.disabled = Boolean(savePromise) || referenceError || !draftReconciled || serverStatus === 'locked' || localDataInvalid
    checkoutButton.disabled = checkoutPending || referenceError || !draftReconciled || serverStatus === 'locked' || localDataInvalid
    packageBox.querySelectorAll('input').forEach((input) => {
      input.disabled = checkoutPending || referenceError || !draftReconciled || serverStatus === 'locked' || localDataInvalid
    })
    updateFulfillmentVisibility()
    retryButton.hidden = !referenceError
    restartButton.hidden = !referenceError && serverStatus !== 'locked'
    if (!draft) saveButton.textContent = 'Serverentwurf speichern'
    else saveButton.textContent = serverStatus === 'locked' ? 'Entwurf gesperrt' : 'Jetzt speichern'
  }

  function setCheckoutStatus(message, kind = '') {
    checkoutStatus.textContent = message
    checkoutStatus.dataset.state = kind
    delete checkoutStatus.dataset.source
  }

  function selectedPackageCode() {
    return packageBox.querySelector('input[name="business-package"]:checked')?.value
  }

  function updateFulfillmentVisibility() {
    const visible = selectedPackageCode() === BUSINESS_FULFILLMENT_PACKAGE_CODE
    fulfillmentForm.hidden = !visible
    fulfillmentFields.disabled = !visible || checkoutPending || referenceError || !draftReconciled || serverStatus === 'locked' || localDataInvalid
    updateOperatorVisibility()
  }

  function updateOperatorVisibility(revalidate = false) {
    const operator = state.operator
    const code = selectedPackageCode() === 'business-pure-code'
    for (const [selector, visible] of [
      ['[data-operator-company]', operator.operatorType === 'company'],
      ['[data-operator-representative]', operator.operatorType !== 'person'],
      ['[data-operator-register]', operator.registered === 'true'],
      ['[data-operator-editorial]', operator.editorial === 'true'],
      ['[data-operator-code]', code],
      ['[data-operator-hosting-other]', code && operator.hostingProvider === 'other'],
      ['[data-operator-domain-other]', code && operator.domainProvider === 'other'],
      ['[data-operator-managed]', !code],
    ]) $$(selector, $('#business-operator')).forEach((element) => { element.hidden = !visible })
    if (operatorValidationStarted && revalidate) showOperatorErrors(false)
  }

  function showOperatorErrors(focus) {
    const errors = businessOperatorErrors(state.operator, selectedPackageCode())
    const names = new Set(errors.map((error) => error.field))
    for (const field of $$('[data-bind^="operator."]', $('#business-operator'))) {
      field.setAttribute('aria-invalid', String(names.has(field.dataset.bind.slice('operator.'.length))))
    }
    if (errors.length) {
      setCheckoutStatus(errors[0].message, 'error')
      checkoutStatus.dataset.source = 'operator'
      if (focus) {
        const field = $(`[data-bind="operator.${errors[0].field}"]`)
        const stepIndex = stepElements.indexOf(field.closest('.step'))
        if (stepIndex >= 0 && stepIndex !== currentStep) go(stepIndex)
        field.scrollIntoView({ behavior: 'smooth', block: 'center' })
        field.focus({ preventScroll: true })
      }
    } else if (operatorValidationStarted && checkoutStatus.dataset.state === 'error'
      && checkoutStatus.dataset.source === 'operator') {
      setCheckoutStatus('')
    }
    return errors.length === 0
  }

  function clearFulfillmentErrors() {
    fulfillmentForm.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.removeAttribute('aria-invalid'))
    if (checkoutStatus.dataset.state === 'error') setCheckoutStatus('')
  }

  function showFulfillmentErrors(errors, { focus = true } = {}) {
    clearFulfillmentErrors()
    if (errors.length === 0) return

    let firstErrorField = null
    for (const error of errors) {
      const field = fulfillmentForm.elements[error.field]
      if (field) {
        field.setAttribute('aria-invalid', 'true')
        if (!firstErrorField) firstErrorField = field
      }
    }

    const firstError = errors[0]
    setCheckoutStatus(firstError.message, 'error')

    if (focus && firstErrorField) {
      firstErrorField.focus()
      firstErrorField.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  function showFulfillmentError(error, { focus = true } = {}) {
    showFulfillmentErrors([error], { focus })
  }

  function updateCustomerTypeFields({ clear = true } = {}) {
    const isCompany = fulfillmentForm.elements.customerType.value === 'company'
    const companyField = $('#business-company-name-field')
    const companyName = fulfillmentForm.elements.companyName
    companyField.hidden = !isCompany
    companyName.required = isCompany
    if (!isCompany && clear) companyName.value = ''
  }

  function updateDomainHolderFields({ clear = true } = {}) {
    const differs = fulfillmentForm.elements.domainHolderDiffers.value === 'true'
    const holderFields = $('#business-domain-holder-fields')
    const isOrganization = fulfillmentForm.elements.domainHolderType.value === 'organization'
    holderFields.hidden = !differs

    const organizationField = $('#business-holder-organization-field')
    const organizationName = fulfillmentForm.elements.domainHolderOrganizationName
    const personFields = $('#business-holder-person-fields')
    organizationField.hidden = !differs || !isOrganization
    personFields.hidden = !differs || isOrganization
    organizationName.required = differs && isOrganization
    for (const name of ['domainHolderFirstName', 'domainHolderLastName']) {
      fulfillmentForm.elements[name].required = differs && !isOrganization
    }
    for (const name of [
      'domainHolderStreet',
      'domainHolderPostalCode',
      'domainHolderCity',
      'domainHolderCountryCode',
      'domainHolderEmail',
    ]) {
      fulfillmentForm.elements[name].required = differs
    }

    if (clear && (!differs || isOrganization)) {
      fulfillmentForm.elements.domainHolderFirstName.value = ''
      fulfillmentForm.elements.domainHolderLastName.value = ''
    }
    if (clear && (!differs || !isOrganization)) organizationName.value = ''
    if (clear && !differs) {
      for (const name of [
        'domainHolderStreet',
        'domainHolderPostalCode',
        'domainHolderCity',
        'domainHolderCountryCode',
        'domainHolderEmail',
      ]) fulfillmentForm.elements[name].value = ''
    }
  }

  function resetFulfillmentForm() {
    resetBusinessFulfillment(fulfillmentForm)
    updateCustomerTypeFields({ clear: false })
    updateDomainHolderFields({ clear: false })
    packageBox.querySelectorAll('input').forEach((input, index) => {
      input.checked = index === 0
    })
    clearFulfillmentErrors()
    updateFulfillmentVisibility()
  }

  function trackImageTask(task) {
    const tracked = Promise.resolve(task).finally(() => imageTasks.delete(tracked))
    imageTasks.add(tracked)
    return tracked
  }

  function validatePurchase() {
    const name = state.company.name.trim()
    const email = state.contact.email.trim()
    if (!name) return { path: 'company.name', message: 'Bitte gib vor dem Kauf den Firmennamen ein.' }
    if (!email || !isValidEmail(state.contact.email)) {
      return { path: 'contact.email', message: 'Bitte gib vor dem Kauf eine gültige E-Mail-Adresse ein.' }
    }
    return null
  }

  function showPurchaseError({ path, message }) {
    if (path && fulfillmentForm.elements[path]) {
      showFulfillmentError({ field: path, message })
      return
    }
    const field = $(`[data-bind="${path}"]`)
    const step = field.closest('.step')
    const stepIndex = stepElements.indexOf(step)
    if (stepIndex >= 0) go(stepIndex)
    $('[data-bind="company.name"]').setAttribute('aria-invalid', String(!state.company.name.trim()))
    $('[data-bind="contact.email"]').setAttribute('aria-invalid', String(!state.contact.email.trim() || !isValidEmail(state.contact.email)))
    field.focus()
    setCheckoutStatus(message, 'error')
  }

  function clearPurchaseError(element) {
    if (!element.matches('[data-bind="company.name"], [data-bind="contact.email"]')) return
    const error = validatePurchase()
    $('[data-bind="company.name"]').setAttribute('aria-invalid', String(!state.company.name.trim()))
    $('[data-bind="contact.email"]').setAttribute('aria-invalid', String(!state.contact.email.trim() || !isValidEmail(state.contact.email)))
    if (error) {
      setCheckoutStatus(error.message, 'error')
    } else if (operatorValidationStarted) {
      showOperatorErrors(false)
    } else {
      setCheckoutStatus('')
    }
  }

  packageBox.innerHTML = packages.map((item, index) => `
    <label class="package-option">
      <input type="radio" name="business-package" value="${item.code}" ${index === 0 ? 'checked' : ''}>
      <span class="package-option-copy">
        <strong>${PACKAGE_COPY[item.code].title}</strong>
        <strong class="package-option-tagline">${PACKAGE_COPY[item.code].tagline}</strong>
        <span class="package-option-description">${PACKAGE_COPY[item.code].description}</span>
        ${PACKAGE_COPY[item.code].included ? `<span class="package-option-list-title">Enthalten</span><ul>${PACKAGE_COPY[item.code].included.map((feature) => `<li>${feature}</li>`).join('')}</ul><span class="package-option-list-title">Nicht enthalten</span><ul>${PACKAGE_COPY[item.code].excluded.map((feature) => `<li>${feature}</li>`).join('')}</ul>` : ''}
      </span>
      <strong class="package-option-price">${new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(item.amountCents / 100)}</strong>
    </label>
  `).join('')
  updateCustomerTypeFields({ clear: false })
  updateDomainHolderFields({ clear: false })
  updateFulfillmentVisibility()

  function persistDraftReference(reference) {
    try {
      localStorage.setItem(DRAFT_REFERENCE_KEY, JSON.stringify(reference))
      return true
    } catch {
      return false
    }
  }

  async function ensureDraft() {
    if (draft) return draft
    let existing
    try {
      existing = localStorage.getItem(DRAFT_REFERENCE_KEY)
      if (existing) throw new Error('Eine gespeicherte Serverreferenz muss zuerst geprüft werden.')
      localStorage.setItem(`${DRAFT_REFERENCE_KEY}-probe`, 'x'.repeat(256))
      localStorage.removeItem(`${DRAFT_REFERENCE_KEY}-probe`)
    } catch (error) {
      throw new Error(error.message === 'Eine gespeicherte Serverreferenz muss zuerst geprüft werden.'
        ? error.message
        : 'Der lokale Browserspeicher kann die Zugangsdaten nicht sichern. Deine Eingaben bleiben erhalten.')
    }

    const reference = await requestJson('/api/drafts', {
      method: 'POST',
      body: { builder: 'business' },
    })
    if (!isDraftReference(reference)) {
      throw new Error('Der Speicherdienst hat ungültige Entwurfs-Zugangsdaten zurückgegeben.')
    }
    if (!persistDraftReference(reference)) {
      referenceError = true
      updateSaveControls()
      throw new Error('Der Serverentwurf wurde angelegt, aber die Zugangsdaten konnten nicht lokal gespeichert werden. Deine Formulardaten bleiben erhalten; lade die Seite nicht neu und prüfe den Browserspeicher.')
    }
    draft = reference
    serverStatus = 'draft'
    serverDraftData = null
    draftReconciled = true
    updateSaveControls()
    return draft
  }

  async function saveLatest() {
    if (savePromise) return savePromise
    if (!draftReconciled || referenceError) {
      throw new Error('Bitte kläre zuerst, welcher Entwurfsstand verwendet werden soll.')
    }
    if (serverStatus === 'locked') {
      throw new Error('Dieser Entwurf ist gesperrt. Starte ausdrücklich einen neuen Serverentwurf, um Änderungen zu speichern.')
    }
    if (localDataInvalid) {
      throw new Error('Die ungültigen lokalen Daten wurden nicht verändert. Lade einen Serverstand oder verwirf die lokalen Daten ausdrücklich.')
    }

    const warnings = validationWarnings(state)
    if (warnings.length) {
      updateValidationWarnings()
      throw new Error(warnings[0])
    }

    saveButton.disabled = true
    setSaveStatus('Speichert …', 'saving')
    savePromise = (async () => {
      const reference = await ensureDraft()
      while (savedRevision < revision) {
        const saveRevision = revision
        const snapshot = JSON.parse(JSON.stringify(state))
        const result = await requestJson(`/api/drafts/${encodeURIComponent(reference.draftId)}`, {
          method: 'PUT',
          token: reference.draftToken,
          body: { builder: 'business', data: snapshot },
        })
        if (typeof result.updatedAt !== 'string' || Number.isNaN(Date.parse(result.updatedAt))) {
          throw new Error('Der Speicherdienst hat keine gültige Speicherbestätigung gesendet.')
        }
        savedRevision = saveRevision
      }
      if (savedRevision === revision) {
        setSaveStatus('Gespeichert', 'success')
      } else {
        setSaveStatus('Nicht gespeichert', 'pending')
      }
    })()

    try {
      await savePromise
    } catch (error) {
      if (error.status === 409) {
        serverStatus = 'locked'
        setEditorDisabled(false)
        restartButton.hidden = false
      } else if (error.status === 401 || error.status === 404) {
        referenceError = true
        draftReconciled = false
        showConflict(`${error.message} Deine lokalen Eingaben bleiben erhalten. Lade den Serverstand erneut oder beginne ausdrücklich einen neuen Serverentwurf.`, {
          allowLocal: false,
          allowServer: false,
        })
      }
      setSaveStatus('Speichern fehlgeschlagen', 'error')
      toast(error.message)
      throw error
    } finally {
      savePromise = null
      updateSaveControls()
    }
  }

  function renderState() {
    bindFields()
    SINGLE_IMAGE_PATHS.forEach((path) => renderSingle($(`[data-img="${path}"]`)))
    renderGallery()
    renderList('services')
    renderList('facts')
    updateValidationWarnings()
    renderPreview()
  }

  function useServerState() {
    const next = serverDraftData ? normalizeState(serverDraftData) : cloneDefaults()
    Object.assign(state, next)
    if (!preserveLocalRaw) {
      localDataExists = Boolean(serverDraftData)
      save()
    }
    localDataInvalid = false
    draftReconciled = true
    referenceError = false
    hideConflict()
    setEditorDisabled(false)
    revision = 0
    savedRevision = serverDraftData ? 0 : -1
    renderState()
    if (serverStatus === 'locked') {
      setSaveStatus('Serverentwurf gesperrt', 'error')
      toast('Dieser Entwurf ist gesperrt und kann nicht mehr geändert werden.')
    } else if (serverDraftData) {
      setSaveStatus('Gespeichert', 'success')
    } else {
      setSaveStatus('Nicht gespeichert', 'pending')
    }
    updateSaveControls()
  }

  async function useLocalState() {
    hideConflict()
    draftReconciled = true
    setEditorDisabled(false)
    revision += 1
    savedRevision = -1
    if (serverStatus === 'locked') {
      setSaveStatus('Serverentwurf gesperrt – Änderungen nur lokal', 'error')
      updateSaveControls()
      return
    }
    updateSaveControls()
    setSaveStatus('Nicht gespeichert', 'pending')
    try {
      await saveLatest()
    } catch {
      // saveLatest reports the failure and preserves the local state.
    }
  }

  async function restoreDraft() {
    let storedReference
    try {
      storedReference = localStorage.getItem(DRAFT_REFERENCE_KEY)
    } catch {
      referenceError = true
      setSaveStatus('Speichern fehlgeschlagen', 'error')
      showConflict('Der lokale Browserspeicher ist nicht verfügbar. Eine Serverreferenz kann nicht sicher gelesen werden. Deine Formulardaten bleiben erhalten.', {
        allowLocal: false,
        allowServer: false,
        allowDiscard: true,
      })
      updateSaveControls()
      return
    }

    if (!storedReference) {
      if (localDataInvalid) {
        referenceError = true
        setSaveStatus('Speichern fehlgeschlagen', 'error')
        showConflict(localState.warning, { allowLocal: false, allowServer: false, allowDiscard: true })
      } else {
        draftReconciled = true
        setEditorDisabled(false)
        setSaveStatus(localDataExists ? 'Nicht gespeichert' : 'Nicht gespeichert', 'pending')
      }
      updateSaveControls()
      return
    }

    let reference
    try {
      reference = JSON.parse(storedReference)
    } catch {
      reference = null
    }
    if (!isDraftReference(reference)) {
      referenceError = true
      setSaveStatus('Speichern fehlgeschlagen', 'error')
      showConflict('Die gespeicherte Serverreferenz ist ungültig. Sie wurde nicht ersetzt. Du kannst erneut prüfen oder ausdrücklich einen neuen Serverentwurf beginnen.', {
        allowLocal: false,
        allowServer: false,
      })
      updateSaveControls()
      return
    }

    draft = reference
    draftReconciled = false
    setEditorDisabled(true)
    updateSaveControls()
    setSaveStatus('Lädt …', 'saving')
    try {
      const loaded = await requestJson(`/api/drafts/${encodeURIComponent(reference.draftId)}`, { token: reference.draftToken })
      if (
        loaded.draftId !== reference.draftId
        || loaded.builder !== 'business'
        || !['draft', 'locked'].includes(loaded.status)
        || (loaded.data !== null && !isBusinessDataStructure(loaded.data, { serverData: true }))
      ) {
        throw new Error('Der Speicherdienst hat einen ungültigen oder nicht passenden Entwurf zurückgegeben.')
      }

      serverStatus = loaded.status
      serverDraftData = loaded.data === null ? null : loaded.data
      draftReconciled = false
      referenceError = false
      if (loaded.fulfillmentData) {
        restoreBusinessFulfillment(fulfillmentForm, loaded.fulfillmentData)
        packageBox.querySelector(`input[value="${BUSINESS_FULFILLMENT_PACKAGE_CODE}"]`).checked = true
        updateCustomerTypeFields({ clear: false })
        updateDomainHolderFields({ clear: false })
        updateFulfillmentVisibility()
      }

      if (localDataInvalid) {
        showConflict(
          'Die lokalen Formulardaten sind ungültig und bleiben unverändert. Du kannst den Serverstand laden oder die lokalen Daten ausdrücklich verwerfen.',
          { allowLocal: false, allowServer: true, allowDiscard: true },
        )
        setSaveStatus('Nicht gespeichert', 'pending')
        updateSaveControls()
        return
      }

      const localData = state
      const serverData = serverDraftData ?? cloneDefaults()
      if (localDataExists && !dataEqual(localData, serverData)) {
        showConflict(
          serverDraftData
            ? 'Lokale und serverseitige Änderungen unterscheiden sich. Wähle ausdrücklich, welchen Stand du verwenden möchtest.'
            : 'Der Serverentwurf enthält noch keine gespeicherten Daten, lokale Eingaben sind aber vorhanden. Übernimm die lokalen Daten oder lade ausdrücklich den leeren Serverstand.',
        )
        setSaveStatus('Nicht gespeichert', 'pending')
        updateSaveControls()
        return
      }

      useServerState()
    } catch (error) {
      referenceError = true
      draftReconciled = false
      setSaveStatus('Speichern fehlgeschlagen', 'error')
      showConflict(`${error.message} Die Referenz und deine lokalen Eingaben bleiben erhalten.`, {
        allowLocal: false,
        allowServer: false,
      })
      updateSaveControls()
    }
  }

  function discardInvalidLocal() {
    if (!window.confirm('Die ungültigen lokalen Daten werden dauerhaft aus diesem Browser entfernt. Diese Aktion kann nicht rückgängig gemacht werden. Fortfahren?')) return
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      toast('Die lokalen Daten konnten nicht entfernt werden.')
      return
    }

    localDataInvalid = false
    preserveLocalRaw = false
    localDataExists = false
    Object.assign(state, cloneDefaults())
    if (draft) {
      useServerState()
      return
    }
    referenceError = false
    draftReconciled = true
    revision += 1
    savedRevision = -1
    resetFulfillmentForm()
    hideConflict()
    setEditorDisabled(false)
    renderState()
    save()
    setSaveStatus('Nicht gespeichert', 'pending')
    updateSaveControls()
  }

  function restartServerDraft() {
    if (!window.confirm('Die gespeicherte Serverreferenz wird aus diesem Browser entfernt. Der bisherige Serverentwurf bleibt bestehen, wird aber nicht gelöscht. Lokale Website-Formulardaten bleiben erhalten; die Rundum-Sorglos-Auftragsangaben werden zurückgesetzt. Fortfahren?')) return
    try {
      localStorage.removeItem(DRAFT_REFERENCE_KEY)
    } catch {
      toast('Die Serverreferenz konnte nicht aus dem Browserspeicher entfernt werden.')
      return
    }

    draft = null
    serverDraftData = null
    serverStatus = ''
    referenceError = false
    draftReconciled = !localDataInvalid
    revision += 1
    savedRevision = -1
    resetFulfillmentForm()
    hideConflict()
    setEditorDisabled(localDataInvalid)
    setSaveStatus('Nicht gespeichert', 'pending')
    updateSaveControls()
    if (localDataInvalid) {
      showConflict('Die lokalen Daten sind weiterhin ungültig und wurden nicht verändert. Verwirf sie ausdrücklich, bevor du mit einem neuen Entwurf fortfährst.', {
        allowLocal: false,
        allowServer: false,
        allowDiscard: true,
      })
    }
  }

  function renderPreview() {
    clearTimeout(previewTimer)
    frame.srcdoc = generateBusinessHtml(state, { preview: true, packageCode: selectedPackageCode() })
  }

  function updatePreview() {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(renderPreview, 300)
  }

  function changed() {
    revision += 1
    save()
    updateValidationWarnings()
    updatePreview()
    if (draftReconciled && draft && serverStatus === 'draft') {
      setSaveStatus('Nicht gespeichert', 'pending')
      clearTimeout(autoSaveTimer)
      autoSaveTimer = setTimeout(() => {
        saveLatest().catch(() => {})
      }, 900)
    } else if (serverStatus === 'locked') {
      setSaveStatus('Serverentwurf gesperrt – Änderungen nur lokal', 'error')
    } else {
      setSaveStatus('Nicht gespeichert', 'pending')
    }
  }

  function updateValidationWarnings() {
    const warnings = validationWarnings(state)
    validationWarning.replaceChildren()
    validationWarning.hidden = warnings.length === 0
    for (const warning of warnings.slice(0, 5)) {
      const item = document.createElement('p')
      item.textContent = warning
      validationWarning.append(item)
    }
    if (warnings.length > 5) {
      const more = document.createElement('p')
      more.textContent = `Weitere ${warnings.length - 5} Hinweise. Bitte Eingaben und Bilder prüfen.`
      validationWarning.append(more)
    }

    galleryWarning.hidden = state.gallery.length <= MAX_GALLERY
    if (!galleryWarning.hidden) {
      galleryWarning.textContent = `Dieser lokale Entwurf enthält ${state.gallery.length} Galeriebilder. Vor der späteren Serverspeicherung müssen höchstens ${MAX_GALLERY} ausgewählt sein. Vorhandene Bilder bleiben erhalten und können hier einzeln entfernt werden.`
    }
  }

  function getValue(path) {
    return path.split('.').reduce((value, key) => value?.[key], state)
  }

  function setValue(path, value) {
    const keys = path.split('.')
    const last = keys.pop()
    keys.reduce((target, key) => target[key], state)[last] = value
  }

  function processImage(file, maxDimension, keepAlpha, data, path) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error('Keine Bilddatei. Bitte wähle ein Bild aus.'))
        return
      }

      const url = URL.createObjectURL(file)
      const image = new Image()
      image.onload = () => {
        URL.revokeObjectURL(url)
        try {
          const canvas = document.createElement('canvas')
          const preserveAlpha = keepAlpha || (path === 'hero.image' && hasImageTransparency(image, canvas))
          const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
          canvas.width = Math.max(1, Math.round(image.width * scale))
          canvas.height = Math.max(1, Math.round(image.height * scale))
          const context = canvas.getContext('2d')
          if (!context) {
            reject(new Error('Die Bildverarbeitung ist in diesem Browser nicht verfügbar.'))
            return
          }
          if (!preserveAlpha) {
            context.fillStyle = '#fff'
            context.fillRect(0, 0, canvas.width, canvas.height)
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height)
          if (preserveAlpha) {
            resolve(encodeBusinessLogo(canvas, image, {
              maxImageBytes: MAX_IMAGE_BYTES,
              fitsDraft: (value) => draftRequestBytes(withImage(data, path, value)) <= MAX_DRAFT_REQUEST_BYTES,
              ...(path === 'hero.image' && { label: 'Titelbild' }),
            }))
            return
          }
          const format = keepAlpha ? 'image/webp' : 'image/jpeg'
          const qualities = keepAlpha ? [0.9, 0.82, 0.72, 0.62] : [0.82, 0.74, 0.66, 0.58]
          let lastIssue = 'image'
          for (const quality of qualities) {
            const value = canvas.toDataURL(format, quality)
            if (!value.startsWith(`data:${format};base64,`)) {
              reject(new Error('Dieses Bildformat wird vom Browser nicht unterstützt. Bitte verwende ein JPEG- oder WebP-fähiges Bild.'))
              return
            }
            const size = imageByteLength(value)
            if (size === null || size > MAX_IMAGE_BYTES) {
              lastIssue = 'image'
              continue
            }
            const candidate = withImage(data, path, value)
            if (draftRequestBytes(candidate) > MAX_DRAFT_REQUEST_BYTES) {
              lastIssue = 'request'
              continue
            }
            resolve(value)
            return
          }
          reject(new Error(lastIssue === 'image'
            ? 'Das Bild ist auch nach zusätzlicher Komprimierung größer als 1,5 MiB. Bitte wähle ein kleineres Bild.'
            : 'Das Bild passt auch nach zusätzlicher Komprimierung nicht in das Draft-Limit von 4 MiB. Entferne oder verkleinere zuerst andere Bilder.'))
        } catch (error) {
          reject((keepAlpha || path === 'hero.image') && error instanceof Error ? error : new Error('Bild konnte nicht verarbeitet werden.'))
        }
      }
      image.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('Bild konnte nicht gelesen werden.'))
      }
      image.src = url
    })
  }

  function renderSingle(box) {
    const path = box.dataset.img
    const value = getValue(path)
    box.querySelectorAll('img, .rm').forEach((element) => element.remove())
    box.querySelector('[data-drop-label]').hidden = Boolean(value)

    if (!value) return

    const image = new Image()
    image.src = value
    image.alt = ''
    const remove = document.createElement('button')
    remove.className = 'rm'
    remove.type = 'button'
    remove.disabled = editorDisabled
    remove.textContent = '✕'
    remove.setAttribute('aria-label', 'Bild entfernen')
    remove.addEventListener('click', (event) => {
      event.stopPropagation()
      setValue(path, '')
      $('.image-status', box.parentElement).textContent = ''
      renderSingle(box)
      changed()
    })
    box.append(image, remove)
  }

  function wireDrop(box, onFiles) {
    const input = $('input[type=file]', box)
    box.addEventListener('click', (event) => {
      if (!event.target.closest('.rm')) input.click()
    })
    box.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('.rm')) {
        event.preventDefault()
        input.click()
      }
    })
    input.addEventListener('change', () => {
      onFiles([...input.files])
      input.value = ''
    })
    for (const eventName of ['dragenter', 'dragover']) {
      box.addEventListener(eventName, (event) => {
        event.preventDefault()
        box.classList.add('over')
      })
    }
    for (const eventName of ['dragleave', 'drop']) {
      box.addEventListener(eventName, (event) => {
        event.preventDefault()
        box.classList.remove('over')
      })
    }
    box.addEventListener('drop', (event) => onFiles([...event.dataTransfer.files]))
  }

  for (const box of $$('[data-img]')) {
    renderSingle(box)
    wireBusinessSingleImage({
      box,
      input: $('input[type=file]', box),
      status: $('.image-status', box.parentElement),
      isEditorDisabled: () => editorDisabled,
      async onFile(file) {
        const path = box.dataset.img
        const value = await trackImageTask(
          processImage(file, Number(box.dataset.max) || 1400, path === 'logo', state, path),
        )
        setValue(path, value)
        renderSingle(box)
        changed()
      },
    })
  }

  const galleryGrid = $('#gallery-grid')
  function renderGallery() {
    galleryGrid.replaceChildren()
    state.gallery.forEach((source, index) => {
      const tile = document.createElement('div')
      const image = new Image()
      image.alt = ''
      image.src = source
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.setAttribute('aria-label', `Bild ${index + 1} entfernen`)
      remove.textContent = '✕'
      remove.addEventListener('click', () => {
        state.gallery.splice(index, 1)
        renderGallery()
        changed()
      })
      tile.append(image, remove)
      galleryGrid.append(tile)
    })
  }

  wireDrop($('#gallery-drop'), async (files) => {
    if (!files.length) return
    const room = MAX_GALLERY - state.gallery.length
    if (room <= 0) {
      toast(`Maximal ${MAX_GALLERY} Galeriebilder. Bitte entferne zuerst ein Bild.`)
      return
    }
    if (files.length > room) {
      const available = room === 1 ? 'ein weiteres Bild' : `${room} weitere Bilder`
      toast(`Diese Auswahl würde die Grenze von ${MAX_GALLERY} Galeriebildern überschreiten. Bitte wähle höchstens ${available} aus.`)
      return
    }

    const task = (async () => {
      const gallery = [...state.gallery]
      for (const file of files) {
        const candidate = { ...state, gallery }
        const value = await processImage(file, 1400, false, candidate, `gallery.${gallery.length}`)
        gallery.push(value)
      }
      state.gallery = gallery
      renderGallery()
      changed()
    })()
    try {
      await trackImageTask(task)
    } catch (error) {
      toast(error.message)
    }
  })

  const listConfig = {
    services: {
      max: MAX_SERVICES,
      fresh: () => ({ icon: '✨', title: '', text: '' }),
      fields: '<div class="row"><label>Icon<input data-k="icon"></label><label>Titel<input data-k="title"></label></div><label>Beschreibung<textarea rows="2" data-k="text"></textarea></label>',
    },
    facts: {
      max: MAX_FACTS,
      fresh: () => ({ value: '', label: '' }),
      fields: '<div class="row fact-row"><label>Zahl<input data-k="value" placeholder="15+"></label><label>Beschriftung<input data-k="label" placeholder="Jahre Erfahrung"></label></div>',
    },
  }

  function renderList(name) {
    const config = listConfig[name]
    const host = $(`#list-${name}`)
    host.replaceChildren()
    state[name].forEach((item, index) => {
      const element = document.createElement('div')
      element.className = 'item'
      element.innerHTML = `${config.fields}<button class="del" type="button" aria-label="Eintrag ${index + 1} entfernen">✕</button>`
      $$('[data-k]', element).forEach((input) => {
        const path = `${name}.${input.dataset.k}`
        input.maxLength = FIELD_LIMITS[path]
        input.title = `Maximal ${FIELD_LIMITS[path]} Zeichen.`
        input.value = item[input.dataset.k]
        input.addEventListener('input', () => {
          if (
            input.value.length > FIELD_LIMITS[path]
            && (item[input.dataset.k].length <= FIELD_LIMITS[path] || input.value.length >= item[input.dataset.k].length)
          ) {
            input.value = item[input.dataset.k]
            toast(`Dieses Feld darf höchstens ${FIELD_LIMITS[path]} Zeichen enthalten.`)
            return
          }
          if (INVALID_CONTROL_CHARACTERS.test(input.value)) {
            input.value = item[input.dataset.k]
            toast('Dieses Feld enthält nicht erlaubte Steuerzeichen.')
            return
          }
          item[input.dataset.k] = input.value
          changed()
        })
      })
      $('.del', element).addEventListener('click', () => {
        state[name].splice(index, 1)
        renderList(name)
        changed()
      })
      host.append(element)
    })
    if (window.gsap && host.children.length) {
      window.gsap.from([...host.children], { y: 12, opacity: 0, stagger: 0.05, duration: 0.35, clearProps: 'all' })
    }
  }

  $$('[data-add]').forEach((button) => {
    button.addEventListener('click', () => {
      const name = button.dataset.add
      const config = listConfig[name]
      if (state[name].length >= config.max) {
        toast(`Maximal ${config.max} Einträge.`)
        return
      }
      state[name].push(config.fresh())
      renderList(name)
      changed()
    })
  })

  function bindFields() {
    $$('[data-bind]').forEach((element) => {
      const path = element.dataset.bind
      const max = FIELD_LIMITS[path]
      if (max) element.maxLength = max
      else element.removeAttribute('maxlength')
      if (max) element.title = `Maximal ${max} Zeichen.`
      if (element.type === 'checkbox') element.checked = getValue(path) === 'true'
      else element.value = getValue(path) ?? ''
      element.oninput = () => {
        const previous = getValue(path)
        const value = element.type === 'checkbox' ? String(element.checked) : element.value
        if (
          max
          && value.length > max
          && (previous.length <= max || value.length >= previous.length)
        ) {
          element.value = previous
          toast(`Dieses Feld darf höchstens ${max} Zeichen enthalten.`)
          return
        }
        if (typeof element.value === 'string' && INVALID_CONTROL_CHARACTERS.test(element.value)) {
          element.value = previous
          toast('Dieses Feld enthält nicht erlaubte Steuerzeichen.')
          return
        }
        setValue(path, value)
        clearPurchaseError(element)
        if (path.startsWith('operator.')) updateOperatorVisibility(true)
        changed()
      }
      element.onblur = () => {
        const value = getValue(path)
        const valid = element.dataset.format === 'email'
          ? isValidEmail(value)
          : element.dataset.format === 'url'
            ? isValidUrl(value)
            : true
        if (!valid) {
          toast(element.dataset.format === 'email'
            ? 'Bitte eine gültige E-Mail-Adresse eingeben.'
            : 'Bitte eine gültige HTTP- oder HTTPS-Adresse ohne Zugangsdaten eingeben.')
        }
      }
    })
    updateOperatorVisibility()
  }

  PALETTES.forEach(([accent, accent2]) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.style.background = `linear-gradient(135deg,${accent},${accent2})`
    button.setAttribute('aria-label', `Palette ${accent} ${accent2}`)
    button.addEventListener('click', () => {
      state.design.accent = accent
      state.design.accent2 = accent2
      bindFields()
      changed()
    })
    $('#swatches').append(button)
  })

  function go(index) {
    const nextIndex = Math.max(0, Math.min(stepElements.length - 1, index))
    const direction = nextIndex >= currentStep ? 1 : -1
    stepElements[currentStep].classList.remove('on')
    stepElements[nextIndex].classList.add('on')
    $$('button', stepsNav).forEach((button, stepIndex) => {
      button.classList.toggle('on', stepIndex === nextIndex)
      button.classList.toggle('done', stepIndex < nextIndex)
    })
    $('#progress-bar').style.width = `${((nextIndex + 1) / stepElements.length) * 100}%`
    $('#step-count').textContent = `${nextIndex + 1} / ${stepElements.length}`
    $('#prev').style.visibility = nextIndex === 0 ? 'hidden' : 'visible'
    $('#next').style.visibility = nextIndex === stepElements.length - 1 ? 'hidden' : 'visible'
    $('#step-wrap').scrollTop = 0
    $$('button', stepsNav)[nextIndex].scrollIntoView({ inline: 'center', block: 'nearest' })
    if (window.gsap) {
      window.gsap.fromTo(
        stepElements[nextIndex].children,
        { x: 24 * direction, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.45, stagger: 0.04, ease: 'power3.out', clearProps: 'all' },
      )
    }
    currentStep = nextIndex
  }

  stepElements.forEach((step, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = step.dataset.step
    button.addEventListener('click', () => go(index))
    stepsNav.append(button)
  })

  $('#next').addEventListener('click', () => go(currentStep + 1))
  $('#prev').addEventListener('click', () => go(currentStep - 1))

  $('#device').addEventListener('click', (event) => {
    const button = event.target.closest('button')
    if (!button) return
    $$('#device button').forEach((deviceButton) => {
      const selected = deviceButton === button
      deviceButton.classList.toggle('on', selected)
      deviceButton.setAttribute('aria-pressed', String(selected))
    })
    frame.style.width = button.dataset.w
  })

  saveButton.addEventListener('click', () => {
    clearTimeout(autoSaveTimer)
    saveLatest().catch(() => {})
  })
  packageBox.addEventListener('change', () => {
    checkoutReview.hidden = true
    checkoutButton.hidden = false
    updateFulfillmentVisibility()
    updatePreview()
    if (operatorValidationStarted) showOperatorErrors(false)
  })
  fulfillmentForm.elements.customerType.addEventListener('change', () => {
    updateCustomerTypeFields()
    clearFulfillmentErrors()
  })
  fulfillmentForm.elements.domainHolderDiffers.addEventListener('change', () => {
    updateDomainHolderFields()
    clearFulfillmentErrors()
  })
  fulfillmentForm.elements.domainHolderType.addEventListener('change', () => {
    updateDomainHolderFields()
    clearFulfillmentErrors()
  })
  fulfillmentForm.addEventListener('input', clearFulfillmentErrors)
  fulfillmentForm.addEventListener('change', clearFulfillmentErrors)

  function getFulfillmentErrors() {
    const value = (name) => fulfillmentForm.elements[name].value
    return validateBusinessFulfillmentForUI({
      customerType: value('customerType'),
      companyName: value('companyName'),
      firstName: value('firstName'),
      lastName: value('lastName'),
      billingStreet: value('billingStreet'),
      billingPostalCode: value('billingPostalCode'),
      billingCity: value('billingCity'),
      billingCountryCode: value('billingCountryCode'),
      communicationEmail: value('communicationEmail'),
      desiredDomain: value('desiredDomain'),
      alternativeDomain: value('alternativeDomain'),
      domainHolderDiffers: value('domainHolderDiffers') === 'true',
      domainHolderType: value('domainHolderType'),
      domainHolderOrganizationName: value('domainHolderOrganizationName'),
      domainHolderFirstName: value('domainHolderFirstName'),
      domainHolderLastName: value('domainHolderLastName'),
      domainHolderStreet: value('domainHolderStreet'),
      domainHolderPostalCode: value('domainHolderPostalCode'),
      domainHolderCity: value('domainHolderCity'),
      domainHolderCountryCode: value('domainHolderCountryCode'),
      domainHolderEmail: value('domainHolderEmail'),
      hostingerConsent: fulfillmentForm.elements.hostingerConsent.checked,
    })
  }

  function showCheckoutReview() {
    if (checkoutPending) return

    const selectedPackage = selectedPackageCode()
    if (!packages.some((item) => item.code === selectedPackage)) {
      setCheckoutStatus('Bitte wähle ein verfügbares Website-Paket aus.', 'error')
      return
    }

    const fulfillmentErrors = selectedPackage === BUSINESS_FULFILLMENT_PACKAGE_CODE ? getFulfillmentErrors() : []
    showFulfillmentErrors(fulfillmentErrors, { focus: false })
    operatorValidationStarted = true
    const operatorValid = showOperatorErrors(false)
    const purchaseError = validatePurchase()
    if (purchaseError) {
      showPurchaseError(purchaseError)
      return
    }

    if (!operatorValid) {
      showOperatorErrors(true)
      return
    }
    if (fulfillmentErrors.length) {
      showFulfillmentErrors(fulfillmentErrors)
      return
    }

    try {
      if (selectedPackage === BUSINESS_FULFILLMENT_PACKAGE_CODE) {
        collectBusinessFulfillment(fulfillmentForm)
      }
      checkoutReviewContent.innerHTML = renderCheckoutReview({
        packageCode: selectedPackage,
        builderLabel: 'Business',
      })
      checkoutReview.hidden = false
      checkoutButton.hidden = true
      checkoutReview.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      setCheckoutStatus('')
    } catch (error) {
      if (error instanceof BusinessFulfillmentValidationError) {
        showFulfillmentError(error)
      } else {
        setCheckoutStatus(error.message, 'error')
      }
    }
  }

  async function beginCheckout() {
    if (checkoutPending) return

    const selectedPackage = selectedPackageCode()
    if (!packages.some((item) => item.code === selectedPackage)) {
      setCheckoutStatus('Bitte wähle ein verfügbares Website-Paket aus.', 'error')
      return
    }

    const purchaseError = validatePurchase()
    if (purchaseError) {
      showPurchaseError(purchaseError)
      return
    }
    operatorValidationStarted = true
    if (!showOperatorErrors(true)) return

    let orderData = null
    if (selectedPackage === BUSINESS_FULFILLMENT_PACKAGE_CODE) {
      try {
        orderData = collectBusinessFulfillment(fulfillmentForm)
      } catch (error) {
        showFulfillmentError(error)
        return
      }
    }

    checkoutPending = true
    clearTimeout(autoSaveTimer)
    setEditorDisabled(true)
    updateSaveControls()
    setCheckoutStatus('Deine Änderungen werden gespeichert. Danach öffnet sich der sichere Checkout …', 'pending')

    try {
      while (imageTasks.size) await Promise.all([...imageTasks])

      const currentError = validatePurchase()
      if (currentError) {
        showPurchaseError(currentError)
        throw new Error(currentError.message)
      }
      if (!showOperatorErrors(false)) {
        throw new Error('Bitte prüfe die Betreiberangaben.')
      }

      while (savedRevision < revision) await saveLatest()
      if (savedRevision !== revision) {
        throw new Error('Der aktuelle Entwurfsstand konnte nicht bestätigt werden. Bitte speichere erneut.')
      }

      const reference = draft
      if (!isDraftReference(reference)) {
        throw new Error('Die Serverreferenz für diesen Entwurf ist nicht verfügbar. Bitte lade den Entwurf erneut.')
      }

      const checkout = await requestJson('/api/checkout', {
        method: 'POST',
        body: createBusinessCheckoutPayload({
          packageCode: selectedPackage,
          draftId: reference.draftId,
          draftToken: reference.draftToken,
          fulfillmentData: orderData,
        }),
      })

      let checkoutUrl
      try {
        checkoutUrl = new URL(checkout.url)
      } catch {
        throw new Error('Der Checkout hat keine gültige Zieladresse zurückgegeben.')
      }
      if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com') {
        throw new Error('Der Checkout hat eine nicht erlaubte Zieladresse zurückgegeben.')
      }

      window.location.assign(checkoutUrl.href)
    } catch (error) {
      checkoutPending = false
      setEditorDisabled(false)
      updateSaveControls()
      setCheckoutStatus(error.message, 'error')
    }
  }

  checkoutButton.addEventListener('click', showCheckoutReview)
  reviewEditButton.addEventListener('click', () => {
    checkoutReview.hidden = true
    checkoutButton.hidden = false
    checkoutButton.focus()
  })
  reviewConfirmButton.addEventListener('click', beginCheckout)
  retryButton.addEventListener('click', () => {
    retryButton.disabled = true
    restoreDraft().finally(() => { retryButton.disabled = false })
  })
  restartButton.addEventListener('click', restartServerDraft)
  useLocalButton.addEventListener('click', () => { useLocalState() })
  useServerButton.addEventListener('click', useServerState)
  discardInvalidLocalButton.addEventListener('click', discardInvalidLocal)

  window.addEventListener('beforeunload', (event) => {
    if (savePromise || (revision > 0 && savedRevision < revision)) {
      event.preventDefault()
      event.returnValue = ''
    }
  })

  $('#btn-reset').addEventListener('click', () => {
    if (!conflict.hidden || localDataInvalid) {
      toast('Bitte löse zuerst den angezeigten Datenkonflikt.')
      return
    }
    if (!window.confirm('Alle Eingaben löschen?')) return
    Object.assign(state, cloneDefaults())
    bindFields()
    resetFulfillmentForm()
    $$('.image-status').forEach((status) => { status.textContent = '' })
    SINGLE_IMAGE_PATHS.forEach((path) => renderSingle($(`[data-img="${path}"]`)))
    renderGallery()
    renderList('services')
    renderList('facts')
    changed()
    go(0)
  })

  renderState()
  go(0)
  setEditorDisabled(localDataInvalid)
  if (localState.warning) {
    showConflict(localState.warning, { allowLocal: false, allowServer: false, allowDiscard: true })
    setSaveStatus('Speichern fehlgeschlagen', 'error')
  }
  restoreDraft()

  loadGsap()
    .then((gsap) => {
      if (!gsap) throw new Error('Die Builder-Animationen konnten nicht initialisiert werden.')
      gsap.from('.business-page .topbar', { y: -60, opacity: 0, duration: 0.7, ease: 'power3.out' })
      gsap.from('.business-page .panel', { x: -40, opacity: 0, duration: 0.8, delay: 0.1, ease: 'power3.out' })
      gsap.from('.business-page .preview', { y: 40, opacity: 0, duration: 0.9, delay: 0.2, ease: 'power3.out' })
    })
    .catch((error) => toast(error.message))
}
