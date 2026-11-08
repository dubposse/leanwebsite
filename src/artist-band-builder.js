import { getPackagesForBuilder } from '../shared/packages.js'
import {
  HOSTING_DOMAIN_DETAILS,
  PACKAGE_COPY,
  POST_PURCHASE_CHANGES_TEXT,
  POST_PURCHASE_CHANGES_TITLE,
  CHECKOUT_TAX_NOTICE,
} from '../shared/builder-copy.js'
import { renderCheckoutReview } from '../shared/checkout-review.js'
import { generateArtistBandHtml } from '../shared/artist-band-template.js'
import { artistBandLegalErrors, LEGAL_DEFAULTS } from '../shared/artist-band-legal.js'
import { setupArtistBandMobileView } from './artist-band-mobile-view.js'
import {
  collectArtistBandFulfillment,
  createArtistBandCheckoutPayload,
  HOSTINGER_CONSENT_TEXT,
  HOSTINGER_CONSENT_VERSION,
  packageRequiresFulfillment,
  validateArtistBandFulfillmentForUI,
  ArtistBandFulfillmentValidationError,
} from './artist-band-fulfillment.js'

const STORAGE_KEY = 'leanwebsite-artist-band-draft-v1'
const MAX_COVER_BYTES = 1.5 * 1024 * 1024

const DEFAULT_DATA = {
  name: 'DJ Nova',
  genre: 'Techno · Acid · Electro',
  tagline: 'Basslines für die Nacht.',
  bio: 'Produzent und DJ aus der Posse. Treibende Grooves, analoge Wärme und viel Acid.',
  accent: '#c6ff00',
  theme: 'dark',
  contentFont: 'standard',
  contentColor: 'auto',
  spotify: '',
  soundcloud: '',
  bandcamp: '',
  instagram: '',
  email: '',
  cover: '',
  tracks: [{ a: 'Midnight Acid', b: '' }],
  gigsHeading: 'Live',
  gigs: [{ a: '2026-11-21', b: 'Berlin · Club Posse' }],
  legal: { ...LEGAL_DEFAULTS },
}

const FIELD_NAMES = [
  'name', 'genre', 'tagline', 'bio', 'accent', 'theme', 'contentFont', 'contentColor',
  'spotify', 'soundcloud', 'bandcamp', 'instagram', 'email', 'gigsHeading',
]

function cloneData(data) {
  return {
    ...data,
    legal: { ...LEGAL_DEFAULTS, ...data.legal },
    tracks: data.tracks.map((track) => ({ ...track })),
    gigs: data.gigs.map((gig) => ({ ...gig })),
  }
}

function formatPackagePrice(amountCents) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amountCents / 100)
}

function apiErrorMessage(message, status) {
  const known = {
    'Invalid URL': 'Bitte prüfe die eingegebenen Links. Erlaubt sind HTTP- und HTTPS-Adressen.',
    'Invalid email address': 'Bitte gib eine gültige E-Mail-Adresse ein.',
    'Cover must be a JPEG image': 'Das Cover konnte nicht als JPEG verarbeitet werden. Bitte lade ein anderes Bild hoch.',
    'Cover image is invalid or too large': 'Das Cover ist ungültig oder größer als 1,5 MB.',
    'Cover must contain valid JPEG image data': 'Das Cover enthält keine gültigen JPEG-Bilddaten.',
    'This draft is locked': 'Dieser Entwurf kann nicht mehr geändert werden.',
    'This draft can no longer be purchased': 'Dieser Entwurf kann nicht mehr gekauft werden.',
    'This draft has no saved content yet': 'Der Entwurf enthält noch keine gespeicherten Änderungen.',
    'Unknown package for this builder': 'Bitte wähle ein verfügbares Artist/Band-Paket.',
    'Invalid fulfillment data': 'Bitte prüfe die Auftragsdaten.',
    'Hostinger setup consent is required': 'Bitte bestätige die Zustimmung zur Hostinger-Einrichtung.',
    'Invalid desired domain': 'Die gewünschte Domain ist ungültig. Bitte gib eine neue .de-Domain ein.',
    'Invalid alternative domain': 'Die alternative Domain ist ungültig. Bitte gib eine .de-Domain ein.',
    'Alternative domain must differ from desired domain': 'Wunschdomain und alternative Domain müssen verschieden sein.',
    'Invalid first name': 'Bitte prüfe den Vornamen.',
    'Invalid last name': 'Bitte prüfe den Nachnamen.',
    'Invalid billing street': 'Bitte prüfe Straße und Hausnummer.',
    'Invalid billing postal code': 'Bitte prüfe die Postleitzahl.',
    'Invalid billing city': 'Bitte prüfe den Ort.',
    'Invalid billing country code': 'Bitte prüfe den Ländercode.',
    'Invalid email address': 'Bitte gib eine gültige E-Mail-Adresse ein.',
    'Invalid domain holder details': 'Bitte prüfe die Angaben zum Domaininhaber.',
    'Invalid domain holder first name': 'Bitte prüfe den Vornamen des Domaininhabers.',
    'Invalid domain holder last name': 'Bitte prüfe den Nachnamen des Domaininhabers.',
    'Invalid domain holder street': 'Bitte prüfe die Straße des Domaininhabers.',
    'Invalid domain holder postal code': 'Bitte prüfe die Postleitzahl des Domaininhabers.',
    'Invalid domain holder city': 'Bitte prüfe den Ort des Domaininhabers.',
    'Invalid domain holder country code': 'Bitte prüfe den Ländercode des Domaininhabers.',
    'Invalid domain holder email': 'Bitte gib eine gültige E-Mail-Adresse des Domaininhabers ein.',
    'This order is no longer editable': 'Dieser Auftrag ist nicht mehr bearbeitbar.',
  }

  if (known[message]) return known[message]
  if (status === 422) return 'Einige Eingaben sind ungültig oder zu lang. Bitte prüfe die Formularfelder.'
  if (status === 413) return 'Die Daten sind zu groß. Bitte verkleinere das Cover oder kürze deine Eingaben.'
  if (status >= 500) return 'Der Dienst ist gerade nicht verfügbar. Bitte versuche es später erneut.'
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
    throw new Error('Keine Verbindung zum Dienst. Bitte prüfe deine Internetverbindung und versuche es erneut.')
  }

  let payload = null
  try {
    payload = await response.json()
  } catch {
    if (response.ok) throw new Error('Der Dienst hat eine ungültige Antwort gesendet.')
  }

  if (!response.ok) throw new Error(apiErrorMessage(payload?.error, response.status))
  return payload
}

function isDraftReference(value) {
  return value
    && typeof value.draftId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.draftId)
    && typeof value.draftToken === 'string'
    && /^[A-Za-z0-9_-]{43}$/.test(value.draftToken)
}

async function encodeCover(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('Die Bilddatei ist größer als 20 MB.')

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('Die Bilddatei konnte nicht geöffnet werden. Bitte wähle ein anderes Bild.')
  }

  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) {
      throw new Error('Das Bild hat eine zu hohe Auflösung. Bitte wähle ein kleineres Bild.')
    }

    let scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height))
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Die Bildverarbeitung ist in diesem Browser nicht verfügbar.')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

      for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        const base64 = dataUrl.slice('data:image/jpeg;base64,'.length)
        const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
        if (Math.floor(base64.length * 3 / 4) - padding <= MAX_COVER_BYTES) return dataUrl
      }

      scale *= 0.8
    }
  } finally {
    bitmap.close()
  }

  throw new Error('Das Cover konnte nicht auf maximal 1,5 MB verkleinert werden.')
}

export function renderArtistBandBuilder(app) {
  document.title = 'Artist & Band Website erstellen – LeanWebsite'
  app.classList.add('app-builder')
  app.innerHTML = `
    <div class="ab-page">
      <header class="ab-header">
        <a class="ab-brand" href="/" aria-label="Zur LeanWebsite-Startseite">
          <span class="ab-brand-mark" aria-hidden="true">L</span>
          <span>LeanWebsite</span>
        </a>
        <a class="ab-back" href="/">Zur Startseite <span aria-hidden="true">↗</span></a>
      </header>

      <main class="ab-main">
        <section class="ab-intro" aria-labelledby="ab-title">
          <p class="ab-eyebrow"><span aria-hidden="true"></span> Artist &amp; Band</p>
          <h1 id="ab-title">Dein Sound.<br><span>Dein eigener Auftritt.</span></h1>
          <p>Gestalte eine Website, die deine Musik und deine nächsten Gigs in den Mittelpunkt stellt.</p>
        </section>

        <div class="ab-mobile-view-switch" role="group" aria-label="Ansicht wählen">
          <button type="button" data-view="edit" aria-pressed="true" aria-controls="ab-editor">Bearbeiten</button>
          <button type="button" data-view="preview" aria-pressed="false" aria-controls="ab-preview-panel">Vorschau</button>
        </div>
        <div class="ab-workspace" data-view="edit">
          <section id="ab-editor" class="ab-editor" aria-label="Website-Inhalte bearbeiten">
            <form id="ab-form">
              <fieldset id="ab-fields">
                <legend class="ab-sr-only">Inhalte deiner Artist- oder Band-Website</legend>
                <section class="ab-card">
                  <div class="ab-card-heading"><span>01</span><div><h2>Dein Auftritt</h2><p>Die wichtigsten Infos auf einen Blick.</p></div></div>
                  <div class="ab-fields-grid">
                    <label class="ab-field ab-field-wide">Name / Artist-Name<input name="name" maxlength="100" required autocomplete="organization"></label>
                    <label class="ab-field">Genre<input name="genre" maxlength="120"></label>
                    <label class="ab-field">Akzentfarbe<input name="accent" type="color" aria-label="Akzentfarbe"></label>
                    <label class="ab-field ab-field-wide">Dein Claim<input name="tagline" maxlength="180"></label>
                    <label class="ab-field ab-field-wide">Über dich / euch<textarea name="bio" maxlength="3000" rows="5"></textarea></label>
                    <label class="ab-field">Farbstil<select name="theme"><option value="dark">Dark</option><option value="light">Light</option><option value="grad">Gradient</option></select></label>
                    <label class="ab-field">Schriftstil der Inhalte<select name="contentFont"><option value="standard">Standard</option><option value="genre">Genre-Stil</option><option value="claim">Claim-Stil</option></select></label>
                    <label class="ab-field">Textfarbe der Inhalte<select name="contentColor"><option value="auto">Automatisch</option><option value="accent">Akzentfarbe</option><option value="claim">Claim-Farbe</option></select></label>
                    <label class="ab-field">Cover-Bild<span class="ab-file-control"><input id="ab-cover" type="file" accept="image/*"><span>Bild auswählen</span></span><span id="ab-cover-name" class="ab-field-hint">Wird als JPEG verarbeitet (max. 1,5 MB).</span></label>
                    <p class="ab-field-hint ab-field-wide">Bei Akzentfarbe als Textfarbe kann die Lesbarkeit je nach gewählter Farbe variieren.</p>
                  </div>
                  <div id="ab-cover-preview-wrap" class="ab-cover-preview-wrap" hidden><img id="ab-cover-preview" alt="Vorschau des Cover-Bildes"><button id="ab-remove-cover" class="ab-text-button" type="button">Cover entfernen</button></div>
                </section>

                <section class="ab-card">
                  <div class="ab-card-heading"><span>02</span><div><h2>Releases &amp; Live</h2><p>Füge Songs und kommende Termine hinzu.</p></div></div>
                  <div class="ab-list-section"><div class="ab-list-title"><h3>Tracks</h3><button class="ab-add" id="ab-add-track" type="button">+ Track hinzufügen</button></div><div id="ab-tracks" class="ab-list"></div></div>
                  <div class="ab-list-section"><div class="ab-list-title"><h3>Gigs</h3><button class="ab-add" id="ab-add-gig" type="button">+ Gig hinzufügen</button></div><div class="ab-fields-grid"><label class="ab-field ab-field-wide">Überschrift für Gigs<input name="gigsHeading" maxlength="40"></label><div id="ab-gigs" class="ab-list ab-field-wide"></div></div></div>
                </section>

                <section class="ab-card">
                  <div class="ab-card-heading"><span>03</span><div><h2>Links &amp; Booking</h2><p>Wo man deine Musik und dich findet.</p></div></div>
                  <div class="ab-fields-grid">
                    <label class="ab-field">Spotify<input name="spotify" type="url" maxlength="2048" placeholder="https://"></label>
                    <label class="ab-field">SoundCloud<input name="soundcloud" type="url" maxlength="2048" placeholder="https://"></label>
                    <label class="ab-field">Bandcamp<input name="bandcamp" type="url" maxlength="2048" placeholder="https://"></label>
                    <label class="ab-field">Instagram<input name="instagram" type="url" maxlength="2048" placeholder="https://"></label>
                    <label class="ab-field ab-field-wide">Booking-E-Mail<input name="email" type="email" maxlength="254" autocomplete="email"></label>
                  </div>
                </section>
                <section class="ab-card" id="ab-legal">
                  <div class="ab-card-heading"><div><h2>Impressum &amp; Datenschutz</h2></div></div>
                  <div class="ab-fields-grid">
                    <label class="ab-field">Betreiberform<select name="legalOperatorType" data-legal="operatorType"><option value="person">Einzelperson</option><option value="gbr">GbR</option><option value="association">Verein</option><option value="company">Unternehmen (z. B. UG oder GmbH)</option></select></label>
                    <label class="ab-field">Name des Betreibers<input name="legalOperatorName" data-legal="operatorName" maxlength="500"></label>
                    <label class="ab-field" data-legal-company>Rechtsform (z. B. UG oder GmbH)<input name="legalForm" data-legal="legalForm" maxlength="500"></label>
                    <label class="ab-field ab-field-wide" data-legal-representative>Vertretungsberechtigte<input name="legalRepresentative" data-legal="representative" maxlength="500"></label>
                    <p class="ab-field-hint ab-field-wide">Diese Anschrift wird öffentlich im Impressum deiner Website angezeigt. Verwende eine geeignete, ladungsfähige Anschrift.</p>
                    <label class="ab-field ab-field-wide">Straße und Hausnummer<input name="legalStreet" data-legal="street" maxlength="500"></label>
                    <label class="ab-field">Postleitzahl<input name="legalPostalCode" data-legal="postalCode" maxlength="500"></label>
                    <label class="ab-field">Ort<input name="legalCity" data-legal="city" maxlength="500"></label>
                    <label class="ab-field">Land<input name="legalCountry" data-legal="country" maxlength="500"></label>
                    <label class="ab-field">Öffentliche E-Mail-Adresse<input name="legalEmail" data-legal="email" type="email" maxlength="500"></label>
                    <label class="ab-field">Telefonnummer (optional)<input name="legalPhone" data-legal="phone" maxlength="500"></label>
                    <label class="ab-field">Registereintragung<select name="legalRegistered" data-legal="registered"><option value="false">Nein</option><option value="true">Ja</option></select></label>
                    <label class="ab-field" data-legal-register>Registergericht<input name="legalRegisterCourt" data-legal="registerCourt" maxlength="500"></label>
                    <label class="ab-field" data-legal-register>Registernummer<input name="legalRegisterNumber" data-legal="registerNumber" maxlength="500"></label>
                    <label class="ab-field">Umsatzsteuer-ID (falls vorhanden und anzugeben)<input name="legalVatId" data-legal="vatId" maxlength="500"></label>
                    <label class="ab-field">Journalistisch-redaktionelle Inhalte<select name="legalEditorial" data-legal="editorial"><option value="false">Nein</option><option value="true">Ja</option></select></label>
                    <label class="ab-field" data-legal-editorial>Name des Verantwortlichen<input name="legalEditorialName" data-legal="editorialName" maxlength="500"></label>
                    <label class="ab-field" data-legal-editorial>Anschrift des Verantwortlichen<input name="legalEditorialAddress" data-legal="editorialAddress" maxlength="500"></label>
                    <label class="ab-field" data-legal-code>Hostinganbieter<select name="legalHostingProvider" data-legal="hostingProvider"><option value="">Noch nicht entschieden</option><option>Hostinger</option><option>IONOS</option><option>STRATO</option><option value="other">Anderer Anbieter</option></select></label>
                    <label class="ab-field" data-legal-hosting-other>Anderer Hostinganbieter<input name="legalHostingOther" data-legal="hostingOther" maxlength="500"></label>
                    <label class="ab-field" data-legal-code>Domainanbieter<select name="legalDomainProvider" data-legal="domainProvider"><option value="">Noch nicht entschieden</option><option>Hostinger</option><option>IONOS</option><option>STRATO</option><option value="other">Anderer Anbieter</option></select></label>
                    <label class="ab-field" data-legal-domain-other>Anderer Domainanbieter<input name="legalDomainOther" data-legal="domainOther" maxlength="500"></label>
                    <label class="ab-consent ab-field-wide"><input name="legalConfirmPublic" data-legal="confirmPublic" type="checkbox"><span>Ich bestätige, dass die Betreiberangaben korrekt sind und öffentlich auf meiner Website angezeigt werden dürfen.</span></label>
                    <label class="ab-consent ab-field-wide"><input name="legalConfirmReviewed" data-legal="confirmReviewed" type="checkbox"><span>Ich habe Impressum und Datenschutzerklärung geprüft und werde die Angaben bei Bedarf vor der Veröffentlichung anpassen.</span></label>
                  </div>
                  <p id="ab-legal-error" class="ab-fulfillment-error" role="alert" hidden></p>
                </section>
              </fieldset>
            </form>

            <section class="ab-card ab-buy-card" aria-labelledby="ab-package-title">
              <div class="ab-card-heading"><span>04</span><div><h2 id="ab-package-title">Deine Website kaufen</h2><p>Wähle das passende Artist/Band-Paket.</p></div></div>
              <div id="ab-packages" class="ab-packages"></div>
              <aside class="ab-package-changes">
                <h3>${POST_PURCHASE_CHANGES_TITLE}</h3>
                <p>${POST_PURCHASE_CHANGES_TEXT}</p>
              </aside>
              <p class="ab-tax-note">${CHECKOUT_TAX_NOTICE}</p>
              <form id="ab-fulfillment" class="ab-fulfillment" hidden novalidate>
                <fieldset id="ab-fulfillment-fields">
                  <legend class="ab-sr-only">Auftragsdaten für Rundum sorglos</legend>
                  <div class="ab-fulfillment-heading">
                    <h3>Angaben für deinen Auftrag</h3>
                    <p>Diese Daten verwenden wir ausschließlich für die Einrichtung deines Hostinger-Accounts und deiner neuen Domain.</p>
                  </div>
                  <p class="ab-artist-context">Website-Name aus deinem Entwurf: <strong id="ab-artist-name"></strong>. Das ist nicht dein rechtlicher Name als Auftraggeber.</p>
                  <div class="ab-fields-grid">
                    <label class="ab-field">Vorname<input name="firstName" maxlength="100" autocomplete="given-name" required aria-invalid="false"></label>
                    <label class="ab-field">Nachname<input name="lastName" maxlength="100" autocomplete="family-name" required aria-invalid="false"></label>
                    <label class="ab-field ab-field-wide">Straße und Hausnummer<input name="billingStreet" maxlength="200" autocomplete="street-address" required aria-invalid="false"></label>
                    <label class="ab-field">Postleitzahl<input name="billingPostalCode" maxlength="20" autocomplete="postal-code" required aria-invalid="false"></label>
                    <label class="ab-field">Ort<input name="billingCity" maxlength="100" autocomplete="address-level2" required aria-invalid="false"></label>
                    <label class="ab-field">Land (Ländercode)<input name="billingCountryCode" maxlength="2" placeholder="DE" autocomplete="country" required aria-invalid="false"></label>
                    <label class="ab-field ab-field-wide">E-Mail für die Auftragskommunikation<input name="communicationEmail" type="email" maxlength="254" autocomplete="off" required aria-invalid="false"></label>
                    <label class="ab-field">Gewünschte neue .de-Domain<input name="desiredDomain" maxlength="253" placeholder="dein-name.de" autocapitalize="none" spellcheck="false" required aria-invalid="false"></label>
                    <label class="ab-field">Alternative .de-Domain (optional)<input name="alternativeDomain" maxlength="253" placeholder="dein-name-2.de" autocapitalize="none" spellcheck="false" aria-invalid="false"></label>
                    <label class="ab-field ab-field-wide">Domaininhaber
                      <select name="domainHolderDiffers" aria-invalid="false">
                        <option value="false">Der Domaininhaber entspricht dem Auftraggeber.</option>
                        <option value="true">Der Domaininhaber ist eine andere Person.</option>
                      </select>
                    </label>
                  </div>
                  <div id="ab-domain-holder-fields" class="ab-fields-grid ab-domain-holder-fields" hidden>
                    <h4 class="ab-field-wide">Angaben zum abweichenden Domaininhaber</h4>
                    <label class="ab-field">Vorname<input name="domainHolderFirstName" maxlength="100" autocomplete="off" aria-invalid="false"></label>
                    <label class="ab-field">Nachname<input name="domainHolderLastName" maxlength="100" autocomplete="off" aria-invalid="false"></label>
                    <label class="ab-field ab-field-wide">Straße und Hausnummer<input name="domainHolderStreet" maxlength="200" autocomplete="off" aria-invalid="false"></label>
                    <label class="ab-field">Postleitzahl<input name="domainHolderPostalCode" maxlength="20" autocomplete="off" aria-invalid="false"></label>
                    <label class="ab-field">Ort<input name="domainHolderCity" maxlength="100" autocomplete="off" aria-invalid="false"></label>
                    <label class="ab-field">Land (Ländercode)<input name="domainHolderCountryCode" maxlength="2" placeholder="DE" autocomplete="off" aria-invalid="false"></label>
                    <label class="ab-field">E-Mail-Adresse<input name="domainHolderEmail" type="email" maxlength="254" autocomplete="off" aria-invalid="false"></label>
                  </div>
                  <section class="ab-hostinger-notes" aria-labelledby="ab-hostinger-title">
                    <h4 id="ab-hostinger-title">Hosting und Domain – Rundum Sorglos</h4>
                    <p>${HOSTING_DOMAIN_DETAILS}</p>
                  </section>
                  <label class="ab-consent" data-consent-version="${HOSTINGER_CONSENT_VERSION}">
                    <input name="hostingerConsent" type="checkbox" required aria-invalid="false">
                    <span>${HOSTINGER_CONSENT_TEXT}</span>
                  </label>
                  <p id="ab-fulfillment-error" class="ab-fulfillment-error" role="alert" hidden></p>
                </fieldset>
              </form>
              <p class="ab-payment-note">Der angezeigte Preis wird beim Checkout serverseitig bestätigt. Es wird nichts automatisch heruntergeladen.</p>
              <section id="ab-checkout-review" class="ab-checkout-review" aria-labelledby="ab-checkout-review-title" hidden>
                <h3 id="ab-checkout-review-title">Bestellung prüfen</h3>
                <div id="ab-checkout-review-content"></div>
                <div class="ab-actions">
                  <button id="ab-review-edit" class="ab-save-button" type="button">Zurück zur Auswahl</button>
                  <button id="ab-review-confirm" class="ab-checkout-button" type="button">Weiter zum zahlungspflichtigen Checkout</button>
                </div>
              </section>
              <div class="ab-actions">
                <button id="ab-save" class="ab-save-button" type="button">Entwurf speichern</button>
                <button id="ab-checkout" class="ab-checkout-button" type="button">Bestellung prüfen <span aria-hidden="true">→</span></button>
              </div>
              <p id="ab-status" class="ab-status" role="status" aria-live="polite"></p>
              <button id="ab-new-draft" class="ab-text-button" type="button" hidden>Neuen Serverentwurf starten</button>
            </section>

            <p class="ab-privacy-note">Die Vorschau wird in deinem Browser erzeugt. Beim Speichern werden die Inhalte deiner Website inklusive Cover für deinen privaten Entwurf gespeichert. Auftragsdaten werden bei einem Rundum-sorglos-Checkout separat und nur für die Bestellung serverseitig gespeichert. Entwurfs-Zugangsdaten bleiben lokal in diesem Browser gespeichert; gib diese nicht weiter.</p>
          </section>

          <aside id="ab-preview-panel" class="ab-preview-panel" aria-label="Live-Vorschau deiner Website">
            <div class="ab-preview-heading"><div><span class="ab-live-dot"></span> Live-Vorschau</div><span>Änderungen erscheinen direkt</span></div>
            <iframe id="ab-preview" title="Live-Vorschau der Artist/Band-Website" sandbox=""></iframe>
          </aside>
        </div>
      </main>
      <footer class="ab-footer">
        <span>© ${new Date().getFullYear()} LeanWebsite</span>
        <nav class="ab-footer-links" aria-label="Rechtliche Informationen">
          <a href="/datenschutz">Datenschutzerklärung</a>
          <a href="/widerruf">Widerruf</a>
          <a href="https://matthiasbrehm.de/impressum" target="_blank" rel="noopener noreferrer">Impressum</a>
        </nav>
        <a href="/">Zurück zur Startseite</a>
      </footer>
    </div>
  `

  const form = app.querySelector('#ab-form')
  const fields = app.querySelector('#ab-fields')
  const preview = app.querySelector('#ab-preview')
  setupArtistBandMobileView(app.querySelector('.ab-workspace'), app.querySelector('.ab-mobile-view-switch'))
  const status = app.querySelector('#ab-status')
  const saveButton = app.querySelector('#ab-save')
  const checkoutButton = app.querySelector('#ab-checkout')
  const newDraftButton = app.querySelector('#ab-new-draft')
  const packageBox = app.querySelector('#ab-packages')
  const checkoutReview = app.querySelector('#ab-checkout-review')
  const checkoutReviewContent = app.querySelector('#ab-checkout-review-content')
  const reviewEditButton = app.querySelector('#ab-review-edit')
  const reviewConfirmButton = app.querySelector('#ab-review-confirm')
  const fulfillmentForm = app.querySelector('#ab-fulfillment')
  const fulfillmentFields = app.querySelector('#ab-fulfillment-fields')
  const domainHolderFields = app.querySelector('#ab-domain-holder-fields')
  const artistName = app.querySelector('#ab-artist-name')
  const fulfillmentError = app.querySelector('#ab-fulfillment-error')
  const legalSection = app.querySelector('#ab-legal')
  const legalError = app.querySelector('#ab-legal-error')
  let legalValidationStarted = false
  const coverInput = app.querySelector('#ab-cover')
  const coverName = app.querySelector('#ab-cover-name')
  const coverPreviewWrap = app.querySelector('#ab-cover-preview-wrap')
  const coverPreview = app.querySelector('#ab-cover-preview')
  let data = cloneData(DEFAULT_DATA)
  let draft = null
  let revision = 0
  let savedRevision = -1
  let savePromise = null
  let previewTimer
  let checkoutPending = false
  let coverPromise = null
  let coverProcessingError = false
  let restoreError = ''
  let draftLocked = false

  const packages = getPackagesForBuilder('artist-band')
  packageBox.innerHTML = packages.map((item, index) => `
    <label class="ab-package">
      <input type="radio" name="package" value="${item.code}" ${index === 0 ? 'checked' : ''}>
      <span class="ab-package-content">
        <span class="ab-package-name">${PACKAGE_COPY[item.code].title}</span>
        <span class="ab-package-tagline">${PACKAGE_COPY[item.code].tagline}</span>
        <span class="ab-package-description">${PACKAGE_COPY[item.code].description}</span>
        ${PACKAGE_COPY[item.code].included ? `<span class="ab-package-list-title">Enthalten</span><ul>${PACKAGE_COPY[item.code].included.map((feature) => `<li>${feature}</li>`).join('')}</ul><span class="ab-package-list-title">Nicht enthalten</span><ul>${PACKAGE_COPY[item.code].excluded.map((feature) => `<li>${feature}</li>`).join('')}</ul>` : ''}
      </span>
      <strong>${formatPackagePrice(item.amountCents)}</strong>
    </label>
  `).join('')

  function setStatus(message, kind = '') {
    status.textContent = message
    status.dataset.kind = kind
  }

  function showFulfillmentError(message) {
    fulfillmentError.textContent = message
    fulfillmentError.hidden = !message
  }

  function showFulfillmentErrors(errors) {
    if (!errors || errors.length === 0) {
      showFulfillmentError('')
      for (const field of fulfillmentForm.querySelectorAll('[aria-invalid="true"]')) {
        field.setAttribute('aria-invalid', 'false')
      }
      return
    }

    const errorFields = new Set(errors.map((e) => e.field))
    for (const field of fulfillmentForm.querySelectorAll('[aria-invalid]')) {
      field.setAttribute('aria-invalid', errorFields.has(field.name) ? 'true' : 'false')
    }

    const firstError = errors[0]
    showFulfillmentError(firstError.message)

    const firstErrorField = fulfillmentForm.elements[firstError.field]
    if (firstErrorField) {
      firstErrorField.scrollIntoView({ behavior: 'smooth', block: 'center' })
      firstErrorField.focus()
    }
  }

  function updateDomainHolderFields() {
    const differs = fulfillmentForm.elements.domainHolderDiffers.value === 'true'
    domainHolderFields.hidden = !differs
    for (const input of domainHolderFields.querySelectorAll('input')) input.required = differs
  }

  function updateSelectedPackage() {
    const selectedPackage = packageBox.querySelector('input[name="package"]:checked')?.value
    const showFulfillment = packageRequiresFulfillment(selectedPackage)
    fulfillmentForm.hidden = !showFulfillment
    fulfillmentFields.disabled = !showFulfillment || checkoutPending || draftLocked
    checkoutReview.hidden = true
    checkoutButton.hidden = false
    if (!showFulfillment) showFulfillmentError('')
    updateLegalFields()
    updatePreview()
  }

  function updateLegalFields() {
    const code = !packageRequiresFulfillment(packageBox.querySelector('input[name="package"]:checked')?.value)
    for (const [selector, visible] of [
      ['[data-legal-representative]', data.legal.operatorType !== 'person'],
      ['[data-legal-company]', data.legal.operatorType === 'company'],
      ['[data-legal-register]', data.legal.registered],
      ['[data-legal-editorial]', data.legal.editorial],
      ['[data-legal-code]', code],
      ['[data-legal-hosting-other]', code && data.legal.hostingProvider === 'other'],
      ['[data-legal-domain-other]', code && data.legal.domainProvider === 'other'],
    ]) {
      legalSection.querySelectorAll(selector).forEach((element) => { element.hidden = !visible })
    }
    if (legalValidationStarted) showLegalErrors(false)
  }

  function showLegalErrors(navigate) {
    const packageCode = packageBox.querySelector('input[name="package"]:checked')?.value
    const errors = artistBandLegalErrors(data.legal, packageCode)
    const names = new Set(errors.map((error) => error.field))
    for (const field of legalSection.querySelectorAll('[data-legal]')) {
      field.setAttribute('aria-invalid', String(names.has(field.dataset.legal)))
    }
    legalError.textContent = errors[0]?.message ?? ''
    legalError.hidden = !errors.length
    if (navigate && errors.length) {
      const field = legalSection.querySelector(`[data-legal="${errors[0].field}"]`)
      field.scrollIntoView({ behavior: 'smooth', block: 'center' })
      field.focus({ preventScroll: true })
    }
    return errors.length === 0
  }

  function restoreFulfillmentData(value) {
    if (!value) return
    for (const [key, field] of [
      ['firstName', 'firstName'],
      ['lastName', 'lastName'],
      ['billingStreet', 'billingStreet'],
      ['billingPostalCode', 'billingPostalCode'],
      ['billingCity', 'billingCity'],
      ['billingCountryCode', 'billingCountryCode'],
      ['communicationEmail', 'communicationEmail'],
      ['desiredDomain', 'desiredDomain'],
      ['alternativeDomain', 'alternativeDomain'],
      ['domainHolderFirstName', 'domainHolderFirstName'],
      ['domainHolderLastName', 'domainHolderLastName'],
      ['domainHolderStreet', 'domainHolderStreet'],
      ['domainHolderPostalCode', 'domainHolderPostalCode'],
      ['domainHolderCity', 'domainHolderCity'],
      ['domainHolderCountryCode', 'domainHolderCountryCode'],
      ['domainHolderEmail', 'domainHolderEmail'],
    ]) {
      fulfillmentForm.elements[field].value = value[key] ?? ''
    }
    fulfillmentForm.elements.domainHolderDiffers.value = String(value.domainHolderDiffers === true)
    fulfillmentForm.elements.hostingerConsent.checked = value.hostingerConsent === true
    updateDomainHolderFields()
  }

  function updateCoverPreview() {
    if (!data.cover) {
      coverPreviewWrap.hidden = true
      coverPreview.removeAttribute('src')
      coverName.textContent = 'Wird als JPEG verarbeitet (max. 1,5 MB).'
      return
    }
    coverPreview.src = data.cover
    coverPreviewWrap.hidden = false
    coverName.textContent = 'Cover hinzugefügt.'
  }

  function updatePreview() {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(() => {
      preview.srcdoc = generateArtistBandHtml(data, new Date().getFullYear(), undefined, packageBox.querySelector('input[name="package"]:checked')?.value)
        .replace('<head>', '<head><base href="about:srcdoc">')
    }, 100)
  }

  function markChanged() {
    revision += 1
    artistName.textContent = data.name
    if (!checkoutPending) setStatus('Nicht gespeicherte Änderungen. Speichere den Entwurf vor dem Verlassen der Seite.', 'pending')
    updatePreview()
  }

  function renderList(key) {
    const list = app.querySelector(key === 'tracks' ? '#ab-tracks' : '#ab-gigs')
    const placeholders = key === 'tracks' ? ['Track-Titel', 'Link (optional)'] : ['Datum', 'Ort / Club']
    list.replaceChildren()

    data[key].forEach((item, index) => {
      const row = document.createElement('div')
      row.className = 'ab-list-row'
      const first = document.createElement('input')
      first.maxLength = key === 'tracks' ? 80 : 80
      first.placeholder = placeholders[0]
      first.setAttribute('aria-label', placeholders[0])
      first.value = item.a
      const second = document.createElement('input')
      second.maxLength = 200
      second.placeholder = placeholders[1]
      second.setAttribute('aria-label', placeholders[1])
      second.value = item.b
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'ab-remove'
      remove.textContent = '×'
      remove.setAttribute('aria-label', `${key === 'tracks' ? 'Track' : 'Gig'} entfernen`)
      first.addEventListener('input', () => {
        item.a = first.value
        markChanged()
      })
      second.addEventListener('input', () => {
        item.b = second.value
        markChanged()
      })
      remove.addEventListener('click', () => {
        data[key].splice(index, 1)
        renderList(key)
        markChanged()
      })
      row.append(first, second, remove)
      list.append(row)
    })
  }

  function renderForm() {
    for (const key of FIELD_NAMES) {
      form.elements[key].value = data[key] ?? DEFAULT_DATA[key]
    }
    for (const field of legalSection.querySelectorAll('[data-legal]')) {
      const value = data.legal[field.dataset.legal]
      if (field.type === 'checkbox') field.checked = value
      else field.value = String(value)
    }
    updateLegalFields()
    artistName.textContent = data.name
    renderList('tracks')
    renderList('gigs')
    updateCoverPreview()
    updatePreview()
  }

  function persistDraftReference(reference) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reference))
    } catch {
      throw new Error('Der Entwurf wurde angelegt, aber die Zugangsdaten konnten nicht lokal gespeichert werden. Bitte aktiviere den lokalen Browserspeicher, bevor du fortfährst.')
    }
  }

  async function ensureDraft() {
    if (draft) return draft

    let previous
    try {
      previous = localStorage.getItem(STORAGE_KEY)
    } catch {
      throw new Error('Der lokale Browserspeicher ist nicht verfügbar. Ohne ihn können die Zugangsdaten für die Wiederaufnahme nicht sicher gespeichert werden.')
    }
    if (previous) {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        throw new Error('Die gespeicherte Entwurfsreferenz konnte nicht ersetzt werden. Prüfe bitte die Browserspeicher-Einstellungen.')
      }
    }
    try {
      localStorage.setItem(`${STORAGE_KEY}-probe`, 'x'.repeat(256))
      localStorage.removeItem(`${STORAGE_KEY}-probe`)
    } catch {
      throw new Error('Der lokale Browserspeicher kann die Entwurfs-Zugangsdaten nicht sichern. Prüfe bitte die Browserspeicher-Einstellungen.')
    }

    const reference = await requestJson('/api/drafts', {
      method: 'POST',
      body: { builder: 'artist-band' },
    })
    if (!isDraftReference(reference)) throw new Error('Der Dienst hat ungültige Entwurfs-Zugangsdaten zurückgegeben.')
    persistDraftReference(reference)
    draft = reference
    newDraftButton.hidden = true
    return draft
  }

  async function saveLatest() {
    if (savePromise) return savePromise

    saveButton.disabled = true
    setStatus('Entwurf wird gespeichert …')
    savePromise = (async () => {
      const reference = await ensureDraft()
      while (savedRevision < revision) {
        const saveRevision = revision
        const snapshot = cloneData(data)
        await requestJson(`/api/drafts/${encodeURIComponent(reference.draftId)}`, {
          method: 'PUT',
          token: reference.draftToken,
          body: { builder: 'artist-band', data: snapshot },
        })
        savedRevision = saveRevision
      }
      setStatus('Alle aktuellen Änderungen wurden gespeichert.', 'success')
    })()

    try {
      await savePromise
    } catch (error) {
      setStatus(error.message, 'error')
      throw error
    } finally {
      savePromise = null
      saveButton.disabled = checkoutPending
    }
  }

  async function restoreDraft() {
    let stored
    try {
      stored = localStorage.getItem(STORAGE_KEY)
    } catch {
      setStatus('Der lokale Browserspeicher ist nicht verfügbar. Ein vorhandener Entwurf kann in diesem Browser nicht wiederaufgenommen werden.', 'error')
      return
    }
    if (!stored) return

    let reference
    try {
      reference = JSON.parse(stored)
    } catch {
      restoreError = 'Die lokal gespeicherte Entwurfsreferenz ist ungültig.'
    }

    if (reference && !isDraftReference(reference)) restoreError = 'Die lokal gespeicherte Entwurfsreferenz ist ungültig.'
    if (restoreError) {
      setStatus(`${restoreError} Du kannst einen neuen Entwurf beginnen.`, 'error')
      newDraftButton.hidden = false
      return
    }

    draft = reference
    fields.disabled = true
    setStatus('Gespeicherter Entwurf wird geladen …')
    try {
      const loaded = await requestJson(`/api/drafts/${encodeURIComponent(draft.draftId)}`, { token: draft.draftToken })
      if (loaded.builder !== 'artist-band') throw new Error('Der gespeicherte Entwurf gehört nicht zum Artist/Band-Builder.')
      if (loaded.data) {
        data = cloneData({
          ...loaded.data,
          contentFont: loaded.data.contentFont ?? DEFAULT_DATA.contentFont,
          contentColor: loaded.data.contentColor ?? DEFAULT_DATA.contentColor,
          gigsHeading: loaded.data.gigsHeading?.trim() ? loaded.data.gigsHeading : DEFAULT_DATA.gigsHeading,
        })
        revision = 0
        savedRevision = 0
        renderForm()
        setStatus('Dein gespeicherter Entwurf wurde geladen.', 'success')
      } else {
        savedRevision = -1
        setStatus('Dein Entwurf ist bereit. Speichere deine Änderungen, um sie zu sichern.')
      }
      if (loaded.fulfillmentData) {
        packageBox.querySelector('input[value="artist-band-rundum-sorglos"]').checked = true
        restoreFulfillmentData(loaded.fulfillmentData)
        updateSelectedPackage()
      }
      if (loaded.status === 'locked') {
        draftLocked = true
        saveButton.disabled = true
        checkoutButton.disabled = true
        fulfillmentFields.disabled = true
        newDraftButton.hidden = false
        setStatus('Dieser Entwurf ist gesperrt und kann nicht mehr bearbeitet oder gekauft werden.', 'error')
      }
    } catch (error) {
      draft = null
      restoreError = error.message
      setStatus(`Der gespeicherte Entwurf konnte nicht geladen werden: ${error.message}`, 'error')
      newDraftButton.hidden = false
    } finally {
      fields.disabled = draftLocked
    }
  }

  form.addEventListener('input', (event) => {
    const legalKey = event.target.dataset.legal
    if (legalKey && event.target.tagName !== 'SELECT') {
      data.legal[legalKey] = event.target.type === 'checkbox' ? event.target.checked : event.target.value
      updateLegalFields()
      markChanged()
      return
    }
    const key = event.target.name
    if (!FIELD_NAMES.includes(key) || event.target.tagName === 'SELECT') return
    data[key] = event.target.value
    markChanged()
  })

  form.addEventListener('change', (event) => {
    const legalKey = event.target.dataset.legal
    if (legalKey && event.target.tagName === 'SELECT') {
      data.legal[legalKey] = ['registered', 'editorial'].includes(legalKey) ? event.target.value === 'true' : event.target.value
      updateLegalFields()
      markChanged()
      return
    }
    const key = event.target.name
    if (event.target.tagName !== 'SELECT' || !FIELD_NAMES.includes(key) || data[key] === event.target.value) return
    data[key] = event.target.value
    markChanged()
  })

  form.addEventListener('submit', (event) => event.preventDefault())

  packageBox.addEventListener('change', updateSelectedPackage)
  fulfillmentForm.addEventListener('change', (event) => {
    if (event.target.name === 'domainHolderDiffers') {
      updateDomainHolderFields()
      if (event.target.getAttribute('aria-invalid') === 'true') {
        event.target.setAttribute('aria-invalid', 'false')
      }
    }
    showFulfillmentError('')
  })
  fulfillmentForm.addEventListener('input', (event) => {
    if (event.target.form === fulfillmentForm) {
      const field = event.target
      if (field.getAttribute('aria-invalid') === 'true') {
        field.setAttribute('aria-invalid', 'false')
      }
    }
  })

  app.querySelector('#ab-add-track').addEventListener('click', () => {
    if (data.tracks.length >= 20) {
      setStatus('Es können höchstens 20 Tracks hinzugefügt werden.', 'error')
      return
    }
    data.tracks.push({ a: '', b: '' })
    renderList('tracks')
    markChanged()
  })
  app.querySelector('#ab-add-gig').addEventListener('click', () => {
    if (data.gigs.length >= 20) {
      setStatus('Es können höchstens 20 Gigs hinzugefügt werden.', 'error')
      return
    }
    data.gigs.push({ a: '', b: '' })
    renderList('gigs')
    markChanged()
  })

  coverInput.addEventListener('change', async () => {
    const [file] = coverInput.files
    if (!file) return
    coverInput.disabled = true
    coverProcessingError = false
    setStatus('Cover wird verarbeitet …')
    coverPromise = (async () => {
      try {
        data.cover = await encodeCover(file)
        updateCoverPreview()
        markChanged()
      } catch (error) {
        coverProcessingError = true
        setStatus(error.message, 'error')
      } finally {
        coverInput.value = ''
        coverInput.disabled = false
        coverPromise = null
      }
    })()
    await coverPromise
  })
  app.querySelector('#ab-remove-cover').addEventListener('click', () => {
    data.cover = ''
    coverProcessingError = false
    updateCoverPreview()
    markChanged()
  })

  saveButton.addEventListener('click', () => {
    saveLatest().catch((error) => setStatus(error.message, 'error'))
  })

  function showCheckoutReview() {
    if (checkoutPending) return
    const selectedPackage = packageBox.querySelector('input[name="package"]:checked')?.value
    if (!packages.some((item) => item.code === selectedPackage)) {
      setStatus('Bitte wähle ein gültiges Paket aus.', 'error')
      return
    }

    legalValidationStarted = true
    if (!showLegalErrors(true)) return

    try {
      if (packageRequiresFulfillment(selectedPackage)) {
        const formData = {
          firstName: fulfillmentForm.elements.firstName.value,
          lastName: fulfillmentForm.elements.lastName.value,
          billingStreet: fulfillmentForm.elements.billingStreet.value,
          billingPostalCode: fulfillmentForm.elements.billingPostalCode.value,
          billingCity: fulfillmentForm.elements.billingCity.value,
          billingCountryCode: fulfillmentForm.elements.billingCountryCode.value,
          communicationEmail: fulfillmentForm.elements.communicationEmail.value,
          desiredDomain: fulfillmentForm.elements.desiredDomain.value,
          alternativeDomain: fulfillmentForm.elements.alternativeDomain.value,
          domainHolderDiffers: fulfillmentForm.elements.domainHolderDiffers.value === 'true',
          domainHolderFirstName: fulfillmentForm.elements.domainHolderFirstName.value,
          domainHolderLastName: fulfillmentForm.elements.domainHolderLastName.value,
          domainHolderStreet: fulfillmentForm.elements.domainHolderStreet.value,
          domainHolderPostalCode: fulfillmentForm.elements.domainHolderPostalCode.value,
          domainHolderCity: fulfillmentForm.elements.domainHolderCity.value,
          domainHolderCountryCode: fulfillmentForm.elements.domainHolderCountryCode.value,
          domainHolderEmail: fulfillmentForm.elements.domainHolderEmail.value,
          hostingerConsent: fulfillmentForm.elements.hostingerConsent.checked,
        }
        const errors = validateArtistBandFulfillmentForUI(formData)
        if (errors.length > 0) {
          showFulfillmentErrors(errors)
          setStatus('')
          return
        }
        collectArtistBandFulfillment(fulfillmentForm)
      }
      checkoutReviewContent.innerHTML = renderCheckoutReview({
        packageCode: selectedPackage,
        builderLabel: 'Artist & Band',
      })
      checkoutReview.hidden = false
      checkoutButton.hidden = true
      checkoutReview.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      setStatus('')
    } catch (error) {
      showFulfillmentError(packageRequiresFulfillment(selectedPackage) ? error.message : '')
      setStatus(error.message, 'error')
    }
  }

  async function beginCheckout() {
    if (checkoutPending) return
    const selectedPackage = packageBox.querySelector('input[name="package"]:checked')?.value
    if (!packages.some((item) => item.code === selectedPackage)) {
      setStatus('Bitte wähle ein gültiges Paket aus.', 'error')
      return
    }

    checkoutPending = true
    fields.disabled = true
    fulfillmentFields.disabled = true
    packageBox.querySelectorAll('input').forEach((input) => { input.disabled = true })
    checkoutButton.disabled = true
    saveButton.disabled = true
    setStatus('Änderungen werden gespeichert, danach öffnet sich der sichere Checkout …')

    try {
      if (coverPromise) await coverPromise
      if (coverProcessingError) throw new Error('Bitte lade ein gültiges Cover hoch oder entferne das fehlerhafte Cover, bevor du fortfährst.')
      await saveLatest()
      const orderData = selectedPackage === 'artist-band-rundum-sorglos'
        ? collectArtistBandFulfillment(fulfillmentForm)
        : null
      const reference = draft
      const checkout = await requestJson('/api/checkout', {
        method: 'POST',
        body: createArtistBandCheckoutPayload({
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
      fields.disabled = false
      updateSelectedPackage()
      packageBox.querySelectorAll('input').forEach((input) => { input.disabled = false })
      checkoutButton.disabled = false
      saveButton.disabled = false
      showFulfillmentError(selectedPackage === 'artist-band-rundum-sorglos' ? error.message : '')
      setStatus(error.message, 'error')
    }
  }

  checkoutButton.addEventListener('click', showCheckoutReview)
  reviewEditButton.addEventListener('click', () => {
    checkoutReview.hidden = true
    checkoutButton.hidden = false
    checkoutButton.focus()
  })
  reviewConfirmButton.addEventListener('click', beginCheckout)

  newDraftButton.addEventListener('click', () => {
    if (savePromise || checkoutPending || coverPromise) {
      setStatus('Warte, bis der laufende Vorgang abgeschlossen ist, bevor du einen neuen Serverentwurf startest.', 'error')
      return
    }
    if (!window.confirm('Die lokale Zuordnung zum bisherigen Serverentwurf wird aufgehoben. Der Serverentwurf und bestehende Bestellungen bleiben unverändert bestehen. Deine aktuellen Eingaben werden auf den Ausgangszustand zurückgesetzt. Fortfahren?')) return

    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      setStatus('Die gespeicherte Entwurfsreferenz konnte nicht entfernt werden.', 'error')
      return
    }

    draft = null
    draftLocked = false
    restoreError = ''
    revision = 0
    savedRevision = -1
    data = cloneData(DEFAULT_DATA)
    renderForm()
    fulfillmentForm.reset()
    coverInput.value = ''
    showFulfillmentError('')
    packageBox.querySelectorAll('input').forEach((input, index) => {
      input.disabled = false
      input.checked = index === 0
    })
    fields.disabled = false
    saveButton.disabled = false
    checkoutButton.disabled = false
    coverProcessingError = false
    updateDomainHolderFields()
    updateSelectedPackage()
    newDraftButton.hidden = true
    setStatus('Neuer Entwurf bereit. Der Serverentwurf wird beim ersten Speichern angelegt.', 'success')
  })

  renderForm()
  updateDomainHolderFields()
  updateSelectedPackage()
  restoreDraft()
}
