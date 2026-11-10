# LeanWebsite Studio

**Live:** <https://leanwebsite-studio.matthiasbrehm.de>

LeanWebsite Studio ist eine Plattform, auf der Künstler, Bands, Selbstständige und kleine Unternehmen ihre eigene Website direkt im Browser gestalten, live in der Vorschau prüfen, bezahlen und als fertige HTML-Datei herunterladen können. Ein Konto ist dafür nicht nötig. Optional lässt sich im Paket „Rundum sorglos“ zusätzlich die Einrichtung von Hosting und .de-Domain beauftragen.

Pakete und Preise stehen im Studio unter <https://leanwebsite-studio.matthiasbrehm.de>.

Das Projekt ist bewusst schlank: Vanilla JavaScript im Frontend, Vercel Functions im Backend, keine UI-Frameworks.

## Zielgruppen

- **Künstler und Bands**, die schnell eine Online-Präsenz mit Bio, Infos und Links brauchen.
- **Selbstständige und kleine Unternehmen**, die eine übersichtliche Firmenwebsite mit Leistungen und Kontaktdaten wollen.

## Funktionen

**Builder „Artist & Band“** (`/builder/artist-band`)

- Name, Genre, Tagline und Bio, Akzentfarbe, Theme (dunkel, hell, Verlauf) und Schriftart
- Cover-Bild, bis zu 20 Tracks und 20 Gigs
- Links zu Spotify, SoundCloud, Bandcamp und Instagram sowie Kontakt-E-Mail
- Angaben für Impressum und Datenschutz fließen in die Website ein

**Builder „Business“** (`/builder/business`)

- Abschnitte für Unternehmen, Startbereich, bis zu 8 Leistungen, „Über uns“ mit Kennzahlen, Logo und Galerie
- Kontaktbereich mit E-Mail, Telefon, Adresse, Öffnungszeiten und Instagram
- Farbpaletten, Akzentfarben, Hell/Dunkel-Modus und Eckenradius
- Betreiberangaben für Impressum und Datenschutz

**Für beide Builder**

- Live-Vorschau in einem abgeschotteten iFrame, auf kleinen Bildschirmen mit Umschalter zwischen Formular und Vorschau
- Bezahlung über Stripe Checkout, Download der fertigen `website.html` und einer Vertragsbestätigung (PDF) nach bestätigter Zahlung
- Datenschutzerklärung, elektronischer Widerruf und Bestellabschlussseite

## Tech-Stack

| Bereich | Technologie |
| --- | --- |
| Frontend | Vite, Vanilla JavaScript (ES-Module), CSS |
| Backend | Vercel Functions (Node.js) unter `api/` |
| Datenbank | Neon PostgreSQL |
| Objektspeicher | Cloudflare R2 (privat, S3-kompatibel) |
| Zahlung | Stripe Checkout und Webhooks |
| Dokumente und Bilder | `pdf-lib`, `jpeg-js` |
| Tests | Node.js Test Runner |
| Paketverwaltung | pnpm |

## Architektur im Überblick

```text
api/         Vercel Functions (Entwürfe, Checkout, Webhook, Downloads, Widerruf)
db/          SQL-Migrationen
shared/      Code für Browser und Server (Templates, Pakete, Texte)
src/         Frontend (Landingpage, Builder, Bestellabschluss, rechtliche Seiten)
tests/       Offline-Tests
```

Ablauf eines Kaufs:

1. Der Builder speichert den Arbeitsstand als Entwurf. Die Referenz dazu liegt im `localStorage` des Browsers.
2. Beim Checkout prüft der Server den Entwurf, erzeugt daraus die HTML-Datei, friert den Stand als Snapshot ein und leitet zu Stripe weiter.
3. Stripe meldet die Zahlung per Webhook; erst dann gilt die Bestellung als bezahlt.
4. Nach bestätigter Zahlung stehen Download und Vertragsbestätigung bereit.

Mehr dazu in der [Architekturdokumentation](docs/ARCHITECTURE.md).

## Technische Besonderheiten

- **Eine Vorlage für Vorschau und Ergebnis:** Der Code in `shared/` läuft im Browser (Live-Vorschau) und auf dem Server (kaufbare Datei).
- **Server vertraut dem Browser nicht:** Eingaben und Bilder werden serverseitig validiert, die HTML-Datei wird ausschließlich serverseitig erzeugt, Preise stammen nur aus `shared/packages.js`.
- **Entwürfe ohne Benutzerkonto:** Zugriff über ein zufälliges Token, in der Datenbank liegt nur dessen Hash.
- **Zuverlässiger Checkout:** Unveränderlicher Snapshot je Bestellung, idempotente Stripe-Sessions und idempotente Webhook-Verarbeitung.
- **Geschützte Downloads:** Keine öffentlichen Speicher-URLs; Auslieferung nur nach Zahlung und mit Integritätsprüfung.
- **Offline testbar:** Die Tests laufen ohne Datenbank, Stripe oder R2.

## Lokale Installation

Voraussetzungen: Node.js (mindestens 20.6) und pnpm.

```sh
pnpm install
cp .env.example .env.local   # Werte eintragen
pnpm dev                     # Frontend, http://localhost:5173
```

`pnpm dev` startet nur das Vite-Frontend. Für Frontend und API gemeinsam:

```sh
pnpm exec vercel dev
```

Weitere Befehle:

```sh
pnpm build        # Produktionsbuild
pnpm preview      # Vorschau des Builds
pnpm db:migrate   # Datenbankmigrationen (liest .env.local)
```

Die benötigten Umgebungsvariablen sind in `.env.example` aufgeführt und in der [Architekturdokumentation](docs/ARCHITECTURE.md#umgebungsvariablen-und-deployment) erklärt.

## Tests

```sh
pnpm test
```

Die Tests laufen offline; externe Dienste werden durch Fakes ersetzt. Sie decken unter anderem Validierung, Entwurfs-API, Tokens, Checkout, Webhook, Downloads, Vertragsbestätigung, Widerruf und Diagnose-Logging ab.

## Deployment auf Vercel

1. Repository mit einem Vercel-Projekt verbinden. `vercel.json` enthält die Rewrites.
2. Umgebungsvariablen für **Production** setzen.
3. Migrationen gegen die Produktionsdatenbank ausführen (`pnpm db:migrate`).
4. In Stripe einen Webhook auf `https://leanwebsite-studio.matthiasbrehm.de/api/stripe-webhook` einrichten (`checkout.session.completed`, `checkout.session.async_payment_succeeded`) und das Signing-Secret als `STRIPE_WEBHOOK_SECRET` hinterlegen.

Details und Hinweise (z. B. Rate Limiting) stehen in der [Architekturdokumentation](docs/ARCHITECTURE.md#umgebungsvariablen-und-deployment).

## Lizenz
Der Quellcode von LeanWebsite Studio wird unter der [GNU Affero General Public License v3.0](LICENSE) veröffentlicht.

Für die mit den Buildern generierten und an Kunden ausgelieferten Websites gelten gesonderte Nutzungsrechte. Kunden dürfen ihre fertigen Websites frei verwenden, bearbeiten, veröffentlichen und kommerziell nutzen, ohne sie deshalb unter die AGPLv3 stellen zu müssen.

Einzelheiten stehen in [LICENSING.md](LICENSING.md).

Copyright © 2026 Matthias Brehm.
