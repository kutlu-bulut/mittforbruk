# CLAUDE.md — Prosjektkontekst for AI-assistert utvikling

> Denne filen er ment å gi kontekst til Claude (eller andre AI-verktøy) som jobber med dette prosjektet.
> Oppdatert: April 2026 | Versjon: v19.2

---

## Hva er dette?

**"Hvor går pengene?"** er en PWA (Progressive Web App) for par og husstander som vil tracke ekstrautgifter — de uplanlagte felleskjøpene som kommer i tillegg til faste regninger og matbudsjett.

### Nøkkelfunksjoner
- Google-innlogging via Firebase Auth
- Husstandsdeling via invitasjonskode
- Kjøpsregistrering med butikk, kategori, behov/lyst, rating
- Butikk-autocomplete (lagres automatisk)
- Budsjettsporing med fargekodede barer (grønn/gul/rød)
- Adaptiv duell/ranking (1 bruker = solo, 2 = VS-duell, 3+ = rangert liste)
- Kategori- og butikkfordeling med horisontale barer
- Emoji-avatar og fargevelger
- Prestasjoner/achievements
- Kjøps-DNA med personlig statistikk
- Historikk per måned med detaljevisning
- Mørk modus
- PWA-installerbar

### Målgruppe
Primært par som deler økonomi. Fungerer også for enkeltpersoner og husstander med 3+ medlemmer.

---

## Teknisk arkitektur

### Stack
- **Frontend:** Vanilla JS med ES modules, Tailwind CSS (CDN), Lucide Icons
- **Backend:** Firebase (Firestore + Authentication)
- **Hosting:** GitHub Pages (kutlu-bulut.github.io/mittforbruk)
- **Font:** Inter (body) + Fredoka (branding)

### Filstruktur
```
mittforbruk/
├── index.html          # Hoved-HTML med alle seksjoner
├── app.js              # Orchestrator — starter listeners, kobler moduler
├── styles.css          # All CSS inkl. dark mode, toast, modal, animasjoner
├── sw.js               # Service Worker (minimal, for PWA-installasjon)
├── manifest.json       # PWA-manifest
├── logo.png            # App-logo
├── firestore.rules     # Firestore Security Rules (referanse)
├── CLAUDE.md           # Denne filen
└── js/
    ├── firebase.js     # Firebase-konfigurasjon, eksporterer db/auth/provider
    ├── state.js        # Delt app-state, konstanter, emojier, achievements
    ├── ui.js           # escapeHtml, showToast, showModal
    ├── auth.js         # Login, logout, auth state listener
    ├── preferences.js  # Fargevelger, dark mode, emoji-avatar, profil
    ├── navigation.js   # Tab-switching
    ├── cards.js        # Gjenbrukbar kjøpskort-renderer
    ├── purchases.js    # CRUD for kjøp, dynamisk buyer-selector
    ├── insights.js     # Duell/ranking, daglig oversikt, kategori/butikk-barer
    ├── history.js      # Historikk-liste og månedsdetaljer
    ├── household.js    # Husstand-innstillinger, kategorier, medlemmer
    ├── stores.js       # Butikk-autocomplete, auto-lagring, store manager
    └── ui.js           # XSS-beskyttelse, toast, inline modal
```

### Firestore-struktur
```
users/{uid}
  ├── name, email, color, darkMode, avatar, hid

households/{hid}
  ├── name, migrated
  ├── settings/global
  │     └── monthlyBudget, categoriesMigrated
  ├── purchases/{purchaseId}
  │     └── store, desc, price, category, buyer, createdAt, type, rating
  ├── categories/{catId}
  │     └── name
  └── stores/{storeId}
        └── name
```

### Dataflyt
1. `auth.js` lytter på auth-state → henter brukerdokument
2. Hvis `hid` finnes → kaller `startApp()` i `app.js`
3. `app.js` starter `onSnapshot`-lyttere på husstand, budsjett, medlemmer, kjøp, kategorier
4. Kjøp-lytteren beregner all statistikk (totaler, buyer/cat/store-sums, profil-DNA) og kaller oppdateringsfunksjoner i andre moduler

---

## Viktige lærdommer

### Sirkulære avhengigheter
`auth.js` trengte `startApp` fra `app.js`, men `app.js` importerte `initAuth` fra `auth.js`. Løsning: `auth.js` mottar `startApp` som callback-parameter i stedet for å importere den direkte.

**Regel:** Ingen modul i `js/` skal importere fra `app.js`. Flyten er enveis: `app.js` → moduler.

### Firestore Security Rules
Rules må alltid oppdateres i Firebase Console når nye collections legges til. Manglende regler gir "permission denied" som kan krasje hele Firestore-kanalen.

**Regel:** Legg til rules *før* du deployer kode som bruker nye collections.

### onSnapshot og brukerdata
Den originale koden brukte `onSnapshot` alene for å sjekke om et brukerdokument fantes. Under nettverksglitches kan `d.exists()` returnere `false` midlertidig, som førte til at `hid` ble overskrevet til `null`.

**Regel:** Bruk `getDoc` (engangslesing) for å verifisere om et dokument eksisterer før du oppretter det. `onSnapshot` brukes kun for sanntidslytting etter at dokumentet er bekreftet.

### ES Modules og onclick
Funksjoner definert i ES modules er ikke automatisk tilgjengelige i global scope. `onclick="login()"` i HTML fungerer kun hvis `window.login` er eksplisitt satt i en modul som faktisk lastes.

**Regel:** Alle funksjoner som brukes i HTML onclick må registreres på `window`. Hvis én import feiler, krasjer hele modultreet og ingen `window`-funksjoner registreres. Sjekk DevTools Console for 404-feil på moduler.

### Firestore orderBy og indekser
`orderBy` på en ny collection krever en Firestore-indeks. Uten den kaster Firestore en feil. For enkle collections (som `stores`) er det tryggere å sortere i JavaScript.

**Regel:** Unngå `orderBy` i Firestore-queries med mindre du har bekreftet at indeksen finnes. Sorter heller i JS med `.sort()`.

### innerHTML vs textContent (XSS)
All brukerinput som vises i DOM-en må escapes. `textContent` er safe by default. `innerHTML` med brukerdata er en XSS-vektor.

**Regel:** Bruk `document.createElement` + `textContent` for brukerdata. Bruk `escapeHtml()` fra `ui.js` der `innerHTML` er nødvendig.

### Cache-problemer med GitHub Pages
Nettleseren cacher JS-moduler aggressivt. Etter deploy kan gamle versjoner fortsatt kjøre.

**Regel:** Alltid hard refresh (Cmd+Shift+R) etter deploy. Oppdater versjonsnummer i `index.html` (title + login-skjerm) for hver endring.

---

## Retningslinjer for videre utvikling

### Før du gjør endringer
1. **Backup først** — ta kopi av filene du endrer
2. **Sjekk hele importkjeden** — én feilende import krasjer alt
3. **Kjør `node --check` på alle JS-filer** før deploy
4. **Oppdater versjonsnummer** i `index.html` for hver endring

### Når du legger til nye features
1. Opprett en ny modul i `js/` hvis funksjonaliteten er avgrenset
2. Importer den i `app.js` (side-effect import for window-funksjoner, named import for eksporterte funksjoner)
3. Aldri importer `app.js` fra en modul — bruk callbacks
4. Legg til Firestore Security Rules for nye collections *først*
5. Bruk `escapeHtml()` på all brukerinput som vises

### Filendringer og deploy
1. Gjør endringer lokalt eller i Claude
2. Valider med `node --check`
3. Last opp til GitHub (via git push eller web-upload)
4. JS-filer i `js/`-mappen må lastes opp *til js/-mappen*, ikke roten
5. Hard refresh etter deploy

### Ting å unngå
- **Ikke bruk `alert()`, `prompt()`, `confirm()`** — bruk `showToast()` og `showModal()` fra `ui.js`
- **Ikke legg til nye CDN-avhengigheter** uten god grunn (Chart.js ble fjernet med vilje)
- **Ikke bruk `@latest`** for CDN-pakker — pin versjonen
- **Ikke opprett `bindings.js`** — onclick-handlers er i HTML, window-funksjoner i moduler
- **Ikke bruk `setDoc` uten `merge: true`** på eksisterende dokumenter — det overskriver alt

---

## Mulige neste steg

### Lav innsats, høy verdi
- Offline-støtte (service worker som cacher app-shell)
- Oppgjørsberegning ("du skylder meg X kr denne måneden")
- Eksport av data til CSV

### Medium innsats
- Erstatte Tailwind CDN med produksjons-CSS (byggesteg)
- Sterkere husstandskode (lengre, vanskeligere å gjette)
- Push-notifikasjoner for påminnelser

### Stor innsats
- Bank-API-integrasjon (PSD2/Open Banking) for automatisk registrering
- Sparemål for husstanden
- Historisk budsjett per måned (ikke bare nåværende)
