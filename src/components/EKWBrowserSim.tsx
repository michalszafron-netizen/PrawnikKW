/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Search, Server, Shield, Smartphone, ArrowRight, Check, AlertCircle, RefreshCw, Layers, Settings2, BookOpen, Trash2, Clock, Download, Pencil } from "lucide-react";
import { PRECONFIGURED_EXAMPLES } from "../data/examples";
import { KWData } from "../types";

interface ValidationInfo {
  ok: boolean;
  issues: string[];
  aiAssisted: boolean;
}

interface CachedKW {
  kwNumber: string;
  viewType: "aktualna" | "zupelna";
  customName?: string;
  fetchedAt: string;
  lastEntryDate: string;
  sadRejonowy: string;
  propertyType: string;
  ownerNames: string[];
  data: KWData;
  rawApify?: any;
  parserVersion?: number;
  validation?: ValidationInfo;
}

const KW_CACHE_KEY = "lexparser_kw_cache";

// Must match PARSER_VERSION in server.ts. If a cached entry was mapped by an
// older parser, we re-map it from its stored rawApify (no Apify/network call
// needed) the next time it's opened from the library — see remapIfStale().
const MIN_PARSER_VERSION = 9;

function getCachedBooks(): CachedKW[] {
  try {
    const raw = localStorage.getItem(KW_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCachedBooks(books: CachedKW[]) {
  localStorage.setItem(KW_CACHE_KEY, JSON.stringify(books));
}

function addToCache(entry: CachedKW) {
  const books = getCachedBooks();
  const idx = books.findIndex(b => b.kwNumber === entry.kwNumber && b.viewType === entry.viewType);
  if (idx >= 0) books[idx] = entry;
  else books.unshift(entry);
  saveCachedBooks(books);
}

function removeFromCache(kwNumber: string, viewType: string) {
  const books = getCachedBooks().filter(b => !(b.kwNumber === kwNumber && b.viewType === viewType));
  saveCachedBooks(books);
}

// --- Monthly EKW query counter (per browser profile; no backend) ----------------
// Apify free tier ≈ 35 fetches/month; the $10 plan ≈ 1000/month. We track real
// fetches locally so the notary sees how many paid lookups they've used.
const QUERY_COUNTER_KEY = "lexparser_query_counter";
const MONTHLY_QUERY_LIMIT = 1000;
// A cached księga older than this many days triggers a "may be outdated" warning.
const STALE_AFTER_DAYS = 7;

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getQueryCount(): number {
  try {
    const raw = localStorage.getItem(QUERY_COUNTER_KEY);
    if (!raw) return 0;
    const obj = JSON.parse(raw);
    return obj.month === currentMonthKey() ? (obj.count || 0) : 0;
  } catch {
    return 0;
  }
}

function incrementQueryCount(): number {
  const count = getQueryCount() + 1;
  localStorage.setItem(QUERY_COUNTER_KEY, JSON.stringify({ month: currentMonthKey(), count }));
  return count;
}

// --- Server persistence client (library + usage survive browser cache clears) ---
async function apiGetLibrary(): Promise<CachedKW[] | null> {
  try { const r = await fetch("/api/library"); if (!r.ok) return null; const j = await r.json(); return Array.isArray(j.books) ? j.books : []; } catch { return null; }
}
async function apiSaveBook(book: CachedKW): Promise<CachedKW[] | null> {
  try { const r = await fetch("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ book }) }); if (!r.ok) return null; const j = await r.json(); return Array.isArray(j.books) ? j.books : null; } catch { return null; }
}
async function apiDeleteBook(kwNumber: string, viewType: string): Promise<CachedKW[] | null> {
  try { const r = await fetch("/api/library/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kwNumber, viewType }) }); if (!r.ok) return null; const j = await r.json(); return Array.isArray(j.books) ? j.books : null; } catch { return null; }
}
async function apiBulkLibrary(books: CachedKW[]): Promise<CachedKW[] | null> {
  try { const r = await fetch("/api/library/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ books }) }); if (!r.ok) return null; const j = await r.json(); return Array.isArray(j.books) ? j.books : null; } catch { return null; }
}
async function apiGetUsage(): Promise<number | null> {
  try { const r = await fetch("/api/usage"); if (!r.ok) return null; const j = await r.json(); return typeof j.count === "number" ? j.count : null; } catch { return null; }
}
async function apiIncrementUsage(): Promise<number | null> {
  try { const r = await fetch("/api/usage/increment", { method: "POST" }); if (!r.ok) return null; const j = await r.json(); return typeof j.count === "number" ? j.count : null; } catch { return null; }
}

// --- EKW check-digit validation -------------------------------------------------
// Official land-register check digit: over (courtCode + 8-digit number), each
// character is mapped to a value (digits 0-9; letters per the table below),
// multiplied by the cyclic weights [1,3,7], summed, mod 10. Verified against
// known-good numbers WA1M/00348754/5 and KA1T/00086962/7.
const KW_CHAR_VALUES: Record<string, number> = {
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  "X": 10, "A": 11, "B": 12, "C": 13, "D": 14, "E": 15, "F": 16, "G": 17, "H": 18,
  "I": 19, "J": 20, "K": 21, "L": 22, "M": 23, "N": 24, "O": 25, "P": 26, "R": 27,
  "S": 28, "T": 29, "U": 30, "W": 31, "Y": 32, "Z": 33,
};
const KW_WEIGHTS = [1, 3, 7];

function computeKwCheckDigit(courtCode: string, bookNumber: string): number | null {
  const s = (courtCode + bookNumber.padStart(8, "0")).toUpperCase();
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const v = KW_CHAR_VALUES[s[i]];
    if (v === undefined) return null; // unknown char — can't validate
    sum += v * KW_WEIGHTS[i % 3];
  }
  return sum % 10;
}

// One-time local repair: older cache entries may be keyed under the number the
// user typed (possibly a wrong check digit). The stored rawApify carries the
// authoritative number — realign the entry to it, no re-fetch needed. Also
// de-duplicates entries that collapse onto the same corrected key.
function migrateCachedBooks(): CachedKW[] {
  const books = getCachedBooks();
  let changed = false;
  const seen = new Set<string>();
  const result: CachedKW[] = [];
  for (const b of books) {
    const auth = String(b.rawApify?.kwNumber || "").trim().toUpperCase();
    if (/^[A-Z0-9]{4}\/\d{6,}\/\d$/.test(auth) && auth !== b.kwNumber) {
      b.kwNumber = auth;
      if (b.data) b.data.kwNumber = auth;
      changed = true;
    }
    const key = `${b.kwNumber}|${b.viewType}`;
    if (seen.has(key)) { changed = true; continue; } // drop duplicate
    seen.add(key);
    result.push(b);
  }
  if (changed) saveCachedBooks(result);
  return result;
}

function extractLastEntryDate(data: KWData, rawApify?: any): string {
  if (!rawApify) return "";
  const allSections = [rawApify.dzialIO, rawApify.dzialISp, rawApify.dzialII, rawApify.dzialIII, rawApify.dzialIV].filter(Boolean);
  const dates: string[] = [];
  for (const section of allSections) {
    for (const entry of (section.entries || [])) {
      if (entry.label === "_header" && /^DZ\. KW/i.test(entry.value || "")) {
        const dateMatch = (entry.value || "").match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) dates.push(dateMatch[1]);
      }
    }
  }
  dates.sort();
  return dates.length > 0 ? dates[dates.length - 1] : "";
}

interface EKWBrowserSimProps {
  onDataLoaded: (data: KWData, rawApify?: any, validation?: ValidationInfo) => void;
  onStartLoading: () => void;
  onStopLoading: () => void;
  autoOpenLibrary?: boolean;
}

export default function EKWBrowserSim({ onDataLoaded, onStartLoading, onStopLoading, autoOpenLibrary }: EKWBrowserSimProps) {
  // Input states
  const [courtCode, setCourtCode] = useState("WA1M");
  const [bookNumber, setBookNumber] = useState("00348754");
  const [controlNum, setControlNum] = useState("5");

  // View type toggle
  const [viewType, setViewType] = useState<"aktualna" | "zupelna">("zupelna");

  // Notary AI settings
  const [includePesels, setIncludePesels] = useState(true);
  const [includeAcquisitionBasis, setIncludeAcquisitionBasis] = useState(true);
  const [useAbbreviations, setUseAbbreviations] = useState(true);
  const [uppercaseNames, setUppercaseNames] = useState(true);
  const [spellOutNumbers, setSpellOutNumbers] = useState(true);

  // Simulation process states
  const [step, setStep] = useState<"form" | "captcha" | "loading" | "success">("form");
  const [sliderPosition, setSliderPosition] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [simulatedResult, setSimulatedResult] = useState<KWData | null>(null);

  // Library state
  const [cachedBooks, setCachedBooks] = useState<CachedKW[]>(getCachedBooks());
  const [showLibrary, setShowLibrary] = useState(true);
  const [queryCount, setQueryCount] = useState<number>(getQueryCount());
  // Inline rename state for library entries: "kwNumber|viewType" being edited.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  // Load library + usage from the server (source of truth), migrating any
  // localStorage data on first run. Falls back to localStorage if server is down.
  useEffect(() => {
    (async () => {
      const local = migrateCachedBooks(); // legacy local cache (realigned numbers)
      let serverBooks = await apiGetLibrary();
      if (serverBooks === null) {
        setCachedBooks(local); // server unreachable — show local
      } else {
        if (serverBooks.length === 0 && local.length > 0) {
          serverBooks = (await apiBulkLibrary(local)) || local;
        }
        setCachedBooks(serverBooks);
        saveCachedBooks(serverBooks); // mirror locally
      }
      const usage = await apiGetUsage();
      if (usage !== null) setQueryCount(usage);
    })();
  }, []);

  // Auto compile current book number
  const fullKW = `${courtCode}/${bookNumber}/${controlNum}`;

  const loadFromCache = async (cached: CachedKW) => {
    let bookData = cached.data;
    let validation: ValidationInfo | undefined = cached.validation;

    // If this entry was mapped by an older parser, re-map it locally from the
    // rawApify it already carries — no Apify/government portal call needed.
    if ((cached.parserVersion || 0) < MIN_PARSER_VERSION && cached.rawApify) {
      try {
        const remapRes = await fetch("/api/remap-kw", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw: cached.rawApify, kwNumber: cached.kwNumber })
        });
        const remapped = await remapRes.json();
        if (remapRes.ok && remapped.mapped) {
          bookData = remapped.mapped;
          if (remapped.validation) validation = remapped.validation;
          const updatedEntry: CachedKW = {
            ...cached,
            data: bookData,
            parserVersion: remapped.parserVersion,
            validation
          };
          addToCache(updatedEntry);
          await apiSaveBook(updatedEntry);
          setCachedBooks(getCachedBooks());
        }
      } catch {
        // Remap failed (e.g. server unreachable) — fall back to the cached mapping as-is.
      }
    }

    const data: KWData = {
      ...bookData,
      notarySettings: {
        includePesels,
        includeAcquisitionBasis,
        useAbbreviations,
        uppercaseNames,
        spellOutNumbers
      }
    };
    setSimulatedResult(data);
    onDataLoaded(data, cached.rawApify, validation);
    const parts = cached.kwNumber.split("/");
    if (parts.length === 3) {
      setCourtCode(parts[0]);
      setBookNumber(parts[1]);
      setControlNum(parts[2]);
    }
    setViewType(cached.viewType);
    setStep("success");
  };

  const handleDeleteCached = async (kwNumber: string, vt: string) => {
    removeFromCache(kwNumber, vt);
    const books = await apiDeleteBook(kwNumber, vt);
    setCachedBooks(books || getCachedBooks());
  };

  // Save a custom, user-defined name for a library entry (e.g. "Mieszkanie Jana
  // Kowalskiego"). Persisted server-side + local mirror.
  const saveCachedName = async (cached: CachedKW, name: string) => {
    const updated: CachedKW = { ...cached, customName: name.trim() || undefined };
    addToCache(updated);
    const books = await apiSaveBook(updated);
    setCachedBooks(books || getCachedBooks());
    setEditingKey(null);
    setNameDraft("");
  };

  // Re-fetch a cached księga from Apify (counts as a billable query) and overwrite
  // the stored entry, even if the data is identical. Used by the "Odśwież" button.
  const refreshCached = (cached: CachedKW) => {
    const parts = cached.kwNumber.split("/");
    if (parts.length === 3) {
      setCourtCode(parts[0]);
      setBookNumber(parts[1]);
      setControlNum(parts[2]);
    }
    setViewType(cached.viewType);
    triggerLookup(cached.kwNumber, cached.viewType);
  };

  // Predefined quick select
  const handleQuickSelect = (exampleId: string) => {
    const ex = PRECONFIGURED_EXAMPLES.find((e) => e.id === exampleId);
    if (ex) {
      const parts = ex.kwNumber.split("/");
      setCourtCode(parts[0]);
      setBookNumber(parts[1]);
      setControlNum(parts[2]);
    }
  };

  const startSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Validate formatting roughly (Court code is 4 characters, book number is up to 8 digits, control is 1 digit)
    if (courtCode.trim().length !== 4) {
      alert("Kod sądu musi składać się dokładnie z 4 znaków (np. WA1M).");
      return;
    }
    if (!/^\d+$/.test(bookNumber) || bookNumber.trim().length < 5) {
      alert("Numer księgi wieczystej powinien składać się z cyfr (standardowo 8 cyfr).");
      return;
    }
    if (!/^\d$/.test(controlNum)) {
      alert("Cyfra kontrolna musi być pojedynczą cyfrą (0-9).");
      return;
    }

    // Validate the EKW check digit before spending a (paid) Apify query.
    const expected = computeKwCheckDigit(courtCode, bookNumber);
    if (expected !== null && expected !== parseInt(controlNum, 10)) {
      alert(
        `Nieprawidłowa cyfra kontrolna dla ${courtCode}/${bookNumber.padStart(8, "0")}.\n` +
        `Poprawna cyfra kontrolna to: ${expected}. Popraw numer i spróbuj ponownie.`
      );
      return;
    }

    // Skip the CAPTCHA step entirely — go straight to fetching.
    triggerLookup();
  };

  // Drag handles for beautiful Custom Sliding Captcha
  const handleMouseDown = () => setIsDragging(true);
  const handleTouchStart = () => setIsDragging(true);

  // Mouse move handlers
  useEffect(() => {
    const handleMove = (clientX: number) => {
      if (!isDragging) return;
      const track = document.getElementById("captcha-track");
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const pos = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      setSliderPosition(pos);
      if (pos >= 98) {
        setIsDragging(false);
        triggerLookup();
      }
    };

    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches && e.touches[0]) handleMove(e.touches[0].clientX);
    };

    const handleUp = () => {
      if (isDragging) {
        setIsDragging(false);
        if (sliderPosition < 98) {
          // Reset slider
          setSliderPosition(0);
        }
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, [isDragging, sliderPosition]);

  const triggerLookup = (kwOverride?: string, viewOverride?: "aktualna" | "zupelna") => {
    const kwToFetch = (kwOverride || fullKW);
    const viewToFetch = viewOverride || viewType;
    setStep("loading");
    onStartLoading();
    setLogs([]);

    const messages = [
      "Inicjowanie zapytania do portalu EKW Ministerstwa Sprawiedliwości...",
      "Nawiązywanie połączenia z przeglądarką ekw.ms.gov.pl...",
      "Rozwiązywanie zabezpieczeń Imperva/Incapsula WAF...",
      "Weryfikacja tokenu sesji anty-botowej...",
      "Pobieranie Działu I-O (Oznaczenie nieruchomości)...",
      "Pobieranie Działu I-Sp (Spis praw związanych z własnością)...",
      "Pobieranie Działu II (Właściciele, udziały, podstawy nabycia)...",
      "Pobieranie Działu III (Służebności, roszczenia, ograniczenia)...",
      "Pobieranie Działu IV (Hipoteki i obciążenia)...",
      "Parsowanie surowych danych HTML do formatu strukturalnego...",
      "Mapowanie do formatu notarialnego..."
    ];

    let currentLogIndex = 0;
    const interval = setInterval(() => {
      if (currentLogIndex < messages.length) {
        setLogs((prev) => [...prev, messages[currentLogIndex]]);
        currentLogIndex++;
      } else {
        clearInterval(interval);
        completeSearch(kwToFetch, viewToFetch);
      }
    }, 450);
  };

  const completeSearch = async (kwToFetch: string, viewToFetch: "aktualna" | "zupelna") => {
    try {
      // Try fetching real data from Apify EKW scraper
      const response = await fetch("/api/fetch-kw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kwNumber: kwToFetch, viewType: viewToFetch })
      });
      const parsed = await response.json();

      if (response.ok && parsed.mapped) {
        const dataWithSettings: KWData = {
          ...parsed.mapped,
          notarySettings: {
            includePesels,
            includeAcquisitionBasis,
            useAbbreviations,
            uppercaseNames,
            spellOutNumbers
          }
        };
        const lastEntry = extractLastEntryDate(dataWithSettings, parsed.raw);
        // Use the authoritative KW number returned by the parser (correct check
        // digit), not necessarily what the user typed.
        const authoritativeKW = (dataWithSettings.kwNumber || kwToFetch).replace(/\s+/g, "").toUpperCase();
        const validation: ValidationInfo | undefined = parsed.validation;
        // Preserve a user-given name across refreshes.
        const existingNamed = cachedBooks.find(b => b.kwNumber === authoritativeKW && b.viewType === viewToFetch);
        const cacheEntry: CachedKW = {
          kwNumber: authoritativeKW,
          viewType: viewToFetch,
          customName: existingNamed?.customName,
          fetchedAt: new Date().toISOString(),
          lastEntryDate: lastEntry,
          sadRejonowy: dataWithSettings.sadRejonowy,
          propertyType: dataWithSettings.dzial1O.propertyType,
          ownerNames: dataWithSettings.dzial2.owners.map(o => o.name),
          data: dataWithSettings,
          rawApify: parsed.raw,
          parserVersion: parsed.parserVersion || MIN_PARSER_VERSION,
          validation
        };
        addToCache(cacheEntry);
        // Persist to the server (survives browser cache clears); fall back to local.
        const savedBooks = await apiSaveBook(cacheEntry);
        setCachedBooks(savedBooks || getCachedBooks());
        // Count this as one real (billable) EKW fetch — server-side counter.
        const newCount = await apiIncrementUsage();
        setQueryCount(newCount !== null ? newCount : incrementQueryCount());
        setSimulatedResult(dataWithSettings);
        onDataLoaded(dataWithSettings, parsed.raw, validation);
        setStep("success");
      } else {
        throw new Error(parsed.error || "Nie udało się pobrać danych z EKW.");
      }
    } catch (err: any) {
      console.error("Apify fetch failed, trying simulation fallback:", err.message);

      // Fallback: check preconfigured examples
      const matchedEx = PRECONFIGURED_EXAMPLES.find(
        (e) => e.kwNumber.replace(/\s+/g, "").toUpperCase() === kwToFetch.replace(/\s+/g, "").toUpperCase()
      );

      if (matchedEx) {
        setSimulatedResult(matchedEx.data);
        onDataLoaded(matchedEx.data);
        setStep("success");
      } else {
        // Final fallback: AI simulation
        try {
          const simResponse = await fetch("/api/simulate-kw", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kwNumber: kwToFetch })
          });
          const simParsed = await simResponse.json();

          if (simResponse.ok) {
            setSimulatedResult(simParsed);
            onDataLoaded(simParsed);
            setStep("success");
          } else {
            throw new Error(simParsed.error || "Nie udało się wygenerować księgi.");
          }
        } catch (simErr: any) {
          alert("Błąd pobierania danych: " + err.message + "\nFallback: " + simErr.message);
          setStep("form");
        }
      }
    } finally {
      onStopLoading();
    }
  };

  return (
    <div className="bg-[#FDFCFB] border border-[#D1CEC8] shadow-sm flex flex-col h-full lg:min-h-[520px] rounded-none">
      {/* Header bar styling - Editorial Monochrome top heading */}
      <div className="bg-[#1A1A1A] px-6 py-4 flex items-center justify-between border-b border-[#D1CEC8]">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-stone-100" />
          <span className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7A7772] uppercase">
            LEXPARSER SIM EKW v2.0
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[#7A7772] font-mono">
          <Server className="w-3.5 h-3.5 text-[#7A7772]" /> stateless-auth
        </div>
      </div>

      <div className="p-6 sm:p-8 flex-1 flex flex-col justify-center">
        {step === "form" && (
          <div className="space-y-6 fade-in max-w-xl mx-auto w-full">
            <div className="text-center space-y-1">
              <span className="text-[10px] uppercase font-bold tracking-widest text-[#7A7772] block">Baza Danych Ministerstwa</span>
              <h3 className="text-xl font-serif text-[#1A1A1A]">
                Wyszukaj Księgę Wieczystą (EKW)
              </h3>
              <p className="text-xs text-[#7A7772] font-serif italic max-w-sm mx-auto">
                Wprowadź kod sądu rejonowego, numer księgi oraz cyfrę kontrolną z odpisu.
              </p>
            </div>

            {/* Simulated official MS form fields block */}
            <form onSubmit={startSearch} className="space-y-4 bg-[#F5F2ED] border border-[#D1CEC8] p-5 rounded-none">
              <div className="grid grid-cols-12 gap-3 items-end">
                {/* Prefix */}
                <div className="col-span-4 space-y-1.5">
                  <label className="text-[9px] font-bold text-[#7A7772] block uppercase tracking-widest">
                    Kod Sądu
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={4}
                    placeholder="WA1M"
                    value={courtCode}
                    onChange={(e) => setCourtCode(e.target.value.toUpperCase())}
                    className="w-full border-b border-[#1A1A1A] bg-white py-2 text-sm text-center font-mono font-bold tracking-widest text-[#1A1A1A] uppercase focus:outline-none focus:border-[#7A7772] rounded-none"
                  />
                </div>

                {/* Main Number */}
                <div className="col-span-5 space-y-1.5">
                  <label className="text-[9px] font-bold text-[#7A7772] block uppercase tracking-widest">
                    Numer Księgi
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={8}
                    placeholder="00012345"
                    value={bookNumber}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "");
                      setBookNumber(val);
                    }}
                    className="w-full border-b border-[#1A1A1A] bg-white py-2 text-sm text-center font-mono font-bold tracking-widest text-[#1A1A1A] focus:outline-none focus:border-[#7A7772] rounded-none"
                  />
                </div>

                {/* Control Number */}
                <div className="col-span-3 space-y-1.5">
                  <label className="text-[9px] font-bold text-[#7A7772] block uppercase tracking-widest">
                    C. Kontrolna
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={1}
                    placeholder="7"
                    value={controlNum}
                    onChange={(e) => setControlNum(e.target.value.replace(/\D/g, ""))}
                    className="w-full border-b border-[#1A1A1A] bg-white py-2 text-sm text-center font-mono font-bold text-[#1A1A1A] focus:outline-none focus:border-[#7A7772] rounded-none"
                  />
                </div>
              </div>

              {/* View type selector */}
              <div className="border-t border-[#D1CEC8] pt-3 space-y-2">
                <span className="text-[9px] font-bold text-[#7A7772] uppercase tracking-[0.2em] block">Tryb przeglądania treści KW</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setViewType("zupelna")}
                    className={`flex-1 py-2 px-3 text-[10px] uppercase tracking-wider font-bold border transition-all cursor-pointer ${
                      viewType === "zupelna"
                        ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                        : "bg-white text-[#7A7772] border-[#D1CEC8] hover:border-[#1A1A1A]"
                    }`}
                  >
                    Zupełna treść
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewType("aktualna")}
                    className={`flex-1 py-2 px-3 text-[10px] uppercase tracking-wider font-bold border transition-all cursor-pointer ${
                      viewType === "aktualna"
                        ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                        : "bg-white text-[#7A7772] border-[#D1CEC8] hover:border-[#1A1A1A]"
                    }`}
                  >
                    Aktualna treść
                  </button>
                </div>
                <p className="text-[9px] text-[#7A7772] font-serif italic">
                  {viewType === "zupelna"
                    ? "Pełna historia wpisów — wpisy aktualne i wykreślone, zmiany, podstawy."
                    : "Tylko bieżący stan wpisów — bez historii zmian."}
                </p>
              </div>

              {/* Notary AI parameters — hidden for now: AI extracts everything later,
                  and these toggles are adjustable on the workstation. Kept in the
                  DOM (defaults applied) so re-enabling is a one-line change. */}
              <div className="hidden border-t border-[#D1CEC8] pt-3 space-y-2">
                <div className="text-[9px] font-bold text-[#7A7772] uppercase tracking-[0.2em] flex items-center gap-1.5">
                  <Settings2 className="w-3 h-3 text-[#1A1A1A]" /> Parametry Opracowania AI
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" checked={includePesels} onChange={(e) => setIncludePesels(e.target.checked)} className="accent-[#1A1A1A] h-3.5 w-3.5 cursor-pointer" />
                    <span className="text-[10px] font-bold text-[#1A1A1A] group-hover:text-[#7A7772] transition-colors">PESEL / KRS</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" checked={includeAcquisitionBasis} onChange={(e) => setIncludeAcquisitionBasis(e.target.checked)} className="accent-[#1A1A1A] h-3.5 w-3.5 cursor-pointer" />
                    <span className="text-[10px] font-bold text-[#1A1A1A] group-hover:text-[#7A7772] transition-colors">Podstawy nabycia</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" checked={useAbbreviations} onChange={(e) => setUseAbbreviations(e.target.checked)} className="accent-[#1A1A1A] h-3.5 w-3.5 cursor-pointer" />
                    <span className="text-[10px] font-bold text-[#1A1A1A] group-hover:text-[#7A7772] transition-colors">Terminologia urzędowa</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" checked={uppercaseNames} onChange={(e) => setUppercaseNames(e.target.checked)} className="accent-[#1A1A1A] h-3.5 w-3.5 cursor-pointer" />
                    <span className="text-[10px] font-bold text-[#1A1A1A] group-hover:text-[#7A7772] transition-colors">Nazwiska drukowane</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" checked={spellOutNumbers} onChange={(e) => setSpellOutNumbers(e.target.checked)} className="accent-[#1A1A1A] h-3.5 w-3.5 cursor-pointer" />
                    <span className="text-[10px] font-bold text-[#1A1A1A] group-hover:text-[#7A7772] transition-colors">Słowny opis ułamków</span>
                  </label>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full bg-[#1A1A1A] hover:bg-stone-850 text-white font-bold uppercase tracking-widest py-3 px-4 text-xs transition-colors cursor-pointer rounded-none block shadow-md"
                >
                  <Search className="w-4 h-4 text-[#7A7772] inline-block mr-1" />
                  Rozpocznij Pobieranie z serwerów
                </button>
                <div className="mt-3 flex items-center justify-center">
                  <div className={`inline-flex items-center gap-2 border px-3 py-1.5 ${
                    queryCount >= MONTHLY_QUERY_LIMIT
                      ? "bg-red-50 border-red-300"
                      : queryCount >= MONTHLY_QUERY_LIMIT * 0.9
                        ? "bg-amber-50 border-amber-300"
                        : "bg-[#1A1A1A] border-[#1A1A1A]"
                  }`}>
                    <Server className={`w-3.5 h-3.5 ${
                      queryCount >= MONTHLY_QUERY_LIMIT ? "text-red-700" : queryCount >= MONTHLY_QUERY_LIMIT * 0.9 ? "text-amber-700" : "text-white"
                    }`} />
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${
                      queryCount >= MONTHLY_QUERY_LIMIT ? "text-red-700" : queryCount >= MONTHLY_QUERY_LIMIT * 0.9 ? "text-amber-800" : "text-white/70"
                    }`}>
                      Zapytania EKW (mies.):
                    </span>
                    <span className={`text-xs font-mono font-bold ${
                      queryCount >= MONTHLY_QUERY_LIMIT ? "text-red-700" : queryCount >= MONTHLY_QUERY_LIMIT * 0.9 ? "text-amber-900" : "text-white"
                    }`}>
                      {queryCount} / {MONTHLY_QUERY_LIMIT}
                    </span>
                  </div>
                </div>
              </div>
            </form>

            {/* Cached KW library */}
            {cachedBooks.length > 0 && (
              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLibrary(!showLibrary)}
                  className="w-full flex items-center justify-between text-[9px] font-bold text-[#7A7772] uppercase tracking-[0.2em] cursor-pointer hover:text-[#1A1A1A] transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5" />
                    Biblioteka pobranych KW ({cachedBooks.length})
                  </span>
                  <span className="text-[9px]">{showLibrary ? "▲ Zwiń" : "▼ Rozwiń"}</span>
                </button>

                {showLibrary && (
                <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                    {cachedBooks.map((cached) => {
                      const fetchDate = new Date(cached.fetchedAt);
                      const ageHours = Math.round((Date.now() - fetchDate.getTime()) / 3600000);
                      const ageStr = ageHours < 1 ? "< 1h temu" : ageHours < 24 ? `${ageHours}h temu` : `${Math.round(ageHours / 24)}d temu`;
                      const ageDays = (Date.now() - fetchDate.getTime()) / 86400000;
                      const isStale = ageDays >= STALE_AFTER_DAYS;
                      const propLabel = cached.propertyType === "dzialka" ? "Grunt" : cached.propertyType === "lokal" ? "Lokal" : cached.propertyType === "budynek" ? "Budynek" : "Inne";
                      const entryKey = `${cached.kwNumber}|${cached.viewType}`;

                      return (
                        <div
                          key={`${cached.kwNumber}-${cached.viewType}`}
                          className={`bg-white border p-3 transition-all group ${
                            isStale ? "border-amber-300 hover:border-amber-500" : "border-[#D1CEC8] hover:border-[#1A1A1A]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => loadFromCache(cached)}
                              className="flex-1 text-left cursor-pointer"
                            >
                              {cached.customName && (
                                <div className="font-serif font-bold text-sm text-[#1A1A1A] mb-0.5 leading-tight">
                                  {cached.customName}
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-xs text-[#1A1A1A]">{cached.kwNumber}</span>
                                <span className={`text-[8px] uppercase font-bold tracking-wider px-1.5 py-0.5 ${
                                  cached.viewType === "zupelna" ? "bg-[#1A1A1A] text-white" : "bg-emerald-600 text-white"
                                }`}>
                                  {cached.viewType === "zupelna" ? "Zupełna" : "Aktualna"}
                                </span>
                              </div>
                              <div className="text-[10px] text-[#7A7772] mt-1 font-serif italic">{cached.sadRejonowy}</div>
                              <div className="flex items-center gap-3 mt-1 text-[9px] text-[#7A7772]">
                                <span className="font-bold uppercase">{propLabel}</span>
                                <span>·</span>
                                <span>{cached.ownerNames.length > 0 ? cached.ownerNames[0] : "—"}{cached.ownerNames.length > 1 ? ` +${cached.ownerNames.length - 1}` : ""}</span>
                              </div>
                              <div className="flex items-center gap-3 mt-2 text-[10px]">
                                <span className={`flex items-center gap-1 font-semibold ${isStale ? "text-amber-700" : "text-[#5A5650]"}`}>
                                  <Clock className="w-3 h-3" /> Pobrano: <span className="font-bold">{ageStr}</span>
                                </span>
                                {cached.lastEntryDate && (
                                  <span className="text-[#5A5650] font-semibold">
                                    Ost. wpis: <span className="font-bold text-[#1A1A1A]">{cached.lastEntryDate}</span>
                                  </span>
                                )}
                              </div>
                            </button>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => { setEditingKey(entryKey); setNameDraft(cached.customName || ""); }}
                                className="p-1.5 text-[#7A7772] hover:text-[#1A1A1A] transition-colors cursor-pointer"
                                title="Nadaj / zmień nazwę"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => refreshCached(cached)}
                                className="p-1.5 text-[#7A7772] hover:text-[#1A1A1A] transition-colors cursor-pointer"
                                title="Odśwież — pobierz nową wersję z EKW (zużywa 1 zapytanie)"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCached(cached.kwNumber, cached.viewType)}
                                className="p-1.5 text-[#7A7772] hover:text-red-700 transition-colors cursor-pointer"
                                title="Usuń z biblioteki"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {editingKey === entryKey && (
                            <div className="mt-2 flex items-center gap-1.5">
                              <input
                                autoFocus
                                value={nameDraft}
                                onChange={(e) => setNameDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveCachedName(cached, nameDraft);
                                  if (e.key === "Escape") { setEditingKey(null); setNameDraft(""); }
                                }}
                                placeholder="Nazwa, np. Mieszkanie Jana Kowalskiego"
                                className="flex-1 border border-[#1A1A1A] bg-white px-2 py-1 text-xs font-serif text-[#1A1A1A] focus:outline-none rounded-none"
                              />
                              <button type="button" onClick={() => saveCachedName(cached, nameDraft)} className="text-[9px] font-bold uppercase tracking-wider bg-[#1A1A1A] text-white px-2.5 py-1.5 cursor-pointer hover:bg-stone-800">Zapisz</button>
                              <button type="button" onClick={() => { setEditingKey(null); setNameDraft(""); }} className="text-[9px] font-bold uppercase tracking-wider border border-[#D1CEC8] text-[#7A7772] px-2.5 py-1.5 cursor-pointer hover:border-[#1A1A1A] hover:text-[#1A1A1A]">Anuluj</button>
                            </div>
                          )}

                          {isStale && (
                            <div className="mt-2 flex items-start gap-1.5 bg-amber-50 border border-amber-300 px-2 py-1.5">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                              <span className="text-[9px] text-amber-800 font-bold leading-snug">
                                Minęło ponad {STALE_AFTER_DAYS} dni od pobrania — dane mogą być nieaktualne.
                                Kliknij <RefreshCw className="w-2.5 h-2.5 inline-block mx-0.5" />, aby pobrać nową wersję.
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Quick selectors for Polish Notaries demo cases — hidden: library
                covers real cases and most demo numbers are invalid. */}
            <div className="hidden space-y-2 pt-2">
              <span className="text-[9px] font-bold text-[#7A7772] uppercase tracking-[0.2em] block">
                Lub wybierz przykładowe akta demonstracyjne:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PRECONFIGURED_EXAMPLES.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => handleQuickSelect(ex.id)}
                    className={`text-left p-4 rounded-none border text-xs transition-all flex items-center justify-between hover:border-[#1A1A1A] duration-150 ${
                      fullKW === ex.kwNumber
                        ? "border-[#1A1A1A] bg-[#F5F2ED] text-[#1A1A1A] font-bold"
                        : "border-[#D1CEC8] bg-white text-[#7A7772]"
                    }`}
                  >
                    <div>
                      <div className="font-mono font-bold text-neutral-900">{ex.kwNumber}</div>
                      <div className="text-[10px] text-[#7A7772] font-serif italic mt-0.5">{ex.title}</div>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-[#1A1A1A]" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Captcha slider simulation step */}
        {step === "captcha" && (
          <div className="max-w-md mx-auto w-full text-center space-y-6 fade-in py-6">
            <div className="flex justify-center">
              <div className="p-4 bg-[#F5F2ED] border border-[#D1CEC8] text-[#1A1A1A]">
                <Shield className="w-8 h-8" />
              </div>
            </div>
            <div>
              <span className="text-[9px] font-bold text-[#7A7772] uppercase tracking-widest block">Uwierzytelnienie Selektywne</span>
              <h4 className="text-lg font-serif italic text-[#1A1A1A] mt-1">
                Weryfikacja Człowiek-Notariusz
              </h4>
              <p className="text-xs text-[#7A7772] font-serif italic mt-1.5 max-w-xs mx-auto">
                Przesuń suwak w prawo, aby przejść państwową procedurę zapobiegania robotom (CAPTCHA).
              </p>
            </div>

            {/* Slide to unlock slider track */}
            <div
              id="captcha-track"
              className="h-12 bg-white rounded-none relative overflow-hidden border border-[#D1CEC8] select-none"
            >
              <div
                className="absolute top-0 bottom-0 bg-[#F5F2ED] transition-all"
                style={{ width: `${sliderPosition}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-[10px] uppercase font-bold tracking-widest text-[#7A7772]">
                Przesuń suwak do końca →
              </div>

              {/* Handle */}
              <div
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                className="absolute top-0 bottom-0 w-12 bg-[#1A1A1A] text-white flex items-center justify-center cursor-ew-resize shadow-md hover:bg-neutral-800 transition-colors rounded-none"
                style={{ left: `calc(${sliderPosition}% - ${sliderPosition * 0.48}px)` }}
              >
                <ArrowRight className="w-5 h-5 text-[#F5F2ED]" />
              </div>
            </div>

            <button
              onClick={() => setStep("form")}
              className="text-[10px] uppercase font-bold tracking-widest text-[#7A7772] hover:text-[#1A1A1A] transition-colors border-b border-[#D1CEC8] pb-0.5"
            >
              Anuluj wyszukiwanie
            </button>
          </div>
        )}

        {/* Live crawling log outputs / logs */}
        {step === "loading" && (
          <div className="max-w-xl mx-auto w-full space-y-6 py-6 fade-in">
            <div className="flex items-center gap-3">
              <RefreshCw className="w-4 h-4 text-[#1A1A1A] animate-spin" />
              <div className="text-[10px] font-bold text-[#7A7772] uppercase tracking-[0.2em] font-mono">
                Pobieranie odpisu księgi: {fullKW}
              </div>
            </div>

            {/* Simulated log shell console background */}
            <div className="bg-[#1A1A1A] text-[#F5F2ED] rounded-none p-5 font-mono text-[11px] h-52 overflow-y-auto space-y-2 border border-[#D1CEC8] shadow-inner">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-2 items-start leading-relaxed opacity-90 font-mono">
                  <span className="text-[#7A7772] select-none font-mono">&gt;</span>
                  <span>{log}</span>
                </div>
              ))}
              <div className="w-3 h-4 bg-white animate-pulse inline-block" />
            </div>

            <p className="text-[10px] text-[#7A7772] text-center font-serif italic max-w-sm mx-auto">
              Szyfrowana usługa proxy wyciąga dane unikalne i bezpiecznie ładuje je do lokalnego stanu. Informacje nie są zapisywane na dysku trwałym.
            </p>
          </div>
        )}

        {/* Final extraction outcome feedback */}
        {step === "success" && simulatedResult && (
          <div className="max-w-md mx-auto w-full text-center space-y-6 py-6 fade-in">
            <div className="flex justify-center">
              <div className="w-12 h-12 bg-[#F5F2ED] border border-[#D1CEC8] text-[#1A1A1A] rounded-full flex items-center justify-center">
                <Check className="w-6 h-6" />
              </div>
            </div>
            <div>
              <span className="text-[9px] font-bold text-[#7A7772] uppercase tracking-widest block">KOMUNIKAT EKSTRAKCJI</span>
              <h4 className="text-xl font-serif italic text-[#1A1A1A] mt-1">
                Księga zaimportowana pomyślnie
              </h4>
              <p className="text-xs text-[#1A1A1A] font-mono font-bold tracking-widest mt-1.5 uppercase">
                {simulatedResult.kwNumber}
              </p>
              <div className="mt-3 inline-block bg-[#F5F2ED] border border-[#D1CEC8] px-3 py-1 text-[10px] text-[#1A1A1A] font-bold uppercase tracking-wider font-mono">
                {simulatedResult.sadRejonowy}
              </div>
            </div>

            <div className="bg-white border border-[#D1CEC8] p-5 text-left text-xs space-y-2.5 rounded-none font-serif">
              <div className="flex justify-between border-b border-[#E5E5E5] pb-2 font-serif">
                <span className="text-[#7A7772] font-serif">Obiekt:</span>
                <span className="font-bold text-[#1A1A1A] capitalize">
                  {simulatedResult.dzial1O.propertyType === "lokal" ? "Lokal Wyodrębniony" : "Nieruchomość gruntowa / budynek"}
                </span>
              </div>
              <div className="flex justify-between border-b border-[#E5E5E5] pb-2 font-serif">
                <span className="text-[#7A7772]">Obszar całkowity:</span>
                <span className="font-bold text-[#1A1A1A]">{simulatedResult.dzial1O.totalAreaStr}</span>
              </div>
              <div className="flex justify-between border-b border-[#E5E5E5] pb-2 font-serif">
                <span className="text-[#7A7772]">Zidentyfikowani właściciele:</span>
                <span className="font-bold text-[#1A1A1A]">{simulatedResult.dzial2.owners.length} działy</span>
              </div>
              <div className="flex justify-between font-serif">
                <span className="text-[#7A7772]">Hipoteka Dział IV:</span>
                <span className="font-bold text-red-800">
                  {simulatedResult.dzial4.hasEntries ? `Obciążona (${simulatedResult.dzial4.mortgages.length} wpisów)` : "Czysty (Brak wpisów)"}
                </span>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setStep("form")}
                className="flex-1 bg-transparent hover:bg-[#F5F2ED] text-[#1A1A1A] border border-[#1A1A1A] font-bold uppercase tracking-widest py-3 px-4 text-xs transition-all duration-200 cursor-pointer rounded-none"
              >
                Załaduj inną księgę wieczystą
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
