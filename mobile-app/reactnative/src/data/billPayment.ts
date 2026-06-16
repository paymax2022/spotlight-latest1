import { Colors } from '@/constants/colors';

export type PaymentServiceId = 'airtime' | 'data' | 'electricity' | 'cable-tv' | 'education';

export interface PaymentProvider {
  id: string;
  name: string;
  accent: string;
  bg: string;
}

export interface PaymentPlan {
  id: string;
  label: string;
  price?: string;
  meta?: string;
}

export interface PaymentServiceConfig {
  id: PaymentServiceId;
  title: string;
  subtitle: string;
  icon: string;
  accent: string;
  providerLabel: string;
  accountLabel: string;
  accountPlaceholder: string;
  amountLabel: string;
  primaryAction: string;
  helperText: string;
  providers: PaymentProvider[];
  quickAmounts?: string[];
  plans?: PaymentPlan[];
  summary: Array<{ label: string; value: string }>;
}

export const BILL_CATEGORIES = [
  { id: 'airtime', label: 'Airtime', icon: 'Smartphone', route: '/services/airtime', accent: Colors.primary, bg: Colors.iconBgPurple },
  { id: 'data', label: 'Data / Internet', icon: 'Wifi', route: '/services/data', accent: Colors.secondary, bg: Colors.iconBgBlue },
  { id: 'electricity', label: 'Electricity', icon: 'Zap', route: '/services/electricity', accent: '#D97706', bg: 'rgba(234,179,8,0.12)' },
  { id: 'cable-tv', label: 'Cable TV', icon: 'Tv', route: '/services/cable-tv', accent: Colors.teal, bg: Colors.iconBgTeal },
  { id: 'education', label: 'Education', icon: 'GraduationCap', route: '/services/education', accent: '#7C3AED', bg: 'rgba(124,58,237,0.10)' },
] as const;

export const PAYMENT_SERVICES: Record<PaymentServiceId, PaymentServiceConfig> = {
  airtime: {
    id: 'airtime',
    title: 'Buy Airtime',
    subtitle: 'Top up any Nigerian mobile line instantly with secure wallet payment.',
    icon: 'Smartphone',
    accent: Colors.primary,
    providerLabel: 'Select Network',
    accountLabel: 'Phone Number',
    accountPlaceholder: '0801 234 5678',
    amountLabel: 'Amount',
    primaryAction: 'Buy Airtime',
    helperText: 'Airtime value is delivered immediately after confirmation.',
    providers: [
      { id: 'mtn', name: 'MTN', accent: '#F5B800', bg: 'rgba(245,184,0,0.12)' },
      { id: 'airtel', name: 'Airtel', accent: '#E11D48', bg: 'rgba(225,29,72,0.10)' },
      { id: 'glo', name: 'Glo', accent: '#16A34A', bg: 'rgba(22,163,74,0.10)' },
      { id: '9mobile', name: '9mobile', accent: '#84CC16', bg: 'rgba(132,204,22,0.12)' },
    ],
    quickAmounts: ['₦100', '₦200', '₦500', '₦1,000', '₦2,000', '₦5,000'],
    summary: [
      { label: 'Network', value: 'MTN' },
      { label: 'Delivery', value: 'Instant' },
      { label: 'Fee', value: '₦0.00' },
    ],
  },
  data: {
    id: 'data',
    title: 'Airtime & Data',
    subtitle: 'Buy mobile data and internet bundles for all major providers.',
    icon: 'Wifi',
    accent: Colors.secondary,
    providerLabel: 'Select Provider',
    accountLabel: 'Phone / Router Number',
    accountPlaceholder: '0801 234 5678',
    amountLabel: 'Choose Plan',
    primaryAction: 'Buy Data',
    helperText: 'Data bundles activate on the selected line after payment.',
    providers: [
      { id: 'mtn', name: 'MTN Data', accent: '#F5B800', bg: 'rgba(245,184,0,0.12)' },
      { id: 'airtel', name: 'Airtel Data', accent: '#E11D48', bg: 'rgba(225,29,72,0.10)' },
      { id: 'glo', name: 'Glo Data', accent: '#16A34A', bg: 'rgba(22,163,74,0.10)' },
      { id: 'spectranet', name: 'Spectranet', accent: Colors.secondary, bg: Colors.iconBgBlue },
    ],
    plans: [
      { id: '1gb', label: '1GB Daily', price: '₦350', meta: '24 hours' },
      { id: '3gb', label: '3GB Weekly', price: '₦1,200', meta: '7 days' },
      { id: '10gb', label: '10GB Monthly', price: '₦3,500', meta: '30 days' },
    ],
    summary: [
      { label: 'Provider', value: 'MTN Data' },
      { label: 'Plan', value: '3GB Weekly' },
      { label: 'Fee', value: '₦0.00' },
    ],
  },
  electricity: {
    id: 'electricity',
    title: 'Electricity Payment',
    subtitle: 'Power your home with prepaid and postpaid utility payments.',
    icon: 'Zap',
    accent: '#D97706',
    providerLabel: 'Select Disco',
    accountLabel: 'Meter Number',
    accountPlaceholder: '1234 5678 9012',
    amountLabel: 'Amount',
    primaryAction: 'Validate Meter',
    helperText: 'Meter details are validated before payment confirmation.',
    providers: [
      { id: 'ekedc', name: 'EKEDC', accent: '#D97706', bg: 'rgba(234,179,8,0.12)' },
      { id: 'ikedc', name: 'IKEDC', accent: Colors.secondary, bg: Colors.iconBgBlue },
      { id: 'aedc', name: 'AEDC', accent: Colors.primary, bg: Colors.iconBgPurple },
      { id: 'phed', name: 'PHED', accent: Colors.teal, bg: Colors.iconBgTeal },
    ],
    quickAmounts: ['₦1,000', '₦2,000', '₦5,000', '₦10,000', '₦20,000'],
    summary: [
      { label: 'Customer', value: 'Prince Adekunle' },
      { label: 'Meter Type', value: 'Prepaid' },
      { label: 'Token', value: 'Instant delivery' },
    ],
  },
  'cable-tv': {
    id: 'cable-tv',
    title: 'Cable TV Payment',
    subtitle: 'Renew subscriptions and stay connected to your favourite channels.',
    icon: 'Tv',
    accent: Colors.teal,
    providerLabel: 'Select Provider',
    accountLabel: 'Smartcard / IUC Number',
    accountPlaceholder: '1234567890',
    amountLabel: 'Choose Bouquet',
    primaryAction: 'Renew Subscription',
    helperText: 'Subscription renewals are processed securely in seconds.',
    providers: [
      { id: 'dstv', name: 'DSTV', accent: Colors.secondary, bg: Colors.iconBgBlue },
      { id: 'gotv', name: 'GOtv', accent: Colors.teal, bg: Colors.iconBgTeal },
      { id: 'startimes', name: 'StarTimes', accent: Colors.primary, bg: Colors.iconBgPurple },
      { id: 'showmax', name: 'Showmax', accent: '#E11D48', bg: 'rgba(225,29,72,0.10)' },
    ],
    plans: [
      { id: 'compact', label: 'Compact', price: '₦12,500', meta: '30 days' },
      { id: 'confam', label: 'Confam', price: '₦7,400', meta: '30 days' },
      { id: 'max', label: 'Max', price: '₦5,700', meta: '30 days' },
    ],
    summary: [
      { label: 'Provider', value: 'DSTV' },
      { label: 'Bouquet', value: 'Compact' },
      { label: 'Fee', value: '₦0.00' },
    ],
  },
  education: {
    id: 'education',
    title: 'Education Payment',
    subtitle: 'Pay for result checkers, exam PINs, and school-related services.',
    icon: 'GraduationCap',
    accent: '#7C3AED',
    providerLabel: 'Select Service',
    accountLabel: 'Candidate / Profile ID',
    accountPlaceholder: 'Enter candidate ID',
    amountLabel: 'Choose Product',
    primaryAction: 'Pay Education Bill',
    helperText: 'PIN and voucher details appear after successful payment.',
    providers: [
      { id: 'waec', name: 'WAEC', accent: '#7C3AED', bg: 'rgba(124,58,237,0.10)' },
      { id: 'neco', name: 'NECO', accent: Colors.primary, bg: Colors.iconBgPurple },
      { id: 'jamb', name: 'JAMB', accent: Colors.secondary, bg: Colors.iconBgBlue },
      { id: 'school', name: 'School Fees', accent: Colors.teal, bg: Colors.iconBgTeal },
    ],
    plans: [
      { id: 'waec-pin', label: 'WAEC Result PIN', price: '₦4,000', meta: 'E-voucher' },
      { id: 'neco-token', label: 'NECO Token', price: '₦1,500', meta: 'Instant PIN' },
      { id: 'jamb-pin', label: 'JAMB e-PIN', price: '₦6,200', meta: 'Registration' },
    ],
    summary: [
      { label: 'Service', value: 'WAEC' },
      { label: 'Delivery', value: 'Instant PIN' },
      { label: 'Fee', value: '₦0.00' },
    ],
  },
};

export const RECENT_BILLERS = [
  { id: 'ekedc', title: 'EKEDC Token', subtitle: 'Meter 0421•••918', amount: '₦7,500', icon: 'Zap', accent: '#D97706', bg: 'rgba(234,179,8,0.12)' },
  { id: 'mtn', title: 'MTN Airtime', subtitle: '0803•••2241', amount: '₦1,000', icon: 'Smartphone', accent: Colors.primary, bg: Colors.iconBgPurple },
  { id: 'dstv', title: 'DSTV Compact', subtitle: 'Smartcard 702•••903', amount: '₦12,500', icon: 'Tv', accent: Colors.teal, bg: Colors.iconBgTeal },
];
