/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Copy, FileText, CheckCircle, ArrowRight, ExternalLink, HelpCircle } from "lucide-react";

export default function EKWHelp() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-8 shadow-sm">
      <div className="flex items-start gap-4 mb-6">
        <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
          <HelpCircle className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 font-display">
            Instrukcja Kopiowania z Portalu Ministerstwa Sprawiedliwości (EKW)
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Ponieważ rządowy system EKW posiada zabezpieczenia anty-bot (CAPTCHA), najszybszą i w 100% niezawodną metodą pracy notariusza jest jednorazowe skopiowanie zawartości przeglądarki bezpośrednio do naszego generatora.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        {/* Step 1 */}
        <div className="flex flex-col bg-slate-50 rounded-xl p-5 border border-slate-100 relative">
          <span className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">
            1
          </span>
          <div className="text-indigo-600 font-medium mb-2 flex items-center gap-1.5 text-sm">
            <ExternalLink className="w-4 h-4" /> Otwórz EKW
          </div>
          <p className="text-xs text-slate-600 flex-1">
            Przejdź na oficjalną stronę rządową do wyszukiwania ksiąg wieczystych i wpisz szukany numer KW.
          </p>
          <a
            href="https://przegladarka-ekw.ms.gov.pl/eukw_prz/KsiegiWieczyste/wyszukiwanieKW"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center justify-center gap-1.5 bg-white text-slate-800 text-xs font-medium py-2 px-3 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Oficjalny Portal EKW <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Step 2 */}
        <div className="flex flex-col bg-slate-50 rounded-xl p-5 border border-slate-100 relative">
          <span className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">
            2
          </span>
          <div className="text-indigo-600 font-medium mb-2 flex items-center gap-1.5 text-sm">
            <FileText className="w-4 h-4" /> Wybierz Aktualną Treść
          </div>
          <p className="text-xs text-slate-600 flex-1">
            Po wpisaniu numeru wybierz opcję <strong className="text-slate-800">„Przeglądanie aktualnej treści księgi wieczystej”</strong>. Zobaczysz podzielony na zagnieżdżone tabele oficjalny odpis.
          </p>
          <div className="mt-4 text-[10px] text-slate-400 bg-slate-100 p-2 rounded border border-slate-100 font-mono">
            Dział I-O • Spis spraw • Własność • Obciążenia
          </div>
        </div>

        {/* Step 3 */}
        <div className="flex flex-col bg-slate-50 rounded-xl p-5 border border-slate-100 relative">
          <span className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">
            3
          </span>
          <div className="text-indigo-600 font-medium mb-2 flex items-center gap-1.5 text-sm">
            <Copy className="w-4 h-4" /> Skopiuj Wszystko (Ctrl + A)
          </div>
          <p className="text-xs text-slate-600 flex-1">
            Kliknij w dowolnym miejscu strony z tekstem księgi wieczystej. Wciśnij na klawiaturze skrót <strong className="text-slate-800">Ctrl + A</strong> (zaznacz wszystko), a następnie <strong className="text-slate-800">Ctrl + C</strong> (kopiuj).
          </p>
          <div className="mt-4 p-2 bg-indigo-50 rounded border border-indigo-100 text-[11px] text-indigo-700 flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Gotowe do wklejenia w zakładce „Szybkie Wklejanie”!</span>
          </div>
        </div>
      </div>

      <div className="mt-8 bg-amber-50 border border-amber-200/60 rounded-xl p-5 flex gap-4">
        <div className="text-amber-600 font-bold text-lg mt-0.5">💡</div>
        <div className="text-xs text-amber-900 space-y-2">
          <p className="font-semibold text-slate-900">Dlaczego paster jest tak zaawansowany?</p>
          <p className="leading-relaxed">
            Nasz generator został wyposażony w wyspecjalizowany model AI, który błyskawicznie radzi sobie z typowym chaossem rządowej struktury EKW. Nawet jeśli skopiujesz ze strony nagłówki, stopki, tabele i przyciski nawigacyjne – model całkowicie je odrzuci, skupiając się wyłącznie na elementach prawnych nieruchomości takich jak dokładne udziały, numery ksiąg i bazy nabycia.
          </p>
        </div>
      </div>
    </div>
  );
}
