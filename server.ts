/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import https from "https";
import { createServer as createViteServer } from "vite";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

let deepseekClient: OpenAI | null = null;
function getDeepseekClient(): OpenAI | null {
  if (!deepseekClient) {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) {
      console.warn("WARNING: DEEPSEEK_API_KEY is not defined. Using fallback generation.");
      return null;
    }
    deepseekClient = new OpenAI({
      apiKey: key,
      baseURL: "https://api.deepseek.com",
    });
  }
  return deepseekClient;
}

// Map of standard Polish EKW Court prefixes
const COURT_MAP: Record<string, { court: string; dept: string }> = {
  "WA1M": { court: "Sąd Rejonowy dla Warszawy-Mokotowa w Warszawie", dept: "VII Wydział Ksiąg Wieczystych" },
  "WA2M": { court: "Sąd Rejonowy dla Warszawy-Żoliborza w Warszawie", dept: "IX Wydział Ksiąg Wieczystych" },
  "WA3M": { court: "Sąd Rejonowy dla Warszawy-Woli w Warszawie", dept: "VI Wydział Ksiąg Wieczystych" },
  "WA4M": { court: "Sąd Rejonowy dla i m.st. Warszawy", dept: "XI Wydział Ksiąg Wieczystych" },
  "WA5M": { court: "Sąd Rejonowy w Piasecznie", dept: "IV Wydział Ksiąg Wieczystych" },
  "WA6M": { court: "Sąd Rejonowy w Pruszkowie", dept: "VI Wydział Ksiąg Wieczystych" },
  "KR1P": { court: "Sąd Rejonowy dla Krakowa-Podgórza w Krakowie", dept: "IV Wydział Ksiąg Wieczystych" },
  "KR1S": { court: "Sąd Rejonowy w Krakowie", dept: "VI Wydział Ksiąg Wieczystych" },
  "GD1G": { court: "Sąd Rejonowy Gdańsk-Północ w Gdańsku", dept: "III Wydział Ksiąg Wieczystych" },
  "PO1P": { court: "Sąd Rejonowy Poznań-Stare Miasto w Poznaniu", dept: "V Wydział Ksiąg Wieczystych" },
  "PO1H": { court: "Sąd Rejonowy Poznań-Nowe Miasto i Wilda w Poznaniu", dept: "VI Wydział Ksiąg Wieczystych" },
  "WR1K": { court: "Sąd Rejonowy dla Wrocławia-Krzyków we Wrocławiu", dept: "IV Wydział Ksiąg Wieczystych" },
  "OL1O": { court: "Sąd Rejonowy w Olsztynie", dept: "VI Wydział Ksiąg Wieczystych" },
  "BI1B": { court: "Sąd Rejonowy w Białymstoku", dept: "IX Wydział Ksiąg Wieczystych" },
  "LU1I": { court: "Sąd Rejonowy Lublin-Wschód w Lublinie", dept: "V Wydział Ksiąg Wieczystych" },
  "LD1M": { court: "Sąd Rejonowy dla Łodzi-Śródmieścia w Łodzi", dept: "XVI Wydział Ksiąg Wieczystych" },
  "SZ1S": { court: "Sąd Rejonowy Szczecin-Prawobrzeże i Zachód w Szczecinie", dept: "X Wydział Ksiąg Wieczystych" },
  "GD1Y": { court: "Sąd Rejonowy w Gdyni", dept: "V Wydział Ksiąg Wieczystych" },
  "GD1S": { court: "Sąd Rejonowy w Sopocie", dept: "IV Wydział Ksiąg Wieczystych" },
  "KA1T": { court: "Sąd Rejonowy w Tychach", dept: "V Wydział Ksiąg Wieczystych" },
  "KA1K": { court: "Sąd Rejonowy Katowice-Wschód w Katowicach", dept: "XI Wydział Ksiąg Wieczystych" },
  "KA1C": { court: "Sąd Rejonowy w Chorzowie", dept: "VI Wydział Ksiąg Wieczystych" },
  "KA1R": { court: "Sąd Rejonowy w Raciborzu", dept: "V Wydział Ksiąg Wieczystych" },
  "KA1Y": { court: "Sąd Rejonowy w Bytomiu", dept: "IV Wydział Ksiąg Wieczystych" }
};

// Helper: find entry value by label in Apify entries array
function findEntry(entries: any[], labelPattern: string | RegExp): string {
  if (!entries || !Array.isArray(entries)) return "";
  const entry = entries.find((e: any) => {
    if (e.label === "_header") return false;
    if (typeof labelPattern === "string") return e.label?.toLowerCase().includes(labelPattern.toLowerCase());
    return labelPattern.test(e.label || "");
  });
  return entry?.value || "";
}

function findAllEntries(entries: any[], labelPattern: string | RegExp): string[] {
  if (!entries || !Array.isArray(entries)) return [];
  return entries
    .filter((e: any) => {
      if (e.label === "_header") return false;
      if (typeof labelPattern === "string") return e.label?.toLowerCase().includes(labelPattern.toLowerCase());
      return labelPattern.test(e.label || "");
    })
    .map((e: any) => e.value || "");
}

function mapApifyToKWData(raw: any, kwNumber: string, courtInfo: { court: string; dept: string }) {
  const dzialIO = raw.dzialIO || {};
  const dzialISp = raw.dzialISp || {};
  const dzialII = raw.dzialII || {};
  const dzialIII = raw.dzialIII || {};
  const dzialIV = raw.dzialIV || {};

  const ioEntries: any[] = dzialIO.entries || [];
  const iSpEntries: any[] = dzialISp.entries || [];
  const iiEntries: any[] = dzialII.entries || [];
  const iiiEntries: any[] = dzialIII.entries || [];
  const ivEntries: any[] = dzialIV.entries || [];

  // --- DZIAŁ I-O ---
  const plotNumber = findEntry(ioEntries, "numer działki");
  const plotIdentifier = findEntry(ioEntries, "identyfikator działki");
  const obreb = findEntry(ioEntries, "obręb ewidencyjny");
  const locationRaw = findEntry(ioEntries, "położenie");
  const streetRaw = findEntry(ioEntries, "ulica");
  const areaRaw = findEntry(ioEntries, "obszar");
  const usageRaw = findEntry(ioEntries, "sposób korzystania");
  const buildingPurpose = findEntry(ioEntries, "przeznaczenie budynku");
  const currentEntryNumberRaw = findEntry(ioEntries, "numer bieżący nieruchomości");
  const joinSeparationRaw = findEntry(ioEntries, "przyłączenie");

  // Extract documents and application data from headers
  const ioDocEntries = ioEntries.filter((e: any) =>
    e.label !== "_header" && !e.label?.startsWith("Lp.") && !e.label?.startsWith("DZ. KW") &&
    e.value?.length > 20 && /wypis|akt|decyzja|postanowienie|umowa|zaświadczenie/i.test(e.value)
  );
  const basisDocsIO = ioDocEntries.map((e: any) => e.value).join("; ");

  const ioAppDataHeaders = ioEntries.filter((e: any) =>
    e.label === "_header" && /^DZ\. KW/i.test(e.value || "")
  );
  const applicationDataIO = ioAppDataHeaders.map((e: any) => e.value).join("; ");

  // Notices (wzmianki)
  const ioNotices = ioEntries
    .filter((e: any) => e.label === "_header" && /wzmiank/i.test(e.value || ""))
    .map((e: any) => e.value);

  // Parse area — supports both "89438,00 M2" and "0,0262 HA" formats
  let areaSqm = 0;
  const areaMatchM2 = areaRaw.match(/([\d\s.,]+)\s*M2/i);
  const areaMatchHA = areaRaw.match(/([\d,]+)\s*HA/i);
  if (areaMatchM2) {
    areaSqm = parseFloat(areaMatchM2[1].replace(/\s/g, "").replace(",", "."));
  } else if (areaMatchHA) {
    areaSqm = parseFloat(areaMatchHA[1].replace(",", ".")) * 10000;
  }
  const areaStr = areaSqm >= 10000
    ? `${(areaSqm / 10000).toFixed(4).replace(".", ",")} ha (${Math.round(areaSqm).toLocaleString("pl-PL")} m²)`
    : `${Math.round(areaSqm).toLocaleString("pl-PL")} m²`;

  const locParts = locationRaw.split("|").map((s: string) => s.trim());
  const location = locParts.length >= 3 ? locParts.slice(2).join(", ") : locationRaw;

  const plots = plotNumber ? [{
    number: plotNumber.split("|")[0]?.trim() || plotNumber,
    areaSquareMeters: Math.round(areaSqm),
    cadastreUnit: obreb || "",
    identifier: plotIdentifier || "",
    landUse: usageRaw || ""
  }] : [];

  const rawPropType = (raw.propertyType || "").toLowerCase();
  let propertyType: "lokal" | "dzialka" | "budynek" | "inne" = "inne";
  if (rawPropType.includes("lokal")) propertyType = "lokal";
  else if (rawPropType.includes("grunt")) propertyType = "dzialka";
  else if (rawPropType.includes("budyn")) propertyType = "budynek";

  const description = [buildingPurpose, usageRaw].filter(Boolean).join(". ") || dzialIO.rawText?.substring(0, 300) || "";

  // --- DZIAŁ I-Sp ---
  const shareInJointProp = findEntry(iSpEntries, "udział") || findEntry(iSpEntries, "nieruchomości wspólnej");
  const iSpAssociated = iSpEntries
    .filter((e: any) => e.label !== "_header" && !e.label?.startsWith("DZ. KW") &&
      !e.label?.toLowerCase().includes("udział") && e.value?.length > 10)
    .map((e: any, i: number) => ({
      id: `sp-${i}`,
      description: e.value
    }));
  const iSpAppDataHeaders = iSpEntries.filter((e: any) => e.label === "_header" && /^DZ\. KW/i.test(e.value || ""));
  const applicationDataISp = iSpAppDataHeaders.map((e: any) => e.value).join("; ");

  // --- DZIAŁ II: Parse owners ---
  // Group entries by "Lp. X." boundaries
  const owners: any[] = [];
  let currentShare = "";
  let currentShareType = "";

  // Extract basis of acquisition from the documents section
  const basisEntries = iiEntries.filter((e: any) =>
    !e.label?.startsWith("_header") && !e.label?.startsWith("Lp.") && !e.label?.startsWith("DZ. KW") &&
    !e.label?.toLowerCase().includes("osoba") && !e.label?.toLowerCase().includes("udział") &&
    !e.label?.toLowerCase().includes("wskazań") && !e.label?.toLowerCase().includes("właściciel") &&
    e.value?.length > 20 && /akt|umowa|decyzja|postanowienie/i.test(e.value)
  );
  const basisText = basisEntries.map((e: any) => e.value).join("; ");

  for (const entry of iiEntries) {
    if (entry.label?.toLowerCase().includes("wskazań") || entry.label?.toLowerCase().includes("udział")) {
      // Parse share: "Lp. 1. | 1 | 2 /3 | WSPÓLNOŚĆ USTAWOWA... | 3"
      const val = entry.value || "";
      const parts = val.split("|").map((s: string) => s.trim());
      const shareMatch = val.match(/(\d+)\s*\/\s*(\d+)/);
      currentShare = shareMatch ? `${shareMatch[1]}/${shareMatch[2]}` : "brak danych";
      currentShareType = parts.find((p: string) => /wspólność|wyłączn/i.test(p)) || "";
      if (currentShareType) currentShare += ` (${currentShareType.toLowerCase()})`;
    }

    // Person entry: "Osoba fizyczna (Imię... nazwisko, imię ojca, imię matki)"
    if (entry.label?.toLowerCase().includes("osoba fizyczna")) {
      const val = entry.value || "";
      const parts = val.split(",").map((s: string) => s.trim());
      const name = parts[0] || "Nieznany";
      const fatherName = parts[1] || "";
      const motherName = parts[2] || "";
      const pesel = parts[3] || "";
      const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
      const parentsStr = fatherName && motherName
        ? `syn/córka ${titleCase(fatherName)} i ${titleCase(motherName)}`
        : "";

      owners.push({
        id: `own-${owners.length}`,
        name: name.toUpperCase(),
        peselOrRegon: pesel && /^\d{11}$/.test(pesel) ? pesel : "",
        parentsNames: parentsStr,
        share: currentShare || "brak danych",
        basisOfAcquisition: basisText || ""
      });
    }

    // Legal entity: "Inna osoba prawna..."
    if (entry.label?.toLowerCase().includes("inna osoba prawna") || entry.label?.toLowerCase().includes("nazwa")) {
      const val = entry.value || "";
      // Strip "Lp. X. | N |" prefix
      const cleaned = val.replace(/^Lp\.\s*\d+\.\s*\|\s*\d+\s*\|\s*/, "").trim();
      const parts = cleaned.split(",").map((s: string) => s.trim());
      const name = parts[0] || "Nieznany podmiot";
      const city = parts[1] || "";
      const regon = parts[2] || "";

      owners.push({
        id: `own-${owners.length}`,
        name: name.toUpperCase(),
        peselOrRegon: regon ? (regon.replace(/\s/g, "").length <= 14 ? `REGON: ${regon.trim()}` : regon) : "",
        parentsNames: city ? `siedziba: ${city}` : "",
        share: currentShare || "brak danych",
        basisOfAcquisition: basisText || ""
      });
    }
  }

  if (owners.length === 0 && dzialII.rawText) {
    owners.push({
      id: "own-0",
      name: "WŁAŚCICIEL (dane w surowym tekście)",
      peselOrRegon: "",
      parentsNames: "",
      share: "brak danych",
      basisOfAcquisition: ""
    });
  }

  const isPerpetualUsufruct = (dzialII.rawText || "").toLowerCase().includes("użytkow") ||
    rawPropType.includes("użytkow");

  // --- DZIAŁ III ---
  const easements = iiiEntries
    .filter((e: any) => e.label !== "_header" && /służebno|przejazd|przechod/i.test(e.value || ""))
    .map((e: any, i: number) => ({ id: `ease-${i}`, description: e.value }));

  const warnings = iiiEntries
    .filter((e: any) => e.label !== "_header" && /ostrzeżeni|egzekucj|roszczen/i.test(e.value || ""))
    .map((e: any, i: number) => ({ id: `warn-${i}`, description: e.value, caseNumber: "" }));

  const otherRights = iiiEntries
    .filter((e: any) => e.label !== "_header" && !e.label?.startsWith("Lp.") && !e.label?.startsWith("DZ. KW") &&
      e.value?.length > 15 &&
      !easements.some((es: any) => es.description === e.value) &&
      !warnings.some((w: any) => w.description === e.value))
    .map((e: any, i: number) => ({ id: `other-${i}`, description: e.value }));

  // --- DZIAŁ IV: Group by "Lp. X." to build mortgage records ---
  const mortgages: any[] = [];
  let currentMortgage: any = null;

  for (const entry of ivEntries) {
    if (entry.label === "_header") {
      if (entry.value?.includes("Wierzyciel")) {
        // Next entries are creditor info — handled below
      }
      continue;
    }

    if (entry.label?.startsWith("Lp.")) {
      if (currentMortgage && currentMortgage.type) {
        mortgages.push(currentMortgage);
      }
      currentMortgage = {
        id: `mort-${mortgages.length}`,
        type: "",
        amount: 0,
        currency: "PLN",
        creditor: "",
        securesWhat: ""
      };
      continue;
    }

    if (!currentMortgage) continue;

    const label = (entry.label || "").toLowerCase();
    const val = entry.value || "";

    if (label.includes("rodzaj hipoteki") || label.includes("rodzaj roszczenia")) {
      currentMortgage.type = val;
    } else if (label.includes("suma")) {
      // "600000,00 (SZEŚĆSET TYSIĘCY) ZŁ" or "250 000,00 PLN"
      const amtMatch = val.match(/([\d\s.,]+)/);
      if (amtMatch) {
        currentMortgage.amount = parseFloat(amtMatch[1].replace(/\s/g, "").replace(",", "."));
      }
      if (/EUR/i.test(val)) currentMortgage.currency = "EUR";
      else if (/USD/i.test(val)) currentMortgage.currency = "USD";
      else if (/CHF/i.test(val)) currentMortgage.currency = "CHF";
      else currentMortgage.currency = "PLN";
    } else if (label.includes("wierzytelność") || label.includes("stosunek")) {
      const cleaned = val.replace(/^Lp\.\s*\d+\.\s*\|\s*\d+\s*\|\s*/, "").trim();
      currentMortgage.securesWhat = cleaned;
    } else if (label.includes("osoba prawna") || label.includes("nazwa") || label.includes("wierzyciel")) {
      const cleaned = val.replace(/^Lp\.\s*\d+\.\s*\|\s*/, "").trim();
      currentMortgage.creditor = cleaned;
    } else if (label.includes("osoba fizyczna") && !currentMortgage.creditor) {
      currentMortgage.creditor = val;
    }
  }

  if (currentMortgage && currentMortgage.type) {
    mortgages.push(currentMortgage);
  }

  // --- Court name ---
  const courtName = raw.courtName || "";
  const courtParts = courtName.split(",").map((s: string) => s.trim());
  const sadRejonowy = courtParts[0] || courtInfo.court;
  const wydzialKw = courtParts[1] || courtInfo.dept;

  return {
    kwNumber,
    sadRejonowy: sadRejonowy.replace(/\s*-\s*[A-Z0-9]+$/, ""),
    wydzialKw: wydzialKw || courtInfo.dept,
    status: "active" as const,
    dzial1O: {
      location,
      address: streetRaw || "",
      propertyType,
      description,
      plots,
      totalAreaStr: areaStr,
      currentEntryNumber: currentEntryNumberRaw?.split("|")[0]?.trim() || "",
      basisDocuments: basisDocsIO || "",
      joinSeparation: joinSeparationRaw || "",
      notices: ioNotices.length > 0 ? ioNotices : undefined,
      applicationData: applicationDataIO || undefined
    },
    dzial1Sp: {
      hasEntries: !dzialISp.empty,
      shareInJointProperty: shareInJointProp || "",
      associatedRights: iSpAssociated,
      applicationData: applicationDataISp || undefined
    },
    dzial2: {
      owners,
      isPerpetualUsufruct
    },
    dzial3: {
      hasEntries: !dzialIII.empty,
      easements,
      warningsAndExecutions: warnings,
      otherRights
    },
    dzial4: {
      hasEntries: !dzialIV.empty && mortgages.length > 0,
      mortgages
    }
  };
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Helper system prompts
  const GENERATION_SYSTEM_INSTRUCTION = `Jesteś ekspertem prawnym, polskim notariuszem oraz specjalistą ds. analizy ksiąg wieczystych (EKW).
Otrzymujesz surowy, zrzutowany tekst (copy-paste z portalu EKW lub pliku PDF) księgi wieczystej. Twój cel to:
1. Przeanalizować i wyodrębnić precyzyjnie dane ze wszystkich działów: Dział I-O, Dział I-Sp, Dział II, Dział III i Dział IV.
2. Sformatować te dane do żądanej struktury JSON.
3. Wygenerować gotowe teksty draftów notarialnych w 3 stylach napisanym pięknym notarialnym językiem polskim:
   - classic (Tradycyjny notarialny): Bardzo formalny o wysokiej gęstości, pisany z pełnymi formułami, dużymi literami nazwisk, słownie rozpisanymi udziałami ułamkowymi np. "1/2 (jedna druga)", skrótami ("Rep. A", "t.j."), opisujący dokładnie podstawy nabycia oraz PESEL-e.
   - modern (Współczesny): Bardziej czytelny, z podziałem na przejrzyste akapity lub punkty, bardzo elegancki, zachowujący pełen rygor prawny.
   - short (Skrócony): Skondensowany do najważniejszych praw, właścicieli i obciążeń.

Szczegółowe wytyczne:
- Zwracaj szczególną uwagę na udziały właścicieli (np. współwłasność łączna małżeńska, udziały ułamkowe).
- Wyszukaj wzmianki o wnioskach (bardzo istotne dla notariusza!). Jeśli w dziale są wzmianki, dodaj je do ostrzeżeń.
- Wyodrębnij kwoty i waluty obciążeń hipotek (Dział IV) oraz wierzycieli.
- Dopasuj typ nieruchomości (lokal / dzialka / budynek) na podstawie treści działu I-O.
- Zwróć dane ściśle w formacie JSON zgodnym ze schematem. Nie używaj znaczników markdown wokół odpowiedzi jeśli to możliwe (chyba że to standardowy blok JSON).`;

  const SIMULATION_SYSTEM_INSTRUCTION = `Jesteś polskim systemem EKW (Elektroniczne Księgi Wieczyste). Twój cel to wygenerować realistyczny i w 100% poprawny merytorycznie testowy odpis księgi wieczystej o podanym numerze oraz dla wskazanego Sądu Rejonowego.
Wygeneruj dane dla całkowicie nowego fikcyjnego, lecz niezwykle realistycznego przypadku: właściciele (polskie imiona i nazwiska, pasujące rodzice, losowe PESEL-e), hipoteki (np. kredyt w polskim banku), działka ewidencyjna ze współrzędnymi/obrębem lub mieszkanie z udziałem w nieruchomości wspólnej.
Zwróć dane w formacie JSON zgodnym ze wskazanym schematem.`;

  // API Route: Web Crawler Simulator & Custom Simulated/Demo Generation
  app.post("/api/simulate-kw", async (req, res) => {
    const { kwNumber } = req.body;
    if (!kwNumber || typeof kwNumber !== "string") {
      return res.status(400).json({ error: "Brakujący lub niepoprawny numer KW." });
    }

    const normalized = kwNumber.replace(/\s+/g, "").toUpperCase();
    const parts = normalized.split("/");
    const prefix = parts[0];

    const courtInfo = COURT_MAP[prefix] || {
      court: `Sąd Rejonowy dla kodu ${prefix}`,
      dept: "Wydział Ksiąg Wieczystych"
    };

    const client = getDeepseekClient();

    if (!client) {
      console.log("No Deepseek API Key configured. Generating simulated data deterministically.");
      return res.json({
        kwNumber: normalized,
        sadRejonowy: courtInfo.court,
        wydzialKw: courtInfo.dept,
        status: "active",
        dzial1O: {
          location: "województwo mazowieckie, powiat m.st. Warszawa, dzielnica Mokotów",
          address: "ul. Woronicza 15, Warszawa",
          propertyType: "lokal",
          description: "Samodzielny lokal mieszkalny nr 8 na 2. piętrze budynku wielorodzinnego, składający się z przedpokoju, kuchni, łazienki oraz 2 pokoi o powierzchni 48,20 m².",
          plots: [{ number: "12/5", areaSquareMeters: 2310, cadastreUnit: "obręb 1-02-09 Mokotów" }],
          totalAreaStr: "48,20 m²"
        },
        dzial1Sp: {
          hasEntries: true,
          shareInJointProperty: "4820/231000",
          associatedRights: [{ id: "sp-auto", description: "Udział wynoszący 4820/231000 części w nieruchomości wspólnej określonej w KW głównym." }]
        },
        dzial2: {
          owners: [{
            id: "own-auto",
            name: "MARIAN PAWEŁ NOWAK",
            peselOrRegon: "79051502941",
            parentsNames: "syn Henryka i Barbary",
            share: "1/1 (całość)",
            basisOfAcquisition: "Umowa sprzedaży Rep. A nr 9871/2012 przed notariuszem Anną Kowalską w Warszawie."
          }],
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
          mortgages: [{
            id: "mort-auto",
            type: "Hipoteka umowna",
            amount: 250000,
            currency: "PLN",
            creditor: "mBank Spółka Akcyjna z siedzibą w Warszawie",
            securesWhat: "Zabezpieczenie kredytu mieszkaniowego nr 2012-M-112"
          }]
        }
      });
    }

    try {
      const themePrompt = `Wygeneruj realistyczną księgę wieczystą o numerze ${normalized} prowadzoną przez ${courtInfo.court} (${courtInfo.dept}).
Wylosuj realistycznego polskiego właściciela lub parę małżeńską, określ nieruchomość (np. lokal lub działkę budowlaną), dodaj jakieś obciążenie hipoteczne (np. PKO BP, ING lub Santander) lub służebność, tak aby dane wyglądały niezwykle wiarygodnie.

Odpowiedz WYŁĄCZNIE obiektem JSON o następującej strukturze (bez komentarzy, bez markdown):
{
  "kwNumber": "string",
  "sadRejonowy": "string",
  "wydzialKw": "string",
  "status": "string",
  "dzial1O": {
    "location": "string",
    "address": "string",
    "propertyType": "lokal" | "dzialka" | "budynek" | "inne",
    "description": "string",
    "plots": [{ "number": "string", "areaSquareMeters": number, "cadastreUnit": "string" }],
    "totalAreaStr": "string"
  },
  "dzial1Sp": {
    "hasEntries": boolean,
    "shareInJointProperty": "string",
    "associatedRights": [{ "id": "string", "description": "string" }]
  },
  "dzial2": {
    "owners": [{ "id": "string", "name": "string", "peselOrRegon": "string", "parentsNames": "string", "share": "string", "basisOfAcquisition": "string" }],
    "isPerpetualUsufruct": boolean
  },
  "dzial3": {
    "hasEntries": boolean,
    "easements": [{ "id": "string", "description": "string" }],
    "warningsAndExecutions": [{ "id": "string", "description": "string" }],
    "otherRights": [{ "id": "string", "description": "string" }]
  },
  "dzial4": {
    "hasEntries": boolean,
    "mortgages": [{ "id": "string", "type": "string", "amount": number, "currency": "string", "creditor": "string", "securesWhat": "string" }]
  }
}`;

      const response = await client.chat.completions.create({
        model: "deepseek-chat",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SIMULATION_SYSTEM_INSTRUCTION },
          { role: "user", content: themePrompt }
        ],
        temperature: 0.9,
      });

      const dataText = response.choices[0].message.content || "{}";
      const parsedData = JSON.parse(dataText.trim());
      res.json(parsedData);
    } catch (error: any) {
      console.error("Deepseek Simulation error:", error);
      res.status(500).json({ error: "Wystąpił błąd podczas generowania symulacji: " + error.message });
    }
  });

  // API Route: Custom Parse of raw text pasted/copied
  app.post("/api/parse-raw-text", async (req, res) => {
    const { rawText, notarySettings } = req.body;
    if (!rawText || typeof rawText !== "string") {
      return res.status(400).json({ error: "Brak tekstu wejściowego do analizy." });
    }

    const client = getDeepseekClient();

    if (!client) {
      console.log("No Deepseek API Key configured. Simulating parse results deterministically.");
      let foundCourt = "Sąd Rejonowy (Wydział Ksiąg Wieczystych)";
      let foundNumber = "Nierozpoznany nr KW";

      const numberMatches = rawText.match(/[A-Z0-9]{4}\/\d{8}\/\d/);
      if (numberMatches) foundNumber = numberMatches[0];

      const courtMatches = rawText.match(/Sąd Rejonowy\s+w\s+[A-Za-zĘÓĄŚŁŻŹĆŃęóąślżźćń]+/i) ||
                           rawText.match(/Sąd Rejonowy\s+dla\s+[A-Za-zĘÓĄŚŁŻŹĆŃęóąślżźćń\- ]+/i);
      if (courtMatches) foundCourt = courtMatches[0];

      return res.json({
        structured: {
          kwNumber: foundNumber,
          sadRejonowy: foundCourt,
          wydzialKw: "Wydział Ksiąg Wieczystych",
          status: "active",
          dzial1O: {
            location: "Położenie wyekstrahowane z tekstu",
            propertyType: rawText.toLowerCase().includes("lokal") ? "lokal" : "dzialka",
            description: "Przykładowy opis wyciągnięty z Twojego tekstu: " + (rawText.substring(0, 300) + "..."),
            plots: [{ number: "Wykryta z tekstu", areaSquareMeters: 500 }],
            totalAreaStr: "500 m²"
          },
          dzial1Sp: { hasEntries: false, associatedRights: [] },
          dzial2: {
            owners: [{
              id: "own-1",
              name: "WYKRYTY WŁAŚCICIEL / WSPÓŁWŁAŚCICIEL",
              peselOrRegon: "PESEL weryfikowany w tekście",
              parentsNames: "rodzice",
              share: "1/1",
              basisOfAcquisition: "Decyzja lub akt prawny ze spisanego tekstu."
            }],
            isPerpetualUsufruct: false
          },
          dzial3: { hasEntries: false, easements: [], warningsAndExecutions: [], otherRights: [] },
          dzial4: { hasEntries: false, mortgages: [] }
        },
        drafts: {
          classic: `Z księgi wieczystej numer ${foundNumber} prowadzonej przez ${foundCourt} wynika, że: w Dziale I-O wpisany jest lokal stanowiący odrębną nieruchomość. W dziale II jako właściciel wpisana jest osoba z wyekstrahowanego tekstu w udziale wynoszącym 1/1 (jedna druga) część na podstawie aktu notarialnego. Dział III oraz Dział IV nie wykazują wpisów. (Brak klucza Deepseek API - wygenerowano uproszczony podgląd parsera)`,
          modern: `Opis na podstawie Księgi Wieczystej ${foundNumber}:\n\n1. Oznaczenie nieruchomości: Lokal / Działka.\n2. Własność: Ujawniono właścicieli zgodnie z przesłanym dokumentem.\n3. Prawa i obciążenia: Działy III i IV są wolne od wpisów w tym uproszczonym podglądzie.`,
          short: `KW ${foundNumber}: Własność 1/1. Działy III i IV: Brak wpisów w darmowym podglądzie.`
        }
      });
    }

    try {
      const prompt = `Analizuj następujący tekst surowej księgi wieczystej:
--- TEKST START ---
${rawText}
--- TEKST KONIEC ---

Ustawienia personalizacji aktu dla Notariusza (zastosuj je w wygenerowanych tekstach):
- Uwzględniaj PESEL-e: ${notarySettings?.includePesels ? "TAK" : "NIE"}
- Uwzględniaj dokładne podstawy nabycia: ${notarySettings?.includeAcquisitionBasis ? "TAK" : "NIE"}
- Stosuj skróty urzędowe/prawne (np. t.j., Dz.U., m.st., lok.): ${notarySettings?.useAbbreviations ? "TAK" : "NIE"}
- Pisz imiona i nazwiska właścicieli Wielkimi Literami: ${notarySettings?.uppercaseNames ? "TAK" : "NIE"}
- Rozpisuj ułamki słownie (np. "1/2 (jedna druga) część"): ${notarySettings?.spellOutNumbers ? "TAK" : "NIE"}

Odpowiedz WYŁĄCZNIE obiektem JSON (bez markdown, bez komentarzy) o następującej strukturze:
{
  "structured": {
    "kwNumber": "wyciągnięty numer KW",
    "sadRejonowy": "Sąd prowadzący",
    "wydzialKw": "Wydział sądu",
    "status": "active",
    "dzial1O": {
      "location": "położenie nieruchomości",
      "address": "dokładny adres jeśli podany",
      "propertyType": "lokal" | "dzialka" | "budynek" | "inne",
      "description": "dokładny opis lokalu/działek",
      "plots": [{ "number": "nr działki", "areaSquareMeters": number, "cadastreUnit": "obręb" }],
      "totalAreaStr": "powierzchnia np. 64,50 m² lub 0,1234 ha"
    },
    "dzial1Sp": {
      "hasEntries": boolean,
      "shareInJointProperty": "udział w nieruchomości wspólnej np. 12/1000",
      "associatedRights": [{ "id": "string", "description": "string" }]
    },
    "dzial2": {
      "owners": [{ "id": "string", "name": "string", "peselOrRegon": "string", "parentsNames": "string", "share": "string", "basisOfAcquisition": "string" }],
      "isPerpetualUsufruct": boolean
    },
    "dzial3": {
      "hasEntries": boolean,
      "easements": [{ "id": "string", "description": "string" }],
      "warningsAndExecutions": [{ "id": "string", "description": "string" }],
      "otherRights": [{ "id": "string", "description": "string" }]
    },
    "dzial4": {
      "hasEntries": boolean,
      "mortgages": [{ "id": "string", "type": "string", "amount": number, "currency": "string", "creditor": "string", "securesWhat": "string" }]
    }
  },
  "drafts": {
    "classic": "Tekst Klasycznego aktu notarialnego w języku polskim — formalny, z pełnymi formułami",
    "modern": "Tekst Współczesnego aktu notarialnego — czytelny, elegancki, z podziałem na punkty",
    "short": "Tekst Skróconego opisu — tylko najważniejsze fakty"
  }
}`;

      const response = await client.chat.completions.create({
        model: "deepseek-chat",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: GENERATION_SYSTEM_INSTRUCTION },
          { role: "user", content: prompt }
        ],
        temperature: 0.4,
      });

      const responseText = response.choices[0].message.content || "{}";
      const parsedOutput = JSON.parse(responseText.trim());
      res.json(parsedOutput);
    } catch (error: any) {
      console.error("Deepseek Raw Parse error:", error);
      res.status(500).json({ error: "Błąd podczas analizowania tekstu przez model AI: " + error.message });
    }
  });

  // API Route: Fetch real KW data from Apify EKW scraper
  app.post("/api/fetch-kw", async (req, res) => {
    const { kwNumber, viewType: reqViewType } = req.body;
    if (!kwNumber || typeof kwNumber !== "string") {
      return res.status(400).json({ error: "Brakujący lub niepoprawny numer KW." });
    }
    const apifyViewType = reqViewType === "aktualna" ? "aktualna" : "zupelna";

    const apifyToken = process.env.APIFY_API_TOKEN;
    if (!apifyToken) {
      return res.status(500).json({ error: "Brak skonfigurowanego tokenu Apify API (APIFY_API_TOKEN)." });
    }

    const normalized = kwNumber.replace(/\s+/g, "").toUpperCase();
    const prefix = normalized.split("/")[0];
    const courtInfo = COURT_MAP[prefix] || {
      court: `Sąd Rejonowy dla kodu ${prefix}`,
      dept: "Wydział Ksiąg Wieczystych"
    };

    try {
      console.log(`[Apify] Fetching KW: ${normalized} (viewType: ${apifyViewType})`);

      const apifyData = await new Promise<any[]>((resolve, reject) => {
        const postBody = JSON.stringify({
          kwNumbers: [normalized],
          viewType: apifyViewType,
          maxConcurrency: 1
        });

        const req = https.request(
          `https://api.apify.com/v2/acts/regdata~ekw-ksiegi-wieczyste-scraper/run-sync-get-dataset-items?token=${apifyToken}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(postBody),
            },
            timeout: 180_000,
          },
          (response) => {
            let body = "";
            response.on("data", (chunk: string) => { body += chunk; });
            response.on("end", () => {
              if (response.statusCode && response.statusCode >= 400) {
                console.error("[Apify] HTTP error:", response.statusCode, body.substring(0, 300));
                reject(new Error(`Apify HTTP ${response.statusCode}: ${body.substring(0, 200)}`));
                return;
              }
              try {
                resolve(JSON.parse(body));
              } catch (e) {
                reject(new Error("Apify zwróciło niepoprawny JSON"));
              }
            });
          }
        );

        req.on("error", (err) => {
          console.error("[Apify] Request error:", err.message);
          reject(err);
        });
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Timeout 180s — Apify nie odpowiedziało w czasie"));
        });

        req.write(postBody);
        req.end();
      });

      console.log(`[Apify] Got ${apifyData?.length || 0} items`);

      if (!apifyData || apifyData.length === 0) {
        return res.status(404).json({ error: "Apify nie zwróciło danych dla podanego numeru KW. Sprawdź poprawność numeru." });
      }

      const raw = apifyData[0];

      if (raw.error || raw.status === "error") {
        return res.status(422).json({ error: `Błąd ekstrakcji EKW: ${raw.error || raw.message || "Nieznany błąd"}` });
      }

      const mapped = mapApifyToKWData(raw, normalized, courtInfo);
      res.json({ mapped, raw });
    } catch (error: any) {
      console.error("[Apify] Fetch error:", error.message);
      res.status(500).json({ error: "Błąd połączenia z Apify: " + error.message });
    }
  });

  // Serve static assets in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
