# LexParser KW — Notariusz.AI

Dokumentacja projektu — opis funkcjonalny i techniczny, do wykorzystania jako punkt wyjścia dla dewelopera przejmującego projekt.

Stan na: 2026-06-26.

---

## 1. Co to jest

LexParser KW to wewnętrzne narzędzie kancelarii notarialnej do automatycznego pobierania i analizowania **elektronicznych Ksiąg Wieczystych (EKW)** z portalu rządowego, a następnie generowania na ich podstawie gotowych do wklejenia opisów stanu prawnego nieruchomości w akcie notarialnym.

Cel biznesowy: notariusz/asystent wpisuje numer KW → system pobiera pełną treść księgi → wyciąga z niej wszystkie istotne dane (właściciele, udziały, hipoteki, działki, obciążenia) → generuje 3 warianty tekstu opisu (klasyczny/aktowy, współczesny, skrócony), które można edytować, korygować przez AI i skopiować do aktu.

## 2. Stos technologiczny

| Warstwa | Technologia |
|---|---|
| Frontend | React 19 + TypeScript, Vite 6, Tailwind CSS 4 |
| Backend | Node.js + Express 4 (jeden proces, `server.ts`), serwowany przez `tsx` w dev / `esbuild` bundle w prod |
| AI / LLM | DeepSeek API (`deepseek-chat`, kompatybilny z SDK `openai`) — generowanie i korekta tekstów aktu |
| Źródło danych EKW | Apify (`regdata~ekw-ksiegi-wieczyste-scraper`) — płatny scraper portalu rządowego EKW (obchodzi WAF Imperva/Incapsula) |
| Cache klienta | `localStorage` (biblioteka pobranych ksiąg) |
| Ikony | lucide-react |

Brak bazy danych — wszystko jest stateless po stronie serwera; jedyna persystencja to `localStorage` w przeglądarce użytkownika.

## 3. Struktura repozytorium

```
server.ts                     – cały backend (Express + integracja Apify + DeepSeek + parser EKW)
src/
  App.tsx                     – główny layout, routing zakładek, ekran ładowania
  types.ts                    – definicje typu KWData i powiązanych encji
  components/
    EKWBrowserSim.tsx         – wyszukiwarka KW, biblioteka (cache), pobieranie z Apify
    NotaryEditor.tsx          – główny panel edycyjny (Edytor / Rubryki) + generowanie draftów
    RubricViewer.tsx          – pełny widok surowych danych pogrupowanych po rubrykach EKW
    ManualPaster.tsx          – wklejanie surowego tekstu EKW i parsowanie przez AI (obecnie niepodłączone do UI)
    EKWHelp.tsx                – zakładka pomocy/instrukcji
  data/examples.ts            – preskonfigurowane przykładowe księgi (fallback offline / demo)
przyklady/                    – przykładowe PDF-y/PNG odpisów EKW (materiał referencyjny do mapowania)
.env.local                    – sekrety (APIFY_API_TOKEN, DEEPSEEK_API_KEY) — gitignored
```

## 4. Przepływ danych (główny use case)

1. Użytkownik wpisuje numer KW (np. `KA1T/00086962/7`) w `EKWBrowserSim`.
2. Frontend wysyła `POST /api/fetch-kw` z numerem i typem widoku (`zupelna` / `aktualna`).
3. Backend woła Apify (`run-sync-get-dataset-items`), które scrapuje portal EKW i zwraca **surowe dane** w formacie: lista wpisów `{label, value}` per dział, gdzie `value` to string z segmentami rozdzielonymi `|` (np. `"1. | 1 | --- | ŚLĄSKIE"`), a faktyczna treść to zawsze **ostatni segment** (`---` = pole puste).
4. Backend mapuje surowe dane na ustrukturyzowany obiekt `KWData` (funkcja `mapApifyToKWData()` w `server.ts`) i zwraca do klienta `{ mapped, raw, parserVersion }`.
5. Frontend zapisuje **oba** zestawy danych (`mapped` i `raw`) w `localStorage` (biblioteka ksiąg) oraz przekazuje je do `NotaryEditor`.
6. `NotaryEditor` generuje 3 warianty tekstu (lokalnie, deterministycznie) lub przez DeepSeek (`POST /api/parse-raw-text`), z możliwością dalszej korekty przez AI w naturalnym języku.
7. Użytkownik edytuje pola w panelu, kopiuje gotowy tekst do aktu.

### Re-mapowanie bez ponownego scrapowania

Surowe dane (`raw`/`rawApify`) są trwale zapisywane w cache. Gdy logika parsera (`mapApifyToKWData`) zostanie poprawiona, **nie trzeba** ponownie odpytywać Apify (kosztowne, płatne, wolne) — wystarczy przepuścić już posiadane surowe dane przez nowy parser. Do tego służy `POST /api/remap-kw`. Każdy wpis w cache ma pole `parserVersion`; stała `PARSER_VERSION` w `server.ts` musi być zwiększana przy każdej zmianie logiki mapowania — `EKWBrowserSim` przy wybraniu księgi z biblioteki automatycznie wykrywa nieaktualną wersję i przemapowuje lokalnie.

## 5. Endpointy API (server.ts)

| Endpoint | Metoda | Opis |
|---|---|---|
| `/api/fetch-kw` | POST | Pobiera księgę z Apify (realne dane z portalu rządowego) i mapuje na `KWData`. Body: `{ kwNumber, viewType }`. |
| `/api/remap-kw` | POST | Przemapowuje już posiadane surowe dane Apify (`raw`) bez ponownego scrapowania. Body: `{ raw, kwNumber }`. |
| `/api/simulate-kw` | POST | Generuje fikcyjną/demonstracyjną księgę (przez DeepSeek lub deterministyczny fallback) — używane gdy Apify/realne dane nie są dostępne. |
| `/api/parse-raw-text` | POST | Analizuje wklejony ręcznie surowy tekst EKW przez DeepSeek i zwraca strukturę + 3 warianty draftu. Używane też do regeneracji/korekty tekstu w `NotaryEditor`. |

## 6. Model danych — `KWData` (src/types.ts)

Główne sekcje odpowiadają działom księgi wieczystej:

- **`dzial1O`** — Oznaczenie nieruchomości: lokalizacja, adres, typ (`lokal`/`dzialka`/`budynek`/`inne`), działki ewidencyjne (`plots`), powierzchnia, podstawa oznaczenia, przyłączenie/odłączenie, wzmianki.
- **`dzial1Sp`** — Spis praw związanych z własnością (udział w nieruchomości wspólnej dla lokali).
- **`dzial2`** — Własność: lista właścicieli (`owners`) z PESEL/REGON, udziałem, podstawą nabycia, danymi rodziców.
- **`dzial3`** — Prawa, roszczenia, ograniczenia: służebności, ostrzeżenia/egzekucje, inne prawa.
- **`dzial4`** — Hipoteka: lista hipotek (`mortgages`) z kwotą, walutą, wierzycielem, opisem wierzytelności, odsetkami.

Każda sekcja może dodatkowo zawierać `notices` (wzmianki o wnioskach — istotne prawnie, blokują rękojmię wiary publicznej KW) i `applicationData` (numery wniosków Dz.Kw.).

## 7. Funkcjonalności UI

### Wyszukiwarka EKW (`EKWBrowserSim`)
- Wpisywanie numeru KW (3 segmenty: kod sądu / numer / cyfra kontrolna).
- Wybór widoku: `zupełna` (cała historia wpisów) lub `aktualna` (tylko stan bieżący).
- **Biblioteka ksiąg** — lista wcześniej pobranych ksiąg (cache w `localStorage`), z datą pobrania, ostatnim wpisem, właścicielami; można usunąć wpis lub otworzyć ponownie (z automatycznym przemapowaniem jeśli parser się zmienił).
- Fallback offline: jeśli Apify nie odpowiada, system próbuje dopasować numer do `PRECONFIGURED_EXAMPLES`, a w ostatniej kolejności generuje fikcyjną księgę przez AI.

### Panel edycyjny (`NotaryEditor`)
Dwa tryby widoku, przełączane zakładką na górze panelu:

1. **Edytor** — uproszczony, edytowalny formularz z najważniejszymi polami każdego działu. Dane można poprawiać ręcznie (np. zmienić udział, dodać współwłaściciela, dodać hipotekę).
   - Globalne przełączniki widoczności: *Wzmianki o wnioskach*, *Dane o wniosku* (dotyczą całej księgi).
   - Kontekstowe "chipy" widoczności przy każdej sekcji (np. PESEL/REGON i Podstawa nabycia przy właścicielach, Odsetki przy hipotekach, Identyfikator TERYT i Przyłączenie/odłączenie przy działkach) — włączają/wyłączają dodatkowe, rzadziej potrzebne pola bez zaśmiecania widoku.
2. **Rubryki** — pełny, nieedytowalny podgląd surowych danych z Apify, pogrupowany po realnej strukturze prawnej księgi (Rubryka 1.1, 1.2 … 4.8, z Podrubrykami), z wyszukiwarką i opcją ukrycia pustych rubryk. Służy do weryfikacji, czy Edytor niczego nie zgubił/nie zniekształcił.

Po prawej stronie: generator draftu w 3 stylach (Tradycyjny/Aktowy, Współczesny, Skrócony), z polem do dowolnej korekty językowej przez AI ("zapisz wszystkie nazwiska małą czcionką" itp.), przyciski Kopiuj / Pobierz .txt.

### Wklejanie ręczne (`ManualPaster`)
Komponent istnieje w kodzie (wklejenie surowego tekstu odpisu + parsowanie przez DeepSeek), ale **nie jest aktualnie podłączony do nawigacji** w `App.tsx` (zakładka usunięta z UI). Do przywrócenia wystarczy dodać przycisk zakładki analogicznie do `sim`/`help`.

### Pomoc (`EKWHelp`)
Statyczna instrukcja użytkowania dla notariusza/asystenta.

## 8. Parser danych Apify — kluczowe detale techniczne

To najbardziej "kruchy" element systemu, bo zależy od dokładnego formatu odpowiedzi Apify, który nie jest formalnie dokumentowany.

- Każdy wpis to `{ label, value }`. `label === "_header"` oznacza nagłówek sekcji/rubryki (np. `"Rubryka 1.5 - Obszar"`) albo separator.
- Wartości pól są zakodowane jako string z segmentami rozdzielonymi `|`; **prawdziwa treść to zawsze ostatni segment**, a `"---"` oznacza pole puste. Funkcja `extractVal()` w `server.ts` to dekoduje.
- **Dwa formaty pól** w surowych danych:
  - **Format A (etykieta nazwana)** — `label` zawiera nazwę pola, np. `label: "2. Województwo"`, `value: "1. | 1 | --- | ŚLĄSKIE"`. Obsługuje `findEntry()`.
  - **Format B (tabela Lp.)** — `label` to tylko numer porządkowy (`"1."`), a nazwa pola jest zaszyta w **pierwszym segmencie wartości**, np. `value: "1. Identyfikator działki | 1. | 1 | --- | 241404_2.0003..."`. Obsługuje `findEntryByValuePrefix()`.
- Niektóre etykiety (np. "Obszar") powtarzają się wielokrotnie w tym samym dziale z różną treścią (placeholder przy "Odłączenie" zawsze pusty, prawdziwa wartość przy "Przyłączenie"). `findEntry()` wybiera pierwsze **niepuste** dopasowanie, nie pierwsze dopasowanie w ogóle.
- Hipoteki w Dziale IV są rozdzielane po nagłówkach `"Rubryka 4.2 - Numer hipoteki"`; dane wierzyciela znajdują się w `Podrubryka 4.4.4`.
- Wzmianki (`wzmianki`) w każdym dziale są wykrywane stanowo (`inWzmianki` flag) między nagłówkami `Rubryka x.1 - Wzmianki` i kolejną rubryką.

**Ważne dla dewelopera:** przy każdej zmianie w `mapApifyToKWData()` należy zwiększyć `PARSER_VERSION` w `server.ts`, inaczej już zapisane w bibliotekach klientów księgi nie zostaną automatycznie przemapowane.

Surowe odpowiedzi Apify są zapisywane diagnostycznie na dysk jako `apify_raw_<NUMER_KW>.json` (gitignored) przy każdym pobraniu — przydatne do debugowania nowych formatów danych bez ponownego, płatnego wywołania Apify.

## 9. Konfiguracja środowiska

Zmienne w `.env.local` (gitignored, nie commitować):

```
APIFY_API_TOKEN=...       # token do Apify Actor "regdata~ekw-ksiegi-wieczyste-scraper" (płatne wywołania!)
DEEPSEEK_API_KEY=...      # klucz API DeepSeek (deepseek-chat) — generowanie/korekta tekstów
```

Bez `DEEPSEEK_API_KEY` system działa w trybie deterministycznego fallbacku (prostsze, szablonowe teksty bez AI). Bez `APIFY_API_TOKEN` `/api/fetch-kw` zwraca błąd 500 — wyszukiwarka spada do przykładów/symulacji AI.

`.env.example` w repo zawiera nieaktualne resztki po szablonie Google AI Studio (`GEMINI_API_KEY`, `APP_URL`) — **do wyczyszczenia/zaktualizowania** przy przekazaniu projektu.

## 10. Build i deployment

```
npm install
npm run dev      # tsx server.ts — dev server z Vite middleware (HMR), port 3000
npm run lint     # tsc --noEmit — typecheck
npm run build    # vite build (frontend) + esbuild bundle server.ts -> dist/server.cjs
npm run start    # node dist/server.cjs — produkcyjny start zbudowanej aplikacji
```

Projekt wystartował jako szablon Google AI Studio (Cloud Run) — `metadata.json` i część `.env.example` to relikty tego pochodzenia. Obecnie nie ma jeszcze ustalonego docelowego hostingu produkcyjnego — do decyzji z deweloperem (Cloud Run / VPS / inny PaaS Node.js, jeden proces Express wystarczy, brak bazy danych).

## 11. Repozytorium / dostęp

- GitHub: `https://github.com/michalszafron-netizen/PrawnikKW` (branch `main`).
- W fazie developerskiej używany jest tymczasowy Classic PAT wklejony bezpośrednio w remote URL przy `git push` — **token do zrewokowania przed przejściem do fazy produkcyjnej/sprzedażowej** i zastąpienia bezpiecznym uwierzytelnianiem (np. SSH deploy key per deweloper, GitHub App, lub OAuth dla CI/CD).

## 12. Znane braki / rzeczy do dopilnowania

- `@types/react` nie jest zainstalowany jako zależność — `npm run lint` (tsc --noEmit) zgłasza 2 błędy typowania w `RubricViewer.tsx` (przekazywanie `key` do komponentu rekurencyjnego). Nie blokuje działania apki (Vite/tsx nie wymuszają strict typecheck), ale warto doinstalować `@types/react` + `@types/react-dom` i to uporządkować.
- Zakładka "Wklej tekst ręcznie" (`ManualPaster`) jest napisana, ale niepodłączona do nawigacji w `App.tsx`.
- `.env.example` zawiera nieaktualne zmienne z szablonu AI Studio — wymaga aktualizacji do `APIFY_API_TOKEN`/`DEEPSEEK_API_KEY`.
- Brak testów automatycznych (jednostkowych/e2e) — cała weryfikacja parsera odbywała się manualnie na realnych przykładach z Apify.
- Brak warstwy autentykacji/autoryzacji — narzędzie działa jako wewnętrzny, niezabezpieczony panel (do uzupełnienia przed udostępnieniem szerszemu zespołowi/poza siecią kancelarii).
- Każda zmiana w parserze EKW (`mapApifyToKWData`) wymaga ręcznego zwiększenia `PARSER_VERSION` — łatwo o tym zapomnieć (już raz się zdarzyło w trakcie prac).
