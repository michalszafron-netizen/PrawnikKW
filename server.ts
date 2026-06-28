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
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    });
  }
  return deepseekClient;
}

// LLM model used for generation/correction. Configurable via env so we can switch
// models without code changes. Default is DeepSeek's current model
// "deepseek-v4-flash" (the legacy "deepseek-chat"/"deepseek-reasoner" aliases are
// scheduled for deprecation on 2026-07-24). Set DEEPSEEK_MODEL=deepseek-v4-pro for
// the higher-capability variant, or point DEEPSEEK_BASE_URL at another provider.
const LLM_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

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

// Bump whenever mapApifyToKWData() parsing logic changes — used to invalidate
// stale localStorage cache entries that were mapped with an older parser.
const PARSER_VERSION = 9;

// Extract the actual data value from Apify's pipe-separated format
// e.g. "1. | 1 | --- | ŚLĄSKIE" → "ŚLĄSKIE"
// e.g. "1. | --- | --- | ---" → ""
function extractVal(rawValue: string): string {
  if (!rawValue) return "";
  const parts = rawValue.split("|").map(s => s.trim());
  const last = parts[parts.length - 1];
  return (!last || last === "---") ? "" : last;
}

// In the "aktualna" (current) EKW view many fields are encoded as
// "<VALUE> | <Nr podstawy wpisu>", i.e. the real value is the FIRST segment
// (the opposite of the "zupełna" view, where extractVal()'s last segment wins).
function firstSeg(rawValue: string): string {
  if (!rawValue) return "";
  const first = rawValue.split("|")[0]?.trim();
  return (!first || first === "---") ? "" : first;
}

// Recover the "Komentarz do migracji" (field A) from a dział's rawText. The
// scraper frequently drops this long field from the structured entries (keeping
// only field B), but it survives in rawText. Field A label ends with
// "...przeniesione z dotychczasowej księgi wieczystej"; value runs to "B: Ostatni numer".
function extractMigrationComment(rawText: string): string {
  if (!rawText) return "";
  const m = rawText.match(
    /przeniesione z dotychczasowej księgi wieczystej\s*([\s\S]*?)\s*B:\s*Ostatni numer/
  );
  if (!m) return "";
  return (m[1] || "").replace(/^\s*\d+\.\s*-*\s*/, "").trim();
}

// Find entry by label pattern and extract the clean value.
// A label can appear multiple times in the same Dział (e.g. "Obszar" shows up once
// as an empty placeholder near "Odłączenie" and again with the real value near
// "Przyłączenie") — prefer the first match that actually has a value.
function findEntry(entries: any[], labelPattern: string | RegExp): string {
  if (!entries || !Array.isArray(entries)) return "";
  const matches = entries.filter((e: any) => {
    if (e.label === "_header") return false;
    if (typeof labelPattern === "string") return e.label?.toLowerCase().includes(labelPattern.toLowerCase());
    return labelPattern.test(e.label || "");
  });
  if (matches.length === 0) return "";
  const nonEmpty = matches.find((e: any) => extractVal(e.value));
  return extractVal((nonEmpty || matches[0]).value);
}

// Some "Lp." table rows embed the field name inside `value` instead of `label`
// (e.g. label "1.", value "1. Identyfikator działki | 1. | 1 | --- | ACTUAL").
// Match against the field-name prefix of the value and extract the last segment.
function findEntryByValuePrefix(entries: any[], fieldNamePattern: string | RegExp): string {
  if (!entries || !Array.isArray(entries)) return "";
  const matches = entries.filter((e: any) => {
    if (e.label === "_header") return false;
    const firstSegment = (e.value || "").split("|")[0].trim().replace(/^\d+\.\s*/, "");
    if (typeof fieldNamePattern === "string") return firstSegment.toLowerCase().includes(fieldNamePattern.toLowerCase());
    return fieldNamePattern.test(firstSegment);
  });
  if (matches.length === 0) return "";
  const nonEmpty = matches.find((e: any) => extractVal(e.value));
  return extractVal((nonEmpty || matches[0]).value);
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

// Determine which sub-rubrics of "Rubryka 1.4 - Oznaczenie" actually carry data.
//
// The Dział I-O entry list always contains the structural sub-rubric headers
// (1.4.1 Działka ewidencyjna, 1.4.2 Budynek, 1.4.3 Urządzenie, 1.4.4 Lokal), each
// either followed by real field entries or by a "Brak wpisu" header. We walk the
// list, remember the current sub-rubric, and flag it as present once we encounter
// a non-header entry holding an actual value. This keeps property-type detection
// driven by content rather than by the mere presence of section labels, so new
// księgi of any kind classify correctly.
function detectRubryka14Sections(ioEntries: any[]): {
  dzialka: boolean;
  budynek: boolean;
  urzadzenie: boolean;
  lokal: boolean;
} {
  const present = { dzialka: false, budynek: false, urzadzenie: false, lokal: false };
  if (!Array.isArray(ioEntries)) return present;

  let section: keyof typeof present | "" = "";
  for (const e of ioEntries) {
    const value = e?.value || "";
    if (e?.label === "_header") {
      const v = value.toLowerCase();
      if (/podrubryka\s*1\.4\.1/.test(v) || /działka ewidencyjna/.test(v)) { section = "dzialka"; continue; }
      if (/podrubryka\s*1\.4\.2/.test(v) || /\bbudynek\b/.test(v)) { section = "budynek"; continue; }
      if (/podrubryka\s*1\.4\.3/.test(v) || /\burządzenie\b/.test(v)) { section = "urzadzenie"; continue; }
      if (/podrubryka\s*1\.4\.4/.test(v) || /\blokal\b/.test(v)) { section = "lokal"; continue; }
      // Leaving Rubryka 1.4 entirely (1.5+ or any other top-level rubryka) stops tracking.
      if (/rubryka\s*1\.[5-9]/.test(v) || (!/rubryka\s*1\.4\b/.test(v) && /rubryka\s*\d/.test(v))) {
        section = "";
      }
      // "Brak wpisu" / "-" separators keep the section but carry no data.
      continue;
    }
    // A real field row inside a tracked sub-rubric means that sub-rubric has data.
    if (section && extractVal(value)) present[section] = true;
  }
  return present;
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

  // The two EKW views ("zupełna" = full history, "aktualna" = current state) use
  // noticeably different field encodings. We branch on this where they diverge.
  const isAktualna = (raw.viewType || "").toLowerCase() === "aktualna";

  // Prefer the authoritative KW number returned by the scraper. The check digit a
  // user types may be wrong (e.g. the demo default or a typo) — the EKW portal/
  // scraper resolves the book by court code + number and returns the correct,
  // validated number. Using it keeps the cache key, display and drafts consistent.
  const rawKwNumber = String(raw.kwNumber || "").trim().toUpperCase();
  const effectiveKwNumber = /^[A-Z0-9]{4}\/\d{6,}\/\d$/.test(rawKwNumber) ? rawKwNumber : kwNumber;

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

  const plotNumber = isAktualna
    ? (firstSeg(findEntryRaw(ioEntries, "numer działki")) || findEntry(ioEntries, "numer działki"))
    : findEntry(ioEntries, "numer działki");
  const plotIdentifier = findEntry(ioEntries, "identyfikator działki") ||
    findEntryByValuePrefix(ioEntries, "identyfikator działki");
  const obrebNumer = findEntry(ioEntries, /obręb ewidencyjny/) || findEntryByValuePrefix(ioEntries, "numer obrębu");
  const obrebNazwa = findEntry(ioEntries, /nazwa obrębu/) || findEntryByValuePrefix(ioEntries, "nazwa obrębu");
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

  // Area — from Rubryka 1.5 (zupełna) or "Obszar całej nieruchomości" (aktualna).
  const areaRaw = isAktualna
    ? (firstSeg(findEntryRaw(ioEntries, "obszar")) || findEntry(ioEntries, "obszar"))
    : (findEntry(ioEntries, /^\d*\.?\s*obszar$/i) || findEntry(ioEntries, "obszar"));
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

  // Property type detection.
  //
  // IMPORTANT: we must NOT rely on the mere presence of the word "lokal"/"budynek"
  // in the raw text — EVERY księga's Rubryka 1.4 contains the *structural* sub-rubric
  // headers "Podrubryka 1.4.1 - Działka ewidencyjna", "1.4.2 - Budynek",
  // "1.4.4 - Lokal" even when they hold "Brak wpisu". Detecting on those words
  // misclassified every property as a "lokal".
  //
  // Instead we inspect which sub-rubric of Rubryka 1.4 actually carries data
  // (i.e. has non-header field entries before the next sub-rubric header). This is
  // resilient to future księgi of any kind (działka / budynek / lokal / urządzenie).
  const rawPropType = (raw.propertyType || "").toLowerCase();
  const section14Present = detectRubryka14Sections(ioEntries);

  let propertyType: "lokal" | "dzialka" | "budynek" | "inne";
  if (section14Present.lokal) propertyType = "lokal";
  else if (section14Present.budynek) propertyType = "budynek";
  else if (section14Present.dzialka || plotNumber || usageRaw) propertyType = "dzialka";
  else if (rawPropType.includes("lokal")) propertyType = "lokal";
  else if (rawPropType.includes("budyn")) propertyType = "budynek";
  else if (rawPropType.includes("grunt") || rawPropType.includes("dział")) propertyType = "dzialka";
  else propertyType = "inne";

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

  // Extract basis of acquisition (Podstawa nabycia). In the WNIOSKI section it
  // appears either as "Wskazanie podstawy" (inna podstawa) or "Tytuł aktu" (akt
  // notarialny). Strip any trailing descriptive note like "(wskazanie podstawy)".
  let basisText = "";
  for (const entry of iiEntries) {
    const v = entry.value || "";
    if (entry.label !== "_header" && (/wskazanie podstawy/i.test(v) || /tytuł aktu/i.test(v))) {
      const val = extractVal(v);
      if (val) basisText = val.replace(/\s*\((?:wskazanie podstawy|inna podstawa|tytuł aktu)\)\s*$/i, "").trim();
    }
  }

  const titleCase = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";

  // Udziały (Podrubryka 2.2.1): map "numer udziału w prawie" -> {share, wspólność}.
  // Owners reference their udział via "Lista wskazań udziałów w prawie".
  const udzialMap = new Map<string, { share: string; wspolnosc: string }>();
  {
    let inUdzial = false;
    let curNo = "";
    for (const e of iiEntries) {
      const v = e.value || "";
      if (e.label === "_header") {
        if (/podrubryka\s*2\.2\.1/i.test(v)) { inUdzial = true; continue; }
        if (/podrubryka\s*2\.2\.[2-9]/i.test(v) || /rubryka\s*2\.[3-9]/i.test(v)) { inUdzial = false; continue; }
        continue;
      }
      if (!inUdzial) continue;
      if (/numer udziału w prawie/i.test(v)) {
        curNo = extractVal(v);
        if (curNo) udzialMap.set(curNo, { share: "", wspolnosc: "" });
      } else if (/wielkość udziału/i.test(e.label || "")) {
        const sv = extractVal(v);
        const m = sv.match(/(\d+)\s*\/\s*(\d+)/);
        const u = udzialMap.get(curNo);
        if (u) u.share = m ? `${m[1]}/${m[2]}` : sv;
      } else if (/rodzaj wspólności/i.test(e.label || "")) {
        const sv = extractVal(v);
        const u = udzialMap.get(curNo);
        if (u && sv) u.wspolnosc = sv;
      }
    }
  }

  const shareForUdzial = (no: string): string => {
    const u = udzialMap.get(no);
    if (u && u.share) return `${u.share}${u.wspolnosc ? ` (${u.wspolnosc.toLowerCase()})` : ""}`;
    // Single-udział księga: a person may not reference it explicitly.
    if (udzialMap.size === 1) {
      const only = udzialMap.get([...udzialMap.keys()][0]);
      if (only && only.share) return `${only.share}${only.wspolnosc ? ` (${only.wspolnosc.toLowerCase()})` : ""}`;
    }
    return "";
  };

  // Natural persons (Podrubryka 2.2.5). IMPORTANT: multiple persons live under ONE
  // sub-rubric header, each delimited by a "Lista wskazań udziałów w prawie" row
  // (not by repeated headers). We must finalize on each delimiter, not on PESEL.
  {
    let inPersons = false;
    let cur: any = null;
    const finalize = () => {
      if (cur && (cur.first || cur.sur)) {
        const fullName = [cur.first, cur.second, cur.sur, cur.sur2].filter(Boolean).join(" ");
        const parents = cur.father || cur.mother
          ? `syn/córka ${titleCase(cur.father)}${cur.father && cur.mother ? " i " : ""}${titleCase(cur.mother)}`
          : "";
        owners.push({
          id: `own-${owners.length}`,
          name: fullName.toUpperCase(),
          peselOrRegon: /^\d{11}$/.test(cur.pesel) ? cur.pesel : "",
          parentsNames: parents,
          share: shareForUdzial(cur.udzial) || "brak danych",
          communityType: (cur.udzial && udzialMap.get(cur.udzial)?.wspolnosc) || "",
          basisOfAcquisition: basisText || ""
        });
      }
      cur = null;
    };
    for (const e of iiEntries) {
      const label = e.label || "";
      const value = e.value || "";
      if (e.label === "_header") {
        if (/podrubryka\s*2\.2\.5/i.test(value)) { finalize(); inPersons = true; continue; }
        if (inPersons && (/podrubryka/i.test(value) || /rubryka\s*2\.[3-9]/i.test(value) || /wnioski/i.test(value))) {
          finalize(); inPersons = false; continue;
        }
        continue;
      }
      if (!inPersons) continue;
      if (/lista wskazań udziałów/i.test(value)) {
        finalize();
        cur = { udzial: extractVal(value), first: "", second: "", sur: "", sur2: "", father: "", mother: "", pesel: "" };
      } else if (cur) {
        if (/imię pierwsze/i.test(label)) cur.first = extractVal(value);
        else if (/imię drugie/i.test(label)) cur.second = extractVal(value);
        else if (/nazwisko.*pierwszy człon|^4\.\s*nazwisko/i.test(label)) cur.sur = extractVal(value);
        else if (/drugi człon/i.test(label)) cur.sur2 = extractVal(value);
        else if (/imię ojca/i.test(label)) cur.father = extractVal(value);
        else if (/imię matki/i.test(label)) cur.mother = extractVal(value);
        else if (/pesel/i.test(label)) cur.pesel = extractVal(value);
      }
    }
    finalize();
  }

  // Legal entities (Podrubryka 2.2.4).
  for (let i = 0; i < iiEntries.length; i++) {
    const entry = iiEntries[i];
    if (entry.label === "_header" && /inna osoba prawna/i.test(entry.value || "")) {
      let entityName = "", entityCity = "", entityRegon = "", entityUdzial = "";
      for (let j = i + 1; j < Math.min(i + 18, iiEntries.length); j++) {
        const nextLabel = (iiEntries[j].label || "").toLowerCase();
        const nextVal = iiEntries[j].value || "";
        if (/lista wskazań udziałów/i.test(nextVal)) entityUdzial = extractVal(nextVal);
        if (/^1\.\s*$/.test(iiEntries[j].label || "") && /nazwa/i.test(nextVal)) entityName = extractVal(nextVal);
        if (/nazwa/i.test(nextLabel) && iiEntries[j].label !== "_header") entityName = extractVal(nextVal);
        if (/siedziba/i.test(nextLabel)) entityCity = extractVal(nextVal);
        if (/regon/i.test(nextLabel)) entityRegon = extractVal(nextVal);
        if (iiEntries[j].label === "_header" && /podrubryka|rubryka/i.test(nextVal)) break;
      }
      if (entityName) {
        owners.push({
          id: `own-${owners.length}`,
          name: entityName.toUpperCase(),
          peselOrRegon: entityRegon ? `REGON: ${entityRegon}` : "",
          parentsNames: entityCity ? `siedziba: ${entityCity}` : "",
          share: shareForUdzial(entityUdzial) || "brak danych",
          basisOfAcquisition: basisText || ""
        });
      }
    }
  }

  // Fallback for the "aktualna" (current) view, where Dział II is condensed:
  // owners appear as a single comma-separated value next to a descriptive label
  // (e.g. "Osoba fizyczna (Imię ... PESEL)" → "JAN KOWALSKI, OJCIEC, MATKA, PESEL")
  // rather than as per-field rows. Runs only if the per-field parser found nothing.
  if (owners.length === 0 && !dzialII.empty) {
    // Share lives in "Lista wskazań udziałów..." e.g. value "Lp. 1. | 1 | 1 /1 | --- | 2".
    let condShare = "";
    const shareEntry = iiEntries.find((e: any) =>
      /lista wskazań udziałów|wielkość udziału/i.test(e.label || "")
    );
    if (shareEntry) {
      const m = (shareEntry.value || "").match(/(\d+)\s*\/\s*(\d+)/);
      if (m) condShare = `${m[1]}/${m[2]}`;
    }

    const titleCase = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";

    for (const e of iiEntries) {
      const label = e.label || "";
      if (label === "_header") continue;
      const rawValue = e.value || "";

      // Natural person: "IMIĘ1 IMIĘ2 NAZWISKO, imię ojca, imię matki, PESEL"
      if (/osoba fizyczna/i.test(label)) {
        const parts = rawValue.split(",").map((s: string) => s.trim()).filter(Boolean);
        if (parts.length === 0) continue;
        const fullName = parts[0] || "";
        const pesel = parts.find((p: string) => /^\d{11}$/.test(p)) || "";
        const middle = parts.slice(1).filter((p: string) => !/^\d{11}$/.test(p));
        const father = middle[0] || "";
        const mother = middle[1] || "";
        const parentsStr = father || mother
          ? `syn/córka ${titleCase(father)}${father && mother ? " i " : ""}${titleCase(mother)}`
          : "";
        owners.push({
          id: `own-${owners.length}`,
          name: fullName.toUpperCase(),
          peselOrRegon: pesel,
          parentsNames: parentsStr,
          share: condShare || "brak danych",
          basisOfAcquisition: basisText || ""
        });
      }
      // Legal entity: "NAZWA, SIEDZIBA, REGON" (REGON optional)
      else if (/osoba prawna|jednostka samorz|skarb państwa|niebędąca osobą prawną/i.test(label)) {
        const parts = rawValue.split(",").map((s: string) => s.trim()).filter(Boolean);
        const name = parts[0] || "";
        const regon = parts.find((p: string) => /^\d{9,14}$/.test(p)) || "";
        if (name) {
          owners.push({
            id: `own-${owners.length}`,
            name: name.toUpperCase(),
            peselOrRegon: regon ? `REGON: ${regon}` : "",
            parentsNames: parts[1] && !/^\d{9,14}$/.test(parts[1]) ? `siedziba: ${parts[1]}` : "",
            share: condShare || "brak danych",
            basisOfAcquisition: basisText || ""
          });
        }
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

  // Entry date + journal number for the ownership (Dział II "Dane o wniosku i
  // chwili wpisu"). Generic for both views: read the "Chwila wpisu" date and the
  // "Numer dziennika"; fall back to the condensed "aktualna" wniosek header line.
  let ownerEntryDate = "";
  let ownerEntryNumber = "";
  for (const e of iiEntries) {
    const lab = e.label || "";
    if (/chwila wpisu/i.test(lab) && !ownerEntryDate) {
      const dm = extractVal(e.value).match(/(\d{4}-\d{2}-\d{2})/);
      if (dm) ownerEntryDate = dm[1];
    }
    if (/numer dziennika/i.test(lab) && !ownerEntryNumber) {
      const nm = (e.value || "").match(/([A-Z0-9]{2,4}\s*\/\s*\d+\s*\/\s*\d+(?:\s*\/\s*\d+)?)/);
      if (nm) ownerEntryNumber = nm[1].replace(/\s+/g, "");
    }
  }
  if (!ownerEntryDate || !ownerEntryNumber) {
    // "aktualna" packs it into one header line, e.g.
    // "DZ. KW./KA1T/00003467/25/001, 2025-03-28 11:16:00, 2025-04-28-..., NIE, ... (rodzaj i numer dziennika, chwila wpływu, chwila wpisu, ...)"
    for (const e of iiEntries) {
      const v = e.value || "";
      if (/rodzaj i numer dziennika/i.test(v) || /^DZ\.\s*KW/i.test(v)) {
        if (!ownerEntryNumber) {
          const nm = v.match(/([A-Z0-9]{2,4}\/\d+\/\d+\/\d+)/);
          if (nm) ownerEntryNumber = nm[1];
        }
        if (!ownerEntryDate) {
          const dates = v.match(/\d{4}-\d{2}-\d{2}/g);
          if (dates && dates.length) ownerEntryDate = dates[dates.length - 1]; // chwila wpisu is the later date
        }
      }
    }
  }
  for (const o of owners) {
    if (!o.entryDate && ownerEntryDate) o.entryDate = ownerEntryDate;
    if (!o.entryNumber && ownerEntryNumber) o.entryNumber = ownerEntryNumber;
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

  // Parse wzmianki in Dział IV (Rubryka 4.1).
  //
  // A wzmianka that already carries a "Chwila wykreślenia" has been removed and no
  // longer suspends the public-faith warranty — surfacing it as an active caution
  // would be a false alarm. We therefore buffer each wzmianka and only keep the
  // ones that have NOT been wykreślone.
  let inIVWzmianki = false;
  let wzNumer = "";
  let wzOpis = "";
  let wzWykreslona = false;
  const flushWzmianka = () => {
    if (wzOpis && !wzWykreslona) {
      ivNotices.push(`${wzOpis}${wzNumer ? ` (${wzNumer})` : ""}`);
    }
    wzNumer = "";
    wzOpis = "";
    wzWykreslona = false;
  };
  for (const e of ivEntries) {
    if (e.label === "_header" && /rubryka 4\.1.*wzmianki/i.test(e.value || "")) { inIVWzmianki = true; continue; }
    if (e.label === "_header" && /rubryka 4\.[2-9]/i.test(e.value || "")) {
      if (inIVWzmianki) flushWzmianka();
      inIVWzmianki = false;
      continue;
    }
    if (!inIVWzmianki || e.label === "_header") continue;
    if (/brak wpisu/i.test(e.value || "")) continue;

    if (/numer wzmianki/i.test(e.value || "")) {
      // Start of a new wzmianka — finalize the previous one first.
      flushWzmianka();
      wzNumer = extractVal(e.value);
    } else if (/opis wzmianki/i.test(e.label || "")) {
      wzOpis = extractVal(e.value);
    } else if (/chwila wykreślenia/i.test(e.label || "")) {
      if (extractVal(e.value)) wzWykreslona = true;
    }
  }
  flushWzmianka();

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

  // Fallback for the "aktualna" (current) view: Dział IV is condensed and has no
  // "Rubryka 4.2" headers. Each mortgage is delimited by a "Lp. N." marker, the
  // sum/words/currency live in one combined field, and the creditor is a single
  // comma-separated value. Runs only if the standard parser found nothing.
  if (mortgages.length === 0 && !dzialIV.empty) {
    let cur: any = null;
    const pushCur = () => {
      if (cur && (cur.type || cur.amount)) mortgages.push(cur);
    };
    for (const e of ivEntries) {
      const label = (e.label || "").trim();
      const rawValue = e.value || "";

      // New mortgage block starts at a "Lp. N." marker referencing "Nr podstawy wpisu".
      if (/^Lp\.\s*\d+\.?$/i.test(label) && /nr podstawy wpisu/i.test(rawValue)) {
        pushCur();
        cur = {
          id: `mort-${mortgages.length}`,
          type: "", amount: 0, currency: "PLN", creditor: "",
          creditorCity: "", creditorRegon: "", securesWhat: "",
          sumInWords: "", coEncumberedKW: "", entryNumber: ""
        };
        continue;
      }
      if (!cur || e.label === "_header") continue;

      if (/^numer hipoteki/i.test(label)) {
        cur.entryNumber = firstSeg(rawValue);
      } else if (/^rodzaj hipoteki/i.test(label)) {
        cur.type = rawValue.trim();
      } else if (/^suma/i.test(label)) {
        // "23 330,55 (DWADZIEŚCIA ... 55/100) ZŁ"
        const amtMatch = rawValue.match(/^([\d\s\u00A0.,]+?)\s*\(/);
        if (amtMatch) {
          cur.amount = parseFloat(amtMatch[1].replace(/[\s\u00A0]/g, "").replace(",", "."));
        }
        const wordsMatch = rawValue.match(/\(([^)]*)\)/);
        if (wordsMatch) cur.sumInWords = wordsMatch[1];
        const curTok = (rawValue.match(/\)\s*([A-ZŁa-zł]{2,3})\s*$/)?.[1] || "").toUpperCase();
        cur.currency = curTok.includes("EUR") ? "EUR" : curTok.includes("USD") ? "USD" : curTok.includes("CHF") ? "CHF" : "PLN";
      } else if (/wierzytelność i stosunek prawny/i.test(label)) {
        const segs = rawValue.split("|").map((s: string) => s.trim());
        const last = segs[segs.length - 1];
        if (last && last !== "---") cur.securesWhat = last;
      } else if (/księga współobciążona/i.test(label)) {
        const segs = rawValue.split("|").map((s: string) => s.trim());
        const last = segs[segs.length - 1];
        if (last && /\//.test(last)) cur.coEncumberedKW = last.replace(/\s+/g, "");
      } else if (/inna osoba prawna|osoba prawna|jednostka samorz|skarb państwa|niebędąca osobą prawną/i.test(label)) {
        // Creditor (entity): "Lp. 1. | NAZWA, SIEDZIBA, REGON"
        const after = rawValue.includes("|") ? rawValue.split("|").slice(1).join("|").trim() : rawValue.trim();
        const parts = after.split(",").map((s: string) => s.trim()).filter(Boolean);
        if (parts.length) {
          cur.creditor = parts[0];
          const regon = parts.find((p: string) => /^\d{9,14}$/.test(p));
          const city = parts.slice(1).find((p: string) => !/^\d{9,14}$/.test(p));
          if (city) cur.creditorCity = city;
          if (regon) cur.creditorRegon = regon;
        }
      } else if (/osoba fizyczna/i.test(label)) {
        // Creditor (natural person)
        const after = rawValue.includes("|") ? rawValue.split("|").slice(1).join("|").trim() : rawValue.trim();
        const parts = after.split(",").map((s: string) => s.trim()).filter(Boolean);
        if (parts.length) cur.creditor = parts[0];
      }
    }
    pushCur();
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

  // Migration comments (Rubryki 1.9 / 1.14 / 2.8 / 3.7 / 4.7) — recovered from
  // rawText because the scraper drops them from the structured entries.
  const ioComment = extractMigrationComment(dzialIO.rawText || "");
  const iSpComment = extractMigrationComment(dzialISp.rawText || "");
  const iiComment = extractMigrationComment(dzialII.rawText || "");
  const iiiComment = extractMigrationComment(dzialIII.rawText || "");
  const ivComment = extractMigrationComment(dzialIV.rawText || "");

  return {
    kwNumber: effectiveKwNumber,
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
      applicationData: ioAppData || undefined,
      migrationComment: ioComment || undefined
    },
    dzial1Sp: {
      hasEntries: !dzialISp.empty,
      shareInJointProperty: shareInJointProp || "",
      associatedRights: iSpAssociated,
      applicationData: applicationDataISp || undefined,
      migrationComment: iSpComment || undefined
    },
    dzial2: {
      owners,
      isPerpetualUsufruct,
      notices: iiNotices.length > 0 ? iiNotices : undefined,
      applicationData: iiAppData || undefined,
      migrationComment: iiComment || undefined
    },
    dzial3: {
      hasEntries: !dzialIII.empty,
      easements,
      warningsAndExecutions: warnings,
      otherRights,
      notices: iiiNotices.length > 0 ? iiiNotices : undefined,
      migrationComment: iiiComment || undefined
    },
    dzial4: {
      hasEntries: !dzialIV.empty && mortgages.length > 0,
      mortgages,
      notices: ivNotices.length > 0 ? ivNotices : undefined,
      applicationData: ivAppData || undefined,
      migrationComment: ivComment || undefined
    }
  };
}

// Post-mapping sanity checks. Flags cases where the deterministic parser likely
// missed data (a non-empty dział that produced nothing, a placeholder owner, etc.)
// so we can trigger an AI fallback and/or warn the notary. Conservative — only
// reliable signals, to avoid false alarms.
function validateMapping(mapped: any, raw: any): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const d2empty = raw?.dzialII?.empty === true;
  const d4empty = raw?.dzialIV?.empty === true;
  const dIOempty = raw?.dzialIO?.empty === true;
  const owners = mapped?.dzial2?.owners || [];
  const mortgages = mapped?.dzial4?.mortgages || [];

  if (!d2empty && owners.length === 0) {
    issues.push("Dział II nie jest pusty, a nie odczytano żadnego właściciela.");
  }
  if (owners.some((o: any) => /dane w surowym tekście/i.test(o?.name || ""))) {
    issues.push("Właściciel nie został rozpoznany (placeholder) — sprawdź Dział II.");
  }
  if (owners.length > 0 && owners.every((o: any) => !o?.share || o.share === "brak danych")) {
    issues.push("Nie odczytano wielkości udziałów właścicieli.");
  }
  if (!d4empty && mortgages.length === 0) {
    issues.push("Dział IV nie jest pusty, a nie odczytano żadnej hipoteki.");
  }
  if (!dIOempty && !String(mapped?.dzial1O?.location || "").trim()) {
    issues.push("Brak położenia nieruchomości (Dział I-O).");
  }

  return { ok: issues.length === 0, issues };
}

// Which sections each issue concerns — used to target the AI fallback merge.
function issuesTouch(issues: string[], section: "owners" | "mortgages" | "location"): boolean {
  const text = issues.join(" ").toLowerCase();
  if (section === "owners") return /właściciel|udział|dział ii/.test(text);
  if (section === "mortgages") return /hipotek|dział iv/.test(text);
  if (section === "location") return /położeni|dział i-o/.test(text);
  return false;
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

  // AI fallback: when validation flags missing/garbled sections, ask the LLM to
  // parse the raw EKW text and MERGE only the failing sections into the
  // deterministic result (never overwrite good deterministic data). Returns
  // whether anything was AI-assisted.
  const aiAssistMapping = async (mapped: any, raw: any, issues: string[]): Promise<boolean> => {
    const client = getDeepseekClient();
    if (!client) return false;

    const rawText = [raw?.dzialIO, raw?.dzialISp, raw?.dzialII, raw?.dzialIII, raw?.dzialIV]
      .map((d: any) => d?.rawText)
      .filter(Boolean)
      .join("\n\n");
    if (!rawText.trim()) return false;

    const prompt = `Przeanalizuj surowy tekst księgi wieczystej i zwróć WYŁĄCZNIE obiekt JSON o strukturze:
{
  "dzial1O": { "location": "string", "description": "string" },
  "dzial2": { "owners": [{ "name": "string", "peselOrRegon": "string", "parentsNames": "string", "share": "string", "basisOfAcquisition": "string" }] },
  "dzial4": { "mortgages": [{ "type": "string", "amount": number, "currency": "string", "creditor": "string", "securesWhat": "string" }] }
}
Zasady: nazwiska WIELKIMI literami; udział w formie "licznik/mianownik" z dopiskiem rodzaju wspólności w nawiasie jeśli występuje; wymień WSZYSTKICH współwłaścicieli; nie wymyślaj danych, których nie ma w tekście.

--- TEKST KSIĘGI ---
${rawText}
--- KONIEC ---`;

    try {
      const resp = await client.chat.completions.create({
        model: LLM_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: GENERATION_SYSTEM_INSTRUCTION },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      });
      const parsed = JSON.parse((resp.choices[0].message.content || "{}").trim());
      const s = parsed.structured || parsed;
      let assisted = false;

      if (issuesTouch(issues, "owners") && Array.isArray(s?.dzial2?.owners) && s.dzial2.owners.length > 0) {
        mapped.dzial2.owners = s.dzial2.owners.map((o: any, i: number) => ({
          id: `own-ai-${i}`,
          name: String(o.name || "").toUpperCase(),
          peselOrRegon: o.peselOrRegon || "",
          parentsNames: o.parentsNames || "",
          share: o.share || "brak danych",
          basisOfAcquisition: o.basisOfAcquisition || "",
        }));
        assisted = true;
      }
      if (issuesTouch(issues, "mortgages") && Array.isArray(s?.dzial4?.mortgages) && s.dzial4.mortgages.length > 0) {
        mapped.dzial4.mortgages = s.dzial4.mortgages.map((m: any, i: number) => ({
          id: `mort-ai-${i}`,
          type: m.type || "hipoteka",
          amount: typeof m.amount === "number" ? m.amount : parseFloat(String(m.amount || "0").replace(/[^\d.,]/g, "").replace(",", ".")) || 0,
          currency: m.currency || "PLN",
          creditor: m.creditor || "",
          securesWhat: m.securesWhat || "",
        }));
        mapped.dzial4.hasEntries = mapped.dzial4.mortgages.length > 0;
        assisted = true;
      }
      if (issuesTouch(issues, "location") && s?.dzial1O?.location) {
        mapped.dzial1O.location = s.dzial1O.location;
        if (!mapped.dzial1O.description && s.dzial1O.description) mapped.dzial1O.description = s.dzial1O.description;
        assisted = true;
      }
      return assisted;
    } catch (e: any) {
      console.error("[AI fallback] error:", e.message);
      return false;
    }
  };

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
        model: LLM_MODEL,
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
        model: LLM_MODEL,
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

  // API Route: Refine existing drafts with a free-text notarial instruction.
  //
  // Unlike /api/parse-raw-text (which re-parses raw EKW text), this endpoint takes
  // the THREE already-generated drafts plus a natural-language instruction and
  // returns a corrected set of the same three styles. The structured data is sent
  // only as factual grounding so the model does not invent or drop facts.
  app.post("/api/refine-drafts", async (req, res) => {
    const { instruction, drafts, draft, style, data } = req.body as {
      instruction?: string;
      drafts?: { classic?: string; modern?: string; short?: string };
      draft?: string;
      style?: "classic" | "modern" | "short" | "custom";
      data?: any;
    };

    if (!instruction || !instruction.trim()) {
      return res.status(400).json({ error: "Brak instrukcji korekty." });
    }

    const client = getDeepseekClient();
    if (!client) {
      return res.status(503).json({
        error:
          "Korekta AI wymaga skonfigurowanego klucza DEEPSEEK_API_KEY. Bez niego dostępne są tylko teksty generowane deterministycznie.",
      });
    }

    const styleNames: Record<string, string> = {
      classic: "tradycyjny aktowy (formalny, pełne formuły)",
      modern: "współczesny (czytelny, punktowany)",
      short: "skrócony (skondensowany)",
    };

    // Compact factual grounding — keep the prompt small so the model is fast and
    // never invents/drops legal facts.
    const facts = data
      ? {
          kwNumber: data.kwNumber,
          sad: [data.sadRejonowy, data.wydzialKw].filter(Boolean).join(", "),
          wlasciciele: (data.dzial2?.owners || []).map((o: any) => ({
            imie: o.name, udzial: o.share, pesel: o.peselOrRegon,
          })),
          dzial3: data.dzial3?.hasEntries ? "są wpisy" : "brak",
          hipoteki: (data.dzial4?.mortgages || []).map((m: any) => ({
            rodzaj: m.type, kwota: m.amount, waluta: m.currency, wierzyciel: m.creditor,
          })),
        }
      : null;

    const commonRules = `Zasady:
- Zastosuj instrukcję do tekstu, zachowując jego charakter.
- NIE zmieniaj faktów prawnych (numery KW, nazwiska, PESEL, kwoty, udziały, liczba hipotek) — chyba że instrukcja wyraźnie tego dotyczy.
- Tekst to zwykły tekst (plain text) wklejany do aktu — bez Markdown i bez HTML.
- Zwróć tylko poprawiony tekst, bez komentarzy.`;

    try {
      // Single-style refinement (fast path — refines only the visible draft).
      if (typeof draft === "string" && style) {
        let prompt: string;

        if (style === "custom") {
          // "From scratch" mode: build a brand-new text purely from the księga data
          // according to the user's instruction. Full structured data is provided
          // so the model has every fact it might need.
          prompt = `Jesteś doświadczonym polskim notariuszem. Na podstawie danych z księgi wieczystej (poniżej) stwórz tekst DOKŁADNIE według polecenia użytkownika.

DANE KSIĘGI WIECZYSTEJ (JSON):
${JSON.stringify(data ?? {}, null, 0)}
${draft && draft.trim() ? `\nDOTYCHCZASOWY TEKST (kontynuuj/uwzględnij, jeśli zgodne z poleceniem):\n"""\n${draft}\n"""\n` : ""}
POLECENIE UŻYTKOWNIKA:
"${instruction}"

Zasady:
- Korzystaj wyłącznie z podanych danych — nie wymyślaj faktów ani nie pomijaj istotnych obciążeń, chyba że polecenie wyraźnie tak stanowi.
- Tekst to zwykły tekst (plain text) wklejany do aktu — bez Markdown i bez HTML.
- Zwróć tylko wygenerowany tekst, bez komentarzy.

Odpowiedz WYŁĄCZNIE obiektem JSON: { "draft": "wygenerowany tekst" }`;
        } else {
          prompt = `Popraw poniższy opis stanu prawnego nieruchomości w stylu "${styleNames[style] || style}".
${facts ? `\nDANE FAKTYCZNE KSIĘGI (tylko do weryfikacji):\n${JSON.stringify(facts)}\n` : ""}
TEKST DO POPRAWY:
"""
${draft}
"""

INSTRUKCJA OD NOTARIUSZA:
"${instruction}"

${commonRules}

Odpowiedz WYŁĄCZNIE obiektem JSON: { "draft": "poprawiony tekst" }`;
        }

        const response = await client.chat.completions.create({
          model: LLM_MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: GENERATION_SYSTEM_INSTRUCTION },
            { role: "user", content: prompt },
          ],
          temperature: style === "custom" ? 0.5 : 0.3,
        });
        const parsed = JSON.parse((response.choices[0].message.content || "{}").trim());
        return res.json({ draft: parsed.draft ?? draft, style });
      }

      // Multi-style refinement (refines all three at once).
      if (!drafts || (!drafts.classic && !drafts.modern && !drafts.short)) {
        return res.status(400).json({ error: "Brak tekstów do korekty." });
      }
      const prompt = `Otrzymujesz TRZY wersje opisu stanu prawnego nieruchomości (style: classic, modern, short) oraz instrukcję korekty od notariusza.
${facts ? `\nDANE FAKTYCZNE KSIĘGI (tylko do weryfikacji):\n${JSON.stringify(facts)}\n` : ""}
AKTUALNE TEKSTY:
[classic]
${drafts.classic || ""}
[modern]
${drafts.modern || ""}
[short]
${drafts.short || ""}

INSTRUKCJA OD NOTARIUSZA:
"${instruction}"

${commonRules}
- Zastosuj instrukcję do wszystkich trzech stylów, zachowując ich charakter.

Odpowiedz WYŁĄCZNIE obiektem JSON:
{ "drafts": { "classic": "...", "modern": "...", "short": "..." } }`;

      const response = await client.chat.completions.create({
        model: LLM_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: GENERATION_SYSTEM_INSTRUCTION },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
      });
      const parsed = JSON.parse((response.choices[0].message.content || "{}").trim());
      const out = parsed.drafts || parsed;
      res.json({
        drafts: {
          classic: out.classic ?? drafts.classic ?? "",
          modern: out.modern ?? drafts.modern ?? "",
          short: out.short ?? drafts.short ?? "",
        },
      });
    } catch (error: any) {
      console.error("Deepseek Refine error:", error);
      res.status(500).json({ error: "Błąd korekty AI: " + error.message });
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
        // Save full raw response to file for analysis. Stored in a dedicated
        // folder, with the view type in the name so "aktualna" and "zupelna" of
        // the same księga don't overwrite each other.
        const dumpDir = path.join(process.cwd(), "apify_dumps");
        fs.mkdirSync(dumpDir, { recursive: true });
        const debugPath = path.join(dumpDir, `apify_raw_${normalized.replace(/\//g, "_")}_${apifyViewType}.json`);
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
      let validation = validateMapping(mapped, raw);
      let aiAssisted = false;
      if (!validation.ok) {
        aiAssisted = await aiAssistMapping(mapped, raw, validation.issues);
        if (aiAssisted) validation = validateMapping(mapped, raw); // re-check after merge
      }
      res.json({ mapped, raw, parserVersion: PARSER_VERSION, validation: { ...validation, aiAssisted } });
    } catch (error: any) {
      console.error("[Apify] Fetch error:", error.message);
      res.status(500).json({ error: "Błąd połączenia z Apify: " + error.message });
    }
  });

  // Re-run the mapper over an already-fetched raw Apify payload (e.g. one stored
  // in a client's localStorage cache). No Apify/government portal call involved —
  // lets the client pick up parser fixes without re-scraping a book it already has.
  app.post("/api/remap-kw", async (req, res) => {
    const { raw, kwNumber } = req.body;
    if (!raw || !kwNumber) {
      return res.status(400).json({ error: "Brak danych raw lub kwNumber." });
    }
    const prefix = kwNumber.replace(/\s+/g, "").toUpperCase().split("/")[0];
    const courtInfo = COURT_MAP[prefix] || {
      court: `Sąd Rejonowy dla kodu ${prefix}`,
      dept: "Wydział Ksiąg Wieczystych"
    };
    try {
      const mapped = mapApifyToKWData(raw, kwNumber, courtInfo);
      let validation = validateMapping(mapped, raw);
      let aiAssisted = false;
      if (!validation.ok) {
        aiAssisted = await aiAssistMapping(mapped, raw, validation.issues);
        if (aiAssisted) validation = validateMapping(mapped, raw);
      }
      res.json({ mapped, parserVersion: PARSER_VERSION, validation: { ...validation, aiAssisted } });
    } catch (error: any) {
      res.status(500).json({ error: "Błąd mapowania danych: " + error.message });
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
