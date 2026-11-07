# Fargering – mobilvennleg avlesing av fargeringmerkte fuglar

Prototype på ein mobilvennleg app oppå [ringmerking.no/cr](https://www.ringmerking.no/cr/).
ringmerking.no har ikkje noko API, så ein liten Node-server hentar HTML-sidene og gjer dei om til JSON.

> ⚠️ Berre til privat testing. Spør post@ringmerking.no om løyve eller eit API før appen blir publisert.

## Køyr lokalt

```bash
npm install
npm start
```

Opne http://localhost:3000. Viss du vil teste på mobilen, må den vere på same nettverk.
Bruk då `http://<ip-adressa-til-maskina>:3000`. Merk at GPS krev https på mobil, unntatt på localhost.

## Kva fungerer

| Funksjon | Status |
|---|---|
| Søk på kode, full kode eller metallring | ✅ Fungerer mot ringmerking.no |
| Historikk, kart, statistikk og foto for fuglen | ✅ |
| Detaljar for kvar registrering | ✅ |
| Prosjekt og ringtypar med bilete | ✅ |
| Ny avlesing: GPS, kart, slår opp koden medan du skriv | ✅ Lagra lokalt på telefonen |
| Eksport av eigne avlesingar til CSV | ✅ |
| Installerbar app (PWA), appskal offline | ✅ |
| Innlogging | 🟡 Skrive etter skjemaet, ikkje testa med ekte brukar |
| **Innsending av avlesing til ringmerking.no** | ❌ Skjemaet ligg bak innlogging og er ikkje kartlagt |

## Struktur

```
server/ringmerking.js   Klient og HTML-parsar for ringmerking.no
server/index.js         Express-API (/api/search, /api/event/:id, /api/projects, /api/login, /img)
public/                 Mobilappen (vanleg HTML/CSS/JS + Leaflet)
```

## Kartlegge innsendingsskjemaet

Innsendingsskjemaet blir berre vist for innlogga brukarar. Gjer dette på ein PC:

1. Opne Chrome og logg inn på ringmerking.no/cr.
2. Trykk **F12**, vel fana **Network** og kryss av for **Preserve log**.
3. Gå til **Rapportere → Avlesning av fargemerke** og fyll ut ei *ekte* avlesing.
4. Send ho inn som vanleg, og gå gjennom alle stega.
5. Høgreklikk i lista → **Save all as HAR (sanitized)**.
6. **Fjern passordet** før du deler fila: søk etter `LiPassord` i fila og slett verdien.
   Ta òg bort cookie-verdiar (`ASPSESSIONID…`).

Viss du heller vil sleppe å sende inn noko, kan du lagre sida med skjemaet
(Ctrl+S → «Webside, berre HTML») før du trykkjer send.
