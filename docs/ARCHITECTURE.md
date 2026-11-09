# Architektur von LeanWebsite Studio

Technische Dokumentation zu Aufbau, Datenfluss und Sicherheitsmechanismen. Einen Überblick über das Projekt gibt die [README](../README.md). Produktiv erreichbar ist die Anwendung unter <https://leanwebsite-studio.matthiasbrehm.de>.

## Inhalt

- [Projektstruktur](#projektstruktur)
- [Frontend](#frontend)
- [Backend](#backend)
- [Gemeinsame Templates und HTML-Generierung](#gemeinsame-templates-und-html-generierung)
- [Datenhaltung: Neon PostgreSQL und Cloudflare R2](#datenhaltung-neon-postgresql-und-cloudflare-r2)
- [Entwurfsverwaltung und Token-Sicherheit](#entwurfsverwaltung-und-token-sicherheit)
- [Stripe Checkout, Snapshots und Idempotenz](#stripe-checkout-snapshots-und-idempotenz)
- [Webhook-Verarbeitung](#webhook-verarbeitung)
- [Geschützte Downloads](#geschützte-downloads)
- [Vertragsbestätigung und Widerruf](#vertragsbestätigung-und-widerruf)
- [Sicherheitsmechanismen](#sicherheitsmechanismen)
- [Umgebungsvariablen und Deployment](#umgebungsvariablen-und-deployment)
- [Bekannte Einschränkungen](#bekannte-einschränkungen)

## Projektstruktur

```text
api/                  Vercel Functions
  _lib/               Fachlogik: Entwürfe, Checkout, Webhook-Events, Downloads, Speicher, PDF, Diagnose
  drafts/             Entwurf anlegen (index.js), laden und speichern ([id].js)
  orders/             Status, Download, Vertragsbestätigung
  checkout.js         Stripe-Checkout-Session erzeugen
  stripe-webhook.js   Zahlungsbestätigung von Stripe
  withdrawals.js      Elektronischer Widerruf
  health.js           Health-Check
  health-db.js        Health-Check inkl. Datenbank
db/migrations/        Versionierte SQL-Migrationen
scripts/migrate.js    Migrationsläufer
shared/               Code für Browser und Server (Templates, Pakete, Texte)
src/                  Frontend (Landingpage, Builder, Bestellabschluss, rechtliche Seiten)
tests/                Offline-Tests (Hilfsfunktionen und Fakes in tests/helpers/)
public/               Statische Assets
_reference/           Referenzmaterial, nicht Teil der Anwendung
vercel.json           Rewrites auf index.html
```

## Frontend

- Vite mit Vanilla JavaScript (ES-Module) und CSS, keine UI-Frameworks.
- Auslieferung über `index.html`. Das Routing erfolgt clientseitig in `src/main.js` anhand von `window.location.pathname`; `vercel.json` leitet `/builder/artist-band`, `/builder/business`, `/datenschutz`, `/widerruf` und `/order/complete` auf `index.html` um.
- Zwei Builder: `src/artist-band-builder.js` und `src/business-builder.js`, jeweils mit eigener Mobil-Ansicht (Umschalter Formular/Vorschau).
- Die Live-Vorschau läuft in einem `iframe` mit `sandbox`-Attribut (Artist & Band: `sandbox=""`, Business: `allow-scripts allow-popups`).
- Die Entwurfsreferenz (ID und Token) liegt im `localStorage`. Die Bestellabschlussseite (`src/order-complete.js`) liest sie von dort und fragt den Zahlungsstatus per POST ab (alle 4 Sekunden, maximal 45 Abfragen, solange der Webhook aussteht).

## Backend

Vercel Functions (Node.js, ES-Module) unter `api/`; die Endpunkte sind dünn, Fachlogik liegt in `api/_lib/`.

| Endpunkt | Zweck |
| --- | --- |
| `POST /api/drafts` | Entwurf anlegen, Token ausliefern |
| `GET`/`PUT /api/drafts/:id` | Entwurf laden bzw. speichern (`Authorization`-Header) |
| `POST /api/checkout` | Bestellung anlegen, Stripe-Checkout-URL liefern |
| `POST /api/stripe-webhook` | Stripe-Ereignisse verarbeiten |
| `POST /api/orders/status` | Zahlungsstatus abfragen |
| `POST /api/orders/download` | HTML-Datei herunterladen (nur bezahlt) |
| `POST /api/orders/confirmation` | Vertragsbestätigung als PDF (nur bezahlt) |
| `POST /api/withdrawals` | Elektronischen Widerruf einreichen |
| `GET /api/health`, `GET /api/health-db` | Statusprüfung |

## Gemeinsame Templates und HTML-Generierung

- `shared/` enthält Code, der im Browser und auf dem Server läuft: Templates (`artist-band-template.js`, `business-template.js`), Pakete (`packages.js`), Rechts- und Hinweistexte, Checkout-Prüfansicht.
- Das Frontend nutzt die Templates für die Live-Vorschau, der Server für die kaufbare HTML-Datei. Vorschau und Ergebnis stammen so aus denselben Templates; `tests/shared-boundary.test.js` sichert die Grenze von `shared/` ab.
- Serverseitig hat jeder Builder einen eigenen Validator und Generator (`api/_lib/artist-band.js`, `api/_lib/business.js`, gebündelt in `api/_lib/generators.js`).
- Die gekaufte Datei (`website.html`) entsteht ausschließlich auf dem Server aus validierten Daten; vom Browser gelieferter HTML-Code wird nie verwendet.

### Validierung

- Feste Feldlisten, Längen- und Formatgrenzen; unbekannte Felder werden abgelehnt.
- Artist & Band: Cover als JPEG, geprüft auf Größe, Auflösung und Dekodierbarkeit (`jpeg-js`); bis zu 20 Tracks und 20 Gigs.
- Business: Bilder als JPEG- oder WebP-Data-URL (max. 1,5 MB je Bild, max. 4 MB je Anfrage); bis zu 8 Leistungen, 4 Kennzahlen und 3 Galeriebilder.
- Preise, Währung und Paket stammen nur aus `shared/packages.js`. Vor dem Checkout werden zusätzlich die Angaben zu Impressum und Datenschutz geprüft.

## Datenhaltung: Neon PostgreSQL und Cloudflare R2

- **Neon PostgreSQL** (`@neondatabase/serverless`) speichert Entwürfe (inkl. Token-Hash und Sperrstatus), Bestellungen, Stripe-Ereignisse (`stripe_events`), Auftragsdaten für „Rundum sorglos“ (`order_fulfillment`) und Widerrufe (`withdrawals`).
- **Cloudflare R2** (privater, S3-kompatibler Bucket, `@aws-sdk/client-s3`) speichert den Arbeitsstand als JSON (`drafts/<id>/…`) und den Bestell-Snapshot (`orders/<id>/snapshot`). Es gibt keine öffentlichen Speicher-URLs; Schlüssel werden serverseitig aus UUIDs gebildet und gegen ein festes Muster geprüft (`api/_lib/storage.js`).
- **Migrationen:** `pnpm db:migrate` (`scripts/migrate.js`) liest `.env.local`, bricht ab, wenn die Datenbank nicht `leanwebsite` heißt, führt jede noch nicht angewendete Migration aus `db/migrations/` in einer Transaktion aus und vermerkt sie in `leanwebsite_schema_migrations`.

## Entwurfsverwaltung und Token-Sicherheit

- Es gibt kein Benutzerkonto. Beim Anlegen eines Entwurfs wird ein zufälliges 256-Bit-Token erzeugt und einmalig ausgeliefert.
- In der Datenbank liegt nur der SHA-256-Hash des Tokens (eindeutiger Index); die Prüfung erfolgt zeitkonstant.
- Unbekannter Entwurf und falsches Token liefern dieselbe 404-Antwort.
- Das Token wird im `Authorization`-Header (Entwurfs-API) bzw. im POST-Body (Bestell-API) übertragen, nie in der URL.
- Jede Speicherung erzeugt ein neues, unveränderliches Objekt in R2; ein statusgeschütztes Datenbank-Update setzt den Verweis.
- Bezahlte (gesperrte) Entwürfe lassen sich nicht mehr ändern; Datenbank-Trigger (`drafts_enforce_lock`, `drafts_prevent_locked_delete`) erzwingen das auch auf Datenbankebene.

## Stripe Checkout, Snapshots und Idempotenz

1. `POST /api/checkout` validiert den Entwurf und erzeugt die HTML-Datei serverseitig.
2. Pro Entwurf ist höchstens eine offene Bestellung erlaubt (partieller Unique-Index `orders_one_pending_per_draft_idx`).
3. Vor der Session-Erzeugung kopiert der Server den Inhalt in einen eigenen Snapshot (`orders/<id>/snapshot`, bedingter Schreibzugriff ohne Überschreiben) und speichert Schlüssel, SHA-256, Größe und Content-Type in der Bestellung.
4. Die Bestell-ID dient als Idempotency-Key der Stripe-Session (`leanwebsite-checkout-<id>`); Wiederholungen, etwa nach einem Absturz, liefern dieselbe Session.
5. Hat sich der Entwurf geändert, wird eine veraltete offene Session beendet und eine neue Bestellung angelegt.
6. Datenbank-Constraints und der Trigger `orders_protect_immutable_fields` schützen den Snapshot vor Änderungen.
7. Die Weiterleitungs-URLs basieren auf der konfigurierten `SITE_URL`, nie auf Request-Headern.

Bei „Rundum sorglos“ erfasst der Checkout zusätzlich Rechnungs-, Domain- und Domaininhaber-Angaben samt Einwilligung zur Hostinger-Einrichtung (Tabelle `order_fulfillment`). Die Anwendung speichert diese Auftragsdaten; die Einrichtung selbst ist nicht automatisiert. Die verbindliche Quelle für Pakete und Preise ist `shared/packages.js`. Es wird keine Umsatzsteuer berechnet (Hinweis auf § 19 UStG im Checkout).

## Webhook-Verarbeitung

- `POST /api/stripe-webhook` prüft die Signatur über den unveränderten Raw-Body.
- Verarbeitet werden nur `checkout.session.completed` und `checkout.session.async_payment_succeeded`.
- Eine Bestellung wird nur auf `paid` gesetzt, wenn die Zahlung bestätigt ist, Betrag, Währung und Bestell-Referenz passen und ein Snapshot existiert.
- Bestellung, Sperre des Entwurfs und Ereignisprotokoll (`stripe_events`) werden in einem einzigen SQL-Statement geschrieben; wiederholte Events sind idempotent.
- Abweichungen werden mit einem Prüfgrund (`review_reason`) festgehalten. Bei Infrastrukturfehlern antwortet die Funktion mit 5xx, damit Stripe erneut zustellt.

## Geschützte Downloads

- `POST /api/orders/download` liefert die Datei nur für eine bezahlte Bestellung und nach erfolgreicher Prüfung der Entwurfs-Zugangsdaten.
- Der Speicherschlüssel wird aus der Bestell-ID abgeleitet, nie vom Client übernommen; vor der Auslieferung werden Größe und SHA-256 gegen die Bestelldaten verifiziert.
- Die Antwort enthält `Content-Disposition: attachment` (Dateiname `website.html`), `nosniff` und eine restriktive `Content-Security-Policy` (`sandbox; default-src 'none'; …`).

## Vertragsbestätigung und Widerruf

- **Vertragsbestätigung:** `POST /api/orders/confirmation` erzeugt das PDF (`pdf-lib`) erst nach Prüfung der Zugangsdaten und erneuter Prüfung der Stripe-Session; die Antwort wird ebenfalls mit `attachment` und restriktiver CSP ausgeliefert.
- **Elektronischer Widerruf:** Die Seite `/widerruf` sendet an `POST /api/withdrawals`. Erklärungen werden in der Tabelle `withdrawals` gespeichert. Schutz: feste Feldliste, Same-Origin-Prüfung (Origin-Header gegen Host), Honeypot-Feld (`website`) und Body-Limit von 8 KB.

## Sicherheitsmechanismen

- Der Server vertraut keinen Browserdaten (Validierung, serverseitige HTML-Erzeugung, Preise nur aus `shared/packages.js`).
- Token nur als Hash gespeichert, zeitkonstanter Vergleich, einheitliche 404-Antworten.
- Private Speicherung ohne öffentliche URLs, Integritätsprüfung (SHA-256) vor Auslieferung.
- Webhook-Signaturprüfung, Betrags-/Währungs-/Referenzprüfung, idempotente Verarbeitung.
- Request-Bodys werden manuell gelesen und in der Größe begrenzt; Entwurfs-, Checkout- und Bestell-Endpunkte antworten mit `Cache-Control: no-store`.
- **Diagnose-Logging:** `api/_lib/diagnostics.js` (`logError`, `describeError`) schreibt Fehler nur ins Server-Log, nie an den Browser. Meldungen werden bereinigt (URLs, Auth-Header, Schlüssel, E-Mail-Adressen und lange Zeichenfolgen maskiert) und gekürzt; Ursachenketten werden ausgegeben, ein kurzer Stacktrace nur außerhalb von Production. Das Modul wird von den API-Endpunkten verwendet und durch `tests/diagnostics.test.js` abgedeckt.
- Health-Endpunkte liefern nur einen Statuswert ohne Zugangsdaten.
- Die Anwendung implementiert selbst kein Rate Limiting.

## Umgebungsvariablen und Deployment

Alle Variablen stehen in `.env.example`; echte Werte gehören nie ins Repository (`.env*` ist per `.gitignore` ausgeschlossen).

| Variable | Zweck |
| --- | --- |
| `DATABASE_URL` | Neon-PostgreSQL-Verbindung |
| `STRIPE_SECRET_KEY` | Stripe-API (serverseitig) |
| `STRIPE_WEBHOOK_SECRET` | Signaturprüfung des Webhooks |
| `SITE_URL` | Öffentliche Basis-URL für Stripe-Weiterleitungen (https; lokal ist `http://localhost` erlaubt), produktiv `https://leanwebsite-studio.matthiasbrehm.de` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Privater Cloudflare-R2-Bucket |

**Deployment auf Vercel**

1. Repository mit einem Vercel-Projekt verbinden; Vite-Frontend und Funktionen unter `api/` werden erkannt, `vercel.json` enthält die Rewrites.
2. Alle Variablen für die Umgebung **Production** setzen; nach Änderungen ist ein neues Deployment nötig.
3. Migrationen gegen die Produktionsdatenbank ausführen (`pnpm db:migrate`).
4. In Stripe einen Webhook auf `https://leanwebsite-studio.matthiasbrehm.de/api/stripe-webhook` für `checkout.session.completed` und `checkout.session.async_payment_succeeded` einrichten und das Signing-Secret als `STRIPE_WEBHOOK_SECRET` hinterlegen.
5. Für `/api/checkout` wird ein Rate Limit über die Vercel Firewall empfohlen.

## Bekannte Einschränkungen

- Download und Vertragsbestätigung sind über die Entwurfsreferenz im Browser erreichbar (kein E-Mail-Link); die Zahl der Downloads ist nicht begrenzt.
- Die Einrichtung von Hosting und Domain im Paket „Rundum sorglos“ ist nicht automatisiert.
- Verwaiste Entwurfsversionen und Snapshots abgebrochener Bestellungen werden nicht automatisch aufgeräumt.
