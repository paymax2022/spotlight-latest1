// ── Paymax — Service Modules ──────────────────────────────────────────────────

import { Colors } from './colors';

export interface ServiceModule {
  id:        string;
  label:     string;
  icon:      string;   // lucide icon name
  iconColor: string;
  bgColor:   string;
  route:     string;
  category:  'financial' | 'utility' | 'lifestyle' | 'business';
  badge?:    string;
}

export const SERVICE_MODULES: ServiceModule[] = [
  // ── Financial ──────────────────────────────────────────────────────────────
  { id: 'wallet',          label: 'Wallet',          icon: 'Wallet',          iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/(tabs)/wallet',        category: 'financial' },
  { id: 'transfer',        label: 'Money Transfer',  icon: 'ArrowLeftRight',  iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/services/transfer',    category: 'financial' },
  { id: 'fx-exchange',     label: 'FX Exchange',     icon: 'RefreshCw',       iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/services/fx',          category: 'financial' },
  { id: 'virtual-cards',   label: 'Virtual Cards',   icon: 'CreditCard',      iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/services/cards',       category: 'financial' },
  // ── Utility ────────────────────────────────────────────────────────────────
  { id: 'bills',           label: 'Bill Payments',   icon: 'ReceiptText',     iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/services/bills',       category: 'utility' },
  { id: 'airtime',         label: 'Airtime',         icon: 'Smartphone',      iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/services/airtime',     category: 'utility' },
  { id: 'data',            label: 'Data / Internet', icon: 'Wifi',            iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/services/data',        category: 'utility' },
  { id: 'electricity',     label: 'Electricity',     icon: 'Zap',             iconColor: '#EAB308',         bgColor: 'rgba(234,179,8,0.10)', route: '/services/electricity', category: 'utility' },
  { id: 'cable-tv',        label: 'Cable TV',        icon: 'Tv',              iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/services/cable-tv',    category: 'utility' },
  { id: 'education',       label: 'Education',       icon: 'GraduationCap',   iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/services/education',   category: 'utility' },
  // ── Lifestyle ──────────────────────────────────────────────────────────────
  { id: 'food',            label: 'Food',            icon: 'UtensilsCrossed', iconColor: '#EF4444',         bgColor: 'rgba(239,68,68,0.08)',   route: '/services/food',        category: 'lifestyle' },
  { id: 'ride',            label: 'Ride',            icon: 'Car',             iconColor: '#F97316',         bgColor: 'rgba(249,115,22,0.08)',   route: '/services/ride',        category: 'lifestyle' },
  { id: 'shopping',        label: 'Shopping',        icon: 'ShoppingBag',     iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/services/shopping',    category: 'lifestyle' },
  { id: 'hotels',          label: 'Hotels',          icon: 'BedDouble',       iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,    route: '/services/hotels',      category: 'lifestyle' },
  // ── Business / Other ──────────────────────────────────────────────────────
  { id: 'investments',     label: 'Investments',     icon: 'TrendingUp',      iconColor: '#16A34A',         bgColor: 'rgba(22,163,74,0.08)',    route: '/services/investments', category: 'business' },
  { id: 'voting',          label: 'Voting',          icon: 'BarChart3',       iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,    route: '/services/voting',      category: 'business', badge: 'Live' },
  { id: 'events',          label: 'Events',          icon: 'Ticket',          iconColor: '#A855F7',         bgColor: 'rgba(168,85,247,0.08)',   route: '/services/events',      category: 'business' },
  { id: 'telemedicine',    label: 'Telemedicine',    icon: 'Heart',           iconColor: '#EF4444',         bgColor: 'rgba(239,68,68,0.08)',    route: '/services/health',      category: 'business' },
  { id: 'estate',          label: 'Estate',          icon: 'Building2',       iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/services/estate',      category: 'business' },
  { id: 'parcel',          label: 'Parcel',          icon: 'Package',         iconColor: '#EAB308',         bgColor: 'rgba(234,179,8,0.10)',    route: '/services/parcel',      category: 'business' },
  { id: 'marketplace',     label: 'Marketplace',     icon: 'Store',           iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,    route: '/services/marketplace', category: 'business' },
  { id: 'support',         label: 'Support',         icon: 'Headphones',      iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,    route: '/services/support',     category: 'business' },
];

export const FEATURED_SERVICES = [
  { id: 'bills',    title: 'Pay Bills Instantly',    subtitle: 'Settle utilities in seconds', icon: 'ReceiptText', iconColor: Colors.primary,   bgColor: Colors.iconBgPurple,  route: '/services/bills' },
  { id: 'food-ride',title: 'Book Food & Rides',      subtitle: 'Everything for your commute', icon: 'Car',         iconColor: Colors.secondary, bgColor: Colors.iconBgBlue,    route: '/services/food' },
  { id: 'invest',   title: 'Grow Your Money',        subtitle: 'Invest in high-yield assets', icon: 'TrendingUp',  iconColor: '#16A34A',        bgColor: 'rgba(22,163,74,0.08)', route: '/services/investments' },
];

export const QUICK_ACTIONS = [
  { id: 'add',      label: 'Add Money', icon: 'Plus',         route: '/wallet/add' },
  { id: 'send',     label: 'Send',      icon: 'Send',         route: '/wallet/send' },
  { id: 'withdraw', label: 'Withdraw',  icon: 'ArrowDown',    route: '/wallet/withdraw' },
  { id: 'exchange', label: 'Exchange',  icon: 'RefreshCw',    route: '/services/fx' },
] as const;
