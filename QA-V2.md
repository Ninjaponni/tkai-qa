# Q&A v2 - bestilling

Skrevet 25.09.2026 i Cowork etter å ha lest koden (v1.7, commit 9e34e31). Les CLAUDE.md først, så denne. Frist: del A må være i drift før TKAI #7 onsdag 14.10.2026.

## Mål
Q&A-appen blir en fast del av TKAI: én adresse (qa.tkai.no), ett QR-bilde som kan ligge fast i filmen på DIGS-skjermene, og spørsmålene fra hver kveld tas vare på og vises på tkai.no.

## Viktige fakta fra koden i dag
- Sesjoner og spørsmål slettes etter 24 t (`cleanupOldSessions`).
- Speaker-handlinger (focus, answer, hide, delete) har ingen tilgangskontroll. Alle som kjenner slug-en kan sende socket-events, og handlerne sjekker ikke at `questionId` hører til `slug`. Dette er et reelt hull, ikke bare pynt.
- Appen er åpen for alle (landingssiden lager sesjoner for hvem som helst, telleren står på 78). Andre enn TKAI bruker den altså. Endringene må ikke ødelegge det.

## Del A - før 14.10 (må)

### A1. qa.tkai.no
- Legg til custom domain qa.tkai.no i Render. Tor Martin legger CNAME hos Domeneshop (DNS-pekere) til verdien Render oppgir. Gi ham nøyaktig verdi.
- Gammel onrender.com-adresse skal fortsatt virke.
- Sjekk Render-planen. Hvis tjenesten sover ved inaktivitet (free tier), dokumenter det i CLAUDE.md og foreslå enten oppgradering eller en keep-alive før arrangementer. Kaldstart på 50 sek. midt i en meetup er ikke akseptabelt.

### A2. Adminnøkkel for speaker
- Ny kolonne `sessions.admin_key` (tilfeldig, minst 24 tegn, generert ved opprettelse).
- Speaker-lenken blir `/s/:slug/speaker?k=<admin_key>`. Landingssiden redirecter dit som i dag. Nøkkelen lagres i localStorage for sesjonen slik at reload virker.
- Alle speaker-events (focus, unfocus, answer, hide, delete-question) krever gyldig nøkkel server-side. Uten nøkkel: avvis stille med `error-message`.
- Alle handlers som tar `questionId` skal sjekke at spørsmålet tilhører sesjonen for `slug`.
- `GET /api/sessions/:slug` skal aldri returnere `admin_key`.
- Eksisterende sesjoner uten nøkkel: tillat som før (de slettes uansett innen 24 t). Ingen gammel data skal brekke.

### A3. Kobling til arrangement og arkiv
- Ny kolonne `sessions.event_slug` (f.eks. `tkai-7`, valideres mot `^tkai-\d+$`, nullable).
- Landingssiden får et valgfritt felt "TKAI-arrangement". Enkleste versjon: nedtrekksliste fra `https://tkai.no/events.json` (se del B1), med fallback til fritekst hvis filen ikke finnes ennå.
- Oppryddingen endres: sesjoner MED `event_slug` slettes aldri. Sesjoner uten slettes etter 24 t som før. Beslutning: vi arkiverer bare TKAI-sesjoner, ikke det andre lager.
- Når en arkivert sesjon er eldre enn 24 t, blir den skrivebeskyttet: publikum kan lese, men ikke stille nye spørsmål eller stemme. Speaker kan fortsatt skjule/slette.

### A4. Fast QR: qa.tkai.no/live
- `GET /live` redirecter (302) til publikumssiden for nyeste sesjon med `event_slug` opprettet siste 12 t. Finnes ingen: vis en enkel side "Ingen Q&A akkurat nå. Følg med på tkai.no".
- Da kan én statisk QR-kode til `https://qa.tkai.no/live` ligge fast i After Effects-filmen og på rollup, uten å lages på nytt hver gang.
- Lag QR-koden som SVG og PNG (min. 2000 px) i `public/qr-live.svg/.png` så Tor Martin kan hente den til grafikken.

### Ferdig når (del A)
- qa.tkai.no virker med HTTPS.
- Speaker-lenke uten `k` kan ikke fokusere/skjule/slette (test med to nettlesere).
- En test-sesjon koblet til `tkai-7` finnes fortsatt etter manuell kjøring av oppryddingen, en uten kobling er borte.
- `/live` sender til riktig sesjon.
- `APP_VERSION` bumpet, CLAUDE.md oppdatert (auth-modell, opprydding, nye kolonner, /live).

## Del B - etter 14.10 (bør)

### B1. Arkiv-API for tkai.no
- `GET /api/events/:eventSlug/questions`: alle sesjoner for arrangementet, med tittel, foredragsholder og spørsmål (tekst, upvotes, status answered/active). Aldri `visitor_id`, `admin_key` eller skjulte spørsmål. Nicknames kan tas med (de er genererte).
- CORS eller bare offentlig GET, siden tkai.no leser den ved build.
- Egen, liten oppgave i tkai-web (ikke her): skriv `/events.json` ved build (number, slug, tittel, dato for kommende og nylige arrangementer), og vis spørsmål fra API-et på arrangementssiden når "Vis Q&A på nett" er huket av i Notion. Notion er fortsatt fasiten for hva som publiseres. Dagens manuelle spørsmål i Notion for #4 og #6 skal fortsatt virke.

### B2. Designsystemet
- Appen har allerede #040308 og Space Grotesk. Juster til tkai.no-uttrykket: hent tokens fra `../tkai-web/src/styles/global.css` (farger, Inter for brødtekst, knapper, badges). Behold aksentfargen til fokus-visningen hvis det gir best kontrast på projektor.
- TKAI-logo i header, lenke til tkai.no i footer.
- Ikke rør animasjoner og swipe-oppførsel som fungerer.

## Ikke gjør
- Ikke innfør innlogging for publikum.
- Ikke slett eller migrer bort eksisterende data i Turso.
- Ikke endre nickname-generatoren eller profanity-filteret.

## Til slutt
Oppdater ROADMAP.md i ../tkai-web (fase 3) med det som er gjort, og commit der også.
