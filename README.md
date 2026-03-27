# wAIste Lead Finder

KMU Containerdienste Deutschland — Echtzeit Lead-Qualifizierung via Google Places, Hunter.io & Apollo.io.

---

## Deployment auf Vercel (einmalig ~10 Minuten)

### Schritt 1 — GitHub Repository erstellen
1. github.com aufrufen → anmelden oder kostenlosen Account erstellen
2. Oben rechts auf „+" → „New repository"
3. Name: `waiste-lead-finder` → „Create repository"
4. Den gesamten Projektordner in das Repository hochladen (Upload files)

### Schritt 2 — Vercel Account
1. vercel.com aufrufen → „Sign Up" → mit GitHub anmelden (empfohlen)
2. „Add New Project" → dein `waiste-lead-finder` Repository auswählen → „Import"

### Schritt 3 — API Keys als Environment Variables hinterlegen
In Vercel, vor dem ersten Deploy:
1. „Environment Variables" aufklappen
2. Folgende Keys eintragen:

| Name | Wert |
|------|------|
| `GOOGLE_PLACES_API_KEY` | Dein Google Places API Key (AIzaSy...) |
| `HUNTER_API_KEY` | Dein Hunter.io API Key |

3. Auf „Deploy" klicken

### Schritt 4 — Fertig
Vercel gibt dir eine URL wie `waiste-lead-finder.vercel.app`.
Diese URL an alle Mitarbeiter schicken — fertig.
Kein Setup, keine Keys, einfach öffnen und nutzen.

---

## Lokale Entwicklung

```bash
npm install
cp .env.example .env.local
# .env.local mit deinen Keys befüllen
npm run dev
# → http://localhost:3000
```

---

## Architektur (Sicherheit)

```
Browser (Mitarbeiter)
    ↓ POST /api/places-search
Next.js Server (Vercel)   ← API Keys liegen hier als Env Vars
    ↓ mit Key
Google Places API
```

Kein API Key verlässt jemals den Server. Mitarbeiter sehen nur die App.

---

## Updates deployen

Dateien in GitHub aktualisieren → Vercel deployed automatisch innerhalb von ~60 Sekunden.
