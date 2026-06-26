/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
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

// Extract the actual data value from Apify's pipe-separated format
// e.g. "1. | 1 | --- | ŚLĄSKIE" → "ŚLĄSKIE"
// e.g. "1. | --- | --- | ---" → ""
function extractVal(rawValue: string): string {
  if (!rawValue) return "";
  const parts = rawValue.split("|").map(s => s.trim());
  const last = parts[parts.length - 1];
  return (!last || last === "---") ? "" : last;
}

// Find entry by label pattern and extract the clean value
function findEntry(entries: any[], labelPattern: string | RegExp): string {
  if (!entries || !Array.isArray(entries)) return "";
  const entry = entries.find((e: any) => {
    if (e.label === "_header") return false;
    if (typeof labelPattern === "string") return e.label?.toLowerCase().includes(labelPattern.toLowerCase());
    return labelPattern.test(e.label || "");
  });
  return entry ? extractVal(entry.value) : "";
}

function findEntryRaw(entries: any[], labelPattern: string | RegExp): string {
  if (!entries || !Array.isArray(entries)) return "";
  const entry = entries.find((e: any) => {
    if (e.label === "_header") return false;
    if (typeof labelPattern === "string") return e.label?.toLowerCase().includes(labelPattern.toLowerCase());
    return labelPattern.test(e.label || "");
  });
  return entry?.value || "";
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

  // ======================== DZIAŁ I-O ========================
  const wojewodztwo = findEntry(ioEntries, "województwo");
  const powiat = findEntry(ioEntries, "powiat");
  const gmina = findEntry(ioEntries, "gmina");
  const miejscowosc = findEntry(ioEntries, "miejscowość");
  const dzielnica = findEntry(ioEntries, "dzielnica");
  const streetRaw = findEntry(ioEntries, "ulica");

  const locationParts = [wojewodztwo, powiat, gmina, miejscowosc, dzielnica].filter(Boolean);
  const location = locationParts.length > 0
    ? locationParts.join(", ")
    : extractVal(findEntryRaw(ioEntries, "położenie")) || "";

  const plotNumber = findEntry(ioEntries, "numer działki");
  const plotIdentifier = findEntry(ioEntries, "identyfikator działki");
  const obrebNumer = findEntry(ioEntries, /numer obrębu|obręb ewidencyjny/);
  const obrebNazwa = findEntry(ioEntries, /nazwa obrębu/);
  const obreb = [obrebNumer, obrebNazwa].filter(Boolean).join(" ");
  const usageRaw = findEntry(ioEntries, "sposób korzystania");
  const buildingPurpose = findEntry(ioEntries, "przeznaczenie budynku");
  const currentEntryNumberRaw = findEntry(ioEntries, "numer bieżący nieruchomości");

  // Przyłączenie — extract KW number and area
  const joinKWRaw = findEntryRaw(ioEntries, "przyłączenie");
  const joinKW = extractVal(joinKWRaw);
  const joinAreaEntry = ioEntries.find((e: any, idx: number) => {
    if (e.label !== "Obszar") return false;
    const prevEntries = ioEntries.slice(Math.max(0, idx - 5), idx);
    return prevEntries.some((p: any) => p.label?.includes("Przyłączenie"));
  });
  const joinArea = joinAreaEntry ? extractVal(joinAreaEntry.value) : "";
  const joinSeparation = joinKW ? `${joinKW}${joinArea ? ` (${joinArea})` : ""}` : "";

  // Area — from Rubryka 1.5
  const areaRaw = findEntry(ioEntries, /^\d*\.?\s*obszar$/i) || findEntry(ioEntries, "obszar");
  let areaSqm = 0;
  const areaMatchM2 = areaRaw.match(/([\d\s.,]+)\s*M2/i);
  const areaMatchHA = areaRaw.match(/([\d,.]+)\s*HA/i);
  if (areaMatchM2) {
    areaSqm = parseFloat(areaMatchM2[1].replace(/\s/g, "").replace(",", "."));
  } else if (areaMatchHA) {
    areaSqm = parseFloat(areaMatchHA[1].replace(",", ".")) * 10000;
  }
  const areaStr = areaSqm >= 10000
    ? `${(areaSqm / 10000).toFixed(4).replace(".", ",")} ha (${Math.round(areaSqm).toLocaleString("pl-PL")} m²)`
    : areaSqm > 0 ? `${Math.round(areaSqm).toLocaleString("pl-PL")} m²` : areaRaw;

  const plots = plotNumber ? [{
    number: plotNumber,
    areaSquareMeters: Math.round(areaSqm),
    cadastreUnit: obreb || "",
    identifier: plotIdentifier || "",
    landUse: usageRaw || ""
  }] : [];

  // Property type detection
  const rawPropType = (raw.propertyType || "").toLowerCase();
  const ioRawLower = (dzialIO.rawText || "").toLowerCase();
  let propertyType: "lokal" | "dzialka" | "budynek" | "inne" = "inne";
  if (rawPropType.includes("lokal") || ioRawLower.includes("lokal")) propertyType = "lokal";
  else if (rawPropType.includes("grunt") || usageRaw || plotNumber) propertyType = "dzialka";
  else if (rawPropType.includes("budyn") || ioRawLower.includes("budyn")) propertyType = "budynek";

  const description = [buildingPurpose, usageRaw].filter(Boolean).join(". ") || "";

  // Basis documents from WNIOSKI section
  const basisDocsIO = ioEntries
    .filter((e: any) => e.label !== "_header" && /podstawa oznaczenia/i.test(e.value || ""))
    .map((e: any) => extractVal(e.value))
    .filter(Boolean)
    .join("; ");

  // Application data from WNIOSKI section
  const ioAppData = ioEntries
    .filter((e: any) => /^[\d]+$/.test(e.label || "") && /dane o wniosku/i.test(e.value || ""))
    .map((e: any) => {
      const match = (e.value || "").match(/DZ\.\s*KW\.?\s*\/?\s*(.+)/i);
      return match ? `DZ. KW. ${match[1].trim()}` : e.value;
    })
    .join("; ");

  // Notices (wzmianki) — check if there are actual wzmianki (not just "Brak wpisu")
  const ioNotices: string[] = [];
  let inWzmianki = false;
  for (const e of ioEntries) {
    if (e.label === "_header" && /wzmianki/i.test(e.value || "")) { inWzmianki = true; continue; }
    if (e.label === "_header" && /rubryka\s+\d/i.test(e.value || "") && !/wzmianki/i.test(e.value || "")) { inWzmianki = false; continue; }
    if (inWzmianki && e.label !== "_header" && e.value && !/brak wpisu/i.test(e.value)) {
      ioNotices.push(e.value);
    }
  }

  // ======================== DZIAŁ I-Sp ========================
  const shareInJointProp = findEntry(iSpEntries, /udział.*nieruchomości wspólnej|wielkość udziału/) ||
    findEntry(iSpEntries, "udział");
  const iSpAssociated = iSpEntries
    .filter((e: any) => e.label !== "_header" && !e.label?.startsWith("Lp.") &&
      !/^(Numer|Wpisu)/.test(e.label || "") &&
      !e.label?.toLowerCase().includes("udział") && extractVal(e.value).length > 5)
    .map((e: any, i: number) => ({
      id: `sp-${i}`,
      description: extractVal(e.value)
    }));
  const applicationDataISp = iSpEntries
    .filter((e: any) => /^[\d]+$/.test(e.label || "") && /dane o wniosku/i.test(e.value || ""))
    .map((e: any) => e.value).join("; ");

  // ======================== DZIAŁ II ========================
  const owners: any[] = [];
  let currentShare = "";
  let currentShareType = "";
  let ownerFirstName = "";
  let ownerSecondName = "";
  let ownerSurname = "";
  let ownerSurname2 = "";
  let ownerFather = "";
  let ownerMother = "";
  let ownerPesel = "";
  let inPersonSection = false;
  let basisText = "";

  // Extract basis of acquisition from WNIOSKI section
  for (const entry of iiEntries) {
    if (entry.label !== "_header" && /wskazanie podstawy/i.test(entry.value || "")) {
      const val = extractVal(entry.value);
      if (val) basisText = val;
    }
  }

  for (let i = 0; i < iiEntries.length; i++) {
    const entry = iiEntries[i];
    const label = entry.label || "";
    const value = entry.value || "";

    // Share section
    if (/wielkość udziału/i.test(label)) {
      const shareVal = extractVal(value);
      const shareMatch = shareVal.match(/(\d+)\s*\/\s*(\d+)/);
      currentShare = shareMatch ? `${shareMatch[1]}/${shareMatch[2]}` : shareVal || "brak danych";
    }
    if (/rodzaj wspólności/i.test(label)) {
      currentShareType = extractVal(value);
      if (currentShareType) currentShare += ` (${currentShareType.toLowerCase()})`;
    }

    // Person fields (Podrubryka 2.2.5)
    if (entry.label === "_header" && /osoba fizyczna/i.test(value)) {
      inPersonSection = true;
      ownerFirstName = ownerSecondName = ownerSurname = ownerSurname2 = ownerFather = ownerMother = ownerPesel = "";
      continue;
    }

    if (inPersonSection) {
      if (/imię pierwsze/i.test(label)) ownerFirstName = extractVal(value);
      else if (/imię drugie/i.test(label)) ownerSecondName = extractVal(value);
      else if (/nazwisko.*pierwszy człon|^4\.\s*nazwisko/i.test(label)) ownerSurname = extractVal(value);
      else if (/drugi człon/i.test(label)) ownerSurname2 = extractVal(value);
      else if (/imię ojca/i.test(label)) ownerFather = extractVal(value);
      else if (/imię matki/i.test(label)) ownerMother = extractVal(value);
      else if (/pesel/i.test(label)) {
        ownerPesel = extractVal(value);
        // PESEL is the last field — finalize this owner
        const fullName = [ownerFirstName, ownerSecondName, ownerSurname, ownerSurname2].filter(Boolean).join(" ");
        const titleCase = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";
        const parentsStr = ownerFather || ownerMother
          ? `syn/córka ${titleCase(ownerFather)}${ownerFather && ownerMother ? " i " : ""}${titleCase(ownerMother)}`
          : "";

        owners.push({
          id: `own-${owners.length}`,
          name: fullName.toUpperCase(),
          peselOrRegon: /^\d{11}$/.test(ownerPesel) ? ownerPesel : "",
          parentsNames: parentsStr,
          share: currentShare || "brak danych",
          basisOfAcquisition: basisText || ""
        });
        inPersonSection = false;
      }
    }

    // Legal entity (Podrubryka 2.2.4)
    if (entry.label === "_header" && /inna osoba prawna/i.test(value)) {
      // Look ahead for Nazwa, Siedziba, REGON
      let entityName = "", entityCity = "", entityRegon = "";
      for (let j = i + 1; j < Math.min(i + 15, iiEntries.length); j++) {
        const nextLabel = (iiEntries[j].label || "").toLowerCase();
        if (/^1\.\s*$/.test(iiEntries[j].label || "") && /nazwa/i.test(iiEntries[j].value || "")) {
          entityName = extractVal(iiEntries[j].value);
        }
        if (/nazwa/i.test(nextLabel) && !/^_header$/.test(iiEntries[j].label)) {
          entityName = extractVal(iiEntries[j].value);
        }
        if (/siedziba/i.test(nextLabel)) entityCity = extractVal(iiEntries[j].value);
        if (/regon/i.test(nextLabel)) entityRegon = extractVal(iiEntries[j].value);
        if (iiEntries[j].label === "_header" && /podrubryka|rubryka/i.test(iiEntries[j].value || "")) break;
      }
      if (entityName) {
        owners.push({
          id: `own-${owners.length}`,
          name: entityName.toUpperCase(),
          peselOrRegon: entityRegon ? `REGON: ${entityRegon}` : "",
          parentsNames: entityCity ? `siedziba: ${entityCity}` : "",
          share: currentShare || "brak danych",
          basisOfAcquisition: basisText || ""
        });
      }
    }
  }

  if (owners.length === 0 && !dzialII.empty) {
    owners.push({
      id: "own-0",
      name: "WŁAŚCICIEL (dane w surowym tekście)",
      peselOrRegon: "",
      parentsNames: "",
      share: "brak danych",
      basisOfAcquisition: basisText || ""
    });
  }

  const isPerpetualUsufruct = iiEntries.some((e: any) => /użytkownik wieczysty/i.test(e.value || "")) ||
    rawPropType.includes("użytkow");

  // Notices in Dział II
  const iiNotices: string[] = [];
  let inIIWzmianki = false;
  for (const e of iiEntries) {
    if (e.label === "_header" && /wzmianki/i.test(e.value || "")) { inIIWzmianki = true; continue; }
    if (e.label === "_header" && /rubryka\s+2\.[2-9]/i.test(e.value || "")) { inIIWzmianki = false; continue; }
    if (inIIWzmianki && e.label !== "_header" && !/brak wpisu/i.test(e.value || "") && e.value) {
      iiNotices.push(e.value);
    }
  }

  // Application data for Dział II
  const iiAppData = iiEntries
    .filter((e: any) => /chwila wpływu/i.test(e.label || ""))
    .map((e: any) => extractVal(e.value))
    .filter(Boolean)
    .join("; ");

  // ======================== DZIAŁ III ========================
  const easements: any[] = [];
  const warnings: any[] = [];
  const otherRights: any[] = [];
  const iiiNotices: string[] = [];

  if (!dzialIII.empty) {
    let inIIIWzmianki = false;
    for (const e of iiiEntries) {
      if (e.label === "_header" && /wzmianki/i.test(e.value || "")) { inIIIWzmianki = true; continue; }
      if (e.label === "_header" && /rubryka\s+3\.[2-9]/i.test(e.value || "")) { inIIIWzmianki = false; continue; }
      if (inIIIWzmianki && e.label !== "_header" && !/brak wpisu/i.test(e.value || "") && e.value) {
        iiiNotices.push(e.value);
      }
    }

    for (const entry of iiiEntries) {
      if (entry.label === "_header") continue;
      const val = extractVal(entry.value);
      if (!val || val.length < 10) continue;

      if (/służebno|przejazd|przechod|droga/i.test(val)) {
        easements.push({ id: `ease-${easements.length}`, description: val });
      } else if (/ostrzeżeni|egzekucj|roszczen|zakaz/i.test(val)) {
        warnings.push({ id: `warn-${warnings.length}`, description: val, caseNumber: "" });
      } else if (!/^(Numer|Wpisu|Indeks|Lp\.)/i.test(entry.label || "")) {
        otherRights.push({ id: `other-${otherRights.length}`, description: val });
      }
    }
  }

  // ======================== DZIAŁ IV ========================
  const mortgages: any[] = [];
  const ivNotices: string[] = [];

  // Parse wzmianki in Dział IV (Rubryka 4.1)
  let inIVWzmianki = false;
  let currentWzmiankaDesc = "";
  for (const e of ivEntries) {
    if (e.label === "_header" && /rubryka 4\.1.*wzmianki/i.test(e.value || "")) { inIVWzmianki = true; continue; }
    if (e.label === "_header" && /rubryka 4\.[2-9]/i.test(e.value || "")) { inIVWzmianki = false; continue; }
    if (inIVWzmianki && e.label !== "_header" && !/brak wpisu/i.test(e.value || "")) {
      if (/numer wzmianki/i.test(e.label || "")) {
        currentWzmiankaDesc = extractVal(e.value);
      }
      if (/opis wzmianki/i.test(e.label || "")) {
        ivNotices.push(`${e.value}${currentWzmiankaDesc ? ` (${currentWzmiankaDesc})` : ""}`);
      }
    }
  }

  // Parse mortgages — split by "Rubryka 4.2 - Numer hipoteki" headers
  let currentMortgage: any = null;
  let inCreditorSection = false;

  for (const entry of ivEntries) {
    // New mortgage starts at "Rubryka 4.2 - Numer hipoteki"
    if (entry.label === "_header" && /rubryka 4\.2.*numer hipoteki/i.test(entry.value || "")) {
      if (currentMortgage && currentMortgage.type) {
        mortgages.push(currentMortgage);
      }
      currentMortgage = {
        id: `mort-${mortgages.length}`,
        type: "",
        amount: 0,
        currency: "PLN",
        creditor: "",
        creditorCity: "",
        creditorRegon: "",
        securesWhat: "",
        sumInWords: "",
        interestRate: "",
        coEncumberedKW: "",
        entryNumber: ""
      };
      inCreditorSection = false;
      continue;
    }

    if (!currentMortgage) continue;

    const label = (entry.label || "");
    const labelLower = label.toLowerCase();

    // Skip header separators
    if (label === "_header") {
      if (/wierzyciel/i.test(entry.value || "")) inCreditorSection = true;
      if (/podrubryka 4\.4\.[2-5]/i.test(entry.value || "")) inCreditorSection = true;
      if (/rubryka 4\.[5-9]/i.test(entry.value || "")) inCreditorSection = false;
      continue;
    }
    if (/^(Lp\.|Numer i nazwa|Wpisu)/.test(label)) continue;

    const val = extractVal(entry.value);
    if (!val) continue;

    // Mortgage number
    if (/numer hipoteki/i.test(labelLower)) {
      currentMortgage.entryNumber = val;
    }
    // Mortgage type
    else if (/rodzaj hipoteki/i.test(labelLower)) {
      currentMortgage.type = val;
    }
    // Amount (take first occurrence only)
    else if (/^2\.\s*suma$/i.test(label.trim()) && currentMortgage.amount === 0) {
      const amtMatch = val.match(/([\d\s.,]+)/);
      if (amtMatch) {
        currentMortgage.amount = parseFloat(amtMatch[1].replace(/\s/g, "").replace(",", "."));
      }
    }
    // Amount in words
    else if (/suma słownie/i.test(labelLower) && !currentMortgage.sumInWords) {
      currentMortgage.sumInWords = val;
    }
    // Currency
    else if (/waluta sumy/i.test(labelLower)) {
      const cur = val.toUpperCase();
      if (cur.includes("EUR")) currentMortgage.currency = "EUR";
      else if (cur.includes("USD")) currentMortgage.currency = "USD";
      else if (cur.includes("CHF")) currentMortgage.currency = "CHF";
      else currentMortgage.currency = "PLN";
    }
    // Interest rate
    else if (/rodzaj odsetek/i.test(labelLower) || /wysokość odsetek/i.test(labelLower)) {
      if (val) currentMortgage.interestRate = (currentMortgage.interestRate ? currentMortgage.interestRate + " " : "") + val;
    }
    // Debt description
    else if (/^b:\s*wierzytelność/i.test(label.trim()) && !currentMortgage.securesWhat) {
      currentMortgage.securesWhat = val;
    }
    // Co-encumbered book
    else if (/nr księgi wieczystej/i.test(labelLower) || (/księga współobciążona/i.test(labelLower))) {
      if (val && val !== "/ /") currentMortgage.coEncumberedKW = val.replace(/\s+/g, "");
    }
    // Creditor info (inside Podrubryka 4.4.2-4.4.5)
    else if (inCreditorSection) {
      if (/^1\.\s*$/.test(label) && /nazwa/i.test(entry.value || "")) {
        currentMortgage.creditor = val;
      } else if (/siedziba/i.test(labelLower)) {
        currentMortgage.creditorCity = val;
      } else if (/regon/i.test(labelLower)) {
        currentMortgage.creditorRegon = val;
      }
    }
  }

  if (currentMortgage && currentMortgage.type) {
    mortgages.push(currentMortgage);
  }

  // Format creditor strings
  for (const m of mortgages) {
    if (m.creditorCity && m.creditor) {
      m.creditor = `${m.creditor}, ${m.creditorCity}`;
    }
    if (m.creditorRegon) {
      m.creditor += ` (REGON: ${m.creditorRegon})`;
    }
    delete m.creditorCity;
    delete m.creditorRegon;
    delete m.sumInWords;
    delete m.coEncumberedKW;
  }

  // Application data for Dział IV
  const ivAppData = ivEntries
    .filter((e: any) => /chwila wpływu/i.test(e.label || ""))
    .map((e: any) => extractVal(e.value))
    .filter(Boolean)
    .join("; ");

  // ======================== COURT NAME ========================
  const courtName = raw.courtName || "";
  const sadRejonowy = courtInfo.court;
  const wydzialKw = courtInfo.dept;

  return {
    kwNumber,
    sadRejonowy,
    wydzialKw,
    status: "active" as const,
    dzial1O: {
      location,
      address: streetRaw ? `ul. ${streetRaw}` : "",
      propertyType,
      description,
      plots,
      totalAreaStr: areaStr,
      currentEntryNumber: currentEntryNumberRaw || "",
      basisDocuments: basisDocsIO || "",
      joinSeparation: joinSeparation || "",
      notices: ioNotices.length > 0 ? ioNotices : undefined,
      applicationData: ioAppData || undefined
    },
    dzial1Sp: {
      hasEntries: !dzialISp.empty,
      shareInJointProperty: shareInJointProp || "",
      associatedRights: iSpAssociated,
      applicationData: applicationDataISp || undefined
    },
    dzial2: {
      owners,
      isPerpetualUsufruct,
      notices: iiNotices.length > 0 ? iiNotices : undefined,
      applicationData: iiAppData || undefined
    },
    dzial3: {
      hasEntries: !dzialIII.empty,
      easements,
      warningsAndExecutions: warnings,
      otherRights,
      notices: iiiNotices.length > 0 ? iiiNotices : undefined
    },
    dzial4: {
      hasEntries: !dzialIV.empty && mortgages.length > 0,
      mortgages,
      notices: ivNotices.length > 0 ? ivNotices : undefined,
      applicationData: ivAppData || undefined
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

      // --- DIAGNOSTIC: dump raw Apify structure ---
      if (apifyData && apifyData.length > 0) {
        const raw0 = apifyData[0];
        console.log(`[Apify DEBUG] Top-level keys: ${Object.keys(raw0).join(", ")}`);
        for (const key of Object.keys(raw0)) {
          const val = raw0[key];
          if (val && typeof val === "object" && !Array.isArray(val)) {
            console.log(`[Apify DEBUG] ${key} => object keys: ${Object.keys(val).join(", ")}`);
            if (val.entries && Array.isArray(val.entries)) {
              console.log(`[Apify DEBUG]   ${key}.entries count: ${val.entries.length}`);
              for (let i = 0; i < Math.min(5, val.entries.length); i++) {
                console.log(`[Apify DEBUG]   ${key}.entries[${i}]: ${JSON.stringify(val.entries[i]).substring(0, 200)}`);
              }
            }
            if (val.sections && Array.isArray(val.sections)) {
              console.log(`[Apify DEBUG]   ${key}.sections count: ${val.sections.length}`);
              for (let i = 0; i < Math.min(3, val.sections.length); i++) {
                const sec = val.sections[i];
                console.log(`[Apify DEBUG]   ${key}.sections[${i}]: name=${sec.name || sec.title || "?"}, keys=${Object.keys(sec).join(",")}, entries=${sec.entries?.length || 0}`);
              }
            }
          } else if (Array.isArray(val)) {
            console.log(`[Apify DEBUG] ${key} => array[${val.length}]`);
            if (val.length > 0) console.log(`[Apify DEBUG]   ${key}[0]: ${JSON.stringify(val[0]).substring(0, 200)}`);
          } else {
            console.log(`[Apify DEBUG] ${key} => ${JSON.stringify(val).substring(0, 150)}`);
          }
        }
        // Save full raw response to file for analysis
        const debugPath = path.join(process.cwd(), `apify_raw_${normalized.replace(/\//g, "_")}.json`);
        fs.writeFileSync(debugPath, JSON.stringify(raw0, null, 2), "utf-8");
        console.log(`[Apify DEBUG] Full raw response saved to: ${debugPath}`);
      }

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
