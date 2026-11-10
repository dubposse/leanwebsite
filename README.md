# LeanWebsite

Eine gemeinsame Landingpage für spezialisierte Website-Builder. Das Frontend nutzt Vite, Vanilla JavaScript (ES-Module) und CSS; Backend-Routen werden als Vercel Serverless Functions umgesetzt.

## Projektstruktur

```text
api/
  _lib/              Gemeinsame serverseitige API-Hilfsfunktionen
  health.js          GET /api/health
src/
  data/
    builders.js      Builder-Angebote und konfigurierbare Ziel-URLs
  main.js            Landingpage und Builder-Auswahl
  style.css          Responsive Gestaltung
public/
  leanwebsite.svg    Favicon
.env.example         Vorlagen für spätere externe Dienste
index.html           Vite-Einstiegspunkt
```

Der Artist/Band-Einstieg führt zum Builder unter `/builder/artist-band`. Datenbank, Stripe Checkout und Cloudflare R2 sind serverseitig angebunden.

## Lokal starten

Voraussetzungen: Node.js und pnpm.

```sh
pnpm install
pnpm dev
```

Die Vite-Entwicklungsseite ist standardmäßig unter `http://localhost:5173` erreichbar. Für einen Produktionsbuild und eine lokale Vorschau:

```sh
pnpm build
pnpm preview
```

Vercel Functions werden lokal über das Vercel CLI mit `vercel dev` ausgeführt. Damit ist auch die Health-Route unter `/api/health` erreichbar. Die normale Vite-Entwicklung mit `pnpm dev` stellt diese Serverless Functions nicht bereit.

## Datenbank (Neon PostgreSQL)

- `api/_lib/db.js`: serverseitiger Neon-Client (liest `DATABASE_URL`) und `checkDatabaseHealth()`; Abfragen nur parametrisiert.
- `shared/packages.js` (Re-Export in `api/_lib/packages.js`): Paketdefinitionen in Integer-Cent (Endbeträge in EUR, es wird keine Steuer berechnet oder separat ausgewiesen). Preise nie vom Frontend übernehmen.
- `api/health-db.js`: `GET /api/health-db` gibt nur `ok`/`unavailable` zurück, keine Zugangsdaten.
- `db/migrations/`: versionierte SQL-Migrationen (`0001_init.sql`: `builders`, `drafts`, `orders`, `downloads`, `stripe_events`).

Migration ausführen (lädt `.env.local`):

```sh
pnpm db:migrate
```

Das Skript bricht ab, wenn die verbundene Datenbank nicht `leanwebsite` heißt, führt jede Migration in einer Transaktion aus, merkt sich angewendete Versionen in `leanwebsite_schema_migrations` und löscht oder verändert keine bestehenden Tabellen.

## Dateispeicher (Cloudflare R2)

`api/_lib/storage.js` bindet einen privaten R2-Bucket über die S3-kompatible API an (`@aws-sdk/client-s3`, Region `auto`, Endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`).

- Funktionen: `putObject`, `getObject`, `deleteObject`, `objectExists`.
- Keys entstehen nur serverseitig: `draftObjectKey(draftId, fileName)` → `drafts/<uuid>/<datei>`, `orderZipKey(orderId)` → `orders/<uuid>/website.zip`. Jeder Key wird vor dem Zugriff validiert.
- Erlaubte Content-Types sind eine Allowlist; Objekte sind auf 50 MB begrenzt.
- Es gibt keine öffentlichen URLs und keine Upload-, Download- oder Lösch-Endpunkte.

## Stripe (Webhook-Vorbereitung)

- `api/_lib/stripe.js`: serverseitiges Stripe-Modul (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), Signaturprüfung über den unveränderten Raw-Body.
- `api/_lib/stripe-events.js`: Verarbeitung verifizierter Events.
- `api/stripe-webhook.js`: `POST /api/stripe-webhook` (Body-Parser deaktiviert, ungültige Signatur → HTTP 400).

Behandelt werden nur `checkout.session.completed` und `checkout.session.async_payment_succeeded`; alle anderen Events werden ignoriert. Eine Bestellung wird nur auf `paid` gesetzt, wenn `payment_status = paid` ist, die Session-ID serverseitig gespeichert ist und Betrag, Währung und (falls vorhanden) `client_reference_id` zur Bestellung passen. Event-Erfassung (`stripe_events`) und Bestellungsupdate laufen in einer Transaktion; bei Fehlern antwortet die Funktion mit 5xx, damit Stripe erneut zustellt. Ein Checkout-Endpunkt ist vorhanden (siehe unten); Download-Tokens und Dateifreigabe sind nicht Teil der Builder-Oberfläche.

Tests (offline, ohne Stripe-Verbindung und ohne Datenbank): `pnpm test`.

## Stripe Checkout und Webhook

- `api/checkout.js` + `api/_lib/checkout.js`: `POST /api/checkout` mit `{ builder, package, draftId, draftToken }` (JSON, max. 4 KB, unbekannte Felder werden abgelehnt). Antwort: nur `{ url }` der Stripe-Checkout-Session (Modus `payment`, EUR, ohne automatische Steuer).
- `api/_lib/tokens.js`: geheime Entwurfs-Tokens (256 Bit). In `drafts.access_token_hash` wird nur der SHA-256-Hash gespeichert; die Entwurfs-UUID allein berechtigt zu nichts. Unbekannter Entwurf und falsches Token ergeben dieselbe 404-Antwort.
- Preis, Währung und Paket kommen ausschließlich aus `api/_lib/packages.js`; das Paket muss zum Builder des Entwurfs passen. Die Bestellung (`pending`) wird serverseitig angelegt, ihre ID ist `client_reference_id`, die Session-ID wird in `orders.stripe_checkout_session_id` gespeichert.
- Idempotenz: pro Entwurf ist nur eine offene Bestellung möglich (Unique-Index). Wiederholte Anfragen liefern die bestehende Session; die Bestell-ID dient als Stripe-Idempotency-Key, sodass nach einem Stripe-Fehler dieselbe Session erzeugt wird. Abgelaufene Sessions werden verworfen, bei Paketwechsel wird die alte Session beendet. Eine abgeschlossene Session wird nie verworfen.
- `api/stripe-webhook.js`: nur `checkout.session.completed` und `checkout.session.async_payment_succeeded`. Eine Bestellung wird nur bei `payment_status = paid` und passender Session-ID, Bestell-ID (`client_reference_id`), Betrag und Währung auf `paid` gesetzt; Bestellung, Event-Eintrag und Sperre des Entwurfs erfolgen in einem Statement. Abweichungen werden in `stripe_events.review_reason` festgehalten:

```sql
SELECT id, type, order_id, outcome, review_reason, received_at FROM stripe_events WHERE review_reason IS NOT NULL;
```

- Die Weiterleitung nach der Zahlung (`SITE_URL/order/complete?checkout=success`) gibt nichts frei; sie öffnet nur die Bestellabschlussseite, die den Status serverseitig abfragt.
- Für `/api/checkout` empfiehlt sich zusätzlich ein Rate Limit über die Vercel Firewall.

## Website-Snapshot und Entwurfsinhalt

- Der aktuelle Arbeitsstand eines Entwurfs liegt als unveränderliches Objekt (`application/zip` oder `application/json`) im privaten R2-Bucket unter `drafts/<draftId>/content-<uuid>`; `drafts.storage_key` verweist auf die aktuelle Version. Bestehende `content`-Schlüssel bleiben lesbar. `saveDraftContent()` in `api/_lib/drafts.js` schreibt eine neue Version bedingt und veröffentlicht sie mit einem Status-geschützten Datenbankupdate. Dadurch überschreiben parallele Speichervorgänge keine gemeinsam gelesenen Bytes; beim Sperren und Speichern entscheidet die serialisierte Draft-Zeilenaktualisierung.
- Beim Checkout kopiert der Server den aktuellen Inhalt in `orders/<orderId>/snapshot` (bedingter Schreibzugriff, überschreibt nie) und speichert Schlüssel, SHA-256, Größe und Content-Type in der Bestellung. Erst danach wird die Stripe-Session erzeugt. Migration `0003` erzwingt das per Constraint (Session und `paid` setzen einen Snapshot voraus) und per Trigger (Snapshot und Angebot einer Bestellung mit Session sind unveränderlich).
- Der Entwurf bleibt bis zur Zahlung bearbeitbar. Hat sich der Inhalt seit dem Snapshot geändert, wird eine offene Session nicht wiederverwendet: sie wird beendet und eine neue Bestellung mit neuem Snapshot angelegt.
- Der Webhook setzt nur Bestellungen mit Snapshot auf `paid` (sonst Review-Grund `snapshot_missing`).
- Offene Integrationspunkte: ZIP-Erzeugung nach Zahlung und Aufräumen verwaister Draft-Versionen sowie Snapshots abgebrochener Bestellungen.

## Entwurfs-API (Schritt 12)

- `POST /api/drafts` `{ builder: "artist-band" | "business" }` → `201 { draftId, draftToken }`. Das Token wird nur einmal ausgegeben, gespeichert wird nur der Hash.
- `GET /api/drafts/:id` → `{ draftId, builder, status, updatedAt, data }` (`data` ist `null`, solange nichts gespeichert wurde).
- `PUT /api/drafts/:id` `{ builder, data }` → `{ updatedAt }`. Max. 4 MB pro Request; gesperrte Entwürfe → 409.
- GET/PUT erwarten `Authorization: Bearer <draftToken>` (nie in der URL). Falsches Token und fremde/unbekannte ID → gleiche 404-Antwort. Keine CORS-Header (nur Same-Origin).
- Gespeichert wird in `drafts/<id>/content` ausschließlich das serverseitig validierte, normalisierte JSON des Builders. Beim Speichern muss zusätzlich die HTML-Erzeugung gelingen.

### Builder-Integration

`api/_lib/generators.js` registriert `artist-band` mit seinem eigenen `{ validate(input), generateHtml(data, year) }`-Generator aus `api/_lib/artist-band.js`. Die Vorschau unter `/builder/artist-band` verwendet denselben HTML-Renderer aus `shared/artist-band-template.js`; es gibt keine getrennte Vorschau-Generator-Version. Der Validator normalisiert die Artist/Band-Felder, begrenzt Arrays und Strings und akzeptiert als Cover nur JPEG-Data-URLs, die `jpeg-js` tatsächlich dekodiert (max. 1,5 MB und 8 Megapixel). Farben und Themes sind fest begrenzt, URLs und E-Mail-Adressen geprüft, Text und Attribute escaped. `business` bleibt bis zu einer eigenen Integration gesperrt.

Der Builder legt erst beim ersten Speichern oder Checkout einen Entwurf an. Die Entwurfs-ID und das Zugriffstoken werden lokal im Browser gespeichert; Formularinhalte werden beim Speichern an die LeanWebsite-API übertragen und im privaten R2-Bucket gehalten. Die Vorschau bleibt in einem sandboxed iframe. Beim Checkout übermittelt der Browser nur den serverseitigen Paketcode, niemals einen Preis; Stripe- und R2-Zugangsdaten bleiben serverseitig.

Der Business-Builder verarbeitet Logos bevorzugt als WebP und bei fehlender Canvas-WebP-Kodierung als PNG, damit Transparenz erhalten bleibt. PNG ist nur für Logos zulässig; die übrigen Business-Bilder bleiben JPEG oder WebP. Es gelten weiterhin 1,5 MiB pro Bild und 4 MiB pro Draft-Anfrage.

Der Checkout liest den Entwurf einmal, validiert erneut, erzeugt daraus das HTML und legt **dieses HTML** (`text/html`) als unveränderlichen Snapshot ab. HTML aus dem Browser wird nie übernommen. Migration 0004 ist nicht nötig.

## Umgebungsvariablen

`.env.example` enthält ausschließlich Platzhalter für Stripe, Neon und Cloudflare R2. Für lokale Zugangsdaten kann eine nicht versionierte `.env.local` angelegt werden.


## Geschützter Download (Schritt 15)

Keine neue Migration: Die Berechtigung nutzt die vorhandenen Draft-Zugangsdaten (`draftId` + `draftToken`). Die Bestellung wird über `orders.draft_id` bestimmt; eine bezahlte Bestellung hat Vorrang vor älteren fehlgeschlagenen oder offenen. Die Tabelle `downloads` bleibt ungenutzt.

- `POST /api/orders/status` – Body `{ draftId, draftToken }`. Antwort: `status` (`none`, `pending`, `paid`, `failed`, `refunded`), `downloadAvailable`, Paketname und Hinweistext. Keine Schlüssel, Prüfsummen oder Tokens.
- `POST /api/orders/download` – gleicher Body. Liefert die HTML-Datei nur, wenn `orders.status = 'paid'` (gesetzt ausschließlich durch den verifizierten Webhook), der Snapshot-Schlüssel exakt `orders/<Bestell-ID>/snapshot` entspricht und Größe sowie SHA-256 zu den gespeicherten Metadaten passen. Der Browser kann weder Bestell-ID noch R2-Schlüssel vorgeben (zusätzliche Felder werden ignoriert).
- Fehler: falsche/fehlende Zugangsdaten → 404 (identisch für unbekannt/falsch), unbezahlt → 402 `not_paid`, Snapshot fehlt/ungültig → 409 `snapshot_unavailable`, Prüfsumme/Größe falsch → 409 `snapshot_corrupt`.
- Header: `Content-Disposition: attachment`, `Content-Type: text/html; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, restriktive CSP.
- Seite `/order/complete` (Rewrite in `vercel.json`): liest die Zugangsdaten aus `localStorage`, fragt den Status per POST ab (Polling bis ca. 3 Minuten, solange der Webhook aussteht) und bietet den Download erst bei bestätigter Zahlung an. Der Parameter `?checkout=` ist nur ein Texthinweis. Bei „Rundum sorglos“ weist die Seite darauf hin, dass Hosting und Betreuung separat folgen.
- Offen: kein Rate-Limiting; die Download-Anzahl wird nicht begrenzt; Wiederzugriff nur im selben Browser (kein E-Mail-Link).


## Deployment

- `main`: Production auf Vercel
- `develop`: Preview auf Vercel
- Entwicklung und Tests erfolgen zunächst lokal.
- Änderungen werden erst nach erfolgreicher Prüfung in `main` übernommen.

