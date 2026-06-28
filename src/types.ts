/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface OwnerEntity {
  id: string;
  name: string;
  peselOrRegon?: string;
  parentsNames?: string;
  share: string;
  basisOfAcquisition: string;
  entryNumber?: string;
  communityType?: string;
  entryDate?: string;
  applicationData?: string;
}

export interface MortgageEntity {
  id: string;
  type: string;
  amount: number;
  currency: string;
  creditor: string;
  securesWhat?: string;
  entryNumber?: string;
  interestRate?: string;
  entryDate?: string;
  applicationData?: string;
}

export interface EasementEntity {
  id: string;
  description: string;
  beneficiary?: string;
  entryNumber?: string;
  applicationData?: string;
}

export interface WarningOrExecutionEntity {
  id: string;
  description: string;
  caseNumber?: string;
  entryNumber?: string;
  applicationData?: string;
}

export interface PlotEntity {
  number: string;
  areaSquareMeters: number;
  cadastreUnit?: string;
  identifier?: string;
  landUse?: string;
}

export interface KWData {
  kwNumber: string;
  sadRejonowy: string;
  wydzialKw: string;
  status: "active" | "migrated" | "closed" | "unknown";

  dzial1O: {
    location: string;
    address?: string;
    propertyType: "dzialka" | "lokal" | "budynek" | "inne";
    description: string;
    plots: PlotEntity[];
    totalAreaStr: string;
    currentEntryNumber?: string;
    basisDocuments?: string;
    joinSeparation?: string;
    notices?: string[];
    applicationData?: string;
    migrationComment?: string;
  };

  dzial1Sp: {
    hasEntries: boolean;
    shareInJointProperty?: string;
    associatedRights: EasementEntity[];
    notices?: string[];
    applicationData?: string;
    migrationComment?: string;
  };

  dzial2: {
    owners: OwnerEntity[];
    isPerpetualUsufruct: boolean;
    notices?: string[];
    applicationData?: string;
    migrationComment?: string;
  };

  dzial3: {
    hasEntries: boolean;
    easements: EasementEntity[];
    warningsAndExecutions: WarningOrExecutionEntity[];
    otherRights: EasementEntity[];
    preemptionRights?: EasementEntity[];
    claims?: EasementEntity[];
    disposalRestrictions?: EasementEntity[];
    notices?: string[];
    applicationData?: string;
    migrationComment?: string;
  };

  dzial4: {
    hasEntries: boolean;
    mortgages: MortgageEntity[];
    notices?: string[];
    applicationData?: string;
    migrationComment?: string;
  };

  notarySettings?: {
    includePesels: boolean;
    includeAcquisitionBasis: boolean;
    useAbbreviations: boolean;
    uppercaseNames: boolean;
    spellOutNumbers: boolean;
  };
}

export interface FieldVisibilityConfig {
  notices: boolean;
  applicationData: boolean;
  pesel: boolean;
  basisDocuments: boolean;
  identifiers: boolean;
  joinSeparation: boolean;
  entryNumbers: boolean;
  interestRate: boolean;
}

export const DEFAULT_FIELD_VISIBILITY: FieldVisibilityConfig = {
  notices: true,
  applicationData: false,
  pesel: true,
  basisDocuments: true,
  identifiers: false,
  joinSeparation: true,
  entryNumbers: false,
  interestRate: false,
};

export type TemplateStyle = "classic" | "modern" | "short" | "custom";

export interface PreconfiguredExample {
  id: string;
  kwNumber: string;
  title: string;
  subtitle: string;
  description: string;
  data: KWData;
}
