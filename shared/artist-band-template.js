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

export function generateArtistBandHtml(data, year, esc = escapeHtml) {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new TypeError('A valid site year is required')
  }

  const acc = /^#[0-9a-f]{6}$/i.test(data.accent) ? data.accent : '#c6ff00'
  const theme = Object.hasOwn(THEMES, data.theme) ? data.theme : 'dark'
  const [bg, fg, mut, card] = THEMES[theme]
  const links = [['Spotify', data.spotify], ['SoundCloud', data.soundcloud], ['Bandcamp', data.bandcamp], ['Instagram', data.instagram]]
    .map(([label, value]) => [label, safeUrl(value)])
    .filter(([, href]) => href)
    .map(([label, href]) => `<a class="pill" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`).join('')
  const tracks = data.tracks.filter((track) => track.a.trim()).map((track, index) => {
    const href = safeUrl(track.b)
    const inner = `<span class="n">${String(index + 1).padStart(2, '0')}</span><span>${esc(track.a)}</span><span class="go">${href ? '▶' : ''}</span>`
    return href ? `<a class="row" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : `<div class="row">${inner}</div>`
  }).join('')
  const gigs = data.gigs.filter((gig) => gig.a.trim() || gig.b.trim()).map((gig) =>
    `<div class="row"><span class="n">${esc(gig.a)}</span><span>${esc(gig.b)}</span><span></span></div>`).join('')
  const name = esc(data.name || 'Artist')
  const email = validEmail(data.email) ? data.email : ''
  const cover = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data.cover) ? data.cover : ''

  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title><meta name="description" content="${esc(data.tagline)}">
<style>
:root{--bg:${bg};--fg:${fg};--mut:${mut};--card:${card};--acc:${acc}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-x:hidden}
${theme === 'grad' ? 'body{background:linear-gradient(135deg,#12002b,#3a0ca3 50%,#0b3d91);background-attachment:fixed}' : ''}
a{color:inherit;text-decoration:none}
.hero{min-height:100vh;display:flex;flex-direction:column;justify-content:flex-end;padding:8vw 6vw 6vw;position:relative;isolation:isolate;overflow:hidden}
.hero::before{content:"";position:absolute;inset:0;z-index:-2;${cover ? `background:url(${cover}) center/cover;` : `background:radial-gradient(circle at 20% 20%,${acc}55,transparent 55%),radial-gradient(circle at 80% 70%,#7c4dff66,transparent 55%);animation:drift 14s ease-in-out infinite alternate;`}}
.hero::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(transparent 30%,var(--bg))}
@keyframes drift{to{transform:scale(1.15) translate(3%,2%)}}
.genre{color:var(--acc);text-transform:uppercase;letter-spacing:.3em;font-size:.8rem;margin:0;animation:up .8s both}
h1{font-size:clamp(3rem,13vw,10rem);line-height:.9;margin:.15em 0;font-weight:900;letter-spacing:-.04em;animation:up .9s .1s both}
h1 span{background:linear-gradient(100deg,var(--fg),var(--acc),var(--fg));background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shine 6s linear infinite}
@keyframes shine{to{background-position:200% center}}
.tag{font-size:1.3rem;color:var(--mut);margin:0;animation:up .9s .25s both}
@keyframes up{from{opacity:0;transform:translateY(30px)}}
.bars{display:flex;gap:4px;height:40px;align-items:flex-end;margin-top:2rem}
.bars i{width:6px;background:var(--acc);border-radius:3px;height:100%;transform-origin:bottom;animation:eq 1s ease-in-out infinite alternate}
${Array.from({ length: 12 }, (_, index) => `.bars i:nth-child(${index + 1}){animation-delay:${(index * 0.13).toFixed(2)}s;animation-duration:${(0.6 + (index % 5) * 0.2).toFixed(1)}s`).join('')}
@keyframes eq{from{transform:scaleY(.15)}to{transform:scaleY(1)}}
section{max-width:900px;margin:0 auto;padding:4rem 6vw;animation:up 1s both;animation-timeline:view();animation-range:entry 0% cover 30%}
h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.3em;color:var(--acc);margin:0 0 1.2rem}
.row{display:grid;grid-template-columns:90px 1fr auto;gap:1rem;padding:1rem 1.2rem;background:var(--card);border-radius:14px;margin-bottom:.6rem;transition:transform .25s,box-shadow .25s}
a.row:hover{transform:translateX(8px);box-shadow:0 0 0 1px var(--acc)}
.n{color:var(--acc);font-variant-numeric:tabular-nums}.go{color:var(--acc)}
.pills{display:flex;gap:.7rem;flex-wrap:wrap}
.pill{padding:.7rem 1.4rem;border-radius:999px;border:1px solid var(--acc);transition:background .2s,color .2s,transform .2s}
.pill:hover{background:var(--acc);color:#000;transform:translateY(-3px)}
footer{text-align:center;color:var(--mut);padding:3rem 1rem;font-size:.8rem}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style></head><body>
<header class="hero"><p class="genre">${esc(data.genre)}</p><h1><span>${name}</span></h1><p class="tag">${esc(data.tagline)}</p><div class="bars" aria-hidden="true">${'<i></i>'.repeat(12)}</div></header>
${data.bio.trim() ? `<section><h2>Über</h2><p>${esc(data.bio).replace(/\n/g, '<br>')}</p></section>` : ''}
${tracks ? `<section><h2>Releases</h2>${tracks}</section>` : ''}
${gigs ? `<section><h2>Live</h2>${gigs}</section>` : ''}
${links || email ? `<section><h2>Folgen &amp; Booking</h2><div class="pills">${links}${email ? `<a class="pill" href="mailto:${esc(email)}">Booking</a>` : ''}</div></section>` : ''}
<footer>© ${year} ${name} · erstellt mit LeanWebsite</footer>
</body></html>`
}
