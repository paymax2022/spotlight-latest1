export interface Network {
  id: string;
  name: string;
  code: string;
  logoUrl?: string;
  isActive: boolean;
  accent?: string;
  bg?: string;
}

export interface DataPlan {
  id: string;
  networkCode: string;
  name: string;
  allowance: string;
  validity: string;
  sellingPrice: number;
  providerCode: string;
  isActive: boolean;
}

export interface Disco {
  id: string;
  name: string;
  code: string;
  supportsPrepaid: boolean;
  supportsPostpaid: boolean;
  isActive: boolean;
}

export interface MeterValidation {
  customerName: string;
  customerAddress?: string;
  meterNumber: string;
  discoName: string;
  minimumAmount?: number;
  maximumAmount?: number;
}

export interface CableProvider {
  id: string;
  name: string;
  code: string;
  logoUrl?: string;
  isActive: boolean;
}

export interface CablePackage {
  id: string;
  providerCode: string;
  name: string;
  duration: string;
  sellingPrice: number;
  providerCodeValue: string;
  isActive: boolean;
}

export interface SmartCardValidation {
  customerName: string;
  smartCardNumber: string;
  providerName: string;
  currentBouquet?: string;
}

export interface EducationProvider {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  accent?: string;
  bg?: string;
}

export interface EducationProduct {
  id: string;
  providerCode: string;
  name: string;
  sellingPrice: number;
  providerCodeValue: string;
  isActive: boolean;
  meta?: string;
}

export type MeterType = 'PREPAID' | 'POSTPAID';
