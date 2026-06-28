/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from "react";
import { Clipboard, FileText, UploadCloud, Settings2, Sparkles, CheckSquare, AlertCircle } from "lucide-react";
import { KWData } from "../types";

interface ManualPasterProps {
  onParsedResult: (parsed: { structured: KWData; drafts: { classic: string; modern: string; short: string } }) => void;
  onStartLoading: () => void;
  onStopLoading: () => void;
  isLoading: boolean;
}

export default function ManualPaster({ onParsedResult, onStartLoading, onStopLoading, isLoading }: ManualPasterProps) {
  const [rawText, setRawText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  // Settings
  const [includePesels, setIncludePesels] = useState(true);
  const [includeAcquisitionBasis, setIncludeAcquisitionBasis] = useState(true);
  const [useAbbreviations, setUseAbbreviations] = useState(true);
  const [uppercaseNames, setUppercaseNames] = useState(true);
  const [spellOutNumbers, setSpellOutNumbers] = useState(true);

  // Handle Drag & Drop
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files[0]);
    }
  };

  const handleFiles = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result && typeof event.target.result === "string") {
        setRawText(event.target.result);
      }
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawText.trim()) return;

    onStartLoading();

    try {
      const response = await fetch("/api/parse-raw-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText,
          notarySettings: {
            includePesels,
            includeAcquisitionBasis,
            useAbbreviations,
            uppercaseNames,
            spellOutNumbers
          }
        })
      });

      const data = await response.json();
      if (response.ok) {
        // Enforce settings values onto returned structures for client consistency
        const processedStructured: KWData = {
          ...data.structured,
          notarySettings: {
            includePesels,
            includeAcquisitionBasis,
            useAbbreviations,
            uppercaseNames,
            spellOutNumbers
          }
        };

        onParsedResult({
          structured: processedStructured,
          drafts: data.drafts
        });
      } else {
        throw new Error(data.error || "Nie udało się sformatować podanego tekstu.");
      }
    } catch (error: any) {
      alert("Błąd analizy tekstu przez sztuczną inteligencję: " + error.message);
    } finally {
      onStopLoading();
    }
  };

  const handlePasteDemoText = () => {
    setRawText(`Księga Wieczysta nr WA1M/00348754/5
Sąd Rejonowy dla Warszawy-Mokotowa, VII Wydział Ksiąg Wieczystych.
DZIAŁ I-O: Oznaczenie nieruchomości
POŁOŻENIE: Województwo Mazowieckie, m.st. Warszawa, dzielnica Mokotów. Przeznaczenie: Samodzielny lokal mieszkalny oznaczony nr 15 przy ulicy Puławskiej 142 w Warszawie.
POWIERZCHNIA: 64,50 m2 składający się z 3 pokoi, przedpokoju i kuchni i łazienki.
DZIAŁ II: Własność
Własność: Jan Paweł Kowalski, syn Mariana i Haliny (PESEL 84051203492) oraz Barbara Maria Kowalska, córka Andrzeja i Krystyny (PESEL 86112504839) we wspólności ustawowej majątkowej małżeńskiej.
Podstawa nabycia: Umowa sprzedaży przed Notariuszem Małgorzatą Szewczyk z dnia 15.05.2018 r. Rep. A 4562/2018.
DZIAŁ IV: Hipoteka
Hipoteka umowna do kwoty 320 000,00 PLN (trzysta dwadzieścia tysięcy złotych) na rzecz PKO Bank Polski S.A. na zabezpieczenie kredytu mieszkaniowego.`);
  };

  return (
    <div className="bg-[#FDFCFB] border border-[#D1CEC8] p-6 sm:p-8 rounded-none shadow-sm space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex flex-col lg:flex-row gap-6 justify-between items-start pb-4 border-b border-[#E5E5E5]">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold tracking-widest text-[#7A7772]">ŹRÓDŁO WPROWADZANIA</span>
            <h3 className="text-xl font-serif text-[#1A1A1A] flex items-center gap-2">
              <Clipboard className="w-5 h-5 text-neutral-800" /> Szybkie Wklejanie i Ekstrakcja
            </h3>
            <p className="text-xs text-[#7A7772] font-serif italic">
              Wklej surową zawartość skopiowaną z rządowej strony EKW (Dział po Dziale) lub wprowadź plik tekstowy (.txt, .html).
            </p>
          </div>
          <button
            type="button"
            onClick={handlePasteDemoText}
            className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A] border border-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-white px-4 py-2 text-center transition-all duration-200 cursor-pointer"
          >
            Wklej Przykładowe Dane (Demo)
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Main clipboard text input area */}
          <div className="lg:col-span-8 space-y-4">
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={`relative border-b-2 transition-all h-[340px] flex flex-col ${
                dragActive
                  ? "border-[#1A1A1A] bg-[#F5F2ED]/60"
                  : "border-[#D1CEC8] hover:border-[#1A1A1A] bg-white"
              }`}
            >
              <textarea
                required
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Wklej tutaj kompletną treść księgi wieczystej... (Skopiuj całą stronę odpisu lub wyciągu za pomocą Ctrl+A i Ctrl+C)"
                className="w-full h-full bg-transparent resize-none p-5 text-xs font-mono text-neutral-800 placeholder-[#9E9C98] focus:outline-none focus:ring-0 leading-relaxed"
              />

              {rawText.length === 0 && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none text-center p-6 gap-3 cursor-pointer"
                >
                  <UploadCloud className="w-8 h-8 text-[#7A7772] opacity-80" />
                  <p className="text-xs font-bold uppercase tracking-wider text-[#1A1A1A]">
                    Przeciągnij i upuść plik odpisu <span className="text-[#7A7772] lowercase font-serif font-normal italic">lub kliknij tutaj</span>
                  </p>
                  <p className="text-[10px] text-[#7A7772]">Obsługiwane pliki wyjściowe (.txt, .html, .rtf)</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.html,.rtf,.doc,.docx"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {rawText.length > 0 && (
              <div className="flex justify-between items-center bg-[#F5F2ED] px-4 py-2 border border-[#D1CEC8]">
                <span className="text-[10px] font-mono text-[#7A7772] uppercase tracking-wider">
                  ROZMIAR TEKSTU: <strong className="text-[#1A1A1A] font-bold">{rawText.length.toLocaleString()} ZNAKÓW</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setRawText("")}
                  className="text-[10px] text-red-700 hover:text-red-950 uppercase font-bold tracking-wider transition-colors cursor-pointer"
                >
                  Wyczyść pole
                </button>
              </div>
            )}
          </div>

          {/* Notarial custom configuration sidebar */}
          <div className="lg:col-span-4 bg-[#F5F2ED] border border-[#D1CEC8] p-5 flex flex-col justify-between h-[340px]">
            <div className="space-y-4">
              <div className="text-[10px] font-bold text-[#7A7772] uppercase tracking-[0.2em] pb-2 border-b border-[#D1CEC8] flex items-center gap-1.55">
                <Settings2 className="w-3.5 h-3.5 text-[#1A1A1A]" /> Parametry Opracowania AI
              </div>

              <div className="space-y-3.5 max-h-[190px] overflow-y-auto pr-1">
                {/* Include PESELs */}
                <label className="flex items-start gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={includePesels}
                    onChange={(e) => setIncludePesels(e.target.checked)}
                    className="mt-0.5 accent-[#1A1A1A] h-3.5 w-3.5 rounded-none cursor-pointer"
                  />
                  <div className="text-[11px] leading-tight">
                    <span className="font-bold text-[#1A1A1A] group-hover:text-[#7A7772] transition-colors">Dane identyfikacyjne PESEL</span>
                    <span className="text-[#7A7772] block mt-0.5 text-[9px] font-serif italic">Dodaj unikalne numery PESEL i KRS.</span>
                  </div>
                </label>

                {/* Include basis of acquisition */}
                <label className="flex items-start gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={includeAcquisitionBasis}
                    onChange={(e) => setIncludeAcquisitionBasis(e.target.checked)}
                    className="mt-0.5 accent-[#1A1A1A] h-3.5 w-3.5 rounded-none cursor-pointer"
                  />
                  <div className="text-[11px] leading-tight">
                    <span className="font-bold text-[#1A1A1A] group-hover:text-[#7A7772] transition-colors">Dodaj podstawy nabycia</span>
                    <span className="text-[#7A7772] block mt-0.5 text-[9px] font-serif italic">Wyciągnij akty notarialne i księgi wieczyste.</span>
                  </div>
                </label>

                {/* Use Abbreviations */}
                <label className="flex items-start gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={useAbbreviations}
                    onChange={(e) => setUseAbbreviations(e.target.checked)}
                    className="mt-0.5 accent-[#1A1A1A] h-3.5 w-3.5 rounded-none cursor-pointer"
                  />
                  <div className="text-[11px] leading-tight">
                    <span className="font-bold text-[#1A1A1A] group-hover:text-[#7A7772] transition-colors">Terminologia urzędowa</span>
                    <span className="text-[#7A7772] block mt-0.5 text-[9px] font-serif italic">Stosuj skróty: Dz.U., Rep. A, m.st. Warszawa.</span>
                  </div>
                </label>

                {/* Capitalize family name */}
                <label className="flex items-start gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={uppercaseNames}
                    onChange={(e) => setUppercaseNames(e.target.checked)}
                    className="mt-0.5 accent-[#1A1A1A] h-3.5 w-3.5 rounded-none cursor-pointer"
                  />
                  <div className="text-[11px] leading-tight">
                    <span className="font-bold text-[#1A1A1A] group-hover:text-[#7A7772] transition-colors">Nazwiska drukowane</span>
                    <span className="text-[#7A7772] block mt-0.5 text-[9px] font-serif italic">Formatuj nazwiska wielkimi literami.</span>
                  </div>
                </label>

                {/* Spell check math/numbers */}
                <label className="flex items-start gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={spellOutNumbers}
                    onChange={(e) => setSpellOutNumbers(e.target.checked)}
                    className="mt-0.5 accent-[#1A1A1A] h-3.5 w-3.5 rounded-none cursor-pointer"
                  />
                  <div className="text-[11px] leading-tight">
                    <span className="font-bold text-[#1A1A1A] group-hover:text-[#7A7772] transition-colors">Słowny opis ułamków</span>
                    <span className="text-[#7A7772] block mt-0.5 text-[9px] font-serif italic">Wpisuj wyrażenie „jedna druga” w tekście.</span>
                  </div>
                </label>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading || !rawText.trim()}
                className={`w-full text-xs uppercase tracking-widest font-bold py-3.5 px-4 rounded-none transition-all duration-300 cursor-pointer ${
                  isLoading || !rawText.trim()
                    ? "bg-stone-300 text-stone-500 cursor-not-allowed border border-stone-200"
                    : "bg-[#1A1A1A] hover:bg-stone-800 text-white shadow-md hover:shadow-lg"
                }`}
              >
                {isLoading ? "Przetwarzanie danych..." : "Generuj Draft Opisu"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
