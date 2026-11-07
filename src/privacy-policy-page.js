import privacyPolicyMarkdown from './data/privacy-policy.md?raw'
import { renderMarkdown } from './markdown.js'

export function renderPrivacyPolicyPage(app) {
  document.title = 'Datenschutzerklärung – LeanWebsite Studio'
  app.classList.remove('app-builder', 'business-builder')
  app.innerHTML = `
    <div class="privacy-page">
      <header class="site-header">
        <a class="brand" href="/" aria-label="LeanWebsite Startseite">
          <span class="brand-mark" aria-hidden="true">L</span>
          <span>LeanWebsite</span>
        </a>
        <a class="header-link" href="/">Zur Startseite <span aria-hidden="true">↗</span></a>
      </header>
      <main class="privacy-content">
        <article class="privacy-document">
          ${renderMarkdown(privacyPolicyMarkdown)}
        </article>
      </main>
      <footer class="site-footer">
        <a class="brand footer-brand" href="/" aria-label="LeanWebsite Startseite">
          <span class="brand-mark" aria-hidden="true">L</span>
          <span>LeanWebsite</span>
        </a>
        <nav class="privacy-footer-links" aria-label="Rechtliche Informationen">
          <a href="https://matthiasbrehm.de/impressum" target="_blank" rel="noopener noreferrer">Impressum</a>
          <a href="/datenschutz" aria-current="page">Datenschutzerklärung</a>
          <a href="/widerruf">Widerruf</a>
        </nav>
      </footer>
    </div>
  `
}
