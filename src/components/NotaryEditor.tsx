/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import {
  Copy,
  Download,
  Check,
  Plus,
  Trash2,
  FileText,
  User,
  Coins,
  Send,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Filter,
  AlertTriangle,
  Shield,
  Scale,
  Building2
} from "lucide-react";
import {
  KWData,
  OwnerEntity,
  MortgageEntity,
  EasementEntity,
  WarningOrExecutionEntity,
  PlotEntity,
  TemplateStyle,
  FieldVisibilityConfig,
  DEFAULT_FIELD_VISIBILITY,
} from "../types";
import RubricViewer from "./RubricViewer";

type EditorViewMode = "editor" | "rubrics";

interface NotaryEditorProps {
  initialData: KWData;
  initialDrafts: { classic: string; modern: string; short: string };
  rawApify?: any;
  onReimport: () => void;
}

// Reusable small input
function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
  italic,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  italic?: boolean;
  className?: string;
}) {
  return (
    <div className={`space-y-0.5 ${className || ""}`}>
      <span className="text-[9px] font-bold text-[#7A7772] uppercase block tracking-wider">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-white border border-[#D1CEC8] px-2 py-0.5 text-xs text-[#1A1A1A] focus:outline-none focus:border-[#7A7772] ${
          mono ? "font-mono" : "font-serif"
        } ${italic ? "italic" : ""}`}
      />
    </div>
  );
}

// Empty section placeholder
function EmptySection({ label }: { label: string }) {
  return (
    <div className="text-center py-4 text-[#7A7772] font-serif italic text-xs bg-[#F5F2ED] border border-dashed border-[#D1CEC8]">
      {label}
    </div>
  );
}

// Section wrapper with collapsible header
function SectionBox({
  icon,
  title,
  children,
  defaultOpen = true,
  accentColor,
  hasNotices,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  accentColor?: string;
  hasNotices?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[#D1CEC8] bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-2 px-4 py-2.5 text-left cursor-pointer transition-colors ${
          accentColor || "bg-white hover:bg-[#F5F2ED]"
        }`}
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-[#7A7772] shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[#7A7772] shrink-0" />
        )}
        <span className="text-[#7A7772]">{icon}</span>
        <span className="text-[10px] font-bold text-[#7A7772] uppercase tracking-[0.15em] flex-1">
          {title}
        </span>
        {hasNotices && (
          <span className="text-[8px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5">
            Wzmianka
          </span>
        )}
      </button>
      {open && <div className="px-4 pb-4 pt-2 space-y-3">{children}</div>}
    </div>
  );
}

// Notices display
function NoticesBlock({ notices }: { notices?: string[] }) {
  if (!notices || notices.length === 0) return null;
  return (
    <div className="bg-amber-50 border border-amber-300 p-3 space-y-1">
      <span className="text-[9px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" /> Wzmianki o wnioskach
      </span>
      {notices.map((n, i) => (
        <p key={i} className="text-[10px] text-amber-900 font-serif">
          {n}
        </p>
      ))}
    </div>
  );
}

// Application data display
function ApplicationDataBlock({ data }: { data?: string }) {
  if (!data) return null;
  return (
    <div className="bg-blue-50/60 border border-blue-200 p-2">
      <span className="text-[9px] font-bold text-blue-700 uppercase tracking-wider">
        Dane o wniosku
      </span>
      <p className="text-[10px] text-blue-900 font-serif">{data}</p>
    </div>
  );
}

export default function NotaryEditor({
  initialData,
  initialDrafts,
  rawApify,
  onReimport,
}: NotaryEditorProps) {
  const [data, setData] = useState<KWData>(initialData);
  const [activeStyle, setActiveStyle] = useState<TemplateStyle>("classic");
  const [drafts, setDrafts] = useState(initialDrafts);
  const [customPrompt, setCustomPrompt] = useState("");
  const [isUpdatingAI, setIsUpdatingAI] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [fieldVisibility, setFieldVisibility] = useState<FieldVisibilityConfig>(
    DEFAULT_FIELD_VISIBILITY
  );
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<EditorViewMode>("editor");

  useEffect(() => {
    setData(initialData);
    setDrafts(initialDrafts);
  }, [initialData, initialDrafts]);

  const vis = fieldVisibility;
  const toggleVis = (key: keyof FieldVisibilityConfig) =>
    setFieldVisibility((prev) => ({ ...prev, [key]: !prev[key] }));

  // --- AI actions ---
  const handleRegenerateText = async () => {
    setIsUpdatingAI(true);
    try {
      const response = await fetch("/api/parse-raw-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText: JSON.stringify(data),
          notarySettings: data.notarySettings,
        }),
      });
      const resData = await response.json();
      if (response.ok) {
        setDrafts(resData.drafts);
      } else {
        throw new Error(resData.error);
      }
    } catch {
      rebuildDraftsOnClient();
    } finally {
      setIsUpdatingAI(false);
    }
  };

  const rebuildDraftsOnClient = () => {
    const num = data.kwNumber;
    const court = data.sadRejonowy;
    const typeStr =
      data.dzial1O.propertyType === "lokal"
        ? "lokal stanowiący odrębną własność"
        : "nieruchomość gruntową";
    const loc = data.dzial1O.location;
    const desc = data.dzial1O.description;

    const ownerClauses = data.dzial2.owners
      .map((o) => {
        const peselCl = o.peselOrRegon ? ` (PESEL: ${o.peselOrRegon})` : "";
        const parentsCl = o.parentsNames ? `, ${o.parentsNames},` : "";
        return `${o.name}${parentsCl}${peselCl} w udziale wynoszącym ${o.share}`;
      })
      .join(" oraz ");

    const mortCl =
      data.dzial4.hasEntries && data.dzial4.mortgages.length > 0
        ? `nieruchomość jest obciążona: ` +
          data.dzial4.mortgages
            .map(
              (m) =>
                `${m.type} w wysokości ${m.amount.toLocaleString()} ${m.currency} na rzecz ${m.creditor}`
            )
            .join(", ")
        : "dział IV jest wolny od wpisów (brak zabezpieczeń hipotecznych)";

    const d3text =
      data.dzial3.hasEntries
        ? [
            ...data.dzial3.easements.map((e) => e.description),
            ...data.dzial3.warningsAndExecutions.map((w) => w.description),
            ...data.dzial3.otherRights.map((r) => r.description),
          ].join(". ") || "wpisy ujawnione"
        : "dział III wolny od wpisów";

    setDrafts({
      classic: `Z księgi wieczystej numer ${num}, prowadzonej przez ${court}, wynika, iż w Dziale I-O wpisana jest ${typeStr}, położona w: ${loc}, opisana jako: ${desc}. W Dziale I-Sp ujawniono: ${data.dzial1Sp.hasEntries ? data.dzial1Sp.associatedRights.map((r) => r.description).join(". ") : "brak wpisów praw związanych z własnością"}. Jako właściciele w Dziale II wpisani są: ${ownerClauses}, na podstawie podstaw nabycia ujawnionych w księdze. W Dziale III: ${d3text}. W Dziale IV: ${mortCl}. Stan prawny zgodny z aktualnym odpisem z EKW.`,
      modern: `Stan księgi wieczystej nr ${num} (${court}):\n\n1. Oznaczenie: ${loc}. ${desc}\n2. Prawa związane (I-Sp): ${data.dzial1Sp.hasEntries ? "Ujawnione" : "Brak wpisów"}\n3. Właściciele: ${data.dzial2.owners.map((o) => `${o.name} [udział ${o.share}]`).join(", ")}\n4. Prawa i roszczenia (III): ${d3text}\n5. Hipoteki: ${mortCl}`,
      short: `KW ${num}: ${typeStr} w m. ${loc}. Właściciele: ${data.dzial2.owners.map((o) => o.name).join(" / ")}. Dział III: ${data.dzial3.hasEntries ? "Wpisy ujawnione" : "Brak wpisów"}. Dział IV: ${data.dzial4.hasEntries ? "Hipoteka wpisana" : "Brak obciążeń"}.`,
    });
  };

  const currentDraftText = drafts[activeStyle];

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(currentDraftText);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleDownloadText = () => {
    const blob = new Blob([currentDraftText], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `opis_kw_${data.kwNumber.replace(/\//g, "_")}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCustomRePrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPrompt.trim()) return;
    setIsUpdatingAI(true);
    try {
      const response = await fetch("/api/parse-raw-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText: `Odpis KW: ${JSON.stringify(data)}\n\nTekst dotychczasowego draftu: ${currentDraftText}`,
          notarySettings: data.notarySettings,
          rawTextOverride: `Zmień wygenerowany tekst według instrukcji: "${customPrompt}". Zwróć zaktualizowany zestaw 3 stylów.`,
        }),
      });
      const resData = await response.json();
      if (response.ok) {
        setDrafts(resData.drafts);
        setCustomPrompt("");
      } else {
        throw new Error(resData.error);
      }
    } catch (err: any) {
      alert("Błąd dostosowania AI: " + err.message);
    } finally {
      setIsUpdatingAI(false);
    }
  };

  // --- Mutators ---
  const updateOwner = (id: string, fields: Partial<OwnerEntity>) => {
    setData({
      ...data,
      dzial2: {
        ...data.dzial2,
        owners: data.dzial2.owners.map((o) =>
          o.id === id ? { ...o, ...fields } : o
        ),
      },
    });
  };

  const addOwner = () => {
    setData({
      ...data,
      dzial2: {
        ...data.dzial2,
        owners: [
          ...data.dzial2.owners,
          {
            id: "owner-new-" + Date.now(),
            name: "NOWY WSPÓŁWŁAŚCICIEL",
            parentsNames: "",
            share: "1/2",
            basisOfAcquisition: "",
          },
        ],
      },
    });
  };

  const removeOwner = (id: string) => {
    setData({
      ...data,
      dzial2: {
        ...data.dzial2,
        owners: data.dzial2.owners.filter((o) => o.id !== id),
      },
    });
  };

  const updateMortgage = (id: string, fields: Partial<MortgageEntity>) => {
    setData({
      ...data,
      dzial4: {
        ...data.dzial4,
        mortgages: data.dzial4.mortgages.map((m) =>
          m.id === id ? { ...m, ...fields } : m
        ),
      },
    });
  };

  const addMortgage = () => {
    setData({
      ...data,
      dzial4: {
        ...data.dzial4,
        hasEntries: true,
        mortgages: [
          ...data.dzial4.mortgages,
          {
            id: "mort-new-" + Date.now(),
            type: "Hipoteka umowna",
            amount: 100000,
            currency: "PLN",
            creditor: "",
            securesWhat: "",
          },
        ],
      },
    });
  };

  const removeMortgage = (id: string) => {
    const filtered = data.dzial4.mortgages.filter((m) => m.id !== id);
    setData({
      ...data,
      dzial4: { ...data.dzial4, hasEntries: filtered.length > 0, mortgages: filtered },
    });
  };

  const updatePlot = (index: number, fields: Partial<PlotEntity>) => {
    const updated = [...data.dzial1O.plots];
    updated[index] = { ...updated[index], ...fields };
    setData({ ...data, dzial1O: { ...data.dzial1O, plots: updated } });
  };

  const addPlot = () => {
    setData({
      ...data,
      dzial1O: {
        ...data.dzial1O,
        plots: [
          ...data.dzial1O.plots,
          { number: "1/1", areaSquareMeters: 1000, cadastreUnit: "" },
        ],
      },
    });
  };

  const removePlot = (index: number) => {
    setData({
      ...data,
      dzial1O: {
        ...data.dzial1O,
        plots: data.dzial1O.plots.filter((_, i) => i !== index),
      },
    });
  };

  // Dział III helpers
  const addEasement = () => {
    setData({
      ...data,
      dzial3: {
        ...data.dzial3,
        hasEntries: true,
        easements: [
          ...data.dzial3.easements,
          { id: "ease-new-" + Date.now(), description: "" },
        ],
      },
    });
  };

  const removeEasement = (id: string) => {
    const easements = data.dzial3.easements.filter((e) => e.id !== id);
    const hasAny = easements.length > 0 || data.dzial3.warningsAndExecutions.length > 0 || data.dzial3.otherRights.length > 0;
    setData({ ...data, dzial3: { ...data.dzial3, hasEntries: hasAny, easements } });
  };

  const addWarning = () => {
    setData({
      ...data,
      dzial3: {
        ...data.dzial3,
        hasEntries: true,
        warningsAndExecutions: [
          ...data.dzial3.warningsAndExecutions,
          { id: "warn-new-" + Date.now(), description: "" },
        ],
      },
    });
  };

  const removeWarning = (id: string) => {
    const warnings = data.dzial3.warningsAndExecutions.filter((w) => w.id !== id);
    const hasAny = data.dzial3.easements.length > 0 || warnings.length > 0 || data.dzial3.otherRights.length > 0;
    setData({ ...data, dzial3: { ...data.dzial3, hasEntries: hasAny, warningsAndExecutions: warnings } });
  };

  const addOtherRight = () => {
    setData({
      ...data,
      dzial3: {
        ...data.dzial3,
        hasEntries: true,
        otherRights: [
          ...data.dzial3.otherRights,
          { id: "other-new-" + Date.now(), description: "" },
        ],
      },
    });
  };

  const removeOtherRight = (id: string) => {
    const rights = data.dzial3.otherRights.filter((r) => r.id !== id);
    const hasAny = data.dzial3.easements.length > 0 || data.dzial3.warningsAndExecutions.length > 0 || rights.length > 0;
    setData({ ...data, dzial3: { ...data.dzial3, hasEntries: hasAny, otherRights: rights } });
  };

  // Dział I-Sp helpers
  const addAssociatedRight = () => {
    setData({
      ...data,
      dzial1Sp: {
        ...data.dzial1Sp,
        hasEntries: true,
        associatedRights: [
          ...data.dzial1Sp.associatedRights,
          { id: "sp-new-" + Date.now(), description: "" },
        ],
      },
    });
  };

  const removeAssociatedRight = (id: string) => {
    const rights = data.dzial1Sp.associatedRights.filter((r) => r.id !== id);
    setData({
      ...data,
      dzial1Sp: { ...data.dzial1Sp, hasEntries: rights.length > 0, associatedRights: rights },
    });
  };

  // --- Filter definitions ---
  const FILTER_OPTIONS: {
    key: keyof FieldVisibilityConfig;
    label: string;
    shortLabel: string;
  }[] = [
    { key: "notices", label: "Wzmianki o wnioskach", shortLabel: "Wzmianki" },
    { key: "applicationData", label: "Dane o wniosku (nr Dz.Kw.)", shortLabel: "Wnioski" },
    { key: "pesel", label: "PESEL / REGON", shortLabel: "PESEL" },
    { key: "basisDocuments", label: "Podstawy wpisu / nabycia", shortLabel: "Podstawy" },
    { key: "identifiers", label: "Identyfikatory (TERYT, nr bieżący)", shortLabel: "Identyfikatory" },
    { key: "landUse", label: "Sposób korzystania z działki", shortLabel: "Użytkowanie" },
    { key: "entryNumbers", label: "Numery bieżące wpisów", shortLabel: "Nr wpisów" },
    { key: "interestRate", label: "Odsetki / Oprocentowanie", shortLabel: "Odsetki" },
  ];

  const hasAnyNotices =
    (data.dzial1O.notices?.length || 0) > 0 ||
    (data.dzial1Sp.notices?.length || 0) > 0 ||
    (data.dzial2.notices?.length || 0) > 0 ||
    (data.dzial3.notices?.length || 0) > 0 ||
    (data.dzial4.notices?.length || 0) > 0;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-stretch">
      {/* LEFT COLUMN: Structural editor */}
      <div className="xl:col-span-5 flex flex-col gap-4">
        <div className="bg-[#FDFCFB] border border-[#D1CEC8] p-5 sm:p-6 shadow-sm space-y-4">
          {/* Header */}
          <div className="flex justify-between items-start pb-3 border-b border-[#E5E5E5]">
            <div>
              <span className="text-[10px] font-bold text-[#7A7772] block uppercase tracking-[0.2em]">
                ODPIS EKW STRUKTURALNY
              </span>
              <h2 className="text-xl font-serif text-[#1A1A1A] mt-1">
                Panele Edycyjne Księgi
              </h2>
            </div>
            <button
              onClick={onReimport}
              className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A] border border-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-white px-3 py-1.5 transition-all duration-200 cursor-pointer"
            >
              Zmień źródło
            </button>
          </div>

          {/* View mode toggle */}
          <div className="flex border border-[#D1CEC8] bg-[#F5F2ED]">
            <button
              type="button"
              onClick={() => setViewMode("editor")}
              className={`flex-1 py-2 text-center text-[10px] uppercase font-bold tracking-widest cursor-pointer transition-colors ${
                viewMode === "editor"
                  ? "bg-white text-[#1A1A1A] border-b-2 border-[#1A1A1A]"
                  : "text-[#7A7772] hover:text-[#1A1A1A]"
              }`}
            >
              Edytor
            </button>
            <button
              type="button"
              onClick={() => setViewMode("rubrics")}
              className={`flex-1 py-2 text-center text-[10px] uppercase font-bold tracking-widest cursor-pointer transition-colors ${
                viewMode === "rubrics"
                  ? "bg-white text-[#1A1A1A] border-b-2 border-[#1A1A1A]"
                  : "text-[#7A7772] hover:text-[#1A1A1A]"
              }`}
            >
              Rubryki
            </button>
          </div>

          {viewMode === "rubrics" ? (
            <RubricViewer rawApify={rawApify} kwNumber={data.kwNumber} />
          ) : (
          <>

          {/* Filter bar */}
          <div className="bg-[#F5F2ED] border border-[#D1CEC8] p-3">
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 w-full text-left cursor-pointer"
            >
              <Filter className="w-3.5 h-3.5 text-[#7A7772]" />
              <span className="text-[10px] font-bold text-[#7A7772] uppercase tracking-[0.15em] flex-1">
                Widoczność rubryk
              </span>
              <span className="text-[9px] text-[#7A7772] font-mono">
                {Object.values(vis).filter(Boolean).length}/{FILTER_OPTIONS.length}
              </span>
              {showFilters ? (
                <ChevronDown className="w-3 h-3 text-[#7A7772]" />
              ) : (
                <ChevronRight className="w-3 h-3 text-[#7A7772]" />
              )}
            </button>

            {showFilters && (
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 pt-2 border-t border-[#D1CEC8]">
                {FILTER_OPTIONS.map((opt) => (
                  <label
                    key={opt.key}
                    className="flex items-center gap-2 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={vis[opt.key]}
                      onChange={() => toggleVis(opt.key)}
                      className="w-3.5 h-3.5 accent-[#1A1A1A] cursor-pointer"
                    />
                    <span className="text-[10px] text-[#1A1A1A] group-hover:text-[#7A7772] transition-colors">
                      {opt.label}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {hasAnyNotices && (
            <div className="bg-amber-50 border border-amber-400 px-3 py-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">
                Uwaga: Wykryto wzmianki o wnioskach w tej księdze
              </span>
            </div>
          )}

          {/* Court info */}
          <div className="grid grid-cols-2 gap-3 bg-[#F5F2ED] p-3 border border-[#D1CEC8] text-xs">
            <FieldInput
              label="Sąd Rejonowy"
              value={data.sadRejonowy}
              onChange={(v) => setData({ ...data, sadRejonowy: v })}
            />
            <FieldInput
              label="Numer Księgi Wieczystej"
              value={data.kwNumber}
              onChange={(v) => setData({ ...data, kwNumber: v })}
              mono
            />
          </div>

          {/* ===== DZIAŁ I-O ===== */}
          <SectionBox
            icon={<Building2 className="w-3.5 h-3.5" />}
            title="Dział I-O: Oznaczenie Nieruchomości"
            hasNotices={(data.dzial1O.notices?.length || 0) > 0}
          >
            {vis.notices && <NoticesBlock notices={data.dzial1O.notices} />}
            {vis.applicationData && (
              <ApplicationDataBlock data={data.dzial1O.applicationData} />
            )}

            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-8">
                <FieldInput
                  label="Położenie / Adres"
                  value={data.dzial1O.location}
                  onChange={(v) =>
                    setData({
                      ...data,
                      dzial1O: { ...data.dzial1O, location: v },
                    })
                  }
                />
              </div>
              <div className="col-span-4 space-y-0.5">
                <span className="text-[9px] font-bold text-[#7A7772] uppercase block tracking-wider">
                  Typ obiektu
                </span>
                <select
                  value={data.dzial1O.propertyType}
                  onChange={(e) =>
                    setData({
                      ...data,
                      dzial1O: {
                        ...data.dzial1O,
                        propertyType: e.target.value as any,
                      },
                    })
                  }
                  className="w-full border border-[#D1CEC8] bg-white py-0.5 px-1 font-serif text-xs text-[#1A1A1A] focus:outline-none"
                >
                  <option value="lokal">Lokal</option>
                  <option value="dzialka">Działka</option>
                  <option value="budynek">Budynek</option>
                  <option value="inne">Inne</option>
                </select>
              </div>
            </div>

            {data.dzial1O.address && (
              <FieldInput
                label="Adres (ulica, numer)"
                value={data.dzial1O.address || ""}
                onChange={(v) =>
                  setData({
                    ...data,
                    dzial1O: { ...data.dzial1O, address: v },
                  })
                }
              />
            )}

            <div className="space-y-0.5">
              <span className="text-[9px] font-bold text-[#7A7772] uppercase block tracking-wider">
                Opis prawny z rubryk
              </span>
              <textarea
                rows={2}
                value={data.dzial1O.description}
                onChange={(e) =>
                  setData({
                    ...data,
                    dzial1O: { ...data.dzial1O, description: e.target.value },
                  })
                }
                className="w-full border border-[#D1CEC8] p-2 text-[#1A1A1A] resize-none font-serif text-xs leading-relaxed focus:outline-none focus:border-[#7A7772] bg-stone-50/30"
              />
            </div>

            {vis.landUse && (
              <FieldInput
                label="Sposób korzystania"
                value=""
                onChange={() => {}}
                placeholder="np. grunty orne, tereny mieszkaniowe, lasy..."
              />
            )}

            {vis.basisDocuments && data.dzial1O.basisDocuments && (
              <FieldInput
                label="Dokumenty będące podstawą wpisu"
                value={data.dzial1O.basisDocuments}
                onChange={(v) =>
                  setData({
                    ...data,
                    dzial1O: { ...data.dzial1O, basisDocuments: v },
                  })
                }
              />
            )}

            {vis.joinSeparation && (
              <FieldInput
                label="Przyłączenie / Odłączenie"
                value={data.dzial1O.joinSeparation || ""}
                onChange={(v) =>
                  setData({
                    ...data,
                    dzial1O: { ...data.dzial1O, joinSeparation: v },
                  })
                }
                placeholder="—"
              />
            )}

            {/* Plots */}
            <div className="space-y-2 pt-2 border-t border-[#E5E5E5]">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-bold text-[#7A7772] uppercase tracking-wider">
                  Działki ewidencyjne
                </span>
                <button
                  type="button"
                  onClick={addPlot}
                  className="text-[9px] uppercase font-bold tracking-widest text-[#1A1A1A] underline hover:no-underline flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Dodaj
                </button>
              </div>
              {data.dzial1O.plots.map((plot, idx) => (
                <div
                  key={idx}
                  className="flex gap-2 items-center bg-[#FDFCFB] border border-[#D1CEC8] p-2"
                >
                  <input
                    type="text"
                    placeholder="Nr"
                    value={plot.number}
                    onChange={(e) => updatePlot(idx, { number: e.target.value })}
                    className="w-20 border-b border-[#1A1A1A] text-center font-mono font-bold text-xs focus:outline-none"
                  />
                  <input
                    type="number"
                    placeholder="Pow."
                    value={plot.areaSquareMeters || ""}
                    onChange={(e) =>
                      updatePlot(idx, {
                        areaSquareMeters: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-16 border-b border-[#1A1A1A] text-center font-serif text-xs focus:outline-none"
                  />
                  <span className="text-[10px] font-serif text-[#7A7772] italic">
                    m²
                  </span>
                  <input
                    type="text"
                    placeholder="Obręb"
                    value={plot.cadastreUnit || ""}
                    onChange={(e) =>
                      updatePlot(idx, { cadastreUnit: e.target.value })
                    }
                    className="flex-1 min-w-0 border-b border-stone-300 text-xs text-[#7A7772] font-serif focus:outline-none focus:border-[#1A1A1A]"
                  />
                  {vis.identifiers && (
                    <input
                      type="text"
                      placeholder="ID TERYT"
                      value={plot.identifier || ""}
                      onChange={(e) =>
                        updatePlot(idx, { identifier: e.target.value })
                      }
                      className="w-24 border-b border-stone-300 text-xs text-[#7A7772] font-mono focus:outline-none focus:border-[#1A1A1A]"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removePlot(idx)}
                    className="text-red-700 hover:text-red-950 transition-colors p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </SectionBox>

          {/* ===== DZIAŁ I-SP ===== */}
          <SectionBox
            icon={<Scale className="w-3.5 h-3.5" />}
            title="Dział I-Sp: Spis Praw Związanych"
            hasNotices={(data.dzial1Sp.notices?.length || 0) > 0}
          >
            {vis.notices && <NoticesBlock notices={data.dzial1Sp.notices} />}
            {vis.applicationData && (
              <ApplicationDataBlock data={data.dzial1Sp.applicationData} />
            )}

            {data.dzial1Sp.shareInJointProperty && (
              <FieldInput
                label="Udział w nieruchomości wspólnej"
                value={data.dzial1Sp.shareInJointProperty || ""}
                onChange={(v) =>
                  setData({
                    ...data,
                    dzial1Sp: { ...data.dzial1Sp, shareInJointProperty: v },
                  })
                }
                mono
              />
            )}

            {data.dzial1Sp.associatedRights.length > 0 ? (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-bold text-[#7A7772] uppercase tracking-wider">
                    Prawa związane z własnością
                  </span>
                  <button
                    type="button"
                    onClick={addAssociatedRight}
                    className="text-[9px] uppercase font-bold tracking-widest text-[#1A1A1A] underline hover:no-underline flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Dodaj
                  </button>
                </div>
                {data.dzial1Sp.associatedRights.map((right) => (
                  <div
                    key={right.id}
                    className="bg-[#F5F2ED] border border-[#D1CEC8] p-3 relative"
                  >
                    <button
                      type="button"
                      onClick={() => removeAssociatedRight(right.id)}
                      className="absolute top-2 right-2 text-red-700 hover:text-red-950 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <textarea
                      rows={2}
                      value={right.description}
                      onChange={(e) => {
                        const updated = data.dzial1Sp.associatedRights.map((r) =>
                          r.id === right.id
                            ? { ...r, description: e.target.value }
                            : r
                        );
                        setData({
                          ...data,
                          dzial1Sp: { ...data.dzial1Sp, associatedRights: updated },
                        });
                      }}
                      className="w-full border border-[#D1CEC8] p-2 text-xs font-serif resize-none focus:outline-none bg-white"
                      placeholder="Opis prawa..."
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex justify-between items-center">
                <EmptySection label="Brak wpisów praw związanych z własnością" />
                <button
                  type="button"
                  onClick={addAssociatedRight}
                  className="ml-2 text-[9px] uppercase font-bold tracking-widest text-[#1A1A1A] underline hover:no-underline flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Plus className="w-3 h-3" /> Dodaj
                </button>
              </div>
            )}
          </SectionBox>

          {/* ===== DZIAŁ II ===== */}
          <SectionBox
            icon={<User className="w-3.5 h-3.5" />}
            title="Dział II: Własność"
            hasNotices={(data.dzial2.notices?.length || 0) > 0}
          >
            {vis.notices && <NoticesBlock notices={data.dzial2.notices} />}
            {vis.applicationData && (
              <ApplicationDataBlock data={data.dzial2.applicationData} />
            )}

            <div className="flex justify-between items-center">
              <span className="text-[9px] font-bold text-[#7A7772] uppercase tracking-wider">
                Właściciele ({data.dzial2.owners.length})
              </span>
              <button
                type="button"
                onClick={addOwner}
                className="text-[9px] uppercase font-bold tracking-widest text-[#1A1A1A] underline hover:no-underline flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" /> Dodaj właściciela
              </button>
            </div>

            {data.dzial2.owners.map((owner) => (
              <div
                key={owner.id}
                className="bg-[#F5F2ED] border border-[#D1CEC8] p-3 space-y-2 relative"
              >
                <button
                  type="button"
                  onClick={() => removeOwner(owner.id)}
                  className="absolute top-2 right-2 text-[#7A7772] hover:text-[#1A1A1A] cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <div className="flex items-center gap-1.5 font-serif font-bold">
                  <User className="w-3.5 h-3.5 text-[#7A7772]" />
                  <input
                    type="text"
                    value={owner.name}
                    onChange={(e) =>
                      updateOwner(owner.id, { name: e.target.value })
                    }
                    className="bg-transparent border-b border-[#1A1A1A] focus:outline-none w-5/6 text-xs uppercase font-bold tracking-wide py-0.5"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <FieldInput
                    label="Wielkość udziału"
                    value={owner.share}
                    onChange={(v) => updateOwner(owner.id, { share: v })}
                  />
                  {vis.pesel && (
                    <FieldInput
                      label="PESEL / REGON"
                      value={owner.peselOrRegon || ""}
                      onChange={(v) =>
                        updateOwner(owner.id, { peselOrRegon: v })
                      }
                      mono
                    />
                  )}
                </div>

                <FieldInput
                  label="Imiona rodziców"
                  value={owner.parentsNames || ""}
                  onChange={(v) =>
                    updateOwner(owner.id, { parentsNames: v })
                  }
                  placeholder="syn / córka..."
                  italic
                />

                {vis.basisDocuments && (
                  <FieldInput
                    label="Podstawa nabycia"
                    value={owner.basisOfAcquisition}
                    onChange={(v) =>
                      updateOwner(owner.id, { basisOfAcquisition: v })
                    }
                    placeholder="Akt Notarialny..."
                  />
                )}

                {vis.entryNumbers && (
                  <div className="grid grid-cols-2 gap-3">
                    <FieldInput
                      label="Nr bieżący wpisu"
                      value={owner.entryNumber || ""}
                      onChange={(v) =>
                        updateOwner(owner.id, { entryNumber: v })
                      }
                      mono
                      placeholder="—"
                    />
                    <FieldInput
                      label="Data wpisu"
                      value={owner.entryDate || ""}
                      onChange={(v) =>
                        updateOwner(owner.id, { entryDate: v })
                      }
                      placeholder="—"
                    />
                  </div>
                )}
              </div>
            ))}

            {data.dzial2.isPerpetualUsufruct && (
              <div className="bg-blue-50 border border-blue-200 p-2 text-[10px] text-blue-800 font-serif">
                Nieruchomość w użytkowaniu wieczystym
              </div>
            )}
          </SectionBox>

          {/* ===== DZIAŁ III ===== */}
          <SectionBox
            icon={<Shield className="w-3.5 h-3.5" />}
            title="Dział III: Prawa, Roszczenia, Ograniczenia"
            hasNotices={(data.dzial3.notices?.length || 0) > 0}
            accentColor={
              data.dzial3.warningsAndExecutions.length > 0
                ? "bg-red-50/60 hover:bg-red-50"
                : undefined
            }
          >
            {vis.notices && <NoticesBlock notices={data.dzial3.notices} />}
            {vis.applicationData && (
              <ApplicationDataBlock data={data.dzial3.applicationData} />
            )}

            {!data.dzial3.hasEntries &&
            data.dzial3.easements.length === 0 &&
            data.dzial3.warningsAndExecutions.length === 0 &&
            data.dzial3.otherRights.length === 0 ? (
              <EmptySection label="Dział III wolny od wpisów" />
            ) : null}

            {/* Służebności */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-bold text-[#7A7772] uppercase tracking-wider">
                  Służebności ({data.dzial3.easements.length})
                </span>
                <button
                  type="button"
                  onClick={addEasement}
                  className="text-[9px] uppercase font-bold tracking-widest text-[#1A1A1A] underline hover:no-underline flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Dodaj
                </button>
              </div>
              {data.dzial3.easements.map((e) => (
                <div
                  key={e.id}
                  className="bg-[#F5F2ED] border border-[#D1CEC8] p-3 relative"
                >
                  <button
                    type="button"
                    onClick={() => removeEasement(e.id)}
                    className="absolute top-2 right-2 text-red-700 hover:text-red-950 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <textarea
                    rows={2}
                    value={e.description}
                    onChange={(ev) => {
                      const updated = data.dzial3.easements.map((x) =>
                        x.id === e.id ? { ...x, description: ev.target.value } : x
                      );
                      setData({
                        ...data,
                        dzial3: { ...data.dzial3, easements: updated },
                      });
                    }}
                    className="w-full border border-[#D1CEC8] p-2 text-xs font-serif resize-none focus:outline-none bg-white"
                    placeholder="Opis służebności..."
                  />
                </div>
              ))}
            </div>

            {/* Ostrzeżenia i egzekucje */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-bold text-red-700 uppercase tracking-wider">
                  Ostrzeżenia i Egzekucje ({data.dzial3.warningsAndExecutions.length})
                </span>
                <button
                  type="button"
                  onClick={addWarning}
                  className="text-[9px] uppercase font-bold tracking-widest text-[#1A1A1A] underline hover:no-underline flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Dodaj
                </button>
              </div>
              {data.dzial3.warningsAndExecutions.map((w) => (
                <div
                  key={w.id}
                  className="bg-red-50 border border-red-200 p-3 relative"
                >
                  <button
                    type="button"
                    onClick={() => removeWarning(w.id)}
                    className="absolute top-2 right-2 text-red-700 hover:text-red-950 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <textarea
                    rows={2}
                    value={w.description}
                    onChange={(ev) => {
                      const updated = data.dzial3.warningsAndExecutions.map(
                        (x) =>
                          x.id === w.id
                            ? { ...x, description: ev.target.value }
                            : x
                      );
                      setData({
                        ...data,
                        dzial3: {
                          ...data.dzial3,
                          warningsAndExecutions: updated,
                        },
                      });
                    }}
                    className="w-full border border-red-200 p-2 text-xs font-serif resize-none focus:outline-none bg-white"
                    placeholder="Opis ostrzeżenia / egzekucji..."
                  />
                  {w.caseNumber && (
                    <span className="text-[9px] text-red-600 font-mono mt-1 block">
                      Sygn.: {w.caseNumber}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Inne prawa */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-bold text-[#7A7772] uppercase tracking-wider">
                  Inne prawa ({data.dzial3.otherRights.length})
                </span>
                <button
                  type="button"
                  onClick={addOtherRight}
                  className="text-[9px] uppercase font-bold tracking-widest text-[#1A1A1A] underline hover:no-underline flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Dodaj
                </button>
              </div>
              {data.dzial3.otherRights.map((r) => (
                <div
                  key={r.id}
                  className="bg-[#F5F2ED] border border-[#D1CEC8] p-3 relative"
                >
                  <button
                    type="button"
                    onClick={() => removeOtherRight(r.id)}
                    className="absolute top-2 right-2 text-red-700 hover:text-red-950 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <textarea
                    rows={2}
                    value={r.description}
                    onChange={(ev) => {
                      const updated = data.dzial3.otherRights.map((x) =>
                        x.id === r.id
                          ? { ...x, description: ev.target.value }
                          : x
                      );
                      setData({
                        ...data,
                        dzial3: { ...data.dzial3, otherRights: updated },
                      });
                    }}
                    className="w-full border border-[#D1CEC8] p-2 text-xs font-serif resize-none focus:outline-none bg-white"
                    placeholder="Dożywocie, najem, dzierżawa, prawo pierwokupu..."
                  />
                </div>
              ))}
            </div>
          </SectionBox>

          {/* ===== DZIAŁ IV ===== */}
          <SectionBox
            icon={<Coins className="w-3.5 h-3.5" />}
            title="Dział IV: Hipoteka"
            hasNotices={(data.dzial4.notices?.length || 0) > 0}
          >
            {vis.notices && <NoticesBlock notices={data.dzial4.notices} />}
            {vis.applicationData && (
              <ApplicationDataBlock data={data.dzial4.applicationData} />
            )}

            <div className="flex justify-between items-center">
              <span className="text-[9px] font-bold text-[#7A7772] uppercase tracking-wider">
                Hipoteki ({data.dzial4.mortgages.length})
              </span>
              <button
                type="button"
                onClick={addMortgage}
                className="text-[9px] uppercase font-bold tracking-widest text-[#1A1A1A] underline hover:no-underline flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" /> Dodaj hipotekę
              </button>
            </div>

            {data.dzial4.mortgages.length === 0 ? (
              <EmptySection label="Dział IV wolny od wpisów (Czysta hipoteka)" />
            ) : (
              data.dzial4.mortgages.map((mort) => (
                <div
                  key={mort.id}
                  className="bg-[#F5F2ED] border border-[#D1CEC8] p-3 space-y-2 relative"
                >
                  <button
                    type="button"
                    onClick={() => removeMortgage(mort.id)}
                    className="absolute top-2 right-2 text-red-700 hover:text-red-950 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <div className="flex items-center gap-1.5 font-serif font-bold">
                    <Coins className="w-4 h-4 text-[#1A1A1A]" />
                    <span className="text-xs uppercase tracking-wider">
                      {mort.type}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-[11px]">
                    <FieldInput
                      label="Kwota nominalna"
                      value={String(mort.amount)}
                      onChange={(v) =>
                        updateMortgage(mort.id, {
                          amount: parseFloat(v) || 0,
                        })
                      }
                    />
                    <div className="space-y-0.5">
                      <span className="text-[9px] font-bold text-[#7A7772] uppercase block tracking-wider">
                        Waluta
                      </span>
                      <select
                        value={mort.currency}
                        onChange={(e) =>
                          updateMortgage(mort.id, { currency: e.target.value })
                        }
                        className="w-full bg-white border border-[#D1CEC8] px-1 py-0.5 font-bold text-xs focus:outline-none"
                      >
                        <option value="PLN">PLN</option>
                        <option value="EUR">EUR</option>
                        <option value="USD">USD</option>
                        <option value="CHF">CHF</option>
                      </select>
                    </div>
                  </div>

                  <FieldInput
                    label="Wierzyciel hipoteczny"
                    value={mort.creditor}
                    onChange={(v) =>
                      updateMortgage(mort.id, { creditor: v })
                    }
                    placeholder="Nazwa banku / instytucji..."
                  />

                  {mort.securesWhat && (
                    <FieldInput
                      label="Opis wierzytelności"
                      value={mort.securesWhat || ""}
                      onChange={(v) =>
                        updateMortgage(mort.id, { securesWhat: v })
                      }
                    />
                  )}

                  {vis.interestRate && (
                    <FieldInput
                      label="Odsetki / Oprocentowanie"
                      value={mort.interestRate || ""}
                      onChange={(v) =>
                        updateMortgage(mort.id, { interestRate: v })
                      }
                      placeholder="—"
                    />
                  )}

                  {vis.entryNumbers && (
                    <div className="grid grid-cols-2 gap-3">
                      <FieldInput
                        label="Nr bieżący wpisu"
                        value={mort.entryNumber || ""}
                        onChange={(v) =>
                          updateMortgage(mort.id, { entryNumber: v })
                        }
                        mono
                        placeholder="—"
                      />
                      <FieldInput
                        label="Data wpisu"
                        value={mort.entryDate || ""}
                        onChange={(v) =>
                          updateMortgage(mort.id, { entryDate: v })
                        }
                        placeholder="—"
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </SectionBox>

          {/* Regenerate button */}
          <button
            onClick={handleRegenerateText}
            disabled={isUpdatingAI}
            className="w-full bg-[#1A1A1A] hover:bg-stone-800 text-white font-bold uppercase tracking-widest py-4 px-4 text-xs transition-all duration-300 cursor-pointer shadow-md"
          >
            {isUpdatingAI
              ? "Synchronizowanie z AI..."
              : "Przeładuj i zsynchronizuj tekst"}
          </button>
          </>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: Document workstation */}
      <div className="xl:col-span-7 flex flex-col h-full min-h-[640px]">
        <div className="bg-[#FDFCFB] border border-[#D1CEC8] shadow-sm flex-1 flex flex-col overflow-hidden">
          {/* Style picker */}
          <div className="bg-[#F5F2ED] border-b border-[#D1CEC8] px-6 py-4 flex flex-wrap gap-4 items-center justify-between">
            <div className="flex gap-2">
              {(
                [
                  ["classic", "Tradycyjny (Aktowy)"],
                  ["modern", "Współczesny"],
                  ["short", "Skrócony"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setActiveStyle(key)}
                  className={`text-[10px] uppercase font-bold tracking-widest py-2 px-3 transition-all cursor-pointer border-b-2 ${
                    activeStyle === key
                      ? "border-[#1A1A1A] text-[#1A1A1A]"
                      : "border-transparent text-[#7A7772] hover:text-[#1A1A1A]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleCopyToClipboard}
                className="text-[10px] font-bold uppercase tracking-widest border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F2ED] py-2 px-4 transition-all duration-200 cursor-pointer bg-transparent text-[#1A1A1A] flex items-center gap-1.5"
              >
                {copySuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Skopiowano
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> Kopiuj
                  </>
                )}
              </button>
              <button
                onClick={handleDownloadText}
                className="text-[10px] font-bold uppercase tracking-widest border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F2ED] py-2 px-4 transition-all duration-200 cursor-pointer bg-transparent text-[#1A1A1A] flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Pobierz .txt
              </button>
            </div>
          </div>

          {/* Paper workspace */}
          <div className="flex-1 p-6 lg:p-8 bg-[#F5F2ED]/60 relative flex flex-col justify-center">
            <div className="text-[9px] font-mono font-bold uppercase tracking-wider text-[#7A7772]/80 absolute top-4 right-6 flex items-center gap-1.5 select-none">
              <FileText className="w-3.5 h-3.5" /> Repertorium A draft
            </div>

            <div className="flex-1 bg-[#FCFBFA] border border-[#D1CEC8] p-6 sm:p-10 shadow-inner flex flex-col min-h-[440px] relative">
              <div className="absolute left-7 top-0 bottom-0 w-[1px] bg-red-200/50 pointer-events-none" />
              <div className="flex-1 pl-6 lg:pl-10">
                <textarea
                  value={currentDraftText}
                  onChange={(e) =>
                    setDrafts({ ...drafts, [activeStyle]: e.target.value })
                  }
                  className="w-full h-full bg-transparent resize-none border-none focus:outline-none text-[#1A1A1A] text-xs sm:text-sm font-serif leading-8 tracking-wide"
                  placeholder="Tutaj pojawi się gotowy do skopiowania opis aktu notarialnego w wybranym stylu..."
                />
              </div>
              {isUpdatingAI && (
                <div className="absolute inset-0 bg-[#FCFBFA]/90 backdrop-blur-[1px] flex flex-col items-center justify-center gap-4">
                  <div className="w-8 h-8 border-2 border-[#1A1A1A] border-t-transparent animate-spin" />
                  <span className="text-[10px] text-[#1A1A1A] font-bold uppercase tracking-[0.2em] font-mono">
                    Korekta i adaptacja AI w toku...
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* AI prompt bar */}
          <div className="bg-[#F5F2ED] border-t border-[#D1CEC8] px-6 py-5">
            <form onSubmit={handleCustomRePrompt} className="space-y-2.5">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1.5">
                <label className="text-[10px] font-bold text-[#7A7772] uppercase tracking-widest flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#1A1A1A]" /> Korekty
                  AI (Polecenie Notarialne)
                </label>
                <span className="text-[9px] text-[#7A7772] font-serif italic">
                  Np:{" "}
                  <em className="text-neutral-700">
                    „zapisz wszystkie nazwiska małą czcionką"
                  </em>
                </span>
              </div>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Wpisz niestandardową instrukcję, aby dokonać precyzyjnej zmiany w wygenerowanym tekście..."
                  className="flex-1 bg-white border-b border-[#1A1A1A] px-3 py-2 text-xs font-serif text-[#1A1A1A] placeholder-[#9E9C98] focus:outline-none focus:border-[#7A7772] shadow-sm"
                />
                <button
                  type="submit"
                  disabled={isUpdatingAI || !customPrompt.trim()}
                  className={`p-3 flex items-center justify-center text-white text-xs font-bold uppercase tracking-widest transition-colors cursor-pointer ${
                    isUpdatingAI || !customPrompt.trim()
                      ? "bg-stone-300 text-stone-500 cursor-not-allowed border border-stone-200"
                      : "bg-[#1A1A1A] hover:bg-stone-800"
                  }`}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
