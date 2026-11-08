import { BUSINESS_OPERATOR_DEFAULTS } from './business-operator.js'

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

function validEmail(value) {
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(value)
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
.menu-toggle{display:none}
.btn{display:inline-block;text-decoration:none;font:inherit;font-weight:700;padding:14px 28px;border:0;border-radius:999px;background:linear-gradient(135deg,var(--a),var(--b));color:#07070d;box-shadow:0 10px 36px -10px var(--a);transition:transform .25s,box-shadow .25s;cursor:pointer}
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
.email-copy{padding:0;border:0;background:none;color:inherit;font:inherit;font-weight:600;text-align:left;overflow-wrap:anywhere;user-select:text;cursor:pointer}
.email-copy:focus-visible,.big-cta .btn:focus-visible{outline:2px solid var(--a);outline-offset:3px}
.copy-status{margin:8px 0 0;color:var(--muted);font-size:.9rem}
.copy-status:empty{display:none}
.big-cta{margin-top:40px;padding:clamp(28px,5vw,56px);border-radius:calc(var(--r) + 8px);background:linear-gradient(135deg,color-mix(in srgb,var(--a) 28%,transparent),color-mix(in srgb,var(--b) 22%,transparent));border:1px solid var(--line);text-align:center}
footer{border-top:1px solid var(--line);padding:36px 0;color:var(--muted);font-size:.9rem}
footer .wrap{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}
.legal-view{display:none;min-height:100vh;overflow-wrap:anywhere}
.legal-view:target{display:block}
.legal-view:target ~ .site-main{display:none}
.legal-view .wrap{max-width:760px}
.legal-view h1{font-size:clamp(2rem,4.5vw,3.2rem);margin-bottom:1em}
.legal-view h2{font-size:1.2rem;line-height:1.3;letter-spacing:0;margin:1.8em 0 .5em}
.legal-view p{margin:.65em 0}
.legal-back{display:inline-block;margin-bottom:2rem;color:var(--text);text-decoration:underline}
.legal-notice{font-weight:700}
.legal-links{display:flex;gap:1.25rem;flex-wrap:wrap}
.lb{position:fixed;inset:0;background:rgba(0,0,0,.88);display:none;place-items:center;z-index:50;cursor:zoom-out}
.lb.on{display:grid}.lb img{max-height:92vh;max-width:92vw;border-radius:12px}
.rv{opacity:0;transform:translateY(34px);transition:opacity .8s cubic-bezier(.2,.8,.2,1),transform .8s cubic-bezier(.2,.8,.2,1);transition-delay:var(--d,0s)}
.rv.in{opacity:1;transform:none}
.cursor{position:fixed;width:340px;height:340px;border-radius:50%;pointer-events:none;background:radial-gradient(circle,color-mix(in srgb,var(--a) 22%,transparent),transparent 65%);transform:translate(-50%,-50%);z-index:-1;left:50%;top:30%}
@media(max-width:760px){
  .menu-toggle{display:flex;flex-shrink:0;flex-direction:column;justify-content:center;align-items:center;gap:5px;width:44px;height:44px;padding:0;border:1px solid var(--line);border-radius:var(--r);background:var(--bg);color:var(--text);cursor:pointer}
  .menu-toggle span{width:20px;height:2px;background:currentColor;border-radius:2px;transition:transform .2s,opacity .2s}
  .menu-toggle[aria-expanded="true"] span:first-child{transform:translateY(7px) rotate(45deg)}
  .menu-toggle[aria-expanded="true"] span:nth-child(2){opacity:0}
  .menu-toggle[aria-expanded="true"] span:last-child{transform:translateY(-7px) rotate(-45deg)}
  .menu-toggle:focus-visible,.nav ul a:focus-visible{outline:2px solid var(--a);outline-offset:3px}
  .nav ul{display:none;position:absolute;top:68px;left:4%;right:4%;max-height:calc(100vh - 80px);overflow-y:auto;flex-direction:column;gap:0;padding:8px;background:var(--bg);border:1px solid var(--line);border-radius:var(--r);box-shadow:0 12px 32px rgba(0,0,0,.2)}
  .nav .menu-toggle[aria-expanded="true"]+ul{display:flex}
  .nav ul a{display:block;padding:12px 16px;border-radius:var(--r)}
  .nav ul a:hover{background:var(--card)}
  .about{grid-template-columns:1fr}.about img{aspect-ratio:4/3}.cursor{display:none}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.rv{opacity:1;transform:none}}
`
}

export function generateBusinessHtml(data, { preview = false, packageCode } = {}) {
  const name = data.company.name || 'Eure Firma'
  const services = data.services.filter((service) => service.title || service.text)
  const facts = data.facts.filter((fact) => fact.value || fact.label)
  const gallery = data.gallery
  const hasAbout = data.about.title || data.about.text || data.about.image || facts.length
  const contact = data.contact
  const canCopyEmail = validEmail(contact.email)
  const hasContact = contact.email || contact.phone || contact.address || contact.hours
  const nav = [
    services.length && ['leistungen', 'Leistungen'],
    hasAbout && ['ueber-uns', 'Über uns'],
    gallery.length && ['galerie', 'Galerie'],
    hasContact && ['kontakt', 'Kontakt'],
  ].filter(Boolean)
  const headline = data.hero.headline || name
  const operator = { ...BUSINESS_OPERATOR_DEFAULTS, ...data.operator }
  const show = (value, placeholder) => nl2br(value.trim() || `[${placeholder}]`)
  const address = `${show(operator.street, 'Straße und Hausnummer')}<br>${show(operator.postalCode, 'Postleitzahl')} ${show(operator.city, 'Ort')}<br>${show(operator.country, 'Land')}`
  const typeNames = { gbr: 'GbR', association: 'Verein' }
  const managed = packageCode === 'business-rundum-sorglos'
  const providerName = (choice, other) => choice === 'other' ? other.trim() : choice.trim()
  const hosting = managed ? 'Hostinger' : providerName(operator.hostingProvider, operator.hostingOther)
  const domain = managed ? 'Hostinger' : providerName(operator.domainProvider, operator.domainOther)

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
${preview ? '<base href="about:srcdoc">' : ''}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}${data.company.tagline ? ' – ' + escapeHtml(data.company.tagline) : ''}</title>
<meta name="description" content="${escapeHtml(data.hero.sub || data.company.tagline || name)}">
<meta name="theme-color" content="${safeColor(data.design.accent, '#8b5cf6')}">
<style>${css(data)}</style>
</head>
<body>
<section id="impressum" class="legal-view"><div class="wrap">
  <a class="legal-back" href="#top">Zurück zur Website</a>
  <h1>Impressum</h1><p><strong>Angaben gemäß § 5 DDG</strong></p>
  <p>${show(operator.operatorName, 'Name des rechtlich verantwortlichen Websitebetreibers')}${operator.operatorType === 'company' ? `<br>${show(operator.legalForm, 'Rechtsform')}` : typeNames[operator.operatorType] ? `<br>${escapeHtml(typeNames[operator.operatorType])}` : ''}${operator.operatorType !== 'person' ? `<br>Vertretungsberechtigt: ${show(operator.representative, 'Vertretungsberechtigte Personen')}` : ''}<br>${address}</p>
  <h2>Kontakt</h2><p>E-Mail: ${show(operator.email, 'Öffentliche E-Mail-Adresse')}${operator.phone.trim() ? `<br>Telefon: ${nl2br(operator.phone)}` : ''}</p>
  ${operator.registered === 'true' ? `<h2>Registerangaben</h2><p>${show(operator.registerCourt, 'Registergericht')}<br>${show(operator.registerNumber, 'Registernummer')}</p>` : ''}
  ${operator.vatId.trim() ? `<h2>Umsatzsteuer-Identifikationsnummer</h2><p>${nl2br(operator.vatId)}</p>` : ''}
  ${operator.editorial === 'true' ? `<h2>Verantwortlich für journalistisch-redaktionelle Inhalte gemäß § 18 Abs. 2 MStV</h2><p>${show(operator.editorialName, 'Name')}<br>${show(operator.editorialAddress, 'Anschrift')}</p>` : ''}
  <h2>Hinweis zu externen Links</h2><p>Diese Website kann Links zu externen Angeboten enthalten. Für deren Inhalte sind die jeweiligen Anbieter verantwortlich. Auf die Gestaltung und Inhalte externer Websites besteht kein unmittelbarer Einfluss.</p>
</div></section>
<section id="datenschutz" class="legal-view"><div class="wrap">
  <a class="legal-back" href="#top">Zurück zur Website</a>
  <h1>Datenschutzerklärung</h1>
  <h2>1. Verantwortlicher</h2><p>Verantwortlich für die Verarbeitung personenbezogener Daten auf dieser Website ist:</p><p>${show(operator.operatorName, 'Name des Websitebetreibers')}<br>${address}</p><p>E-Mail: ${show(operator.email, 'Öffentliche E-Mail-Adresse')}${operator.phone.trim() ? `<br>Telefon: ${nl2br(operator.phone)}` : ''}</p>
  <h2>2. Hosting und Serverprotokolle</h2>
  ${hosting ? `<p>Als Hostinganbieter ist ${escapeHtml(hosting)} ${managed ? 'vorgesehen' : 'angegeben'}.</p>` : '<p class="legal-notice">Der Hostinganbieter ist noch nicht angegeben. Die Hostingangaben müssen vor Veröffentlichung ergänzt werden.</p>'}
  ${domain ? `<p>Als Domainanbieter ist ${escapeHtml(domain)} ${managed ? 'vorgesehen' : 'angegeben'}.</p>` : ''}
  <p>Beim Aufruf der Website können technisch erforderliche Informationen verarbeitet werden, insbesondere IP-Adresse, Datum und Uhrzeit des Zugriffs, angeforderte Inhalte sowie Browser- und Geräteinformationen.</p>
  <p>Diese Verarbeitung dient der technischen Bereitstellung, Stabilität und Sicherheit der Website. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.</p>
  <p>Die konkrete Speicherung, Speicherdauer und gegebenenfalls Weitergabe dieser Daten richten sich nach den technischen und vertraglichen Bedingungen des eingesetzten Hostinganbieters.</p>
  <h2>3. Funktionen, Cookies und Tracking</h2><p>Soweit vorhanden, sind Bilder in der bereitgestellten Website eingebettet. Galerie, Bildvergrößerung, Animationen und die Funktion zum Kopieren der E-Mail-Adresse werden, soweit vorhanden, auf Ihrem Gerät ausgeführt.</p><p>Diese Website verwendet in ihrer bereitgestellten Grundversion keine eigenen Cookies, Analysewerkzeuge oder Trackingdienste.</p>
  <h2>4. Kontaktaufnahme</h2><p>Wenn Sie per E-Mail oder telefonisch Kontakt aufnehmen, werden Ihre übermittelten Angaben zur Bearbeitung Ihrer Anfrage verarbeitet.</p><p>Rechtsgrundlage ist je nach Anlass Art. 6 Abs. 1 lit. b oder lit. f DSGVO.</p><p>Die Daten werden gelöscht, sobald sie für die Bearbeitung nicht mehr benötigt werden und keine gesetzlichen Aufbewahrungspflichten entgegenstehen.</p>
  <h2>5. Externe Links</h2><p>Diese Website enthält gegebenenfalls Links zu externen Plattformen wie sozialen Netzwerken.</p><p>Erst beim Aufrufen dieser Links verlassen Sie diese Website. Für die dortige Datenverarbeitung gelten die Datenschutzhinweise der jeweiligen Anbieter.</p>
  <h2>6. Ihre Rechte</h2><p>Sie haben im Rahmen der gesetzlichen Voraussetzungen das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit sowie Widerspruch gegen bestimmte Verarbeitungen.</p><p>Sie können sich außerdem bei einer zuständigen Datenschutzaufsichtsbehörde beschweren.</p>
  <h2>7. Aktualisierung</h2><p>Diese Datenschutzerklärung gilt für die aktuelle technische Ausgestaltung der Website. Werden weitere Dienste, Funktionen oder Datenverarbeitungen hinzugefügt, muss sie entsprechend angepasst werden.</p>
</div></section>
<div class="site-main">
<div class="cursor" id="glow" aria-hidden="true"></div>
<header class="nav" id="nav"><div class="wrap">
  <a class="logo" href="#top">${data.logo ? `<img src="${data.logo}" alt="${escapeHtml(name)} Logo">` : escapeHtml(name)}</a>
  ${nav.length ? `<button class="menu-toggle" type="button" aria-label="Menü öffnen" aria-expanded="false" aria-controls="nav-links"><span></span><span></span><span></span></button>` : ''}
  <ul id="nav-links">${nav.map(([id, label]) => `<li><a href="#${id}">${label}</a></li>`).join('')}</ul>
</div></header>

<section class="hero" id="top">
  ${data.hero.image ? `<div class="hero-bg"><img src="${data.hero.image}" alt=""></div>` : ''}
  <div class="orb o1"></div><div class="orb o2"></div>
  <div class="wrap">
    ${data.hero.badge ? `<span class="badge rv">${escapeHtml(data.hero.badge)}</span>` : ''}
    <h1 class="rv" style="--d:.08s"><span class="grad">${escapeHtml(headline)}</span></h1>
    ${data.hero.sub ? `<p class="lead rv" style="--d:.16s">${nl2br(data.hero.sub)}</p>` : ''}
    <a class="btn rv" style="--d:.24s" href="#kontakt">${escapeHtml(data.hero.cta || 'Kontakt aufnehmen')}</a>
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

<section id="kontakt"><div class="wrap">
  <h2 class="rv">Kontakt</h2>
  <div class="contact-box">
    ${contact.email ? `<div class="card rv"><h3>E-Mail</h3>${canCopyEmail ? `<button class="email-copy" type="button" data-copy-email aria-describedby="email-copy-status" title="E-Mail-Adresse kopieren"><span id="contact-email-value">${escapeHtml(contact.email)}</span></button><p class="copy-status" id="email-copy-status" role="status" aria-live="polite"></p>` : `<span>${escapeHtml(contact.email)}</span>`}</div>` : ''}
    ${contact.phone ? `<div class="card rv" style="--d:.08s"><h3>Telefon</h3><a href="tel:${escapeHtml(contact.phone.replace(/[^+\d]/g, ''))}">${escapeHtml(contact.phone)}</a></div>` : ''}
    ${contact.address ? `<div class="card rv" style="--d:.16s"><h3>Adresse</h3>${nl2br(contact.address)}</div>` : ''}
    ${contact.hours ? `<div class="card rv" style="--d:.24s"><h3>Öffnungszeiten</h3>${nl2br(contact.hours)}</div>` : ''}
  </div>
  ${!hasContact ? '<p class="rv">Noch keine Kontaktdaten hinterlegt.</p>' : ''}
  ${canCopyEmail ? `<div class="big-cta rv"><h2>Kontakt aufnehmen</h2><button class="btn" type="button" data-copy-email aria-describedby="cta-copy-status">E-Mail-Adresse kopieren</button><p class="copy-status" id="cta-copy-status" role="status" aria-live="polite"></p></div>` : ''}
</div></section>

<footer><div class="wrap">
  <span>© <span id="y"></span> ${escapeHtml(name)}</span>
  <span class="legal-links">${safeUrl(contact.instagram) ? `<a href="${safeUrl(contact.instagram)}" target="_blank" rel="noopener">Instagram</a>` : ''}<a href="#impressum">Impressum</a><a href="#datenschutz">Datenschutz</a></span>
</div></footer>

<div class="lb" id="lb"><img alt=""></div>
</div>
<script>
(function(){
  var $=function(s){return document.querySelector(s)};
  $('#y').textContent=new Date().getFullYear();
  var nav=$('#nav');
  var menu=nav.querySelector('.menu-toggle'),links=$('#nav-links');
  if(menu){
    var closeMenu=function(){menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Menü öffnen')};
    menu.addEventListener('click',function(){
      var open=menu.getAttribute('aria-expanded')!=='true';
      menu.setAttribute('aria-expanded',String(open));
      menu.setAttribute('aria-label',open?'Menü schließen':'Menü öffnen');
    });
    links.addEventListener('click',function(e){if(e.target.closest('a'))closeMenu()});
    addEventListener('keydown',function(e){if(e.key==='Escape'&&menu.getAttribute('aria-expanded')==='true'){closeMenu();menu.focus()}});
    matchMedia('(max-width: 760px)').addEventListener('change',function(e){if(!e.matches)closeMenu()});
  }
  document.querySelectorAll('[data-copy-email]').forEach(function(button){
    button.addEventListener('click',async function(){
      var selection=window.getSelection();
      if(selection&&!selection.isCollapsed&&button.contains(selection.anchorNode))return;
      var email=$('#contact-email-value').textContent;
      var status=document.getElementById(button.getAttribute('aria-describedby'));
      var copied=false;
      if(navigator.clipboard&&navigator.clipboard.writeText){
        try{await navigator.clipboard.writeText(email);copied=true}catch(error){copied=false}
      }
      if(!copied){
        var field=document.createElement('textarea');
        field.value=email;
        field.readOnly=true;
        field.style.cssText='position:fixed;left:-9999px;top:0';
        document.body.appendChild(field);
        field.select();
        try{copied=document.execCommand('copy')}catch(error){copied=false}
        field.remove();
        button.focus({preventScroll:true});
      }
      status.textContent=copied?'E-Mail kopiert!':'Kopieren nicht möglich. Bitte die E-Mail-Adresse oben markieren und manuell kopieren.';
    });
  });
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
