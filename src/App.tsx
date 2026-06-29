/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Scale, FileText, ClipboardPen, Loader2, Sparkles, Gavel, BookOpen } from "lucide-react";
import ManualPaster from "./components/ManualPaster";
import EKWBrowserSim from "./components/EKWBrowserSim";
import NotaryEditor from "./components/NotaryEditor";
import { KWData } from "./types";
import { buildDrafts, DraftSet } from "./lib/draftBuilder";

export default function App() {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingFact, setLoadingFact] = useState("Inicjowanie modelu językowego...");
  const [autoOpenLibrary, setAutoOpenLibrary] = useState(false);

  // Parsed land register documents cache
  const [parsedResult, setParsedResult] = useState<{
    structured: KWData;
    drafts: DraftSet;
    rawApify?: any;
    validation?: { ok: boolean; issues: string[]; aiAssisted: boolean };
  } | null>(null);

  // Legal facts listed during loader screens to calm the user
  const legalFacts = [
    "Dział I-O obejmuje oznaczenie nieruchomości oraz spis spraw, w tym położenie, adres oraz numery działek.",
    "Dział I-Sp ujawnia prawa splecione z własnością, w tym należne udziały w nieruchomości wspólnej.",
    "Dział II identyfikuje uprawnionych właścicieli, wielkości ich udziałów oraz podstawy nabycia.",
    "Dział III zawiera wpisy dotyczące ograniczonych praw rzeczowych, roszczeń i ograniczeń w rozporządzaniu.",
    "Dział IV przeznaczony jest wyłącznie dla wpisów dotyczących hipotek umownych oraz przymusowych.",
    "Wzmianki o wnioskach notarialnych w księdze blokują rękojmię wiary publicznej ksiąg wieczystych."
  ];

  const handleStartLoading = () => {
    setIsLoading(true);
    // Shuffle a random fact to show on loading
    const randomFact = legalFacts[Math.floor(Math.random() * legalFacts.length)];
    setLoadingFact(randomFact);
  };

  const handleStopLoading = () => {
    setIsLoading(false);
  };

  const handleSimulationDataLoaded = (data: KWData, rawApify?: any, validation?: { ok: boolean; issues: string[]; aiAssisted: boolean }) => {
    // Build all three drafts from the single, shared, data-driven generator.
    setParsedResult({
      structured: data,
      rawApify,
      validation,
      drafts: buildDrafts(data),
    });
  };

  const handleBackToSelect = () => {
    setAutoOpenLibrary(false);
    setParsedResult(null);
  };

  // Opens the selection screen with the saved-books library expanded — available
  // from the workstation header so the notary can jump to another księga.
  const handleOpenLibrary = () => {
    setAutoOpenLibrary(true);
    setParsedResult(null);
  };

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1A1A1A] flex flex-col font-sans selection:bg-[#1A1A1A] selection:text-[#F5F2ED]">
      
      {/* Top Professional Navigation Navbar Header */}
      <header className="border-b border-[#D1CEC8] px-4 sm:px-8 py-4 flex justify-between items-center bg-white sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#1A1A1A] flex items-center justify-center text-white font-serif font-bold italic tracking-tighter">
              L
            </div>
            <div>
              <h1 className="text-xs uppercase tracking-[0.2em] font-bold text-[#1A1A1A]">
                LexParser <span className="text-[#7A7772] font-medium">KW - Notariusz.AI</span>
              </h1>
              <p className="text-[9px] uppercase tracking-wider text-[#7A7772] font-semibold mt-0.5">
                System Opracowania Ksiąg Wieczystych RP
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 sm:gap-6">
            {parsedResult && (
              <button
                onClick={handleOpenLibrary}
                title="Otwórz bibliotekę pobranych ksiąg"
                className="inline-flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-[#1A1A1A] border border-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-white px-2.5 py-1.5 transition-all duration-200 cursor-pointer"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Biblioteka</span>
              </button>
            )}
            <div className="hidden md:flex flex-col items-end">
              <span className="text-[9px] uppercase text-[#7A7772] font-bold tracking-widest">Kancelaria Notarialna</span>
              <span className="text-xs font-serif italic text-[#1A1A1A]">Pulpit Nowego Aktu</span>
            </div>
            <a
              href="https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU19820190147/U/D19820147Lj.pdf"
              target="_blank"
              rel="noopener noreferrer"
              title="Otwórz ustawę o księgach wieczystych i hipotece (ISAP, PDF)"
              className="hidden sm:inline-flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-[#7A7772] bg-[#F5F2ED] border border-[#D1CEC8] px-2.5 py-1 hover:text-[#1A1A1A] hover:border-[#1A1A1A] transition-colors duration-200 no-underline"
            >
              Ustawa o KW i hipotece
            </a>
          </div>
        </div>
      </header>

      {/* Main Container Layout */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex flex-col justify-center">
        
        {isLoading && (
          <div className="bg-white border border-[#D1CEC8] p-12 text-center shadow-lg max-w-xl mx-auto w-full my-auto space-y-6 fade-in rounded-none">
            <div className="flex justify-center">
              <div className="relative">
                <div className="w-12 h-12 border border-t-2 border-[#1A1A1A] border-t-transparent animate-spin rounded-full" />
                <Sparkles className="w-4 h-4 text-[#7A7772] absolute top-4 left-4" />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-serif italic text-[#1A1A1A]">
                Analiza księgi i budowanie draftu...
              </h3>
              <p className="text-xs text-[#7A7772] max-w-xs mx-auto leading-relaxed font-serif">
                Zautomatyzowany parser dopasowuje ułamki, wylicza sumy i uzgadnia powiązane prawa według reguł kancelaryjnych.
              </p>
            </div>
            
            {/* Fact board widget */}
            <div className="bg-[#F5F2ED] border border-[#D1CEC8] p-5 text-left rounded-none">
              <span className="text-[9px] font-bold text-[#7A7772] uppercase block tracking-widest mb-2 font-mono">
                Zasady Notarialne EKW
              </span>
              <p className="text-xs font-serif italic text-[#1A1A1A] leading-relaxed">
                "{loadingFact}"
              </p>
            </div>
          </div>
        )}

        {!isLoading && !parsedResult && (
          <div className="space-y-8 flex-1 flex flex-col justify-center">
            
            {/* Header intro card info */}
            <div className="text-center space-y-3 max-w-2xl mx-auto pb-4">
              <span className="text-[10px] uppercase font-bold tracking-[0.25em] text-[#7A7772] block">DOKUMENTACJA REPERTORIUM</span>
              <h2 className="text-2xl sm:text-3.5xl font-serif italic text-[#1A1A1A] tracking-tight leading-tight">
                Generuj Sprawozdania i Opisy Ksiąg Wieczystych
              </h2>
              <p className="text-xs sm:text-sm text-[#7A7772] leading-relaxed max-w-xl mx-auto font-serif">
                Wklej treść odpisu pobraną z portalu EKW lub skorzystaj z profesjonalnego symulatora. System wygeneruje gotowy, zweryfikowany pod kątem ustępu opis w ułamku sekundy.
              </p>
            </div>

            {/* Instrukcja tab hidden for now (stara, nieaktualna) — EKWHelp.tsx
                pozostaje w kodzie, łatwo przywrócić zakładkę później. */}
            <div className="flex-1">
              <EKWBrowserSim
                onDataLoaded={handleSimulationDataLoaded}
                onStartLoading={handleStartLoading}
                onStopLoading={handleStopLoading}
                autoOpenLibrary={autoOpenLibrary}
              />
            </div>
          </div>
        )}

        {/* WORKSTATION VIEW: Renders after parsing EKW data details */}
        {!isLoading && parsedResult && (
          <div className="fade-in space-y-6">
            <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-[0.25em] text-[#7A7772]">
              <Scale className="w-4 h-4 text-[#1A1A1A]" /> Obszar Roboczy Nowego Opisu Aktu Notarialnego
            </div>
            <NotaryEditor
              initialData={parsedResult.structured}
              initialDrafts={parsedResult.drafts}
              rawApify={parsedResult.rawApify}
              validation={parsedResult.validation}
              onReimport={handleBackToSelect}
            />
          </div>
        )}

      </main>

      {/* Footer bar styled simple, with strict privacy info */}
      <footer className="border-t border-[#D1CEC8] bg-[#FDFCFB]">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-4 flex flex-col md:flex-row items-center justify-between text-[10px] uppercase tracking-widest text-[#7A7772] gap-3">
          <div className="flex items-center gap-2">
            <span>© 2026 LexParser.</span>
            <span>Bezpieczne przetwarzanie pamięciowe (Stateless Proxy).</span>
          </div>
          <div className="flex gap-5 items-center">
            <span>Zgodność z RODO / Kancelaria RP</span>
            <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block"></span>
          </div>
        </div>
      </footer>

    </div>
  );
}
