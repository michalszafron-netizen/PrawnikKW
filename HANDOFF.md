# HANDOFF — kontekst do kontynuacji pracy (LexParser KW / Notariusz.AI)

Stan na: kontynuacja po serii zmian; Kiro w starym oknie był niestabilny, dlatego ten plik przejmuje kontekst do nowego okna.

> Pełny opis produktu jest w `PROJECT_OVERVIEW.md`. Tutaj jest stan bieżący + co dokończyć.

---

## 1. Czym jest projekt (skrót)
Narzędzie kancelarii notarialnej: pobiera elektroniczną Księgę Wieczystą (EKW) przez Apify, parsuje surowe dane na strukturę `KWData`, generuje opisy stanu prawnego do aktu w 3 stylach + 1 pustym, z korektą AI (DeepSeek).

Stos: React 19 + TS + Vite (frontend), Express w `server.ts` (backend, uruchamiany przez `tsx`), DeepSeek (LLM), Apify (scraper EKW). Brak bazy — cache ksiąg w `localStorage`.

---

## 2. KLUCZOWA architektura (musisz to wiedzieć)

**Przepływ danych:**
```
Apify (surowe) → server.ts: mapApifyToKWData() → KWData → src/lib/draftBuilder.ts: buildDrafts() → 3 drafty
                                                      ↑
                                          Edytor (NotaryEditor) edytuje TEN SAM obiekt KWData
Rubryki (RubricViewer) = osobny, WIERNY podgląd surowego rawApify (nie przez parser)
```
- Prawa kolumna (drafty: classic/modern/short/custom) = `KWData` skompilowane. NIE jest niezależnym źródłem — dziedziczy błędy parsera. „Prawda" = Rubryki (surowy rawApify).
- Drafty NIE odświeżają się na żywo po edycji w Edytorze — dopiero po „Regeneruj" / „Przywróć" / korekcie AI.

**Dwa formaty EKW** (auto‑wykrywane w `mapApifyToKWData`):
- `zupelna` — nagłówki „Rubryka/Podrubryka", wartości pipe‑separated, **prawdziwa wartość = OSTATNI segment** (`extractVal`). `---` = puste.
- `aktualna` — „spłaszczona", inne etykiety; wartość bywa **PIERWSZYM** segmentem przed „| Nr podstawy wpisu" (`firstSeg`). Wielu właścicieli/hipotek skondensowanych.
- Flaga: `const isAktualna = (raw.viewType||"").toLowerCase()==="aktualna"`.

**Wersjonowanie parsera:** `PARSER_VERSION` w `server.ts` MUSI równać się `MIN_PARSER_VERSION` w `src/components/EKWBrowserSim.tsx`. Po każdej zmianie logiki `mapApifyToKWData` podbij OBIE (teraz: **8**). Klient przy otwarciu z biblioteki sam przemapowuje stare wpisy przez `/api/remap-kw`.

**Autorytatywny numer KW:** `mapApifyToKWData` używa `raw.kwNumber` z Apify (poprawna cyfra kontrolna), nie tego co wpisał user. Zmienna `effectiveKwNumber`.

---

## 3. Środowisko / uruchamianie
- `npm run dev` = `tsx server.ts` (port 3000). **UWAGA: serwer NIE ma hot‑reloadu** — po każdej zmianie `server.ts` trzeba zrestartować `npm run dev`. Frontend ma HMR przez Vite.
- `npm run lint` = `tsc --noEmit`. Są **2 znane, wcześniejsze błędy** w `RubricViewer.tsx` (przekazywanie `key` do komponentu — brak `@types/react`). Nie blokują działania; nie są naszą regresją.
- **Problem maszyny:** serwer bywa ubijany przez OOM (brak pamięci), szczególnie przy wywołaniach DeepSeek. Jeśli `Invoke-WebRequest http://127.0.0.1:3000` zwróci błąd — zrestartuj dev server. Warto zamknąć zaległe procesy `node` żeby zwolnić RAM.
- Model DeepSeek konfigurowalny env: `DEEPSEEK_MODEL` (domyślnie `deepseek-v4-flash`), `DEEPSEEK_BASE_URL`. Klucz: `DEEPSEEK_API_KEY` w `.env.local`. Apify: `APIFY_API_TOKEN`.

**Testowanie offline (bez płatnego Apify):** w `apify_dumps/` są zapisane surowe odpowiedzi (gitignored). Można je przepuścić przez `POST /api/remap-kw` z body `{ raw, kwNumber }`. Przykładowy skrypt:
```ts
// tmp_test.ts — uruchom: npx tsx tmp_test.ts (serwer musi działać)
import fs from "fs";
const raw = JSON.parse(fs.readFileSync("apify_dumps/apify_raw_GD1G_00085431_2_zupelna.json","utf-8"));
const r = await fetch("http://localhost:3000/api/remap-kw",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({raw,kwNumber:"GD1G/00085431/2"})});
console.log(JSON.stringify((await r.json()).mapped.dzial2.owners,null,2));
```
Dostępne zrzuty: KA1T/00086962/7 (zupelna+aktualna), WA1M/00348754 (zupelna+aktualna), GD1G/00085431/2 (zupelna+aktualna). **Usuwaj pliki tmp_*.ts po testach.**

---

## 4. Co JUŻ zrobione (zapisane na dysku, NIE wypchnięte; ostatni push: commit `ee57f02`)
1. Autorytatywny numer KW z Apify (naprawa `/2`→`/5`).
2. Walidacja cyfry kontrolnej EKW przed pobraniem (`computeKwCheckDigit` w `EKWBrowserSim.tsx`; algorytm: znaki kodu sądu+8 cyfr × wagi [1,3,7] mod 10; mapa liter `KW_CHAR_VALUES`). Zweryfikowane na WA1M/…/5 i KA1T/…/7.
3. Migracja cache `/2`→`/5` lokalnie + dedupe (`migrateCachedBooks`, useEffect on mount).
4. Biblioteka: ostrzeżenie po 7 dniach (`STALE_AFTER_DAYS`), przycisk „Odśwież" (`refreshCached`, nadpisuje), **licznik zapytań EKW/mies.** (`QUERY_COUNTER_KEY`, `MONTHLY_QUERY_LIMIT=1000`, kafelek pod przyciskiem pobierania), czytelniejsze metadane, badge Aktualna(zielony)/Zupełna(czarny).
5. **Dział II — wielu współwłaścicieli** (`mapApifyToKWData`): mapa udziałów (Podrubryka 2.2.1 → `udzialMap`), wiązanie osoba→udział przez „Lista wskazań udziałów", wspólność (`shareForUdzial`), osoby fizyczne (2.2.5, rozdzielane „Lista wskazań") + prawne (2.2.4). Naprawa 4→1 (WA1M). Podstawa nabycia z „Wskazanie podstawy" LUB „Tytuł aktu".
6. Data + numer wpisu właścicieli (`ownerEntryDate`/`ownerEntryNumber`, oba formaty; aktualna z nagłówka wniosku).
7. Folder `apify_dumps/` + nazwa pliku z wersją widoku (`apify_raw_<KW>_<viewType>.json`). W `.gitignore`.
8. Sekcja „Okładka" w Rubrykach (`RubricViewer.tsx`, z pól top‑level rawApify: numer, sąd/wydział, typ księgi).
9. **Komentarz migracyjny w Rubrykach** (`extractMigrationComment(rawText)` w `RubricViewer.tsx`) — Apify gubi pole „A" z `entries`, odzyskujemy z `rawText`. Zweryfikowane na GD1G 1.9.
10. **Walidacja mapowania + fallback AI** (`server.ts`): `validateMapping(mapped,raw)` (braki: 0 właścicieli/placeholder/brak udziałów/0 hipotek/brak położenia), `aiAssistMapping` (przy braku → DeepSeek parsuje rawText i SCALA tylko brakujące sekcje, nie nadpisuje dobrych). Oba endpointy zwracają `validation:{ok,issues,aiAssisted}`. Baner w `NotaryEditor`. `validation` przepływa: EKWBrowserSim→onDataLoaded→App→NotaryEditor + zapis w cache.

`PARSER_VERSION = 8`, `MIN_PARSER_VERSION = 8`.

Zmienione, niezacommitowane pliki: `server.ts`, `src/App.tsx`, `src/components/{EKWBrowserSim,NotaryEditor,RubricViewer,ManualPaster}.tsx`, `src/data/examples.ts`, `src/lib/draftBuilder.ts`, `src/types.ts`.

---

## 5. DO DOKOŃCZENIA (kolejność)

> STATUS: Zadania A, B, C **WYKONANE** (commit `b0d40ea`). Sekcja zostawiona jako opis tego, co zrobiono / jak testować przy kolejnych zmianach.

### ZADANIE A (główne): Komentarz migracyjny → Edytor + drafty — ✅ ZROBIONE
Zaimplementowane: pole `migrationComment` w `KWData` (wszystkie 5 działów, `src/types.ts`); ekstrakcja `extractMigrationComment` z `rawText` w `server.ts` (ustawiane na każdym dziale); w `draftBuilder.ts` helper `migrationComments()` dokleja je do draftów classic+modern; w `NotaryEditor.tsx` baner „Komentarze do migracji". `PARSER_VERSION=9`/`MIN_PARSER_VERSION=9`. Zweryfikowane na GD1G: `dzial1O.migrationComment` = „W POLU OBSZAR ZSUMOWANO POWIERZCHNIĘ: MIESZKANIA 48,86 M2 ORAZ PIWNICY 9,21 M2…", draft classic zawiera komentarz.

### ZADANIE B: Live‑test fallbacku AI — ✅ ZROBIONE
Potwierdzone: po wyzerowaniu `raw.dzialII.entries` (z zachowaniem `rawText`) `/api/remap-kw` zwrócił `validation.aiAssisted=true` i uzupełnił 4 właścicieli (WA1M). UWAGA: płatne wołanie DeepSeek + obciąża pamięć (serwer bywa ubijany — restartuj).

### ZADANIE C: Push na GitHub — ✅ ZROBIONE (commit `b0d40ea`)
Repo `github.com/michalszafron-netizen/PrawnikKW.git` (origin/main; token w URL — NIE wyświetlać, zrewokować przed produkcją). Wypchnięto kod + `HANDOFF.md`. **NIE** wypchnięto danych osobowych: `opis_kw_*.txt`, `przyklady/`, `.vscode/`, `apify_dumps/` (gitignored). Kolejny push: `git add server.ts src/ .gitignore HANDOFF.md`, commit po polsku, `git push origin main` (filtruj token: `-replace 'ghp_\w+','***'`).

### Pomysły na dalej (opcjonalne)
- Komentarze migracyjne z pozostałych działów (I‑Sp/II/III/IV) już są w `KWData` i draftach — sprawdzić na księdze, która je ma.
- Doinstalować `@types/react` i usunąć 2 znane błędy `key` w `RubricViewer`.
- Sum‑to‑1 check udziałów w `validateMapping` (na razie pominięty, by uniknąć fałszywych alarmów).
- Pełna „Okładka" (Rubryki 0.2/0.3/0.4) — wymaga, by Apify ją zwracał (obecnie nie).

---

## 6. Zasady/konwencje przy tej pracy
- Po zmianie `server.ts` → restart `npm run dev`.
- Po zmianie logiki parsera → podbij `PARSER_VERSION` i `MIN_PARSER_VERSION` (obie!).
- Testuj na zrzutach z `apify_dumps/` przez `/api/remap-kw` (bez płatnego Apify). Sprzątaj pliki `tmp_*.ts`.
- `extractVal` = ostatni segment (zupelna); `firstSeg` = pierwszy (aktualna).
- Drafty generuje WYŁĄCZNIE `buildDrafts` (jedno źródło). Nie duplikować logiki.
- Dane osobowe: nie wypychać na GitHub plików z realnymi odpisami.
