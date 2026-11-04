function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char])
}

function nl2br(value) {
  return escapeHtml(value).replace(/\n/g, '<br>')
}

function safeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback
}

function safeUrl(value) {
  return /^https?:\/\//i.test(value || '') ? escapeHtml(value) : ''
}

function css(data) {
  const accent = safeColor(data.design.accent, '#8b5cf6')
  const accent2 = safeColor(data.design.accent2, '#22d3ee')
  const dark = data.design.mode !== 'light'
  const radius = parseInt(data.design.radius, 10) || 16

  return `
:root{--a:${accent};--b:${accent2};--r:${radius}px;--bg:${dark ? '#07070d' : '#f7f7fb'};--text:${dark ? '#f4f4fb' : '#12121c'};--muted:${dark ? '#a2a2bb' : '#5d5d73'};--card:${dark ? 'rgba(255,255,255,.05)' : '#fff'};--line:${dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)'}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-x:hidden}
img{max-width:100%;display:block}a{color:inherit}
.wrap{width:min(1120px,92%);margin:0 auto}
section{padding:clamp(64px,10vw,120px) 0;position:relative}
h1,h2,h3{line-height:1.08;letter-spacing:-.035em;margin:0}
h1{font-size:clamp(2.6rem,7.5vw,5.6rem)}
h2{font-size:clamp(2rem,4.5vw,3.2rem);margin-bottom:.5em}
.grad{background:linear-gradient(120deg,var(--a),var(--b),var(--a));background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shine 6s linear infinite}
@keyframes shine{to{background-position:200% center}}
.nav{position:fixed;inset:0 0 auto;z-index:20;transition:.3s}
.nav.stuck{backdrop-filter:blur(16px);background:${dark ? 'rgba(7,7,13,.7)' : 'rgba(247,247,251,.8)'};border-bottom:1px solid var(--line)}
.nav .wrap{display:flex;align-items:center;justify-content:space-between;height:68px}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.03em;text-decoration:none}
.logo img{height:34px;width:auto}
.nav ul{display:flex;gap:26px;list-style:none;margin:0;padding:0;font-size:.95rem}
.nav ul a{text-decoration:none;color:var(--muted);transition:color .2s}.nav ul a:hover{color:var(--text)}
.btn{display:inline-block;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:999px;background:linear-gradient(135deg,var(--a),var(--b));color:#07070d;box-shadow:0 10px 36px -10px var(--a);transition:transform .25s,box-shadow .25s}
.btn:hover{transform:translateY(-3px) scale(1.02);box-shadow:0 18px 44px -10px var(--b)}
.hero{min-height:100svh;display:flex;align-items:center;padding-top:110px;overflow:hidden}
.hero-bg{position:absolute;inset:0;z-index:-1}
.hero-bg img{width:100%;height:100%;object-fit:cover;opacity:${dark ? '.28' : '.22'}}
.hero-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(to bottom,transparent 30%,var(--bg))}
.orb{position:absolute;border-radius:50%;filter:blur(100px);opacity:${dark ? '.35' : '.28'};z-index:-1;animation:drift 18s ease-in-out infinite alternate}
.orb.o1{width:46vmax;height:46vmax;background:var(--a);top:-18vmax;left:-12vmax}
.orb.o2{width:38vmax;height:38vmax;background:var(--b);bottom:-16vmax;right:-10vmax;animation-delay:-7s}
@keyframes drift{to{transform:translate(6vmax,5vmax) scale(1.15)}}
.badge{display:inline-block;padding:6px 16px;border:1px solid var(--line);background:var(--card);border-radius:999px;font-size:.85rem;color:var(--muted);margin-bottom:24px}
.hero p.lead{font-size:clamp(1.05rem,2vw,1.35rem);color:var(--muted);max-width:640px;margin:28px 0 38px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}
.card{padding:28px;border:1px solid var(--line);background:var(--card);border-radius:var(--r);transition:transform .3s,border-color .3s,box-shadow .3s;position:relative;overflow:hidden}
.card:hover{transform:translateY(-6px);border-color:var(--a);box-shadow:0 20px 50px -24px var(--a)}
.card .ic{font-size:2rem;margin-bottom:14px;display:block}
.card h3{font-size:1.3rem;margin-bottom:8px}.card p{margin:0;color:var(--muted)}
.about{display:grid;grid-template-columns:1fr 1fr;gap:clamp(28px,5vw,70px);align-items:center}
.about.solo{grid-template-columns:1fr}
.about img{border-radius:var(--r);width:100%;aspect-ratio:4/5;object-fit:cover;box-shadow:0 30px 80px -30px var(--a)}
.about p{color:var(--muted)}
.facts{display:flex;gap:34px;flex-wrap:wrap;margin-top:30px}
.facts b{display:block;font-size:clamp(2rem,4vw,3rem);letter-spacing:-.04em}.facts span{color:var(--muted);font-size:.9rem}
.gal{columns:3 240px;column-gap:14px}
.gal img{width:100%;margin-bottom:14px;border-radius:var(--r);cursor:zoom-in;transition:transform .4s,filter .4s}
.gal img:hover{transform:scale(1.02);filter:brightness(1.08)}
.contact-box{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
.contact-box h3{font-size:1rem;color:var(--muted);font-weight:600;margin-bottom:8px;letter-spacing:0}
.contact-box a{text-decoration:none;font-weight:600}
.big-cta{margin-top:40px;padding:clamp(28px,5vw,56px);border-radius:calc(var(--r) + 8px);background:linear-gradient(135deg,color-mix(in srgb,var(--a) 28%,transparent),color-mix(in srgb,var(--b) 22%,transparent));border:1px solid var(--line);text-align:center}
footer{border-top:1px solid var(--line);padding:36px 0;color:var(--muted);font-size:.9rem}
footer .wrap{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}
#impressum{padding:40px 0;border-top:1px solid var(--line);font-size:.9rem;color:var(--muted)}
.lb{position:fixed;inset:0;background:rgba(0,0,0,.88);display:none;place-items:center;z-index:50;cursor:zoom-out}
.lb.on{display:grid}.lb img{max-height:92vh;max-width:92vw;border-radius:12px}
.rv{opacity:0;transform:translateY(34px);transition:opacity .8s cubic-bezier(.2,.8,.2,1),transform .8s cubic-bezier(.2,.8,.2,1);transition-delay:var(--d,0s)}
.rv.in{opacity:1;transform:none}
.cursor{position:fixed;width:340px;height:340px;border-radius:50%;pointer-events:none;background:radial-gradient(circle,color-mix(in srgb,var(--a) 22%,transparent),transparent 65%);transform:translate(-50%,-50%);z-index:-1;left:50%;top:30%}
@media(max-width:760px){.nav ul{display:none}.about{grid-template-columns:1fr}.about img{aspect-ratio:4/3}.cursor{display:none}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.rv{opacity:1;transform:none}}
`
}

export function generateBusinessHtml(data) {
  const name = data.company.name || 'Eure Firma'
  const services = data.services.filter((service) => service.title || service.text)
  const facts = data.facts.filter((fact) => fact.value || fact.label)
  const gallery = data.gallery
  const hasAbout = data.about.title || data.about.text || data.about.image || facts.length
  const contact = data.contact
  const hasContact = contact.email || contact.phone || contact.address || contact.hours
  const nav = [
    services.length && ['leistungen', 'Leistungen'],
    hasAbout && ['ueber-uns', 'Über uns'],
    gallery.length && ['galerie', 'Galerie'],
    hasContact && ['kontakt', 'Kontakt'],
  ].filter(Boolean)
  const headline = data.hero.headline || name
  const ctaHref = contact.email ? `mailto:${escapeHtml(contact.email)}` : '#kontakt'

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}${data.company.tagline ? ' – ' + escapeHtml(data.company.tagline) : ''}</title>
<meta name="description" content="${escapeHtml(data.hero.sub || data.company.tagline || name)}">
<meta name="theme-color" content="${safeColor(data.design.accent, '#8b5cf6')}">
<style>${css(data)}</style>
</head>
<body>
<div class="cursor" id="glow" aria-hidden="true"></div>
<header class="nav" id="nav"><div class="wrap">
  <a class="logo" href="#top">${data.logo ? `<img src="${data.logo}" alt="${escapeHtml(name)} Logo">` : escapeHtml(name)}</a>
  <ul>${nav.map(([id, label]) => `<li><a href="#${id}">${label}</a></li>`).join('')}</ul>
</div></header>

<section class="hero" id="top">
  ${data.hero.image ? `<div class="hero-bg"><img src="${data.hero.image}" alt=""></div>` : ''}
  <div class="orb o1"></div><div class="orb o2"></div>
  <div class="wrap">
    ${data.hero.badge ? `<span class="badge rv">${escapeHtml(data.hero.badge)}</span>` : ''}
    <h1 class="rv" style="--d:.08s"><span class="grad">${escapeHtml(headline)}</span></h1>
    ${data.hero.sub ? `<p class="lead rv" style="--d:.16s">${nl2br(data.hero.sub)}</p>` : ''}
    <a class="btn rv" style="--d:.24s" href="${hasContact ? '#kontakt' : ctaHref}">${escapeHtml(data.hero.cta || 'Kontakt aufnehmen')}</a>
  </div>
</section>

${services.length ? `<section id="leistungen"><div class="wrap">
  <h2 class="rv">Leistungen</h2>
  <div class="grid">${services.map((service, index) => `<article class="card rv" style="--d:${Math.min(index, 8) * 0.08}s">
    <span class="ic">${escapeHtml(service.icon || '✨')}</span><h3>${escapeHtml(service.title)}</h3><p>${nl2br(service.text)}</p></article>`).join('')}</div>
</div></section>` : ''}

${hasAbout ? `<section id="ueber-uns"><div class="wrap about${data.about.image ? '' : ' solo'}">
  <div class="rv"><h2>${escapeHtml(data.about.title || 'Über uns')}</h2>
    ${data.about.text ? `<p>${nl2br(data.about.text)}</p>` : ''}
    ${facts.length ? `<div class="facts">${facts.map((fact) => `<div><b class="grad">${escapeHtml(fact.value)}</b><span>${escapeHtml(fact.label)}</span></div>`).join('')}</div>` : ''}
  </div>
  ${data.about.image ? `<img class="rv" style="--d:.15s" src="${data.about.image}" alt="${escapeHtml(data.about.title || name)}" loading="lazy">` : ''}
</div></section>` : ''}

${gallery.length ? `<section id="galerie"><div class="wrap">
  <h2 class="rv">Einblicke</h2>
  <div class="gal">${gallery.map((image) => `<img class="rv" src="${image}" alt="Bild von ${escapeHtml(name)}" loading="lazy">`).join('')}</div>
</div></section>` : ''}

${hasContact ? `<section id="kontakt"><div class="wrap">
  <h2 class="rv">Kontakt</h2>
  <div class="contact-box">
    ${contact.email ? `<div class="card rv"><h3>E-Mail</h3><a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a></div>` : ''}
    ${contact.phone ? `<div class="card rv" style="--d:.08s"><h3>Telefon</h3><a href="tel:${escapeHtml(contact.phone.replace(/[^+\d]/g, ''))}">${escapeHtml(contact.phone)}</a></div>` : ''}
    ${contact.address ? `<div class="card rv" style="--d:.16s"><h3>Adresse</h3>${nl2br(contact.address)}</div>` : ''}
    ${contact.hours ? `<div class="card rv" style="--d:.24s"><h3>Öffnungszeiten</h3>${nl2br(contact.hours)}</div>` : ''}
  </div>
  ${contact.email ? `<div class="big-cta rv"><h2>Lass uns starten.</h2><a class="btn" href="mailto:${escapeHtml(contact.email)}">${escapeHtml(data.hero.cta || 'Jetzt anfragen')}</a></div>` : ''}
</div></section>` : ''}

<footer><div class="wrap">
  <span>© <span id="y"></span> ${escapeHtml(name)}</span>
  <span>${safeUrl(contact.instagram) ? `<a href="${safeUrl(contact.instagram)}" target="_blank" rel="noopener">Instagram</a> · ` : ''}<a href="#impressum">Impressum</a></span>
</div></footer>

<section id="impressum"><div class="wrap">
  <strong>Impressum</strong><br>
  ${escapeHtml(name)}${data.legal.owner ? '<br>Inhaber: ' + escapeHtml(data.legal.owner) : ''}
  ${contact.address ? '<br>' + nl2br(contact.address) : ''}
  ${contact.email ? '<br>E-Mail: ' + escapeHtml(contact.email) : ''}${contact.phone ? '<br>Telefon: ' + escapeHtml(contact.phone) : ''}
  ${data.legal.vat ? '<br>USt-IdNr.: ' + escapeHtml(data.legal.vat) : ''}
</div></section>

<div class="lb" id="lb"><img alt=""></div>
<script>
(function(){
  var $=function(s){return document.querySelector(s)};
  $('#y').textContent=new Date().getFullYear();
  var nav=$('#nav');
  addEventListener('scroll',function(){nav.classList.toggle('stuck',scrollY>20)},{passive:true});
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});
  document.querySelectorAll('.rv').forEach(function(el){io.observe(el)});
  var g=$('#glow');
  addEventListener('pointermove',function(e){g.style.left=e.clientX+'px';g.style.top=e.clientY+'px'},{passive:true});
  var lb=$('#lb'),li=lb.querySelector('img');
  document.querySelectorAll('.gal img').forEach(function(i){i.addEventListener('click',function(){li.src=i.src;lb.classList.add('on')})});
  lb.addEventListener('click',function(){lb.classList.remove('on')});
  addEventListener('keydown',function(e){if(e.key==='Escape')lb.classList.remove('on')});
})();
</script>
</body>
</html>`
}
