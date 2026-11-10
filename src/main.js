import './style.css'
import { builders } from './data/builders.js'
import { renderArtistBandBuilder } from './artist-band-builder.js'
import { renderBusinessBuilder } from './business-builder.js'
import { renderOrderComplete } from './order-complete.js'
import { renderPrivacyPolicyPage } from './privacy-policy-page.js'
import { renderWithdrawalPage } from './withdrawal-page.js'

const app = document.querySelector('#app')
const path = window.location.pathname.replace(/\/$/, '')

if (path === '/datenschutz') {
  renderPrivacyPolicyPage(app)
} else if (path === '/widerruf') {
  renderWithdrawalPage(app)
} else if (path === '/builder/artist-band') {
  renderArtistBandBuilder(app)
} else if (path === '/builder/business') {
  renderBusinessBuilder(app)
} else if (path === '/order/complete') {
  renderOrderComplete(app)
} else {
app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="/" aria-label="LeanWebsite Startseite">
      <span class="brand-mark" aria-hidden="true">L</span>
      <span>LeanWebsite Studio</span>
    </a>
    <a class="header-link" href="#builder">Builder entdecken <span aria-hidden="true">↘</span></a>
  </header>

  <main>
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="eyebrow"><span class="eyebrow-dot"></span> Einfach online gehen</p>
        <h1 id="hero-title">Deine Website.<br /><span>Dein nächster Schritt.</span></h1>
        <p class="hero-description">
          Wähle den Website-Builder, der zu dir passt. Klar aufgebaut, auf das Wesentliche konzentriert.
        </p>
        <a class="primary-link" href="#builder">
          Passenden Builder finden <span aria-hidden="true">↓</span>
        </a>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="art-orbit orbit-one"></div>
        <div class="art-orbit orbit-two"></div>
        <div class="art-sun"></div>
        <div class="art-panel">
          <div class="art-panel-top"><span></span><span></span><span></span></div>
          <div class="art-panel-content">
            <div class="art-line art-line-short"></div>
            <div class="art-line art-line-long"></div>
            <div class="art-preview">
              <div class="art-preview-block"></div>
              <div class="art-preview-copy">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        </div>
        <span class="art-label">Dein Auftritt, dein Anfang.</span>
      </div>
    </section>

    <section class="builder-section" id="builder" aria-labelledby="builder-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Finde deinen Einstieg</p>
          <h2 id="builder-title">Was möchtest du gestalten?</h2>
        </div>
        <p class="section-note">Zwei Wege. Ein klarer Start.</p>
      </div>
      <div class="builder-grid" id="builder-list"></div>
      <p class="selection-status" id="selection-status" aria-live="polite">
        Wähle einen Bereich, um mehr zu erfahren.
      </p>
    </section>

    <section class="closing-note" aria-label="Über LeanWebsite">
      <span class="closing-mark" aria-hidden="true">L</span>
      <p>Weniger Hürden. Mehr Raum für deine Idee.</p>
    </section>
  </main>

  <footer class="site-footer">
    <a class="brand footer-brand" href="/" aria-label="LeanWebsite Startseite">
      <span class="brand-mark" aria-hidden="true">L</span>
      <span>LeanWebsite Studio</span>
    </a>
    <p>Ein guter Anfang für deinen Webauftritt.</p>
    <nav class="site-footer-links" aria-label="Rechtliche Informationen">
      <a href="/datenschutz">Datenschutzerklärung</a>
      <a href="/widerruf">Widerruf</a>
      <a href="https://matthiasbrehm.de/impressum" target="_blank" rel="noopener noreferrer">Impressum</a>
      <a href="https://github.com/dubposse/leanwebsite/blob/main/LICENSING.md" target="_blank" rel="noopener noreferrer">Lizenz</a>
    </nav>
  </footer>
`

const builderList = document.querySelector('#builder-list')
const selectionStatus = document.querySelector('#selection-status')

builderList.innerHTML = builders
  .map(
    (builder, index) => `
      <button
        class="builder-card"
        type="button"
        data-builder-id="${builder.id}"
        aria-pressed="false"
      >
        <span class="card-topline">
          <span class="card-number">0${index + 1}</span>
          <span class="card-icon" aria-hidden="true">${builder.icon}</span>
        </span>
        <span class="card-content">
          <span class="card-category">${builder.category}</span>
          <span class="card-title">${builder.name}</span>
          <span class="card-description">${builder.description}</span>
        </span>
        <span class="card-bottom">
          <span class="card-audience">${builder.audience}</span>
          <span class="card-action">Auswählen <span aria-hidden="true">↗</span></span>
        </span>
      </button>
    `,
  )
  .join('')

builderList.addEventListener('click', (event) => {
  const selectedCard = event.target.closest('[data-builder-id]')

  if (!selectedCard) return

  const selectedBuilder = builders.find((builder) => builder.id === selectedCard.dataset.builderId)

  if (!selectedBuilder) return

  builderList.querySelectorAll('[data-builder-id]').forEach((card) => {
    const isSelected = card === selectedCard
    card.setAttribute('aria-pressed', String(isSelected))
    card.querySelector('.card-action').innerHTML = isSelected
      ? 'Ausgewählt <span aria-hidden="true">✓</span>'
      : 'Auswählen <span aria-hidden="true">↗</span>'
  })

  selectionStatus.replaceChildren(
    document.createTextNode(
      selectedBuilder.url
        ? `${selectedBuilder.name} ist ausgewählt. `
        : `${selectedBuilder.name} ist ausgewählt und wird vorbereitet.`,
    ),
  )

  if (selectedBuilder.url) {
    const builderLink = document.createElement('a')
    builderLink.href = selectedBuilder.url
    builderLink.className = 'status-link'
    builderLink.textContent = 'Builder öffnen'
    selectionStatus.append(' ', builderLink)
  }
})
}
