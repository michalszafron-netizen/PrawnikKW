/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * draftBuilder — single, flexible source of truth for the three notarial drafts
 * (classic / modern / short) generated deterministically from a KWData object.
 *
 * Design goals:
 * - One generator used by every caller (initial load, manual regeneration), so the
 *   three styles can never drift apart again.
 * - Resilient to whatever a księga actually contains: any property type, zero..n
 *   owners, zero..n mortgages, empty or populated działy, optional sections
 *   (I-Sp associated rights, przyłączenie/odłączenie, wzmianki). Nothing is
 *   hard-coded — every clause is derived from the data and gracefully omitted when
 *   the underlying data is absent.
 * - No assumptions that "there is exactly one mortgage" or "Dział III has entries".
 *
 * Future templates/styles can be added by extending TemplateStyle and adding a
 * builder below; the shared helpers stay reusable.
 */

import { KWData, MortgageEntity, OwnerEntity } from "../types";

export interface DraftSet {
  classic: string;
  modern: string;
  short: string;
  /** Free-form draft built entirely from a user instruction. Empty by default. */
  custom: string;
}

export interface BuildDraftsOptions {
  /** Include PESEL/REGON next to owners (defaults to true when present). */
  includePesels?: boolean;
  /** Include acquisition basis for owners (defaults to true when present). */
  includeAcquisitionBasis?: boolean;
}

// ----------------------------------------------------------------------------
// Formatting helpers
// ----------------------------------------------------------------------------

/** Format a monetary amount the Polish way, e.g. 127530.6 → "127 530,60 zł". */
export function formatAmount(amount: number, currency?: string): string {
  const cur = (currency || "PLN").toUpperCase();
  const symbol = cur === "PLN" || cur === "ZŁ" || cur === "ZL" ? "zł" : cur;
  if (!amount || Number.isNaN(amount)) return symbol;
  return `${amount.toLocaleString("pl-PL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${symbol}`;
}

/** Pick the correct Polish plural form for a count (1 / few / many). */
function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Nominative label for the property type. */
export function propertyTypeLabel(type: KWData["dzial1O"]["propertyType"]): string {
  switch (type) {
    case "lokal":
      return "lokal stanowiący odrębną nieruchomość";
    case "budynek":
      return "nieruchomość zabudowana budynkiem";
    case "dzialka":
      return "nieruchomość gruntowa";
    default:
      return "nieruchomość";
  }
}

/** Short label for compact summaries. */
function propertyTypeShortLabel(type: KWData["dzial1O"]["propertyType"]): string {
  switch (type) {
    case "lokal":
      return "lokal";
    case "budynek":
      return "nieruchomość zabudowana";
    case "dzialka":
      return "nieruchomość gruntowa";
    default:
      return "nieruchomość";
  }
}

// ----------------------------------------------------------------------------
// Clause builders (each returns "" when the underlying data is missing)
// ----------------------------------------------------------------------------

/** Describe the plots / object of Dział I-O. */
function objectDescriptionClause(data: KWData): string {
  const io = data.dzial1O;
  const plots = io.plots || [];
  if (plots.length > 0) {
    const plotStrs = plots.map((p) => {
      const bits = [
        p.number ? `działka nr ${p.number}` : "",
        p.cadastreUnit ? `obręb ${p.cadastreUnit}` : "",
        p.landUse ? p.landUse : "",
      ].filter(Boolean);
      return bits.join(", ");
    });
    const joined = plotStrs.join("; ");
    // Append a free-text description only if it adds something not already covered.
    return io.description && !plots.some((p) => p.landUse && io.description.includes(p.landUse))
      ? `${joined}. ${io.description}`
      : joined;
  }
  return io.description || "";
}

/** A single owner rendered as a notarial clause. */
function ownerClause(o: OwnerEntity, opts: Required<BuildDraftsOptions>): string {
  const isRegon = /regon/i.test(o.peselOrRegon || "");
  const idPart =
    opts.includePesels && o.peselOrRegon
      ? ` (${isRegon || /^[A-Za-z]/.test(o.peselOrRegon!) ? "" : "PESEL: "}${o.peselOrRegon})`
      : "";
  const parents = o.parentsNames ? `, ${o.parentsNames}` : "";
  const share = o.share ? ` — w udziale ${o.share}` : "";
  return `${o.name}${parents}${idPart}${share}`;
}

/** All owners joined. */
function ownersClause(data: KWData, opts: Required<BuildDraftsOptions>): string {
  const owners = data.dzial2.owners || [];
  if (owners.length === 0) return "brak ujawnionych właścicieli";
  return owners.map((o) => ownerClause(o, opts)).join("; ");
}

/** Acquisition basis (deduplicated across owners). */
function acquisitionBasisClause(data: KWData): string {
  const bases = Array.from(
    new Set((data.dzial2.owners || []).map((o) => o.basisOfAcquisition).filter(Boolean)),
  );
  return bases.join("; ");
}

/** Full enumeration of mortgages for the classic / modern styles. */
function mortgageFull(m: MortgageEntity): string {
  const parts = [
    m.type || "hipoteka",
    m.amount ? `w kwocie ${formatAmount(m.amount, m.currency)}` : "",
    m.creditor ? `na rzecz: ${m.creditor}` : "",
    m.securesWhat ? `z tytułu: ${m.securesWhat}` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

/** Dział IV clause for classic / modern. */
function mortgagesClause(data: KWData): string {
  const ms = data.dzial4.mortgages || [];
  if (!data.dzial4.hasEntries || ms.length === 0) {
    return "Dział IV wolny od wpisów (brak zabezpieczeń hipotecznych)";
  }
  if (ms.length === 1) {
    return `nieruchomość jest obciążona hipoteką: ${mortgageFull(ms[0])}`;
  }
  const list = ms.map((m, i) => `${i + 1}) ${mortgageFull(m)}`).join("; ");
  const total = ms.reduce((s, m) => s + (m.amount || 0), 0);
  const currency = ms.find((m) => m.amount)?.currency;
  return `nieruchomość jest obciążona ${ms.length} ${plural(
    ms.length,
    "hipoteką",
    "hipotekami",
    "hipotekami",
  )}: ${list}. Łączna suma zabezpieczeń: ${formatAmount(total, currency)}`;
}

/** Compact Dział IV summary for the short style. */
function mortgagesSummary(data: KWData): string {
  const ms = data.dzial4.mortgages || [];
  if (!data.dzial4.hasEntries || ms.length === 0) return "brak (wolny od wpisów)";
  const total = ms.reduce((s, m) => s + (m.amount || 0), 0);
  const creditors = Array.from(new Set(ms.map((m) => m.creditor).filter(Boolean)));
  const creditorStr =
    creditors.length === 1
      ? ` na rzecz ${creditors[0]}`
      : creditors.length > 1
        ? ` na rzecz ${creditors.length} wierzycieli`
        : "";
  const currency = ms.find((m) => m.amount)?.currency;
  const word = plural(ms.length, "hipoteka", "hipoteki", "hipotek");
  const totalStr = total > 0 ? `, łącznie ${formatAmount(total, currency)}` : "";
  return `${ms.length} ${word}${creditorStr}${totalStr}`;
}

/** Dział III narrative (handles empty + all sub-collections). */
function dzial3Clause(data: KWData): string {
  const d3 = data.dzial3;
  if (!d3.hasEntries) return "Dział III wolny od wpisów (brak praw, roszczeń i ograniczeń)";
  const items = [
    ...(d3.easements || []).map((e) => e.description),
    ...(d3.warningsAndExecutions || []).map((w) => w.description),
    ...(d3.otherRights || []).map((r) => r.description),
    ...(d3.claims || []).map((r) => r.description),
    ...(d3.preemptionRights || []).map((r) => r.description),
    ...(d3.disposalRestrictions || []).map((r) => r.description),
  ].filter(Boolean);
  return items.length ? items.join("; ") : "wpisy ujawnione w Dziale III";
}

/** Dział I-Sp clause. */
function dzial1SpClause(data: KWData): string {
  const sp = data.dzial1Sp;
  if (!sp.hasEntries) return "brak wpisów praw związanych z własnością";
  const parts = [
    sp.shareInJointProperty ? `udział w nieruchomości wspólnej: ${sp.shareInJointProperty}` : "",
    ...(sp.associatedRights || []).map((r) => r.description),
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : "ujawnione";
}

/** Aggregate all wzmianki across działy (legally significant — they suspend the
 * public-faith warranty of the land register). */
function allNotices(data: KWData): string[] {
  return [
    ...(data.dzial1O.notices || []),
    ...(data.dzial1Sp.notices || []),
    ...(data.dzial2.notices || []),
    ...(data.dzial3.notices || []),
    ...(data.dzial4.notices || []),
  ].filter(Boolean);
}

// ----------------------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------------------

export function buildDrafts(data: KWData, options: BuildDraftsOptions = {}): DraftSet {
  const opts: Required<BuildDraftsOptions> = {
    includePesels: options.includePesels ?? true,
    includeAcquisitionBasis: options.includeAcquisitionBasis ?? true,
  };

  const num = data.kwNumber;
  const court = [data.sadRejonowy, data.wydzialKw].filter(Boolean).join(", ");
  const typeLabel = propertyTypeLabel(data.dzial1O.propertyType);
  const typeShort = propertyTypeShortLabel(data.dzial1O.propertyType);
  const loc = data.dzial1O.location || "brak danych o położeniu";
  const area = data.dzial1O.totalAreaStr || "";
  const objectDesc = objectDescriptionClause(data);
  const owners = ownersClause(data, opts);
  const ownerWord = plural(data.dzial2.owners?.length || 0, "właściciel", "właściciele", "właściciele");
  const basis = opts.includeAcquisitionBasis ? acquisitionBasisClause(data) : "";
  const join = data.dzial1O.joinSeparation || "";
  const basisDocs = data.dzial1O.basisDocuments || "";
  const sp = dzial1SpClause(data);
  const d3 = dzial3Clause(data);
  const d4 = mortgagesClause(data);
  const notices = allNotices(data);

  // ---- Classic (dense notarial prose) ----
  const classicParts: string[] = [];
  classicParts.push(
    `Z księgi wieczystej numer ${num}${court ? `, prowadzonej przez ${court}` : ""}, wynika, co następuje.`,
  );
  classicParts.push(
    `W Dziale I-O (oznaczenie nieruchomości) wpisana jest ${typeLabel}, położona: ${loc}` +
      `${area ? `, o obszarze ${area}` : ""}` +
      `${objectDesc ? `, obejmująca: ${objectDesc}` : ""}.` +
      `${join ? ` Przyłączenie/odłączenie: ${join}.` : ""}` +
      `${basisDocs ? ` Podstawa oznaczenia: ${basisDocs}.` : ""}`,
  );
  classicParts.push(`W Dziale I-Sp: ${sp}.`);
  classicParts.push(
    `W Dziale II (własność) jako ${ownerWord} wpisani są: ${owners}` +
      `${basis ? `, na podstawie: ${basis}` : ""}.`,
  );
  classicParts.push(`W Dziale III: ${d3}.`);
  classicParts.push(`W Dziale IV: ${d4}.`);
  if (notices.length > 0) {
    classicParts.push(
      `UWAGA — w księdze ujawniono wzmianki o wnioskach (wyłączają rękojmię wiary publicznej ksiąg wieczystych): ${notices.join(
        "; ",
      )}.`,
    );
  }
  const classic = classicParts.join("\n\n");

  // ---- Modern (readable, itemised) ----
  const modernLines: string[] = [
    `Stan prawny nieruchomości — KW ${num}${court ? ` (${court})` : ""}:`,
    "",
    `1. Oznaczenie (Dział I-O): ${typeLabel}, ${loc}${area ? `, obszar ${area}` : ""}.` +
      `${objectDesc ? ` ${objectDesc}.` : ""}${join ? ` Przyłączenie/odłączenie: ${join}.` : ""}`,
    `2. Prawa związane (Dział I-Sp): ${sp}.`,
    `3. Własność (Dział II): ${owners}.${basis ? ` Podstawa nabycia: ${basis}.` : ""}`,
    `4. Prawa, roszczenia, ograniczenia (Dział III): ${d3}.`,
    `5. Hipoteki (Dział IV): ${d4}.`,
  ];
  if (notices.length > 0) {
    modernLines.push(
      `6. Wzmianki o wnioskach (wyłączają rękojmię wiary publicznej): ${notices.join("; ")}.`,
    );
  }
  const modern = modernLines.join("\n");

  // ---- Short (risk-assessment condensate) ----
  const ownerNames = (data.dzial2.owners || []).map((o) => o.name).join(" / ") || "brak danych";
  const short =
    `KW ${num}: ${typeShort}${loc ? `, ${loc}` : ""}${area ? `, ${area}` : ""}. ` +
    `Właściciel(e): ${ownerNames}. ` +
    `Dział III: ${data.dzial3.hasEntries ? "są wpisy" : "brak wpisów"}. ` +
    `Dział IV: ${mortgagesSummary(data)}.` +
    (notices.length > 0 ? ` Wzmianki: ${notices.length} (rękojmia wyłączona).` : "");

  return { classic, modern, short, custom: "" };
}
