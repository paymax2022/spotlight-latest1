import type { UtilityCategory, UtilityPricing } from '../types';

export interface UtilityValidationRequest {
  category: UtilityCategory;
  billerCode: string;
  providerBillerCode?: string | null;
  customerReference: string;
  metadata?: Record<string, unknown>;
}

export interface UtilityValidationResult {
  valid: boolean;
  customerName?: string;
  message?: string;
  raw?: Record<string, unknown>;
}

export interface UtilityPurchaseRequest {
  transactionId: string;
  idempotencyKey: string;
  category: UtilityCategory;
  billerCode: string;
  providerBillerCode?: string | null;
  productCode: string;
  providerProductCode: string;
  customerReference: string;
  pricing: UtilityPricing;
  metadata?: Record<string, unknown>;
}

export interface UtilityPurchaseResult {
  status: 'successful' | 'pending' | 'failed';
  providerReference?: string;
  token?: string;
  message?: string;
  raw?: Record<string, unknown>;
}

export interface UtilityStatusQueryRequest {
  transactionId: string;
  providerReference?: string | null;
  idempotencyKey: string;
}

export interface UtilityStatusResult extends UtilityPurchaseResult {}

export interface UtilityProviderAdapter {
  code: string;
  validateCustomer(request: UtilityValidationRequest): Promise<UtilityValidationResult>;
  purchase(request: UtilityPurchaseRequest): Promise<UtilityPurchaseResult>;
  queryTransactionStatus(request: UtilityStatusQueryRequest): Promise<UtilityStatusResult>;
  healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'down'; message?: string }>;
}
