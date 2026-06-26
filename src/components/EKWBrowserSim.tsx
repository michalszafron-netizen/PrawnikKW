/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Search, Server, Shield, Smartphone, ArrowRight, Check, AlertCircle, RefreshCw, Layers, Settings2 } from "lucide-react";
import { PRECONFIGURED_EXAMPLES } from "../data/examples";
import { KWData } from "../types";

interface EKWBrowserSimProps {
  onDataLoaded: (data: KWData) => void;
  onStartLoading: () => void;
  onStopLoading: () => void;
}

export default function EKWBrowserSim({ onDataLoaded, onStartLoading, onStopLoading }: EKWBrowserSimProps) {
  // Input states
  const [courtCode, setCourtCode] = useState("WA1M");
  const [bookNumber, setBookNumber] = useState("00348754");
  const [controlNum, setControlNum] = useState("2");
  
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

  // Auto compile current book number
  const fullKW = `${courtCode}/${bookNumber}/${controlNum}`;

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

    setStep("captcha");
    setSliderPosition(0);
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

  const triggerLookup = () => {
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
        completeSearch();
      }
    }, 450);
  };

  const completeSearch = async () => {
    try {
      // Try fetching real data from Apify EKW scraper
      const response = await fetch("/api/fetch-kw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kwNumber: fullKW, viewType })
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
        setSimulatedResult(dataWithSettings);
        onDataLoaded(dataWithSettings);
        setStep("success");
      } else {
        throw new Error(parsed.error || "Nie udało się pobrać danych z EKW.");
      }
    } catch (err: any) {
      console.error("Apify fetch failed, trying simulation fallback:", err.message);

      // Fallback: check preconfigured examples
      const matchedEx = PRECONFIGURED_EXAMPLES.find(
        (e) => e.kwNumber.replace(/\s+/g, "").toUpperCase() === fullKW.replace(/\s+/g, "").toUpperCase()
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
            body: JSON.stringify({ kwNumber: fullKW })
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

              {/* Notary AI parameters */}
              <div className="border-t border-[#D1CEC8] pt-3 space-y-2">
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
              </div>
            </form>

            {/* Quick selectors for Polish Notaries demo cases */}
            <div className="space-y-2 pt-2">
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
