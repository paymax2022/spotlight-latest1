// ── Merchant Onboarding — seed catalogue & form schemas ──────────────────────
// Config-driven, not hard-coded into screens (PRD §8.4, FR-14). The mock API
// reads from here; the live API will serve the same shapes from the DB.
// Demonstrates the canonical PRD scenario: Health module → Medical Practitioner.

import { Colors } from '@/constants/colors';
import type { FormSchema, MerchantModule, MerchantType } from '@/types/merchant';

// ─── Modules (PRD §10) ───────────────────────────────────────────────────────

export const MERCHANT_MODULES: MerchantModule[] = [
  {
    id: 'mod-health', slug: 'health', name: 'Health',
    description: 'Offer consultations, run a pharmacy, lab or clinic.',
    icon: 'Stethoscope', iconColor: '#EF4444', bgColor: 'rgba(239,68,68,0.08)',
    status: 'open', typeCount: 2,
  },
  {
    id: 'mod-marketplace', slug: 'marketplace', name: 'Marketplace',
    description: 'Sell products to customers across the app.',
    icon: 'Store', iconColor: Colors.secondary, bgColor: Colors.iconBgBlue,
    status: 'open', typeCount: 1,
  },
  {
    id: 'mod-food', slug: 'food', name: 'Food & Logistics',
    description: 'List a restaurant or join the delivery fleet.',
    icon: 'UtensilsCrossed', iconColor: '#F97316', bgColor: 'rgba(249,115,22,0.08)',
    status: 'open', typeCount: 1,
  },
];

// ─── Merchant types (PRD §10, FR-6/FR-16/FR-18) ──────────────────────────────

export const MERCHANT_TYPES: MerchantType[] = [
  {
    id: 'mt-doctor', moduleId: 'mod-health', moduleName: 'Health', slug: 'medical-practitioner',
    name: 'Medical Practitioner', description: 'Provide video, chat or in-person consultations to patients.',
    icon: 'Stethoscope',
    requirementsSummary: ['Valid MDCN licence', 'Specialty & years of experience', 'Govt-issued ID'],
    expectedReviewLabel: '24–48 hours', requiredKycTier: 2,
    roleToGrant: 'health_provider', currentFormSchemaId: 'fs-doctor-v2', status: 'open',
  },
  {
    id: 'mt-pharmacy', moduleId: 'mod-health', moduleName: 'Health', slug: 'pharmacy',
    name: 'Pharmacy', description: 'Dispense and deliver prescriptions to patients.',
    icon: 'Pill',
    requirementsSummary: ['PCN premises licence', 'Superintendent pharmacist details', 'Premises address'],
    expectedReviewLabel: '3–5 business days', requiredKycTier: 2,
    roleToGrant: 'pharmacy_provider', currentFormSchemaId: 'fs-pharmacy-v1', status: 'open',
  },
  {
    id: 'mt-seller', moduleId: 'mod-marketplace', moduleName: 'Marketplace', slug: 'seller',
    name: 'Marketplace Seller', description: 'List and sell physical goods to customers.',
    icon: 'ShoppingBag',
    requirementsSummary: ['CAC business registration', 'Settlement bank account', 'Product categories'],
    expectedReviewLabel: '1–2 business days', requiredKycTier: 1,
    roleToGrant: 'marketplace_seller', currentFormSchemaId: 'fs-seller-v1', status: 'open',
  },
  {
    id: 'mt-restaurant', moduleId: 'mod-food', moduleName: 'Food & Logistics', slug: 'restaurant',
    name: 'Restaurant', description: 'List your restaurant, build a menu and receive delivery orders.',
    icon: 'UtensilsCrossed',
    requirementsSummary: ['Food handling / NAFDAC permit', "Owner's government ID", 'Settlement account'],
    expectedReviewLabel: '1–2 business days', requiredKycTier: 1,
    roleToGrant: 'restaurant_merchant', currentFormSchemaId: 'fs-restaurant-v1', status: 'open',
  },
];

// ─── Versioned form schemas (PRD §8.3, FR-8 … FR-13) ─────────────────────────

const DOCTOR_SCHEMA_V2: FormSchema = {
  id: 'fs-doctor-v2', merchantTypeId: 'mt-doctor', version: 2, status: 'published',
  steps: [
    {
      key: 'identity', title: 'About you', description: 'Tell us who you are.',
      fields: [
        { key: 'full_name', type: 'text', label: 'Full name', placeholder: 'Dr. Amaka Obi', required: true },
        { key: 'specialty', type: 'select', label: 'Primary specialty', required: true,
          options: [
            { label: 'General Practice', value: 'gp' },
            { label: 'Paediatrics', value: 'paeds' },
            { label: 'Cardiology', value: 'cardio' },
            { label: 'Dermatology', value: 'derm' },
            { label: 'Obstetrics & Gynaecology', value: 'obgyn' },
            { label: 'Psychiatry', value: 'psych' },
          ] },
        { key: 'years_experience', type: 'number', label: 'Years of experience', placeholder: 'e.g. 12', required: true, min: 0, max: 60 },
      ],
    },
    {
      key: 'credentials', title: 'Credentials', description: 'We verify these against the MDCN register.',
      fields: [
        { key: 'license_number', type: 'text', label: 'MDCN registration number', placeholder: 'MDCN/R/45821', required: true },
        { key: 'issuing_body', type: 'select', label: 'Issuing body', required: true,
          options: [{ label: 'MDCN', value: 'mdcn' }, { label: 'Other council', value: 'other' }] },
        { key: 'license_doc', type: 'document', label: 'Medical licence', helpText: 'PDF, JPG or PNG', required: true, hasExpiry: true },
        { key: 'government_id', type: 'document', label: 'Government-issued ID', required: true },
      ],
    },
    {
      key: 'practice', title: 'Practice & consultation', description: 'How you want to consult.',
      fields: [
        { key: 'consult_modes', type: 'multiselect', label: 'Consultation modes', required: true, maxSelections: 3,
          options: [
            { label: 'Video', value: 'video' },
            { label: 'Chat', value: 'chat' },
            { label: 'In-person', value: 'in_person' },
          ] },
        { key: 'consult_fee', type: 'currency', label: 'Consultation fee', placeholder: '0.00', required: true, min: 0 },
        { key: 'has_clinic', type: 'boolean', label: 'I consult from a physical clinic', required: false },
        { key: 'clinic_address', type: 'address', label: 'Clinic address', required: true,
          visibleWhen: { field: 'has_clinic', equals: true } },
        { key: 'availability', type: 'text', label: 'Typical availability', placeholder: 'e.g. Mon–Fri, 9am–5pm', required: false },
      ],
    },
  ],
};

const PHARMACY_SCHEMA_V1: FormSchema = {
  id: 'fs-pharmacy-v1', merchantTypeId: 'mt-pharmacy', version: 1, status: 'published',
  steps: [
    {
      key: 'business', title: 'Pharmacy details',
      fields: [
        { key: 'pharmacy_name', type: 'text', label: 'Registered pharmacy name', required: true },
        { key: 'pcn_number', type: 'text', label: 'PCN premises licence no.', required: true },
        { key: 'pcn_doc', type: 'document', label: 'PCN premises licence', required: true, hasExpiry: true },
      ],
    },
    {
      key: 'superintendent', title: 'Superintendent pharmacist',
      fields: [
        { key: 'superintendent_name', type: 'text', label: 'Full name', required: true },
        { key: 'superintendent_pcn', type: 'text', label: 'Superintendent PCN no.', required: true },
        { key: 'premises_address', type: 'address', label: 'Premises address', required: true },
        { key: 'delivery_radius', type: 'number', label: 'Delivery radius (km)', required: false, min: 1, max: 50 },
      ],
    },
  ],
};

const SELLER_SCHEMA_V1: FormSchema = {
  id: 'fs-seller-v1', merchantTypeId: 'mt-seller', version: 1, status: 'published',
  steps: [
    {
      key: 'business', title: 'Business',
      fields: [
        { key: 'store_name', type: 'text', label: 'Store name', required: true },
        { key: 'cac_number', type: 'text', label: 'CAC registration number', required: false },
        { key: 'categories', type: 'multiselect', label: 'Product categories', required: true, maxSelections: 4,
          options: [
            { label: 'Electronics', value: 'electronics' },
            { label: 'Fashion', value: 'fashion' },
            { label: 'Home & Living', value: 'home' },
            { label: 'Beauty', value: 'beauty' },
            { label: 'Groceries', value: 'groceries' },
          ] },
      ],
    },
    {
      key: 'settlement', title: 'Settlement',
      fields: [
        { key: 'contact_email', type: 'email', label: 'Business email', required: true },
        { key: 'contact_phone', type: 'phone', label: 'Business phone', required: true },
        { key: 'cac_doc', type: 'document', label: 'CAC certificate', required: false },
      ],
    },
  ],
};

// Mirrors supabase/migrations/20261101000001_open_food_merchant_onboarding.sql.
const RESTAURANT_SCHEMA_V1: FormSchema = {
  id: 'fs-restaurant-v1', merchantTypeId: 'mt-restaurant', version: 1, status: 'published',
  steps: [
    {
      key: 'business', title: 'Restaurant details', description: 'Tell us about your restaurant.',
      fields: [
        { key: 'restaurant_name', type: 'text', label: 'Restaurant name', placeholder: 'Blue Yam Kitchen', required: true },
        { key: 'cuisine_types', type: 'multiselect', label: 'Cuisine types', required: true, maxSelections: 4,
          options: [
            { label: 'Nigerian', value: 'nigerian' },
            { label: 'Fast food', value: 'fast_food' },
            { label: 'Continental', value: 'continental' },
            { label: 'Chinese', value: 'chinese' },
            { label: 'Healthy', value: 'healthy' },
            { label: 'Bakery & Desserts', value: 'bakery' },
          ] },
        { key: 'description', type: 'textarea', label: 'Short description', placeholder: "What you're known for", required: false },
      ],
    },
    {
      key: 'location', title: 'Location & service', description: 'Where you cook and how far you deliver.',
      fields: [
        { key: 'address', type: 'address', label: 'Restaurant address', required: true },
        { key: 'delivery_radius', type: 'number', label: 'Delivery radius (km)', placeholder: 'e.g. 8', required: true, min: 1, max: 30 },
        { key: 'prep_time', type: 'number', label: 'Typical prep time (mins)', placeholder: 'e.g. 25', required: false, min: 5, max: 120 },
      ],
    },
    {
      key: 'documents', title: 'Documents', description: 'We verify these before you go live.',
      fields: [
        { key: 'cac_doc', type: 'document', label: 'CAC certificate', required: false },
        { key: 'food_permit', type: 'document', label: 'Food handling / NAFDAC permit', required: true, hasExpiry: true },
        { key: 'owner_id_doc', type: 'document', label: "Owner's government-issued ID", required: true },
      ],
    },
    {
      key: 'settlement', title: 'Contact & settlement', description: 'How we reach you and pay out earnings.',
      fields: [
        { key: 'contact_email', type: 'email', label: 'Business email', required: true },
        { key: 'contact_phone', type: 'phone', label: 'Business phone', required: true },
        { key: 'account_name', type: 'text', label: 'Settlement account name', placeholder: 'As it appears on your bank account', required: true },
      ],
    },
  ],
};

export const FORM_SCHEMAS: Record<string, FormSchema> = {
  'fs-doctor-v2':     DOCTOR_SCHEMA_V2,
  'fs-pharmacy-v1':   PHARMACY_SCHEMA_V1,
  'fs-seller-v1':     SELLER_SCHEMA_V1,
  'fs-restaurant-v1': RESTAURANT_SCHEMA_V1,
};

export const REVIEW_SLA_HOURS = 48;
