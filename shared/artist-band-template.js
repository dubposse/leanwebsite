function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

function safeUrl(value) {
  if (!value) return ''

  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch {
    return ''
  }
}

function validEmail(value) {
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(value)
}

const THEMES = Object.freeze({
  dark: ['#07070c', '#f2f2f7', '#9a9ab0', '#14141d'],
  light: ['#f6f6f1', '#111118', '#5a5a6a', '#ffffff'],
  grad: ['#12002b', '#ffffff', '#c9b8ee', '#ffffff14'],
})

const CONTENT_FONTS = Object.freeze(['standard', 'genre', 'claim'])
const CONTENT_COLORS = Object.freeze(['auto', 'accent', 'claim'])
const MONTHS = Object.freeze([
  ['JAN', 'Januar'], ['FEB', 'Februar'], ['MÄR', 'März'], ['APR', 'April'],
  ['MAI', 'Mai'], ['JUN', 'Juni'], ['JUL', 'Juli'], ['AUG', 'August'],
  ['SEP', 'September'], ['OKT', 'Oktober'], ['NOV', 'November'], ['DEZ', 'Dezember'],
])

function parseGigDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (!year || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null
  return { year: match[1], day, month: MONTHS[month - 1] }
}

export function generateArtistBandHtml(data, year, esc = escapeHtml, packageCode) {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new TypeError('A valid site year is required')
  }

  const acc = /^#[0-9a-f]{6}$/i.test(data.accent) ? data.accent : '#c6ff00'
  const theme = Object.hasOwn(THEMES, data.theme) ? data.theme : 'dark'
  const [bg, fg, mut, card] = THEMES[theme]
  const contentFont = CONTENT_FONTS.includes(data.contentFont) ? data.contentFont : 'standard'
  const contentColor = CONTENT_COLORS.includes(data.contentColor) ? data.contentColor : 'auto'
  const links = [['Spotify', data.spotify], ['SoundCloud', data.soundcloud], ['Bandcamp', data.bandcamp], ['Instagram', data.instagram]]
    .map(([label, value]) => [label, safeUrl(value)])
    .filter(([, href]) => href)
    .map(([label, href]) => `<a class="pill" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`).join('')
  const tracks = data.tracks.filter((track) => track.a.trim()).map((track, index) => {
    const href = safeUrl(track.b)
    const inner = `<span class="n">${String(index + 1).padStart(2, '0')}</span><span>${esc(track.a)}</span><span class="go">${href ? '▶' : ''}</span>`
    return href ? `<a class="row" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : `<div class="row">${inner}</div>`
  }).join('')
  const gigs = data.gigs.filter((gig) => gig.a.trim() || gig.b.trim()).map((gig) => {
    const date = parseGigDate(gig.a)
    if (!date) return `<div class="row gig-row gig-row-undated"><span class="gig-details">${gig.a ? `<span class="gig-date-text">${esc(gig.a)}</span>` : ''}${gig.b ? `<span>${esc(gig.b)}</span>` : ''}</span></div>`
    return `<div class="row gig-row"><time class="gig-date" datetime="${esc(gig.a)}" aria-label="${date.day}. ${date.month[1]} ${date.year}"><span class="gig-day">${date.day}</span><span class="gig-month">${date.month[0]}</span></time><span class="gig-details">${gig.b ? `<span>${esc(gig.b)}</span>` : ''}<span class="gig-year" aria-hidden="true">${date.year}</span></span></div>`
  }).join('')
  const name = esc(data.name || 'Artist')
  const email = validEmail(data.email) ? data.email : ''
  const cover = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data.cover) ? data.cover : ''
  const legal = { ...LEGAL_DEFAULTS, ...data.legal }
  const show = (value, placeholder) => esc(value.trim() || `[${placeholder}]`).replace(/\n/g, '<br>')
  const typeNames = { gbr: 'GbR', association: 'Verein', company: 'Unternehmen' }
  const address = `${show(legal.street, 'Straße und Hausnummer')}<br>${show(legal.postalCode, 'Postleitzahl')} ${show(legal.city, 'Ort')}<br>${show(legal.country, 'Land')}`
  const provider = packageCode === 'artist-band-rundum-sorglos'
    ? 'Hostinger'
    : legal.hostingProvider === 'other' ? legal.hostingOther.trim() : legal.hostingProvider
  const hosting = provider ? esc(provider) : '[Hostinganbieter vor Veröffentlichung ergänzen]'

  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title><meta name="description" content="${esc(data.tagline)}">
<style>
:root{--bg:${bg};--fg:${fg};--mut:${mut};--card:${card};--acc:${acc};--page-gutter:6vw;--content-width:900px}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-x:hidden}
${theme === 'grad' ? 'body{background:linear-gradient(135deg,#12002b,#3a0ca3 50%,#0b3d91);background-attachment:fixed}' : ''}
body[data-content-color="accent"]{--content-fg:var(--acc)}
body[data-content-color="claim"]{--content-fg:var(--mut)}
body:not([data-content-color="accent"]):not([data-content-color="claim"]){--content-fg:var(--fg)}
a{color:inherit;text-decoration:none}
.hero{min-height:100vh;display:flex;flex-direction:column;justify-content:flex-end;padding:8vw var(--page-gutter) 6vw;position:relative;isolation:isolate;overflow:hidden}
.hero-content{width:100%}
.hero::before{content:"";position:absolute;inset:0;z-index:-2;${cover ? `background:url(${cover}) center/cover;` : `background:radial-gradient(circle at 20% 20%,${acc}55,transparent 55%),radial-gradient(circle at 80% 70%,#7c4dff66,transparent 55%);animation:drift 14s ease-in-out infinite alternate;`}}
.hero::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(transparent 30%,var(--bg))}
@keyframes drift{to{transform:scale(1.15) translate(3%,2%)}}
.genre,body[data-content-font="genre"] .content-section,body[data-content-font="genre"] .content-section h2{letter-spacing:.3em}
.genre{color:var(--acc);text-transform:uppercase;font-size:.8rem;margin:0;animation:up .8s both}
h1{font-size:clamp(3rem,13vw,10rem);line-height:.9;margin:.15em 0;font-weight:900;letter-spacing:-.04em;animation:up .9s .1s both}
h1 span{background:linear-gradient(100deg,var(--fg),var(--acc),var(--fg));background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shine 6s linear infinite}
@keyframes shine{to{background-position:200% center}}
.tag{font-size:1.3rem;color:var(--mut);margin:0;animation:up .9s .25s both}
@keyframes up{from{opacity:0;transform:translateY(30px)}}
.bars{display:flex;gap:4px;height:40px;align-items:flex-end;margin-top:2rem}
.bars i{width:6px;background:var(--acc);border-radius:3px;height:100%;transform-origin:bottom;animation:eq 1s ease-in-out infinite alternate}
${Array.from({ length: 12 }, (_, index) => `.bars i:nth-child(${index + 1}){animation-delay:${(index * 0.13).toFixed(2)}s;animation-duration:${(0.6 + (index % 5) * 0.2).toFixed(1)}s}`).join('')}
@keyframes eq{from{transform:scaleY(.15)}to{transform:scaleY(1)}}
section{width:min(var(--content-width),calc(100% - var(--page-gutter) - var(--page-gutter)));margin-inline:var(--page-gutter);padding:3.5rem 0;animation:up 1s both;animation-timeline:view();animation-range:entry 0% cover 30%}
.content-section{color:var(--content-fg);font-family:inherit}
.content-section h2{font-size:.85rem;font-weight:inherit;text-transform:none;color:inherit;margin:0 0 1rem}
.content-section p{margin:0;line-height:1.75}
.content-section p+p{margin-top:1rem}
body[data-content-font="genre"] .content-section{font-size:.95rem;line-height:1.7}
body[data-content-font="genre"] .content-section h2{font-size:.8rem}
body[data-content-font="claim"] .content-section{font-size:1.15rem;line-height:1.75}
body[data-content-font="claim"] .content-section h2{font-size:1rem}
.row{display:grid;grid-template-columns:90px 1fr auto;gap:1rem;padding:1rem 1.2rem;background:var(--card);border-radius:14px;margin-bottom:.6rem;transition:transform .25s,box-shadow .25s}
a.row:hover{transform:translateX(8px);box-shadow:0 0 0 1px var(--acc)}
.content-section .n,.content-section .go{color:inherit;font-variant-numeric:tabular-nums}
.gig-row{grid-template-columns:max-content minmax(0,1fr);align-items:center}
.gig-row-undated{grid-template-columns:minmax(0,1fr)}
.gig-date{display:flex;flex-direction:column;align-items:center;min-width:3rem;color:var(--acc);white-space:nowrap;letter-spacing:normal;line-height:1;font-variant-numeric:tabular-nums}
.gig-day{font-size:1.6em;font-weight:700}
.gig-month{font-size:.75em;font-weight:600;margin-top:.25em}
.gig-details{display:flex;flex-direction:column;min-width:0;overflow-wrap:anywhere}
.gig-date-text{overflow-wrap:anywhere}
.gig-year{font-size:.75em;opacity:.75}
.pills{display:flex;gap:.7rem;flex-wrap:wrap}
.pill{padding:.7rem 1.4rem;border-radius:999px;border:1px solid var(--acc);transition:background .2s,color .2s,transform .2s}
.pill:hover{background:var(--acc);color:#000;transform:translateY(-3px)}
footer{text-align:center;color:var(--mut);padding:3rem 1rem;font-size:.8rem}
.legal-section{display:none;animation:none;overflow-wrap:anywhere}
.legal-section:target{display:block}
.legal-section:target ~ .site-main{display:none}
.legal-section h2{font-size:1.6rem}.legal-section h3{font-size:1rem;margin:1.5rem 0 .5rem}.legal-section p{margin:.5rem 0}
.legal-links{display:flex;justify-content:center;gap:1.25rem;flex-wrap:wrap;margin-top:1rem}.legal-links a{text-decoration:underline}
.legal-back{display:inline-block;margin-bottom:1.5rem;text-decoration:underline}
.legal-notice{font-weight:bold}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style></head><body data-content-font="${contentFont}" data-content-color="${contentColor}">
<section id="impressum" class="legal-section">
<a class="legal-back" href="#website">Zurück zur Website</a>
<h2>Impressum</h2><p><strong>Angaben gemäß § 5 DDG</strong></p>
<p>${show(legal.operatorName, 'Name des rechtlich verantwortlichen Websitebetreibers')}${legal.operatorType === 'company' ? `<br>${show(legal.legalForm, 'Rechtsform')}` : typeNames[legal.operatorType] ? `<br>${esc(typeNames[legal.operatorType])}` : ''}${legal.operatorType !== 'person' ? `<br>${show(legal.representative, 'Vertretungsberechtigte Person')}` : ''}<br>${address}</p>
<h3>Kontakt</h3><p>E-Mail: ${show(legal.email, 'Öffentliche E-Mail-Adresse')}${legal.phone.trim() ? `<br>Telefon: ${esc(legal.phone)}` : ''}</p>
${legal.registered ? `<h3>Registerangaben</h3><p>${show(legal.registerCourt, 'Registergericht')}<br>${show(legal.registerNumber, 'Registernummer')}</p>` : ''}
${legal.vatId.trim() ? `<h3>Umsatzsteuer-Identifikationsnummer</h3><p>${esc(legal.vatId)}</p>` : ''}
${legal.editorial ? `<h3>Verantwortlich für journalistisch-redaktionelle Inhalte gemäß § 18 Abs. 2 MStV</h3><p>${show(legal.editorialName, 'Name')}<br>${show(legal.editorialAddress, 'Anschrift')}</p>` : ''}
<h3>Hinweis zu externen Links</h3><p>Diese Website kann Links zu externen Angeboten enthalten. Für deren Inhalte sind die jeweiligen Anbieter verantwortlich. Auf die Gestaltung und Inhalte externer Websites besteht kein unmittelbarer Einfluss.</p>
</section>
<section id="datenschutz" class="legal-section">
<a class="legal-back" href="#website">Zurück zur Website</a>
<h2>Datenschutzerklärung</h2>
<h3>1. Verantwortlicher</h3><p>Verantwortlich für die Verarbeitung personenbezogener Daten auf dieser Website ist:</p><p>${show(legal.operatorName, 'Name des Websitebetreibers')}<br>${address}</p><p>E-Mail: ${show(legal.email, 'Öffentliche E-Mail-Adresse')}</p>
<h3>2. Hosting und Serverprotokolle</h3><p>Diese Website wird bei ${hosting} betrieben.</p>${provider ? '' : '<p class="legal-notice">Die Hostingangaben müssen vor Veröffentlichung ergänzt werden.</p>'}
<p>Beim Aufruf der Website können technisch erforderliche Informationen verarbeitet werden, insbesondere IP-Adresse, Datum und Uhrzeit des Zugriffs, angeforderte Inhalte sowie Browser- und Geräteinformationen.</p>
<p>Diese Verarbeitung dient der technischen Bereitstellung, Stabilität und Sicherheit der Website. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.</p>
<p>Die konkrete Speicherung, Speicherdauer und gegebenenfalls Weitergabe dieser Daten richten sich nach den technischen und vertraglichen Bedingungen des eingesetzten Hostinganbieters.</p>
<h3>3. Cookies und Tracking</h3><p>Diese Website verwendet in ihrer bereitgestellten Grundversion keine eigenen Cookies, Analysewerkzeuge oder Trackingdienste.</p>
<h3>4. Kontaktaufnahme</h3><p>Wenn Sie per E-Mail Kontakt aufnehmen, werden Ihre übermittelten Angaben zur Bearbeitung Ihrer Anfrage verarbeitet.</p><p>Rechtsgrundlage ist je nach Anlass Art. 6 Abs. 1 lit. b oder lit. f DSGVO.</p><p>Die Daten werden gelöscht, sobald sie für die Bearbeitung nicht mehr benötigt werden und keine gesetzlichen Aufbewahrungspflichten entgegenstehen.</p>
<h3>5. Externe Links</h3><p>Diese Website enthält gegebenenfalls Links zu externen Plattformen wie Musikdiensten oder sozialen Netzwerken.</p><p>Erst beim Aufrufen dieser Links verlassen Sie diese Website. Für die dortige Datenverarbeitung gelten die Datenschutzhinweise der jeweiligen Anbieter.</p>
<h3>6. Ihre Rechte</h3><p>Sie haben im Rahmen der gesetzlichen Voraussetzungen das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit sowie Widerspruch gegen bestimmte Verarbeitungen.</p><p>Sie können sich außerdem bei einer zuständigen Datenschutzaufsichtsbehörde beschweren.</p>
<h3>7. Aktualisierung</h3><p>Diese Datenschutzerklärung gilt für die aktuelle technische Ausgestaltung der Website. Werden weitere Dienste, Funktionen oder Datenverarbeitungen hinzugefügt, muss sie entsprechend angepasst werden.</p>
</section>
<div id="website" class="site-main">
<header class="hero"><div class="hero-content"><p class="genre">${esc(data.genre)}</p><h1><span>${name}</span></h1><p class="tag">${esc(data.tagline)}</p><div class="bars" aria-hidden="true">${'<i></i>'.repeat(12)}</div></div></header>
${data.bio.trim() ? `<section class="content-section"><h2>Über</h2><p>${esc(data.bio).replace(/\n/g, '<br>')}</p></section>` : ''}
${tracks ? `<section class="content-section"><h2>Releases</h2>${tracks}</section>` : ''}
${gigs ? `<section class="content-section"><h2>${esc(data.gigsHeading?.trim() ? data.gigsHeading : 'Live')}</h2>${gigs}</section>` : ''}
${links || email ? `<section class="content-section"><h2>Folgen &amp; Booking</h2><div class="pills">${links}${email ? `<a class="pill" href="mailto:${esc(email)}">Booking</a>` : ''}</div></section>` : ''}
<footer>© ${year} ${name} · erstellt mit LeanWebsite<nav class="legal-links" aria-label="Rechtliche Informationen"><a href="#impressum">Impressum</a><a href="#datenschutz">Datenschutz</a></nav></footer>
</div>
</body></html>`
}
import { LEGAL_DEFAULTS } from './artist-band-legal.js'
