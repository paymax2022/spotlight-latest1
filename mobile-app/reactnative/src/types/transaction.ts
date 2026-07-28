export type ServiceType = 'AIRTIME' | 'DATA' | 'ELECTRICITY' | 'CABLE_TV' | 'EDUCATION';

export type TransactionStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'REFUNDED'
  | 'REVERSED';

export interface Transaction {
  id: string;
  serviceType: ServiceType;
  status: TransactionStatus;
  amount: number;
  charges: number;
  totalAmount: number;
  reference: string;
  customerIdentifier: string;
  providerName?: string;
  providerRoute?: string;
  providerAttempts?: string;
  productName?: string;
  token?: string;
  units?: string;
  createdAt: string;
}

export interface Receipt {
  transactionId: string;
  reference: string;
  status: string;
  serviceType: string;
  amount: number;
  charges: number;
  totalAmount: number;
  customerIdentifier: string;
  customerName?: string;
  productName?: string;
  providerName?: string;
  providerRoute?: string;
  providerAttempts?: string;
  token?: string;
  units?: string;
  createdAt: string;
  supportMessage?: string;
}
