// ── Paymax — Service Modules ──────────────────────────────────────────────────

import { Colors } from './colors';

export interface ServiceModule {
  id:          string;
  label:       string;
  icon:        string;   // lucide icon name
  iconColor:   string;
  bgColor:     string;
  route:       string;
  category:    'financial' | 'utility' | 'lifestyle' | 'business';
  badge?:      string;
  comingSoon?: boolean;
}

export const SERVICE_MODULES: ServiceModule[] = [
  // ── Financial ──────────────────────────────────────────────────────────────
  { id: 'wallet',          label: 'Wallet',          icon: 'Wallet',          iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/(tabs)/wallet',        category: 'financial' },
  { id: 'transfer',        label: 'Money Transfer',  icon: 'ArrowLeftRight',  iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/services/transfer',    category: 'financial' },
  { id: 'fx-exchange',     label: 'FX Exchange',     icon: 'RefreshCw',       iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/fx',                   category: 'financial', badge: 'New' },
  { id: 'virtual-cards',   label: 'Virtual Cards',   icon: 'CreditCard',      iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/fx/cards',             category: 'financial' },
  { id: 'crypto',          label: 'Crypto',          icon: 'Bitcoin',         iconColor: '#F7931A',         bgColor: 'rgba(247,147,26,0.10)', route: '/crypto',           category: 'financial', badge: 'New' },
  // ── Utility ────────────────────────────────────────────────────────────────
  { id: 'bills',           label: 'Bill Payments',   icon: 'ReceiptText',     iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/services/bills',       category: 'utility' },
  { id: 'airtime',         label: 'Airtime',         icon: 'Smartphone',      iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/services/airtime',     category: 'utility' },
  { id: 'data',            label: 'Data / Internet', icon: 'Wifi',            iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/services/data',        category: 'utility' },
  { id: 'electricity',     label: 'Electricity',     icon: 'Zap',             iconColor: '#EAB308',         bgColor: 'rgba(234,179,8,0.10)', route: '/services/electricity', category: 'utility' },
  { id: 'cable-tv',        label: 'Cable TV',        icon: 'Tv',              iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/services/cable-tv',    category: 'utility' },
  { id: 'education',       label: 'Education',       icon: 'GraduationCap',   iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/services/education',   category: 'utility' },
  // ── Lifestyle ──────────────────────────────────────────────────────────────
  { id: 'food',            label: 'Food',            icon: 'UtensilsCrossed', iconColor: '#EF4444',         bgColor: 'rgba(239,68,68,0.08)',   route: '/services/food',        category: 'lifestyle' },
  { id: 'ride',            label: 'Ride',            icon: 'Car',             iconColor: '#F97316',         bgColor: 'rgba(249,115,22,0.08)',   route: '/mobility',             category: 'lifestyle', badge: 'New' },
  { id: 'shopping',        label: 'Shopping',        icon: 'ShoppingBag',     iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/services/shopping',    category: 'lifestyle', comingSoon: true },
  { id: 'hotels',          label: 'Hotels',          icon: 'BedDouble',       iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,    route: '/services/hotels',      category: 'lifestyle', comingSoon: true },
  // ── Business / Other ──────────────────────────────────────────────────────
  { id: 'investments',     label: 'Invest (Stocks)', icon: 'TrendingUp',      iconColor: '#16A34A',         bgColor: 'rgba(22,163,74,0.08)',    route: '/invest',               category: 'financial', badge: 'New' },
  { id: 'voting',          label: 'Voting',          icon: 'BarChart3',       iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,    route: '/voting',               category: 'business', badge: 'Live' },
  { id: 'crowdfunding',    label: 'Crowdfunding',    icon: 'HandHeart',       iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,    route: '/crowdfunding',         category: 'business', badge: 'New' },
  { id: 'events',          label: 'Events',          icon: 'Ticket',          iconColor: '#A855F7',         bgColor: 'rgba(168,85,247,0.08)',   route: '/services/events',      category: 'business', comingSoon: true },
  { id: 'telemedicine',    label: 'Telemedicine',    icon: 'Stethoscope',     iconColor: '#EF4444',         bgColor: 'rgba(239,68,68,0.08)',    route: '/services/telemedicine', category: 'business', badge: 'New' },
  { id: 'estate',          label: 'Estate',          icon: 'Building2',       iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/services/estate',      category: 'business', comingSoon: true },
  { id: 'realtor',         label: 'Realtor',         icon: 'Home',            iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,    route: '/realtor',              category: 'lifestyle', badge: 'New' },
  { id: 'visitor_access',  label: 'Visitor Access',  icon: 'DoorOpen',        iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,    route: '/visitor',              category: 'business' },
  { id: 'gate',            label: 'Gate (Guard)',    icon: 'ShieldCheck',     iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,    route: '/guard',                category: 'business' },
  { id: 'election',        label: 'Elections',       icon: 'Vote',            iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/election/list',        category: 'business' },
  { id: 'meetings',        label: 'Meetings',        icon: 'CalendarDays',    iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,    route: '/meetings',             category: 'business' },
  { id: 'estate_tasks',    label: 'Estate Tasks',    icon: 'ListChecks',      iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/tasks',                category: 'business' },
  { id: 'announcements',   label: 'Announcements',   icon: 'Megaphone',       iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,    route: '/announcements',        category: 'business' },
  { id: 'emergencies',     label: 'Emergencies',     icon: 'Siren',           iconColor: '#EF4444',         bgColor: 'rgba(239,68,68,0.08)', route: '/emergencies',          category: 'business' },
  { id: 'maintenance',     label: 'Maintenance',     icon: 'Wrench',          iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,    route: '/repairs',              category: 'business' },
  { id: 'facilities',      label: 'Facilities',      icon: 'CalendarCheck',   iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/facilities',           category: 'business' },
  { id: 'documents',       label: 'Documents',       icon: 'FolderOpen',      iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,    route: '/documents',            category: 'business' },
  { id: 'vendors',         label: 'Vendors',         icon: 'Hammer',          iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/vendors',              category: 'business' },
  { id: 'dues',            label: 'Dues & Rent',     icon: 'ReceiptText',     iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/dues',                 category: 'financial' },
  { id: 'properties',      label: 'Properties',      icon: 'Building2',       iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/properties',           category: 'business' },
  { id: 'ai_notes',        label: 'AI Notes',        icon: 'Sparkles',        iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/ai-notes',             category: 'business', badge: 'New' },
  { id: 'estate_finance',  label: 'Finance',         icon: 'LineChart',       iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,    route: '/finance',              category: 'financial' },
  { id: 'estate_admin',    label: 'Estate Admin',    icon: 'LayoutDashboard', iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/estate-admin',         category: 'business' },
  { id: 'vendor_portal',   label: 'Vendor Portal',   icon: 'Briefcase',       iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,    route: '/vendor-portal',        category: 'business' },
  { id: 'estate_notifs',   label: 'Notifications',   icon: 'Bell',            iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,    route: '/estate-notifications', category: 'business' },
  { id: 'estate_reports',  label: 'Reports',         icon: 'FileBarChart',    iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,    route: '/reports',              category: 'business' },
  { id: 'estate_settings', label: 'Estate Settings', icon: 'Settings',        iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,    route: '/estate-settings',      category: 'business' },
  { id: 'associations',    label: 'Associations',    icon: 'UsersRound',      iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/association',          category: 'business', badge: 'New' },
  { id: 'parcel',          label: 'Parcel',          icon: 'Package',         iconColor: '#EAB308',         bgColor: 'rgba(234,179,8,0.10)',    route: '/services/parcel',      category: 'business', comingSoon: true },
  { id: 'marketplace',     label: 'Marketplace',     icon: 'Store',           iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,    route: '/services/marketplace', category: 'business', comingSoon: true },
  { id: 'support',         label: 'Support',         icon: 'Headphones',      iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,    route: '/services/support',     category: 'business', comingSoon: true },
];

export const FEATURED_SERVICES = [
  { id: 'bills',    title: 'Pay Bills Instantly',    subtitle: 'Settle utilities in seconds', icon: 'ReceiptText', iconColor: Colors.primary,   bgColor: Colors.iconBgPurple,  route: '/services/bills' },
  { id: 'food-ride',title: 'Book Food & Rides',      subtitle: 'Everything for your commute', icon: 'Car',         iconColor: Colors.secondary, bgColor: Colors.iconBgBlue,    route: '/services/food' },
  { id: 'invest',   title: 'Own the companies shaping your future', subtitle: 'Invest in Nigerian stocks & ETFs', icon: 'TrendingUp', iconColor: '#16A34A', bgColor: 'rgba(22,163,74,0.08)', route: '/invest' },
];

export const QUICK_ACTIONS = [
  { id: 'add',      label: 'Add Money', icon: 'Plus',         route: '/wallet/add' },
  { id: 'send',     label: 'Send',      icon: 'Send',         route: '/wallet/send' },
  { id: 'withdraw', label: 'Withdraw',  icon: 'ArrowDown',    route: '/wallet/withdraw' },
  { id: 'exchange', label: 'Exchange',  icon: 'RefreshCw',    route: '/fx' },
] as const;
