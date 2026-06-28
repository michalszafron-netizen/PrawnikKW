import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Building2,
  Scale,
  User,
  Shield,
  Coins,
  AlertTriangle,
  Eye,
  EyeOff,
  FileText,
} from "lucide-react";

interface RubricViewerProps {
  rawApify: any;
  kwNumber: string;
}

interface RubricEntry {
  label: string;
  value: string;
}

interface Rubric {
  id: string;
  title: string;
  entries: RubricEntry[];
  subrubrics: Rubric[];
}

interface DzialSection {
  key: string;
  title: string;
  icon: React.ReactNode;
  empty: boolean;
  rawText?: string;
  rubrics: Rubric[];
}

function extractVal(rawValue: string): string {
  if (!rawValue) return "";
  const parts = rawValue.split("|").map((s) => s.trim());
  const last = parts[parts.length - 1];
  return !last || last === "---" ? "" : last;
}

function parseRubrics(entries: RubricEntry[]): Rubric[] {
  const rubrics: Rubric[] = [];
  let currentRubric: Rubric | null = null;
  let currentSubrubric: Rubric | null = null;

  for (const entry of entries) {
    if (entry.label === "_header") {
      const val = entry.value || "";

      if (/^Podrubryka\s/i.test(val)) {
        currentSubrubric = {
          id: val,
          title: val,
          entries: [],
          subrubrics: [],
        };
        if (currentRubric) {
          currentRubric.subrubrics.push(currentSubrubric);
        }
        continue;
      }

      if (/^Rubryka\s/i.test(val)) {
        currentSubrubric = null;
        currentRubric = {
          id: val,
          title: val,
          entries: [],
          subrubrics: [],
        };
        rubrics.push(currentRubric);
        continue;
      }

      if (/^DZIAŁ\s/i.test(val)) continue;
      if (val === "-" || val === "---") continue;
      if (/^Brak wpisu$/i.test(val)) {
        const target = currentSubrubric || currentRubric;
        if (target) target.entries.push({ label: "", value: "BRAK WPISU" });
        continue;
      }

      continue;
    }

    if (entry.label === "Lp." || entry.label === "Wpisu") continue;
    if (
      entry.label === "Numer i nazwa pola" &&
      /Indeks|podst|Treść/i.test(entry.value)
    )
      continue;

    const target = currentSubrubric || currentRubric;
    if (target) {
      target.entries.push(entry);
    }
  }

  return rubrics;
}

// The "aktualna" view has no "Rubryka/Podrubryka" headers — instead it uses plain
// section captions ("Działki ewidencyjne", "Właściciele", "Wierzyciel hipoteczny",
// …). Clean a value for faithful display: drop the leading "Lp. N. |" scaffolding
// and the trailing "| Nr podstawy wpisu" label, and turn remaining pipes into a
// readable separator.
function cleanFlatValue(raw: string): string {
  if (!raw) return "";
  let v = raw.replace(/^Lp\.\s*\d+\.?\s*\|\s*/i, "");
  v = v.replace(/\s*\|\s*Nr podstawy wpisu\s*$/i, "");
  v = v.replace(/\s*\|\s*/g, " · ");
  return v.trim();
}

function parseRubricsFlat(entries: RubricEntry[]): Rubric[] {
  const rubrics: Rubric[] = [];
  let current: Rubric | null = null;
  const ensure = (): Rubric => {
    if (!current) {
      current = { id: "grp-0", title: "Treść wpisu", entries: [], subrubrics: [] };
      rubrics.push(current);
    }
    return current;
  };

  for (const entry of entries) {
    const label = entry.label || "";
    const val = entry.value || "";

    if (label === "_header") {
      if (/^DZIAŁ\s/i.test(val) || val === "-" || val === "---" || !val.trim()) continue;
      if (/^Brak wpisu$/i.test(val)) {
        ensure().entries.push({ label: "", value: "BRAK WPISU" });
        continue;
      }
      // A long, data-like header (e.g. a "DZ. KW./..." wniosek line) is content,
      // not a section caption.
      if (/^DZ\.\s*KW/i.test(val) || val.length > 90) {
        ensure().entries.push({ label: "", value: cleanFlatValue(val) });
        continue;
      }
      current = { id: `${val}-${rubrics.length}`, title: val, entries: [], subrubrics: [] };
      rubrics.push(current);
      continue;
    }

    // Skip "aktualna" row delimiters ("Lp. N." + "Nr podstawy wpisu") and scaffolding.
    if (/^Lp\.\s*\d+\.?$/i.test(label.trim()) && /nr podstawy wpisu/i.test(val)) continue;
    if (label === "Lp." || label === "Wpisu") continue;

    ensure().entries.push({ label, value: cleanFlatValue(val) });
  }

  return rubrics;
}

// Recover the "Komentarz do migracji" (field A) text. The Apify scraper often
// drops this long field from the structured entries (keeping only field B), but
// it survives in the section's rawText. The A-label always ends with
// "...przeniesione z dotychczasowej księgi wieczystej" and the value runs until
// "B: Ostatni numer ...".
function extractMigrationComment(rawText?: string): string {
  if (!rawText) return "";
  const m = rawText.match(
    /przeniesione z dotychczasowej księgi wieczystej\s*([\s\S]*?)\s*B:\s*Ostatni numer/
  );
  if (!m) return "";
  return (m[1] || "").replace(/^\s*\d+\.\s*-*\s*/, "").trim();
}

// Pick the right parser based on the data shape (zupełna has Rubryka/Podrubryka
// headers; aktualna does not).
function buildRubrics(entries: RubricEntry[]): Rubric[] {
  const hasRubrykaHeaders = entries.some(
    (e) => e.label === "_header" && /^(Rubryka|Podrubryka)\s/i.test(e.value || "")
  );
  return hasRubrykaHeaders ? parseRubrics(entries) : parseRubricsFlat(entries);
}

function RubricBlock({
  rubric,
  depth = 0,
  dzialFilters,
}: {
  rubric: Rubric;
  depth?: number;
  dzialFilters: Set<string>;
}) {
  const [open, setOpen] = useState(depth === 0);

  const rubricNum = rubric.title.match(
    /(?:Pod)?[Rr]ubryka\s+([\d.]+)/
  )?.[1];
  if (rubricNum && !dzialFilters.has(rubricNum)) return null;

  const isSub = depth > 0;
  const hasContent =
    rubric.entries.some(
      (e) => e.value && !/^BRAK WPISU$/i.test(e.value) && extractVal(e.value)
    ) || rubric.subrubrics.some((s) => s.entries.length > 0);

  const isEmpty = rubric.entries.every(
    (e) => !e.value || /^BRAK WPISU$/i.test(e.value)
  );

  return (
    <div
      className={`${isSub ? "ml-3 border-l-2 border-[#E5E5E5] pl-3" : ""}`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-2 py-1.5 text-left cursor-pointer group ${
          isSub ? "hover:bg-[#F5F2ED]/50" : "hover:bg-[#F5F2ED]"
        }`}
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-[#7A7772] shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-[#7A7772] shrink-0" />
        )}
        <span
          className={`${
            isSub
              ? "text-[9px] text-[#7A7772]"
              : "text-[10px] text-[#1A1A1A] font-bold"
          } uppercase tracking-wider flex-1`}
        >
          {rubric.title}
        </span>
        {isEmpty && (
          <span className="text-[8px] text-[#7A7772] italic font-serif tracking-normal normal-case">
            brak wpisów
          </span>
        )}
        {!isEmpty && !open && (
          <span className="text-[8px] text-[#7A7772] font-mono">
            {rubric.entries.filter((e) => extractVal(e.value)).length} pól
          </span>
        )}
      </button>

      {open && (
        <div className="pb-2 space-y-0.5">
          {rubric.entries.map((entry, idx) => {
            const cleanVal = extractVal(entry.value);
            const isBrakWpisu = /^BRAK WPISU$/i.test(entry.value);

            if (isBrakWpisu) {
              return (
                <div
                  key={idx}
                  className="text-[10px] text-[#7A7772] italic font-serif py-1 pl-5"
                >
                  Brak wpisu
                </div>
              );
            }

            if (!cleanVal && !entry.value) return null;

            const displayLabel = entry.label
              .replace(/^\d+\.\s*/, "")
              .trim();

            return (
              <div
                key={idx}
                className="grid grid-cols-12 gap-2 py-0.5 pl-5 text-[10px] hover:bg-[#F5F2ED]/30"
              >
                <div className="col-span-5 text-[#7A7772] font-medium truncate" title={displayLabel || entry.label}>
                  {displayLabel || entry.label}
                </div>
                <div
                  className="col-span-7 text-[#1A1A1A] font-serif break-words"
                  title={cleanVal || entry.value}
                >
                  {cleanVal || (
                    <span className="text-[#D1CEC8]">---</span>
                  )}
                </div>
              </div>
            );
          })}

          {rubric.subrubrics.map((sub) => (
            <RubricBlock
              key={sub.id}
              rubric={sub}
              depth={depth + 1}
              dzialFilters={dzialFilters}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const DZIAL_CONFIG: {
  key: string;
  rawKey: string;
  title: string;
  icon: React.ReactNode;
}[] = [
  {
    key: "IO",
    rawKey: "dzialIO",
    title: "Dział I-O: Oznaczenie Nieruchomości",
    icon: <Building2 className="w-3.5 h-3.5" />,
  },
  {
    key: "ISp",
    rawKey: "dzialISp",
    title: "Dział I-Sp: Spis Praw Związanych",
    icon: <Scale className="w-3.5 h-3.5" />,
  },
  {
    key: "II",
    rawKey: "dzialII",
    title: "Dział II: Własność",
    icon: <User className="w-3.5 h-3.5" />,
  },
  {
    key: "III",
    rawKey: "dzialIII",
    title: "Dział III: Prawa, Roszczenia, Ograniczenia",
    icon: <Shield className="w-3.5 h-3.5" />,
  },
  {
    key: "IV",
    rawKey: "dzialIV",
    title: "Dział IV: Hipoteka",
    icon: <Coins className="w-3.5 h-3.5" />,
  },
];

export default function RubricViewer({ rawApify, kwNumber }: RubricViewerProps) {
  const [openDzialy, setOpenDzialy] = useState<Set<string>>(
    new Set(["OKL", "IO", "ISp", "II", "III", "IV"])
  );
  const [showEmpty, setShowEmpty] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  if (!rawApify) {
    return (
      <div className="text-center py-12 text-[#7A7772] font-serif italic text-sm">
        Widok rubryk jest dostępny tylko dla ksiąg pobranych z portalu EKW
        (dane surowe Apify).
      </div>
    );
  }

  const toggleDzial = (key: string) => {
    setOpenDzialy((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Synthetic "Okładka" (cover) section. The Apify scraper does not return the
  // cover rubrics (0.x), but a few cover fields arrive as top-level values — we
  // surface those so the Rubryki layout mirrors the portal (Okładka first).
  const coverEntries: RubricEntry[] = [];
  const pushCover = (label: string, val: any) => {
    const s = (val === null || val === undefined) ? "" : String(val).trim();
    if (s && s.toLowerCase() !== "null") coverEntries.push({ label, value: s });
  };
  pushCover("Numer księgi", rawApify.kwNumber);
  pushCover("Sąd / nazwa wydziału", rawApify.courtName);
  pushCover("Kod wydziału", rawApify.courtCode);
  pushCover("Typ księgi", rawApify.propertyType);

  const coverSection: DzialSection = {
    key: "OKL",
    title: "Okładka — Oznaczenie Księgi Wieczystej",
    icon: <FileText className="w-3.5 h-3.5" />,
    empty: coverEntries.length === 0,
    rubrics: coverEntries.length > 0
      ? [{ id: "Rubryka 0.1 - Informacje podstawowe", title: "Rubryka 0.1 - Informacje podstawowe", entries: coverEntries, subrubrics: [] }]
      : [],
  };

  const sections: DzialSection[] = [coverSection, ...DZIAL_CONFIG.map((cfg) => {
    const raw = rawApify[cfg.rawKey];
    if (!raw)
      return {
        key: cfg.key,
        title: cfg.title,
        icon: cfg.icon,
        empty: true,
        rubrics: [],
      };

    return {
      key: cfg.key,
      title: cfg.title,
      icon: cfg.icon,
      empty: raw.empty === true,
      rawText: raw.rawText,
      rubrics: (() => {
        const rubrics = buildRubrics(raw.entries || []);
        // Inject the migration comment (field A) that the scraper dropped.
        const comment = extractMigrationComment(raw.rawText);
        if (comment) {
          for (const r of rubrics) {
            if (/Komentarz/i.test(r.title)) {
              const already = r.entries.some((e) => (e.value || "").includes(comment.slice(0, 24)));
              if (!already) r.entries.unshift({ label: "Komentarz do migracji", value: comment });
            }
          }
        }
        return rubrics;
      })(),
    };
  })];

  const allRubricIds = new Set<string>();
  for (const sec of sections) {
    for (const r of sec.rubrics) {
      const m = r.title.match(/(?:Pod)?[Rr]ubryka\s+([\d.]+)/);
      if (m) allRubricIds.add(m[1]);
      for (const s of r.subrubrics) {
        const sm = s.title.match(/(?:Pod)?[Rr]ubryka\s+([\d.]+)/);
        if (sm) allRubricIds.add(sm[1]);
      }
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Szukaj w rubrykach..."
            className="bg-white border border-[#D1CEC8] px-2.5 py-1 text-xs font-serif focus:outline-none focus:border-[#7A7772] w-52"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowEmpty(!showEmpty)}
          className="flex items-center gap-1 text-[9px] uppercase font-bold tracking-wider text-[#7A7772] hover:text-[#1A1A1A] cursor-pointer"
        >
          {showEmpty ? (
            <Eye className="w-3 h-3" />
          ) : (
            <EyeOff className="w-3 h-3" />
          )}
          {showEmpty ? "Ukryj puste" : "Pokaż puste"}
        </button>
      </div>

      {sections.map((sec) => {
        if (!showEmpty && sec.empty) return null;

        const hasWzmianki = sec.rubrics.some((r) =>
          /wzmianki/i.test(r.title) &&
          r.entries.some(
            (e) => e.value && !/^BRAK WPISU$/i.test(e.value) && e.value !== "---"
          )
        );

        return (
          <div
            key={sec.key}
            className="border border-[#D1CEC8] bg-white overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggleDzial(sec.key)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-left cursor-pointer hover:bg-[#F5F2ED] transition-colors"
            >
              {openDzialy.has(sec.key) ? (
                <ChevronDown className="w-3.5 h-3.5 text-[#7A7772] shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-[#7A7772] shrink-0" />
              )}
              <span className="text-[#7A7772]">{sec.icon}</span>
              <span className="text-[10px] font-bold text-[#7A7772] uppercase tracking-[0.15em] flex-1">
                {sec.title}
              </span>
              {sec.empty && (
                <span className="text-[8px] text-[#7A7772] italic font-serif">
                  BRAK WPISÓW
                </span>
              )}
              {hasWzmianki && (
                <span className="text-[8px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5">
                  Wzmianka
                </span>
              )}
              <span className="text-[8px] text-[#7A7772] font-mono">
                {sec.rubrics.length} rubryk
              </span>
            </button>

            {openDzialy.has(sec.key) && (
              <div className="px-4 pb-3 pt-1">
                {sec.empty ? (
                  <div className="text-center py-4 text-[#7A7772] font-serif italic text-xs bg-[#F5F2ED] border border-dashed border-[#D1CEC8]">
                    {sec.rawText || "Brak wpisów"}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {sec.rubrics.map((rubric) => {
                      if (
                        !showEmpty &&
                        rubric.entries.every(
                          (e) =>
                            !e.value ||
                            /^BRAK WPISU$/i.test(e.value)
                        ) &&
                        rubric.subrubrics.every((s) =>
                          s.entries.every(
                            (e) =>
                              !e.value ||
                              /^BRAK WPISU$/i.test(e.value)
                          )
                        )
                      )
                        return null;

                      if (
                        searchQuery &&
                        !rubric.title
                          .toLowerCase()
                          .includes(searchQuery.toLowerCase()) &&
                        !rubric.entries.some(
                          (e) =>
                            extractVal(e.value)
                              ?.toLowerCase()
                              .includes(searchQuery.toLowerCase()) ||
                            e.label
                              ?.toLowerCase()
                              .includes(searchQuery.toLowerCase())
                        ) &&
                        !rubric.subrubrics.some((s) =>
                          s.entries.some(
                            (e) =>
                              extractVal(e.value)
                                ?.toLowerCase()
                                .includes(searchQuery.toLowerCase()) ||
                              e.label
                                ?.toLowerCase()
                                .includes(searchQuery.toLowerCase())
                          )
                        )
                      )
                        return null;

                      return (
                        <RubricBlock
                          key={rubric.id}
                          rubric={rubric}
                          dzialFilters={allRubricIds}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
