import withdrawalMarkdown from './data/withdrawal-page.md?raw'
import { renderWithdrawalMarkdown } from './withdrawal-markdown.js'

const EMPTY_VALUE = 'Nicht angegeben'

export function renderWithdrawalPage(app) {
  document.title = 'Widerruf – LeanWebsite Studio'
  app.classList.remove('app-builder', 'business-builder')
  app.innerHTML = `
    <div class="privacy-page withdrawal-page">
      <header class="site-header">
        <a class="brand" href="/" aria-label="LeanWebsite Startseite">
          <span class="brand-mark" aria-hidden="true">L</span>
          <span>LeanWebsite</span>
        </a>
        <a class="header-link" href="/">Zur Startseite <span aria-hidden="true">↗</span></a>
      </header>
      <main class="privacy-content">
        <article class="privacy-document">
          ${renderWithdrawalMarkdown(withdrawalMarkdown)}
          <section class="withdrawal-action" aria-labelledby="withdrawal-action-title">
            <h2 id="withdrawal-action-title">Elektronischer Widerruf</h2>
            <p>Sie können Ihre Widerrufserklärung hier elektronisch übermitteln.</p>
            <button class="withdrawal-primary" id="withdrawal-start" type="button">Vertrag widerrufen</button>
            <form id="withdrawal-form" class="withdrawal-form" hidden novalidate>
              <label>Name *
                <input name="customerName" maxlength="200" autocomplete="name" required>
              </label>
              <label>E-Mail-Adresse *
                <input name="customerEmail" type="email" maxlength="254" autocomplete="email" required>
              </label>
              <label>Bestellnummer (optional)
                <input name="orderReference" maxlength="200" autocomplete="off">
              </label>
              <label>Weitere Angaben zur Identifizierung des Vertrags (optional)
                <textarea name="message" rows="4" maxlength="5000"></textarea>
              </label>
              <label class="withdrawal-honeypot" aria-hidden="true">
                Website
                <input name="website" tabindex="-1" autocomplete="off">
              </label>
              <p class="withdrawal-form-error" id="withdrawal-error" role="alert" hidden></p>
              <button class="withdrawal-secondary" id="withdrawal-review" type="button">Angaben prüfen</button>
              <section id="withdrawal-review-panel" class="withdrawal-review" aria-labelledby="withdrawal-review-title" hidden>
                <h3 id="withdrawal-review-title">Bitte prüfen Sie Ihre Angaben</h3>
                <dl>
                  <div><dt>Name</dt><dd id="withdrawal-review-name"></dd></div>
                  <div><dt>E-Mail-Adresse</dt><dd id="withdrawal-review-email"></dd></div>
                  <div><dt>Bestellnummer</dt><dd id="withdrawal-review-order"></dd></div>
                  <div><dt>Weitere Angaben</dt><dd id="withdrawal-review-message"></dd></div>
                </dl>
                <div class="withdrawal-review-actions">
                  <button class="withdrawal-secondary" id="withdrawal-edit" type="button">Angaben ändern</button>
                  <button class="withdrawal-primary" id="withdrawal-submit" type="button">Widerruf bestätigen</button>
                </div>
              </section>
            </form>
            <section id="withdrawal-success" class="withdrawal-success" role="status" aria-live="polite" hidden>
              <h3>Ihre Erklärung wurde übermittelt</h3>
              <p>Eine persönliche Eingangsbestätigung per E-Mail folgt.</p>
              <dl>
                <div><dt>Eingegangen am</dt><dd id="withdrawal-received-at"></dd></div>
                <div><dt>Widerrufskennung</dt><dd id="withdrawal-id"></dd></div>
              </dl>
            </section>
          </section>
        </article>
      </main>
      <footer class="site-footer">
        <a class="brand footer-brand" href="/" aria-label="LeanWebsite Startseite">
          <span class="brand-mark" aria-hidden="true">L</span>
          <span>LeanWebsite</span>
        </a>
        <nav class="privacy-footer-links" aria-label="Rechtliche Informationen">
          <a href="https://matthiasbrehm.de/impressum" target="_blank" rel="noopener noreferrer">Impressum</a>
          <a href="/datenschutz">Datenschutzerklärung</a>
          <a href="/widerruf" aria-current="page">Widerruf</a>
        </nav>
      </footer>
    </div>
  `

  const form = app.querySelector('#withdrawal-form')
  const startButton = app.querySelector('#withdrawal-start')
  const reviewPanel = app.querySelector('#withdrawal-review-panel')
  const submitButton = app.querySelector('#withdrawal-submit')
  const error = app.querySelector('#withdrawal-error')
  let submissionPending = false

  const setError = (message) => {
    error.textContent = message
    error.hidden = !message
  }

  startButton.addEventListener('click', () => {
    form.hidden = false
    startButton.hidden = true
    form.elements.customerName.focus()
  })

  app.querySelector('#withdrawal-review').addEventListener('click', () => {
    if (!form.reportValidity()) return

    app.querySelector('#withdrawal-review-name').textContent = form.elements.customerName.value.trim()
    app.querySelector('#withdrawal-review-email').textContent = form.elements.customerEmail.value.trim()
    app.querySelector('#withdrawal-review-order').textContent = form.elements.orderReference.value.trim() || EMPTY_VALUE
    app.querySelector('#withdrawal-review-message').textContent = form.elements.message.value.trim() || EMPTY_VALUE
    reviewPanel.hidden = false
    setError('')
    reviewPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })

  form.addEventListener('input', () => {
    reviewPanel.hidden = true
  })

  app.querySelector('#withdrawal-edit').addEventListener('click', () => {
    reviewPanel.hidden = true
    form.elements.customerName.focus()
  })

  submitButton.addEventListener('click', async () => {
    if (submissionPending || !form.reportValidity()) return

    submissionPending = true
    submitButton.disabled = true
    setError('')

    try {
      const response = await fetch('/api/withdrawals', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: form.elements.customerName.value,
          customerEmail: form.elements.customerEmail.value,
          orderReference: form.elements.orderReference.value,
          message: form.elements.message.value,
          website: form.elements.website.value,
        }),
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error('Die Antwort des Dienstes konnte nicht gelesen werden.')
      }
      if (!response.ok) throw new Error(payload?.error || 'Die Übermittlung ist fehlgeschlagen.')

      const receivedAt = new Date(payload.receivedAt)
      if (!payload.withdrawalId || Number.isNaN(receivedAt.getTime())) {
        throw new Error('Die Antwort des Dienstes ist ungültig. Bitte kontaktiere uns.')
      }

      app.querySelector('#withdrawal-received-at').textContent = new Intl.DateTimeFormat('de-DE', {
        dateStyle: 'long',
        timeStyle: 'medium',
        timeZone: 'Europe/Berlin',
      }).format(receivedAt)
      app.querySelector('#withdrawal-id').textContent = payload.withdrawalId
      form.hidden = true
      app.querySelector('#withdrawal-success').hidden = false
      app.querySelector('#withdrawal-success').scrollIntoView({ block: 'center', behavior: 'smooth' })
    } catch (submissionError) {
      setError(submissionError.message || 'Die Übermittlung ist fehlgeschlagen. Bitte versuche es erneut.')
      submissionPending = false
      submitButton.disabled = false
    }
  })
}
