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

### ZADANIE A (główne): Komentarz migracyjny → Edytor + drafty
Obecnie komentarz migracyjny widać TYLKO w Rubrykach. Trzeba go przenieść do `KWData`, Edytora i draftów (jest istotny prawnie — np. wyjaśnia, że obszar 58,07 m² = mieszkanie 48,86 + piwnica 9,21).

Kroki:
1. **`src/types.ts`** — dodać do `KWData.dzial1O` pole `migrationComment?: string;` (ewentualnie też do `dzial1Sp`/`dzial2` jeśli chcesz komentarze z innych działów; na start wystarczy I‑O).
2. **`server.ts`** — w `mapApifyToKWData` dodać ekstrakcję z `dzialIO.rawText` (przenieś logikę z `RubricViewer.extractMigrationComment`):
   ```ts
   const migrationComment = (() => {
     const rt = dzialIO.rawText || "";
     const m = rt.match(/przeniesione z dotychczasowej księgi wieczystej\s*([\s\S]*?)\s*B:\s*Ostatni numer/);
     return m ? (m[1]||"").replace(/^\s*\d+\.\s*-*\s*/,"").trim() : "";
   })();
   ```
   i ustawić w zwracanym `dzial1O.migrationComment = migrationComment || undefined`.
3. **Podbij `PARSER_VERSION` → 9 i `MIN_PARSER_VERSION` → 9** (server.ts + EKWBrowserSim.tsx).
4. **`src/lib/draftBuilder.ts`** — w `buildDrafts` dodać komentarz do opisu Działu I‑O (classic + modern), np. zdanie „Komentarz (migracja): {migrationComment}." gdy niepuste. W `short` raczej pominąć.
5. **`src/components/NotaryEditor.tsx`** — w sekcji Działu I‑O dodać pole (czytelne, najlepiej edytowalne `migrationComment`), np. pod opisem. Można też za chipem widoczności.
6. Test: `POST /api/remap-kw` na GD1G zupelna → sprawdź `mapped.dzial1O.migrationComment` = „W POLU OBSZAR ZSUMOWANO POWIERZCHNIĘ…". Sprawdź drafty (buildDrafts) i baner.
7. (Opcjonalnie) skoro logika jest w `server.ts`, można uprościć `RubricViewer` żeby brał z mapped — ale NIE trzeba; Rubryki czytają rawApify i mają własny extractor (zostaw).

### ZADANIE B: Live‑test fallbacku AI
Wymuś brak właścicieli (np. w teście podmień `raw.dzialII.entries` na sam nagłówek, zostaw `rawText`) i wywołaj `/api/remap-kw` — oczekuj `validation.aiAssisted=true` i uzupełnionych właścicieli. UWAGA: to płatne wołanie DeepSeek i obciąża pamięć (serwer może paść — restartuj). Kod jest gotowy, brakuje tylko potwierdzenia na żywo.

### ZADANIE C: Push na GitHub (na końcu)
- Repo: `github.com/michalszafron-netizen/PrawnikKW.git` (origin, branch `main`, token osadzony w URL — NIE wyświetlać; zrewokować przed produkcją).
- Stage TYLKO kod/dok: `git add server.ts src/ .gitignore HANDOFF.md PROJECT_OVERVIEW.md`.
- **NIE commituj** danych osobowych: `opis_kw_*.txt`, `przyklady/` (realne odpisy z PESEL/nazwiskami) ani `.vscode/`, `apify_dumps/` (gitignored). Użytkownik potwierdził, że KW są publiczne, ale na serwer na razie ich nie wrzucamy.
- Commit po polsku, opis zmian. Push: `git push origin main` (przefiltruj token w outpus: `-replace 'ghp_\w+','***'`).

---

## 6. Zasady/konwencje przy tej pracy
- Po zmianie `server.ts` → restart `npm run dev`.
- Po zmianie logiki parsera → podbij `PARSER_VERSION` i `MIN_PARSER_VERSION` (obie!).
- Testuj na zrzutach z `apify_dumps/` przez `/api/remap-kw` (bez płatnego Apify). Sprzątaj pliki `tmp_*.ts`.
- `extractVal` = ostatni segment (zupelna); `firstSeg` = pierwszy (aktualna).
- Drafty generuje WYŁĄCZNIE `buildDrafts` (jedno źródło). Nie duplikować logiki.
- Dane osobowe: nie wypychać na GitHub plików z realnymi odpisami.
