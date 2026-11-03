import { getPackagesForBuilder } from '../shared/packages.js'
import { generateArtistBandHtml } from '../shared/artist-band-template.js'

const STORAGE_KEY = 'leanwebsite-artist-band-draft-v1'
const MAX_COVER_BYTES = 1.5 * 1024 * 1024

const DEFAULT_DATA = {
  name: 'DJ Nova',
  genre: 'Techno · Acid · Electro',
  tagline: 'Basslines für die Nacht.',
  bio: 'Produzent und DJ aus der Posse. Treibende Grooves, analoge Wärme und viel Acid.',
  accent: '#c6ff00',
  theme: 'dark',
  spotify: '',
  soundcloud: '',
  bandcamp: '',
  instagram: '',
  email: '',
  cover: '',
  tracks: [{ a: 'Midnight Acid', b: '' }],
  gigs: [{ a: '2026-11-21', b: 'Berlin · Club Posse' }],
}

const FIELD_NAMES = [
  'name', 'genre', 'tagline', 'bio', 'accent', 'theme',
  'spotify', 'soundcloud', 'bandcamp', 'instagram', 'email',
]

function cloneData(data) {
  return {
    ...data,
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

        <div class="ab-workspace">
          <section class="ab-editor" aria-label="Website-Inhalte bearbeiten">
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
                    <label class="ab-field">Cover-Bild<span class="ab-file-control"><input id="ab-cover" type="file" accept="image/*"><span>Bild auswählen</span></span><span id="ab-cover-name" class="ab-field-hint">Wird als JPEG verarbeitet (max. 1,5 MB).</span></label>
                  </div>
                  <div id="ab-cover-preview-wrap" class="ab-cover-preview-wrap" hidden><img id="ab-cover-preview" alt="Vorschau des Cover-Bildes"><button id="ab-remove-cover" class="ab-text-button" type="button">Cover entfernen</button></div>
                </section>

                <section class="ab-card">
                  <div class="ab-card-heading"><span>02</span><div><h2>Releases &amp; Live</h2><p>Füge Songs und kommende Termine hinzu.</p></div></div>
                  <div class="ab-list-section"><div class="ab-list-title"><h3>Tracks</h3><button class="ab-add" id="ab-add-track" type="button">+ Track hinzufügen</button></div><div id="ab-tracks" class="ab-list"></div></div>
                  <div class="ab-list-section"><div class="ab-list-title"><h3>Gigs</h3><button class="ab-add" id="ab-add-gig" type="button">+ Gig hinzufügen</button></div><div id="ab-gigs" class="ab-list"></div></div>
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
              </fieldset>
            </form>

            <section class="ab-card ab-buy-card" aria-labelledby="ab-package-title">
              <div class="ab-card-heading"><span>04</span><div><h2 id="ab-package-title">Deine Website kaufen</h2><p>Wähle das passende Artist/Band-Paket.</p></div></div>
              <div id="ab-packages" class="ab-packages"></div>
              <p class="ab-payment-note">Der angezeigte Preis wird beim Checkout serverseitig bestätigt. Es wird nichts automatisch heruntergeladen.</p>
              <div class="ab-actions">
                <button id="ab-save" class="ab-save-button" type="button">Entwurf speichern</button>
                <button id="ab-checkout" class="ab-checkout-button" type="button">Weiter zum sicheren Checkout <span aria-hidden="true">→</span></button>
              </div>
              <p id="ab-status" class="ab-status" role="status" aria-live="polite"></p>
              <button id="ab-new-draft" class="ab-text-button" type="button" hidden>Neuen Entwurf beginnen</button>
            </section>

            <p class="ab-privacy-note">Die Vorschau wird in deinem Browser erzeugt. Beim Speichern und Checkout werden deine Formularinhalte inklusive eines hochgeladenen Covers an LeanWebsite übertragen und für deinen privaten Entwurf gespeichert. Entwurfs-Zugangsdaten bleiben lokal in diesem Browser gespeichert; gib diese nicht weiter.</p>
          </section>

          <aside class="ab-preview-panel" aria-label="Live-Vorschau deiner Website">
            <div class="ab-preview-heading"><div><span class="ab-live-dot"></span> Live-Vorschau</div><span>Änderungen erscheinen direkt</span></div>
            <iframe id="ab-preview" title="Live-Vorschau der Artist/Band-Website" sandbox=""></iframe>
          </aside>
        </div>
      </main>
      <footer class="ab-footer"><span>© ${new Date().getFullYear()} LeanWebsite</span><a href="/">Zurück zur Startseite</a></footer>
    </div>
  `

  const form = app.querySelector('#ab-form')
  const fields = app.querySelector('#ab-fields')
  const preview = app.querySelector('#ab-preview')
  const status = app.querySelector('#ab-status')
  const saveButton = app.querySelector('#ab-save')
  const checkoutButton = app.querySelector('#ab-checkout')
  const newDraftButton = app.querySelector('#ab-new-draft')
  const packageBox = app.querySelector('#ab-packages')
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

  const packages = getPackagesForBuilder('artist-band')
  packageBox.innerHTML = packages.map((item, index) => `
    <label class="ab-package">
      <input type="radio" name="package" value="${item.code}" ${index === 0 ? 'checked' : ''}>
      <span class="ab-package-content"><span class="ab-package-name">${item.name}</span><span class="ab-package-description">Artist/Band-Website</span></span>
      <strong>${formatPackagePrice(item.amountCents)}</strong>
    </label>
  `).join('')

  function setStatus(message, kind = '') {
    status.textContent = message
    status.dataset.kind = kind
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
      preview.srcdoc = generateArtistBandHtml(data, new Date().getFullYear())
    }, 100)
  }

  function markChanged() {
    revision += 1
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
    for (const key of FIELD_NAMES) form.elements[key].value = data[key]
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
    let draftLocked = false
    try {
      const loaded = await requestJson(`/api/drafts/${encodeURIComponent(draft.draftId)}`, { token: draft.draftToken })
      if (loaded.builder !== 'artist-band') throw new Error('Der gespeicherte Entwurf gehört nicht zum Artist/Band-Builder.')
      if (loaded.data) {
        data = cloneData(loaded.data)
        revision = 0
        savedRevision = 0
        renderForm()
        setStatus('Dein gespeicherter Entwurf wurde geladen.', 'success')
      } else {
        savedRevision = -1
        setStatus('Dein Entwurf ist bereit. Speichere deine Änderungen, um sie zu sichern.')
      }
      if (loaded.status === 'locked') {
        draftLocked = true
        saveButton.disabled = true
        checkoutButton.disabled = true
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
    const key = event.target.name
    if (!FIELD_NAMES.includes(key)) return
    data[key] = event.target.value
    markChanged()
  })

  form.addEventListener('submit', (event) => event.preventDefault())

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

  checkoutButton.addEventListener('click', async () => {
    const selectedPackage = packageBox.querySelector('input[name="package"]:checked')?.value
    if (!packages.some((item) => item.code === selectedPackage)) {
      setStatus('Bitte wähle ein gültiges Paket aus.', 'error')
      return
    }

    checkoutPending = true
    fields.disabled = true
    packageBox.querySelectorAll('input').forEach((input) => { input.disabled = true })
    checkoutButton.disabled = true
    saveButton.disabled = true
    setStatus('Änderungen werden gespeichert, danach öffnet sich der sichere Checkout …')

    try {
      if (coverPromise) await coverPromise
      if (coverProcessingError) throw new Error('Bitte lade ein gültiges Cover hoch oder entferne das fehlerhafte Cover, bevor du fortfährst.')
      await saveLatest()
      const reference = draft
      const checkout = await requestJson('/api/checkout', {
        method: 'POST',
        body: {
          builder: 'artist-band',
          package: selectedPackage,
          draftId: reference.draftId,
          draftToken: reference.draftToken,
        },
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
      packageBox.querySelectorAll('input').forEach((input) => { input.disabled = false })
      checkoutButton.disabled = false
      saveButton.disabled = false
      setStatus(error.message, 'error')
    }
  })

  newDraftButton.addEventListener('click', () => {
    try {
      localStorage.removeItem(STORAGE_KEY)
      draft = null
      restoreError = ''
      savedRevision = -1
      fields.disabled = false
      saveButton.disabled = false
      checkoutButton.disabled = false
      packageBox.querySelectorAll('input').forEach((input) => { input.disabled = false })
      setStatus('Ein neuer Entwurf wird beim ersten Speichern angelegt.')
      newDraftButton.hidden = true
    } catch {
      setStatus('Die gespeicherte Entwurfsreferenz konnte nicht entfernt werden.', 'error')
    }
  })

  renderForm()
  restoreDraft()
}
