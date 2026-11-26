# 🧮 Rechner

Taschenrechner-App für Handy und Computer, die auf Cloudflare läuft:
**https://rechner.dinnerboneagg.workers.dev**

- **Rechner:** Standard und wissenschaftlich (sin/cos/tan und Umkehrfunktionen, ln, log, √, ∛, xʸ, x², x!, π, e, DEG/RAD),
  Punkt vor Strich, Klammern, Live-Vorschau, keine Rundungsfehler (0,1 + 0,2 = 0,3), deutsches Komma, Tastaturbedienung,
  Tippen auf die Anzeige kopiert das Ergebnis.
- **Verlauf:** auf dem Gerät oder, mit Konto, in der Datenbank auf allen Geräten.
- **Rechen-Duell (Multiplayer):** Raum erstellen, Code oder Link teilen. Alle bekommen dieselbe Kopfrechenaufgabe, wer zuerst richtig antwortet, holt den Punkt.
- **Rangliste:** gewonnene Duelle der angemeldeten Spieler.
- Lässt sich als App auf den Home-Bildschirm legen (Teilen → „Zum Home-Bildschirm“).

## Aufbau

| Teil | Datei | Aufgabe |
|---|---|---|
| Worker | `cloudflare/worker.js` | liefert die App aus (`public/`) und beantwortet `/api/*` |
| Durable Object | `DuelDO` in `cloudflare/worker.js`, Logik in `cloudflare/duel.js` | ein Duell-Raum pro Code, Echtzeit über WebSocket (`/ws?room=CODE`) |
| D1-Datenbank | `rechner-db`, Schema in `cloudflare/api.js` | Konten, Verlauf, Duell-Statistik (Rangliste) |
| Rechenkern | `public/js/calc.js` | sicherer Parser ohne `eval`, im Browser und in den Tests benutzt |

## Veröffentlichen

1. Claude arbeitet auf einem Branch und öffnet einen Pull Request. Der Workflow **Tests** prüft ihn (Unit-Tests und kompletter Worker in `wrangler dev`).
2. Nach dem Merge auf `main` veröffentlicht **Cloudflare** (`.github/workflows/cloudflare.yml`) automatisch:
   Tests → D1-Datenbank anlegen, falls nötig → `wrangler deploy` → warten, bis die neue Version live ist →
   Live-Test (Seite, Datenbank, Multiplayer) → Testkonten (`rtest…`) löschen.

Benötigtes Repository-Secret: **`CLOUDFLARE_API_TOKEN`** (Rechte: Workers Scripts Edit, D1 Edit). Optional `CLOUDFLARE_ACCOUNT_ID`.

## Lokal

```bash
npm test                                  # Unit-Tests
npx wrangler@4 dev                        # App auf http://localhost:8787
TEST_URL=http://localhost:8787 npm test   # zusätzlich Live-Test gegen den lokalen Worker
```
