# Format danych EKW (Apify) — baza wiedzy do parsowania

Notatki zweryfikowane empirycznie na 6 realnych zrzutach z `apify_dumps/`
(3 księgi × 2 widoki: GD1G/00085431/2, KA1T/00086962/7, WA1M/00348754/5).
Cel: nie powtarzać błędów mapowania opisanych w sekcji 3 (każdy był realnym
bugiem w `mapApifyToKWData`, nie tylko teorią).

---

## 1. Dwa widoki — zupełna vs aktualna

Apify zwraca dane w jednym z dwóch kompletnie różnych układów, rozpoznawanych
przez `raw.viewType` (`"zupelna"` lub `"aktualna"`):

| | **zupełna** | **aktualna** |
|---|---|---|
| Zawiera | **całą historię** wpisów (też wykreślone/zastąpione) | tylko stan **bieżący** |
| Struktura | nagłówki `Rubryka X.Y` / `Podrubryka X.Y.Z`, pola wymienione osobno | spłaszczona, jedna linia na właściciela/hipotekę |
| Konwencja wartości | `extractVal()` — prawdziwa treść = **ostatni** segment `\|` | `firstSeg()` — prawdziwa treść = **pierwszy** segment `\|` |
| Wykryj przez | `raw.viewType === "zupelna"` (lub obecność nagłówków `Rubryka`) | `raw.viewType === "aktualna"` |

**Złota zasada:** jeśli masz dostęp do OBU widoków tej samej księgi (jak w
`apify_dumps/`), **aktualna jest naturalnym źródłem prawdy o stanie bieżącym**
— Apify już samo przefiltrowało dla Ciebie historię. Użyj jej do weryfikacji,
czy `zupełna` po przetworzeniu daje TEN SAM wynik (liczba właścicieli, udziały,
suma hipotek). Rozjazd = bug w parserze `zupełna`, nie w danych.

---

## 2. Konwencja kodowania wartości (pipe `|`)

Każde pole to `{label, value}`, gdzie `value` to string z segmentami
rozdzielonymi `|`. `"---"` = pole puste.

### 2a. Format A — nazwa pola w `label`
```
label: "2. Województwo"
value: "1. | 1 | --- | ŚLĄSKIE"
```
Tu `extractVal(value)` (ostatni segment) daje poprawną treść. Najczęstszy
format w `zupełna` dla pól nazwanych indywidualnie (Rubryka 1.3 Położenie,
Podrubryka 2.2.5 Osoba fizyczna pole-po-polu, itd.).

### 2b. Format B — nazwa pola zaszyta w `value` ("tabela Lp.")
```
label: "1."
value: "1. Identyfikator działki | 1. | 1 | --- | 241404_2.0003.AR_3.357/17"
```
Tu `label` to tylko numer porządkowy wiersza tabeli — nazwa pola jest
**pierwszym segmentem `value`**. Występuje w Podrubryka 1.4.1 (Działka
ewidencyjna), Rubryka 4.2 (Numer hipoteki) i podobnych tabelach "Lp.".
Obsługuje to `findEntryByValuePrefix()` w `server.ts`.

**Pułapka:** `findEntry()` szuka po `label`. Jeśli pole jest w Formacie B,
`findEntry()` go NIE znajdzie (bo `label` to samo "1.", "2." itd.) — trzeba
użyć `findEntryByValuePrefix()` albo dopasować po treści `value`.

### 2c. Format aktualna — `firstSeg` + `"Nr podstawy wpisu"`
```
label: "Lista wskazań udziałów w prawie (...)"
value: "Lp. 1. | 1 | 2 /3 | WSPÓLNOŚĆ USTAWOWA MAJĄTKOWA MAŁŻEŃSKA | 3"
```
Tu pierwszy segment ("Lp. 1.") to numer wiersza, a prawdziwe dane są w
środkowych segmentach — pozycje 1..3 mają **ustalone, stałe znaczenie**
(patrz §4), inaczej niż w zupełnej gdzie liczy się tylko "ostatni segment".

---

## 3. Realne bugi znalezione i naprawione (29.06.2026, PARSER_VERSION 9→11)

### 3a. Duplikat etykiety "Obszar" (PARSER_VERSION 9→10, część 1)
W Dziale I-O etykieta `"Obszar"` występuje DWA razy — raz jako placeholder przy
"Odłączenie" (zawsze pusty: `"1. | --- | --- | ---"`), raz z prawdziwą wartością
przy "Przyłączenie". `findEntry()` brał **pierwsze** dopasowanie (puste).
**Fix:** `findEntry()` woli pierwsze NIEPUSTE dopasowanie z wszystkich
pasujących etykiet, nie literalnie pierwsze.

### 3b. Wspólny udział małżeński w formacie "aktualna" (PARSER_VERSION 9→10)
Linia `"Lista wskazań udziałów w prawie..."` powtarza się **dla każdego
właściciela osobno**, z jego WŁASNYM udziałem — ale tylko gdy różni
współwłaściciele (np. dwie pary małżeńskie) mają RÓŻNE udziały:
```
Osoba 1 (Zofia)   ← Lista wskazań: "...| 1 | 2 /3 | WSPÓLNOŚĆ... | 3"   (udział nr 1 = 2/3)
Osoba 2 (Ryszard) ← Lista wskazań: "...| 1 | 2 /3 | WSPÓLNOŚĆ... | 3"   (ten sam, para małżeńska)
Osoba 3 (Iwona)   ← Lista wskazań: "...| 2 | 1 /3 | WSPÓLNOŚĆ... | 3"   (udział nr 2 = 1/3, INNY!)
Osoba 4 (Robert)  ← Lista wskazań: "...| 2 | 1 /3 | WSPÓLNOŚĆ... | 3"   (para małżeńska Iwony)
```
Stary kod robił `.find()` po PIERWSZYM wystąpieniu tej etykiety w całym dziale
i stosował JEDEN udział do wszystkich 4 osób (każdy "2/3" — źle).
**Fix:** śledzenie `pendingShare` sekwencyjnie — linia z udziałem zawsze
bezpośrednio poprzedza wiersz osoby, której dotyczy; każda osoba bierze
ostatnio zaktualizowany `pendingShare`, nie jeden globalny.

**Zasada na przyszłość:** w formacie "aktualna" NIGDY nie zakładaj, że
pierwsze znalezione wystąpienie powtarzającej się etykiety reprezentuje
wszystkie kolejne wiersze. Iteruj sekwencyjnie i aktualizuj stan "w locie".

### 3c. Wykreśleni właściciele pokazywani jako aktualni w "zupełna" (PARSER_VERSION 10→11)
**Najważniejszy i najbardziej ryzykowny prawnie znaleziony błąd.** Format
"zupełna" pokazuje pełną historię — łącznie z właścicielami, którzy już
**sprzedali/przekazali** swój udział. Przykład z GD1G/00085431/2:

```
Podrubryka 2.2.1 - Udział:
  Lp.1  Numer udziału=1, 1/1, wspólność małżeńska   ← WYKREŚLONY (patrz niżej)
  Lp.2  Numer udziału=2, 1/2                        ← aktywny
  Lp.3  Numer udziału=3, 1/2                        ← aktywny

Podrubryka 2.2.5 - Osoba fizyczna:
  Lp.1  Katarzyna Chrzanowska  → udział 1  ← WYKREŚLONA
  Lp.2  Piotr Chrzanowski      → udział 1  ← WYKREŚLONY
  Lp.3  Marzena Bolduan        → udział 2  ← aktywna
  Lp.4  Tomasz Klimkiewicz     → udział 3  ← aktywny
```
Widok "aktualna" tej samej księgi pokazuje **tylko Marzenę i Tomasza** —
potwierdzając, że Chrzanowscy to historia (zastąpieni przy sprzedaży).

**Jak to rozpoznać w surowych danych:** każdy wiersz w tabeli "Lp." ma wartość
w kształcie `<Indeks> | <Wpisu> | <Wykr.> | <Treść>` (4 segmenty po pipe).
**`Wykr.` (drugi od końca segment) różny od `"---"` = ten wpis został
WYKREŚLONY przy wskazanym numerze wpisu i nie jest już aktualny.**
```
"1. Numer udziału w prawie | 1. | 2 | 6 | 1"   →  Wykr.="6"   → WYKREŚLONY
"1. Numer udziału w prawie | 1. | 6 | --- | 2" →  Wykr."---"  → aktywny
```
**Fix:** `isWykreslone(rawValue)` sprawdza ten segment; w parsowaniu
Działu II (osoby fizyczne i prawne) wpisy z `isWykreslone()===true` na linii
"Lista wskazań udziałów..." są całkowicie pomijane przy budowaniu listy
właścicieli (ale oczywiście WCIĄŻ widoczne w zakładce "Rubryki", bo to surowy
podgląd — to jest cała różnica między "Rubryki" i "Edytor").

**Zasada na przyszłość:** w "zupełna" ZAWSZE sprawdzaj kolumnę `Wykr.` przed
uznaniem wiersza za część aktualnego stanu prawnego. Dotyczy to potencjalnie
też Działu III (służebności/ostrzeżenia) i Działu IV (hipoteki) — **patrz §5,
NIE jest jeszcze naprawione tam**.

---

## 4. Format "aktualna" — pozycje segmentów dla udziałów (zweryfikowane)

Dla linii `"Lista wskazań udziałów w prawie (numer udziału w prawie/
wielkość udziału/rodzaj wspólności)"`:

```
value = "Lp. N. | <numer udziału w prawie> | <licznik>/<mianownik> | <rodzaj wspólności albo ---> | <inny indeks>"
         segs[0]   segs[1]                    segs[2]                 segs[3]                        segs[4]
```
Potwierdzone na 3 różnych księgach (KA1T, WA1M, GD1G) — pozycje są stałe.
`segs[4]` (ostatni) wydaje się być jakimś wewnętrznym indeksem niezwiązanym
z udziałem (nie jest jeszcze użyty, prawdopodobnie liczba uprawnionych albo
numer pozycji globalnej — do zweryfikowania jeśli będzie potrzebny).

---

## 5. OTWARTE — niedokończone, wymaga ostrożności

### Dział IV (hipoteki) w "zupełna" — możliwy podobny problem, NIE naprawiony
Sekcja Rubryka 4.2/Podrubryka 4.4.1 ma TĘ SAMĄ konwencję `Wpisu | Wykr.`, ale
interpretacja jest **niejednoznaczna**: wzmianki w Rubryce 4.1 rozróżniają
**"ZMIANA HIPOTEKI PRZYMUSOWEJ"** (korekta/aktualizacja wpisu — hipoteka
WCIĄŻ aktywna, tylko zmieniony np. wierzyciel/kwota) od **"WYKREŚLENIE
HIPOTEKI PRZYMUSOWEJ"** (pełne usunięcie — hipoteka już nieaktywna). Na
przykładzie KA1T/00086962/7 niektóre pola hipoteki (np. "2. Suma") mają
niepuste `Wykr.`, mimo że sama hipoteka pozostaje aktywna (to było "ZMIANA",
nie "WYKREŚLENIE"). **Mechaniczne zastosowanie tej samej reguły co w §3c
("niepuste Wykr. = wyklucz") byłoby BŁĘDEM — wykluczyłoby aktywne hipoteki.**

Przed naprawą trzeba:
1. Zmapować numery wpisów (`DZ. KW./KA1T/NNNNN/RR/N`) z Rubryki 4.6 na
   konkretne wzmianki z Rubryki 4.1, żeby wiedzieć która "Numer hipoteki"
   linia odpowiada której wzmiance (ZMIANA vs WYKREŚLENIE).
2. Wykluczać z `dzial4.mortgages` tylko te, których WŁASNA linia
   `"1. Numer hipoteki (roszczenia)"` ma Wykr. wskazujący na wpis będący
   WYKREŚLENIEM (nie ZMIANĄ).
3. Zweryfikować na realnym PDF/odpisie ile hipotek faktycznie powinno zostać
   (KA1T ma 6 wpisów "Numer hipoteki" w surowych danych — sprawdzić z
   właścicielem/PDF ile z nich jest wciąż aktywnych przed zmianą kodu).

### Dział III (służebności/ostrzeżenia) w "zupełna" — nie sprawdzone
Żadna z 6 przykładowych ksiąg nie miała wpisów w Dziale III (wszystkie
"BRAK WPISÓW"), więc nie było czego zweryfikować. Jeśli trafi się księga z
wpisami, sprawdź najpierw czy ta sama konwencja `Wpisu | Wykr.` obowiązuje
i czy `dzial3.easements`/`warningsAndExecutions` filtruje wykreślone wpisy.

---

## 6. Jak weryfikować zmiany w parserze (workflow)

1. Surowe odpowiedzi z każdego pobrania zapisują się automatycznie do
   `apify_dumps/apify_raw_<KW>_<viewType>.json` (gitignored) — nie trzeba
   ponownie (płatnie) odpytywać Apify żeby przetestować poprawkę.
2. `POST /api/remap-kw` z body `{ raw, kwNumber }` przepuszcza zapisany
   surowy JSON przez aktualny kod `mapApifyToKWData` — szybki, darmowy test.
3. Po KAŻDEJ zmianie logiki w `mapApifyToKWData` podbij **OBIE**:
   `PARSER_VERSION` w `server.ts` i `MIN_PARSER_VERSION` w
   `EKWBrowserSim.tsx` — inaczej już zapisane w bibliotece błędne dane się
   nie przemapują automatycznie przy ponownym otwarciu (to się już raz
   zdarzyło — fix bez podbicia wersji nie dotarł do użytkownika).
4. Jeśli księga ma OBA widoki zapisane (zupełna + aktualna), porównaj wynik
   mapowania obu — powinny dawać IDENTYCZNY stan bieżący (właściciele,
   udziały, aktywne hipoteki). Rozjazd = bug.
