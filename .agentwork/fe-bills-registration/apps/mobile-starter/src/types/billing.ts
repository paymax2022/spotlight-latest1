export type ApiEnvelope<T> = {
  success: boolean;
  message?: string;
  data: T;
};

export type ServiceType = 'AIRTIME' | 'DATA' | 'ELECTRICITY' | 'CABLE_TV';
export type TransactionStatus = 'PENDING' | 'PROCESSING' | 'SUCCESSFUL' | 'FAILED' | 'REFUNDED' | 'REVERSED';

export type Network = {
  id: string;
  name: string;
  code: string;
  logoUrl?: string;
  isActive: boolean;
};

export type DataPlan = {
  id: string;
  networkCode: string;
  name: string;
  allowance: string;
  validity: string;
  sellingPrice: number;
  providerCode: string;
  isActive: boolean;
};

export type Disco = {
  id: string;
  name: string;
  code: string;
  supportsPrepaid: boolean;
  supportsPostpaid: boolean;
  isActive: boolean;
};

export type CableProvider = {
  id: string;
  name: string;
  code: string;
  logoUrl?: string;
  isActive: boolean;
};

export type CablePackage = {
  id: string;
  providerCode: string;
  name: string;
  duration: string;
  sellingPrice: number;
  providerCodeValue: string;
  isActive: boolean;
};

export type ValidationResult = {
  customerName: string;
  customerAddress?: string;
  meterNumber?: string;
  smartCardNumber?: string;
  discoName?: string;
  providerName?: string;
  currentBouquet?: string;
  minimumAmount?: number;
  maximumAmount?: number;
};

export type Transaction = {
  id: string;
  serviceType: ServiceType;
  status: TransactionStatus;
  amount: number;
  charges: number;
  totalAmount: number;
  reference: string;
  customerIdentifier: string;
  providerName?: string;
  productName?: string;
  token?: string;
  units?: string;
  createdAt: string;
};

export type Receipt = Transaction & {
  transactionId: string;
  customerName?: string;
  supportMessage?: string;
};

export type Wallet = {
  balance: number;
  currency: 'NGN';
  ledgerBalance?: number;
  pendingBalance?: number;
};

export type Dashboard = {
  user: {
    fullName: string;
    phone: string;
  };
  wallet: Wallet;
  services: {
    airtime: boolean;
    data: boolean;
    electricity: boolean;
    cableTv: boolean;
  };
  recentTransactions: Transaction[];
  banners?: { id: string; title: string; imageUrl?: string; body?: string }[];
};
