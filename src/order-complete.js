const STORAGE_KEY = 'leanwebsite-artist-band-draft-v1'
const POLL_INTERVAL_MS = 4000
const MAX_POLLS = 45

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN = /^[A-Za-z0-9_-]{43}$/

function readCredentials() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return value && UUID.test(value.draftId) && TOKEN.test(value.draftToken) ? value : null
  } catch {
    return null
  }
}

async function postJson(url, credentials) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ draftId: credentials.draftId, draftToken: credentials.draftToken }),
    cache: 'no-store',
    credentials: 'omit',
  })
}

export function renderOrderComplete(app) {
  // The return parameter is only a hint for the wording. It never grants anything.
  const returnedCancelled = new URLSearchParams(window.location.search).get('checkout') === 'cancelled'

  app.innerHTML = `
    <div class="ab-page">
      <header class="ab-header">
        <a class="ab-brand" href="/" aria-label="Zur LeanWebsite-Startseite">
          <span class="ab-brand-mark" aria-hidden="true">L</span><span>LeanWebsite</span>
        </a>
        <a class="ab-back" href="/builder/artist-band">Zum Builder <span aria-hidden="true">↗</span></a>
      </header>
      <main class="ab-main">
        <section class="ab-card oc-card" aria-labelledby="oc-title" aria-live="polite">
          <h1 id="oc-title">Deine Bestellung</h1>
          <p id="oc-message" class="ab-status" data-kind="pending">Bestellstatus wird geprüft …</p>
          <p id="oc-notice" class="ab-field-hint" hidden></p>
          <div class="oc-actions">
            <button id="oc-download" class="ab-checkout-button" type="button" hidden>Website herunterladen <span aria-hidden="true">↓</span></button>
            <button id="oc-refresh" class="ab-text-button" type="button" hidden>Status erneut prüfen</button>
            <a id="oc-builder" class="ab-text-button" href="/builder/artist-band" hidden>Zurück zum Builder</a>
          </div>
        </section>
      </main>
    </div>`

  const message = app.querySelector('#oc-message')
  const notice = app.querySelector('#oc-notice')
  const downloadButton = app.querySelector('#oc-download')
  const refreshButton = app.querySelector('#oc-refresh')
  const builderLink = app.querySelector('#oc-builder')
  let polls = 0
  let timer = null
  let credentials = null

  const show = (text, kind) => {
    message.textContent = text
    message.dataset.kind = kind
  }

  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(check, POLL_INTERVAL_MS)
  }

  async function check() {
    refreshButton.hidden = true
    let response

    try {
      response = await postJson('/api/orders/status', credentials)
    } catch {
      show('Die Verbindung zum Server ist fehlgeschlagen. Bitte versuche es erneut.', 'error')
      refreshButton.hidden = false
      return
    }

    if (!response.ok) {
      show(
        response.status === 404
          ? 'Zu diesem Browser wurde keine passende Bestellung gefunden.'
          : 'Der Bestellstatus konnte nicht abgerufen werden. Bitte versuche es später erneut.',
        'error',
      )
      refreshButton.hidden = response.status === 404
      builderLink.hidden = false
      return
    }

    const order = await response.json()

    if (order.package?.notice) {
      notice.textContent = order.package.notice
      notice.hidden = false
    }

    if (order.status === 'paid' && order.downloadAvailable) {
      show(`Zahlung bestätigt${order.package ? ` – Paket „${order.package.name}“` : ''}. Deine Website steht bereit.`, 'success')
      downloadButton.hidden = false
    } else if (order.status === 'pending') {
      polls += 1
      downloadButton.hidden = true

      if (polls >= MAX_POLLS) {
        show('Die Zahlungsbestätigung steht noch aus. Das kann bei manchen Zahlungsarten etwas dauern. Du kannst den Status später erneut prüfen.', 'pending')
        refreshButton.hidden = false
        return
      }

      show(
        returnedCancelled
          ? 'Der Bezahlvorgang wurde abgebrochen oder ist noch nicht bestätigt. Ein Download ist erst nach bestätigter Zahlung möglich.'
          : 'Wir warten auf die Zahlungsbestätigung von Stripe. Das dauert meist nur wenige Sekunden. Diese Seite aktualisiert sich selbst.',
        'pending',
      )
      builderLink.hidden = !returnedCancelled
      schedule()
    } else {
      downloadButton.hidden = true
      show(
        order.status === 'none'
          ? 'Es wurde noch keine Bestellung gestartet. Ein Download ist nicht möglich.'
          : 'Die Zahlung wurde nicht abgeschlossen. Ein Download ist nicht möglich.',
        'error',
      )
      builderLink.hidden = false
    }
  }

  downloadButton.addEventListener('click', async () => {
    downloadButton.disabled = true
    show('Download wird vorbereitet …', 'pending')

    try {
      const response = await postJson('/api/orders/download', credentials)

      if (!response.ok) {
        const code = (await response.json().catch(() => ({}))).code
        show(
          code === 'not_paid'
            ? 'Die Zahlung ist noch nicht bestätigt.'
            : 'Die Website konnte gerade nicht bereitgestellt werden. Es wurde nichts heruntergeladen. Bitte versuche es später erneut oder kontaktiere uns.',
          'error',
        )
        return
      }

      const url = URL.createObjectURL(await response.blob())
      const link = Object.assign(document.createElement('a'), { href: url, download: 'website.html' })
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      show('Download gestartet. Bewahre die Datei gut auf.', 'success')
    } catch {
      show('Der Download ist fehlgeschlagen. Bitte versuche es erneut.', 'error')
    } finally {
      downloadButton.disabled = false
    }
  })

  refreshButton.addEventListener('click', () => {
    polls = 0
    show('Bestellstatus wird geprüft …', 'pending')
    check()
  })

  credentials = readCredentials()

  if (!credentials) {
    show('In diesem Browser sind keine Bestelldaten gespeichert. Bitte öffne die Seite im selben Browser, in dem du bestellt hast.', 'error')
    builderLink.hidden = false
    return
  }

  check()
}
