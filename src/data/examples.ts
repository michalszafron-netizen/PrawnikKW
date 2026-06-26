/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PreconfiguredExample } from "../types";

export const PRECONFIGURED_EXAMPLES: PreconfiguredExample[] = [
  {
    id: "mieszkanie-mokotow",
    kwNumber: "WA1M/00348754/2",
    title: "Mieszkanie z hipoteką (Warszawa)",
    subtitle: "Lokal mieszkalny • Wspólność małżeńska • Hipoteka bankowa",
    description: "Standardowy odpis lokalu stanowiącego odrębną własność, ze spłatą kredytu hipotecznego oraz udziałem w gruncie i nieruchomości wspólnej.",
    data: {
      kwNumber: "WA1M/00348754/2",
      sadRejonowy: "Sąd Rejonowy dla Warszawy-Mokotowa w Warszawie",
      wydzialKw: "VII Wydział Ksiąg Wieczystych",
      status: "active",
      dzial1O: {
        location: "województwo mazowieckie, powiat m.st. Warszawa, gmina Mokotów, m. Warszawa, dzielnica Mokotów",
        address: "ul. Puławska 142 m. 15, 02-670 Warszawa",
        propertyType: "lokal",
        description: "Lokal mieszkalny nr 15 usytuowany na czwartej kondygnacji (trzecim piętrze) budynku, składający się z trzech pokoi, kuchni, przedpokoju i łazienki, o łącznej powierzchni użytkowej 64,50 m².",
        plots: [
          {
            number: "45/14",
            areaSquareMeters: 1450,
            cadastreUnit: "obręb 1-02-05 Mokotów"
          }
        ],
        totalAreaStr: "64,50 m²"
      },
      dzial1Sp: {
        hasEntries: true,
        shareInJointProperty: "6450/100000",
        associatedRights: [
          {
            id: "sp-1",
            description: "Udział wynoszący 6450/100000 części w nieruchomości wspólnej, którą stanowi grunt – działka ewidencyjna nr 45/14 oraz części budynku i urządzenia, które nie służą wyłącznie do użytku właścicieli lokali."
          }
        ]
      },
      dzial2: {
        owners: [
          {
            id: "owner-1",
            name: "JAN PAWEŁ KOWALSKI",
            peselOrRegon: "84051203492",
            parentsNames: "syn Mariana i Haliny",
            share: "do całości (1/1)",
            basisOfAcquisition: "Umowa sprzedaży sporządzona przed notariuszem Małgorzatą Szewczyk w Warszawie w dniu 15 maja 2018 r., Repetytorium A numer 4562/2018."
          },
          {
            id: "owner-2",
            name: "BARBARA MARIA KOWALSKA",
            peselOrRegon: "86112504839",
            parentsNames: "córka Andrzeja i Krystyny",
            share: "do całości (1/1)",
            basisOfAcquisition: "Umowa sprzedaży sporządzona przed notariuszem Małgorzatą Szewczyk w Warszawie w dniu 15 maja 2018 r., Repetytorium A numer 4562/2018."
          }
        ],
        isPerpetualUsufruct: false
      },
      dzial3: {
        hasEntries: false,
        easements: [],
        warningsAndExecutions: [],
        otherRights: []
      },
      dzial4: {
        hasEntries: true,
        mortgages: [
          {
            id: "mortgage-1",
            type: "Hipoteka umowna",
            amount: 320000,
            currency: "PLN",
            creditor: "Powszechna Kasa Oszczędności Bank Polski S.A. z siedzibą w Warszawie (KRS: 0000026438)",
            securesWhat: "zabezpieczająca spłatę kredytu hipotecznego nr 2018/K/4512-A oraz odsetek, prowizji i innych należności banku wynikających z umowy kredytowej."
          }
        ]
      }
    }
  },
  {
    id: "dzialka-piaseczno",
    kwNumber: "WA5M/12045963/8",
    title: "Działka budowlana ze służebnością (Piaseczno)",
    subtitle: "Nieruchomość gruntowa • Jeden właściciel • Służebność dojazdu",
    description: "Opis działki gruntu przeznaczonej pod budowę domu, z przysługującą w dziale I-Sp służebnością gruntową przejazdu i przechodu przez sąsiednie działki.",
    data: {
      kwNumber: "WA5M/12045963/8",
      sadRejonowy: "Sąd Rejonowy w Piasecznie",
      wydzialKw: "IV Wydział Ksiąg Wieczystych",
      status: "active",
      dzial1O: {
        location: "województwo mazowieckie, powiat piaseczyński, gmina Lesznowola, miejscowość Mysiadło",
        address: "ul. Słowicza, Mysiadło",
        propertyType: "dzialka",
        description: "Nieruchomość gruntowa stanowiąca niezabudowaną działkę ewidencyjną przeznaczoną pod zabudowę mieszkaniową jednorodzinną.",
        plots: [
          {
            number: "213/5",
            areaSquareMeters: 1245,
            cadastreUnit: "obręb 0012 Mysiadło"
          }
        ],
        totalAreaStr: "1245 m² (0,1245 ha)"
      },
      dzial1Sp: {
        hasEntries: true,
        associatedRights: [
          {
            id: "sp-2",
            description: "Służebność gruntowa polegająca na prawie przejazdu, przechodu i przeprowadzenia mediów szlakiem drogowym o szerokości 4 metrów przebiegającym wzdłuż północnej granicy działki ewidencyjnej numer 213/4, na rzecz każdoczesnego właściciela działki numer 213/5."
          }
        ]
      },
      dzial2: {
        owners: [
          {
            id: "owner-3",
            name: "IRENEUSZ STEFAN BOROWICZ",
            peselOrRegon: "67041804910",
            parentsNames: "syn Wadima i Janiny",
            share: "1/1 (całość)",
            basisOfAcquisition: "Akt Poświadczenia Dziedziczenia sporządzony przez notariusza Elżbietę Nowak-Grabowską w Piasecznie w dniu 12 września 2021 r., Rep. A nr 5912/2021, po zmarłej w dniu 3 lipca 2021 r. Helenie Borowicz."
          }
        ],
        isPerpetualUsufruct: false
      },
      dzial3: {
        hasEntries: false,
        easements: [],
        warningsAndExecutions: [],
        otherRights: []
      },
      dzial4: {
        hasEntries: false,
        mortgages: []
      }
    }
  },
  {
    id: "grunt-egzekucja",
    kwNumber: "KR1P/00135892/3",
    title: "Nieruchomość z egzekucją i ostrzeżeniem (Kraków)",
    subtitle: "Dział roszczeń i egzekucji • Udziały ułamkowe • Hipoteka przymusowa",
    description: "Skomplikowany prawnie stan nieruchomości obciążonej zaległościami podatkowymi, egzekucją komorniczą oraz prawem pierwokupu w dziale III.",
    data: {
      kwNumber: "KR1P/00135892/3",
      sadRejonowy: "Sąd Rejonowy dla Krakowa-Podgórza w Krakowie",
      wydzialKw: "IV Wydział Ksiąg Wieczystych",
      status: "active",
      dzial1O: {
        location: "województwo małopolskie, powiat m. Kraków, gmina Podgórze, m. Kraków",
        address: "ul. Wielicka, Kraków",
        propertyType: "dzialka",
        description: "Nieruchomość gruntowa składająca się z działki ewidencyjnej zabudowanej wolnostojącym murowanym budynkiem gospodarczym.",
        plots: [
          {
            number: "192/1",
            areaSquareMeters: 4500,
            cadastreUnit: "obręb 24 Podgórze"
          }
        ],
        totalAreaStr: "4500 m²"
      },
      dzial1Sp: {
        hasEntries: false,
        associatedRights: []
      },
      dzial2: {
        owners: [
          {
            id: "owner-4",
            name: "WOJCIECH ANDRZEJ MAZUR",
            peselOrRegon: "72120108521",
            parentsNames: "syn Jerzego i Anieli",
            share: "1/2 części",
            basisOfAcquisition: "Umowa darowizny sporządzona przed notariuszem Romanem Dudkiem w Krakowie w dniu 11 lutego 2005 r., Repetytorium A nr 1192/2005."
          },
          {
            id: "owner-5",
            name: "KACPER MAREK MAZUR",
            peselOrRegon: "93021404921",
            parentsNames: "syn Jerzego i Anieli",
            share: "1/2 części",
            basisOfAcquisition: "Umowa zniesienia współwłasności i podziału majątku, sporządzona przed notariuszem Anną Kuleszą w Krakowie, dnia 4 maja 2015 r., Rep. A nr 2314/2015."
          }
        ],
        isPerpetualUsufruct: false
      },
      dzial3: {
        hasEntries: true,
        easements: [],
        warningsAndExecutions: [
          {
            id: "warn-1",
            description: "Ostrzeżenie o wszczęciu egzekucji z udziału wynoszącego 1/2 części należącego do Wojciecha Andrzeja Mazura, prowadzone przez Komornika Sądowego przy Sądzie Rejonowym dla Krakowa-Podgórza Huberta Nowickiego w sprawie o sygnaturze KM 412/2026, na wniosek wierzyciela Skarbu Państwa.",
            caseNumber: "KM 412/2026"
          }
        ],
        otherRights: [
          {
            id: "other-right-1",
            description: "Umowne i nieodpłatne prawo dożywotniego zamieszkiwania w budynku murowanym dla Mariana Mazura (PESEL: 45010103421)."
          }
        ]
      },
      dzial4: {
        hasEntries: true,
        mortgages: [
          {
            id: "mortgage-2",
            type: "Hipoteka przymusowa",
            amount: 85000,
            currency: "PLN",
            creditor: "Naczelnik Drugiego Urzędu Skarbowego w Krakowie",
            securesWhat: "zabezpieczająca zaległości z tytułu podatku dochodowego od osób fizycznych oraz odsetek ustawowych za zwłokę, obciążająca udział 1/2 Wojciecha Andrzeja Mazura."
          }
        ]
      }
    }
  },
  {
    id: "lokal-uzytkowy-wieczyste",
    kwNumber: "GD1G/00085431/9",
    title: "Lokal usługowy i Użytkowanie Wieczyste",
    subtitle: "Użytkowanie wieczyste • Budynek i lokal handlowy • Duża kwota hipoteki",
    description: "Nieruchomość z gruntem oddanym w użytkowanie wieczyste, lokalem stanowiącym odrębną własność i zabezpieczeniem bankowym na wysokie kwoty.",
    data: {
      kwNumber: "GD1G/00085431/9",
      sadRejonowy: "Sąd Rejonowy Gdańsk-Północ w Gdańsku",
      wydzialKw: "III Wydział Ksiąg Wieczystych",
      status: "active",
      dzial1O: {
        location: "województwo pomorskie, powiat m. Gdańsk, gmina Gdańsk, m. Gdańsk",
        address: "ul. Grunwaldzka 82 lok. U1, 80-244 Gdańsk",
        propertyType: "lokal",
        description: "Lokal użytkowy (handlowy) przeznaczony do prowadzenia działalności gospodarczej, oznaczony jako lokal U1 usytuowany na parterze budynku handlowo-biurowego, składający się z sali sprzedaży, zaplecza socjalnego i biura o powierzchni 117,10 m².",
        plots: [
          {
            number: "112/3",
            areaSquareMeters: 4512,
            cadastreUnit: "obręb Wrzeszcz 002"
          }
        ],
        totalAreaStr: "117,10 m²"
      },
      dzial1Sp: {
        hasEntries: true,
        shareInJointProperty: "11710/451200",
        associatedRights: [
          {
            id: "sp-3",
            description: "Udział wynoszący 11710/451200 części we współużytkowaniu wieczystym gruntu – działki ewidencyjnej nr 112/3 oraz we współwłasności budynku i urządzeń wspólnych."
          }
        ]
      },
      dzial2: {
        owners: [
          {
            id: "owner-6",
            name: "SOLAR DEVELOPMENT SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
            peselOrRegon: "KRS: 0000851243, REGON: 382103450",
            share: "1/1 części",
            basisOfAcquisition: "Umowa przeniesienia własności lokalu i udziału w prawie użytkowania wieczystego w wykonaniu umowy przedwstępnej z dnia 14 października 2019 r., Repetytorium A nr 8412/2019, sporządzona przed notariuszem Dariuszem Podgórskim w Gdyni."
          }
        ],
        isPerpetualUsufruct: true
      },
      dzial3: {
        hasEntries: false,
        easements: [],
        warningsAndExecutions: [],
        otherRights: []
      },
      dzial4: {
        hasEntries: true,
        mortgages: [
          {
            id: "mortgage-3",
            type: "Hipoteka umowna",
            amount: 1500000,
            currency: "PLN",
            creditor: "mBank Spółka Akcyjna z siedzibą w Warszawie",
            securesWhat: "zabezpieczająca spłatę kredytu inwestycyjnego ze stawką WIBOR 3M udzielonego na podstawie umowy kredytowej nr KD/2019/9931 z dnia 10 października 2019 r."
          }
        ]
      }
    }
  }
];
