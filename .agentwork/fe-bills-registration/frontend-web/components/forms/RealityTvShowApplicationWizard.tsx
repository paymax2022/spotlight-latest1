'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/src/lib/supabase/client';
import { authFetch, isUnauthorized, redirectToLogin } from '@/src/lib/auth/flow';
import { NIGERIA_STATES, NIGERIA_CITIES_BY_STATE } from '@/src/features/registration/config';
import { loadPaystackClient } from '@/src/lib/payments/paystack-client';

// ─── Constants ─────────────────────────────────────────────────────────────

const TALENT_OPTIONS = ['Singing', 'Acting', 'Dance', 'Comedy', 'Content Creation', 'Public Speaking', 'Rapping', 'Presenting'];
const EXPERIENCE_LEVELS = ['Beginner', 'Emerging', 'Intermediate', 'Advanced', 'Professional'];
const ENTRY_MODES = ['Individual', 'Group'];
const EMERGENCY_RELATIONSHIPS = ['Parent', 'Sibling', 'Spouse', 'Guardian', 'Relative', 'Friend', 'Mentor'];

const STEPS = [
  { id: 1, label: 'About You',    icon: '👤' },
  { id: 2, label: 'Your Talent',  icon: '⭐' },
  { id: 3, label: 'Show Profile', icon: '🎬' },
  { id: 4, label: 'Readiness',    icon: '✅' },
  { id: 5, label: 'Submit',       icon: '🚀' },
];

const REGISTRATION_FEE = 5000;

// ─── Types ──────────────────────────────────────────────────────────────────

interface FormData {
  // Step 1 — About You
  personal_firstName: string;
  personal_lastName: string;
  personal_stageName: string;
  personal_dateOfBirth: string;
  personal_gender: string;
  personal_stateOfResidence: string;
  personal_city: string;
  personal_primaryPhone: string;
  personal_address: string;
  media_profilePhoto: File | null;
  media_profilePhotoPreview: string;
  contest_entryMode: string;

  // Step 2 — Your Talent
  talent_primarySkill: string[];
  talent_experienceYears: string;
  talent_skillLevel: string;
  talent_strengths: string;
  talent_careerGoal: string;
  talent_uniqueStory: string;

  // Step 3 — Show Profile
  category_uniqueStory: string;
  social_instagram: string;
  social_tiktok: string;
  social_youtube: string;
  social_totalFollowers: string;
  media_performanceLink: string;
  media_rightsConfirmed: boolean;

  // Step 4 — Readiness
  bootcamp_availableFullPeriod: string;
  bootcamp_canTravel: boolean;
  category_housemateReadiness: boolean;
  category_dailyFilmingConsent: boolean;
  bootcamp_personalConsiderations: string;
  emergency_fullName: string;
  emergency_relationship: string;
  emergency_phone: string;
  emergency_altPhone: string;

  // Step 5 — Legal
  legal_accuracyDeclaration: boolean;
  legal_termsConsent: boolean;
  legal_mediaRelease: boolean;
  legal_publicVotingConsent: boolean;
  legal_sponsorActivationConsent: boolean;
  legal_productionRulesConsent: boolean;
  compliance_codeOfConductAgreement: boolean;
  review_confirmSubmit: boolean;
}

const INITIAL: FormData = {
  personal_firstName: '', personal_lastName: '', personal_stageName: '',
  personal_dateOfBirth: '', personal_gender: '', personal_stateOfResidence: '',
  personal_city: '', personal_primaryPhone: '',
  personal_address: '', contest_entryMode: 'Individual',
  media_profilePhoto: null, media_profilePhotoPreview: '',

  talent_primarySkill: [], talent_experienceYears: '', talent_skillLevel: '',
  talent_strengths: '', talent_careerGoal: '', talent_uniqueStory: '',

  category_uniqueStory: '',
  social_instagram: '', social_tiktok: '', social_youtube: '',
  social_totalFollowers: '', media_performanceLink: '', media_rightsConfirmed: false,

  bootcamp_availableFullPeriod: '', bootcamp_canTravel: false,
  category_housemateReadiness: false, category_dailyFilmingConsent: false,
  bootcamp_personalConsiderations: '', emergency_fullName: '',
  emergency_relationship: '', emergency_phone: '', emergency_altPhone: '',

  legal_accuracyDeclaration: false, legal_termsConsent: false,
  legal_mediaRelease: false, legal_publicVotingConsent: false,
  legal_sponsorActivationConsent: false, legal_productionRulesConsent: false,
  compliance_codeOfConductAgreement: false, review_confirmSubmit: false,
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const c = {
  pageBg: '#F4F6FB',
  white: '#FFFFFF',
  border: '#E2E8F0',
  primary: '#F59E0B',
  primaryDark: '#D97706',
  textDark: '#111827',
  textMid: '#374151',
  textMuted: '#6B7280',
  success: '#059669',
  successBg: '#ECFDF5',
  danger: '#DC2626',
  dangerBg: '#FEF2F2',
  inputBg: '#FAFAFA',
  shadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
  shadowMd: '0 4px 16px rgba(0,0,0,0.08)',
};

const inp: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 10,
  boxSizing: 'border-box',
  background: '#FFFFFF',
  border: '1.5px solid #94A3B8',
  color: '#111827',
  WebkitTextFillColor: '#111827',
  fontSize: 15,
  lineHeight: 1.5,
  outline: 'none',
  transition: 'border-color 0.2s, box-shadow 0.2s',
  fontFamily: 'inherit',
};
const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: 14,
  fontWeight: 600,
  color: '#1F2937',
  marginBottom: 7,
  letterSpacing: 0,
};
const fieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 0 };
const hint: React.CSSProperties = { fontSize: 12.5, color: '#6B7280', marginTop: 5 };
const errTxt: React.CSSProperties = { fontSize: 12.5, color: c.danger, marginTop: 5, fontWeight: 600 };

// ─── Sub-components ──────────────────────────────────────────────────────────

function Field({ label, required, children, help, error }: {
  label: string; required?: boolean; children: React.ReactNode; help?: string; error?: string;
}) {
  return (
    <div style={fieldWrap}>
      <label style={lbl}>
        {label}
        {required && <span style={{ color: c.danger, marginLeft: 4, fontWeight: 700 }}>*</span>}
        {!required && <span style={{ color: '#9CA3AF', fontSize: 12, fontWeight: 400, marginLeft: 6 }}>(optional)</span>}
      </label>
      {children}
      {help && !error && <span style={hint}>💡 {help}</span>}
      {error && <span style={errTxt}>⚠ {error}</span>}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  const { error, style, onFocus, onBlur, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...rest}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={{
        ...inp,
        ...(error ? { borderColor: c.danger, boxShadow: `0 0 0 3px rgba(220,38,38,0.12)` } : {}),
        ...(focused && !error ? { borderColor: c.primary, boxShadow: `0 0 0 3px rgba(245,158,11,0.18)` } : {}),
        ...style,
      }}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }) {
  const { error, style, onFocus, onBlur, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      {...rest}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={{
        ...inp,
        minHeight: 100,
        resize: 'vertical',
        ...(error ? { borderColor: c.danger, boxShadow: `0 0 0 3px rgba(220,38,38,0.12)` } : {}),
        ...(focused && !error ? { borderColor: c.primary, boxShadow: `0 0 0 3px rgba(245,158,11,0.18)` } : {}),
        ...style,
      }}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: string; children: React.ReactNode }) {
  const { error, style, children, onFocus, onBlur, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <select
      {...rest}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={{
        ...inp,
        cursor: 'pointer',
        ...(error ? { borderColor: c.danger, boxShadow: `0 0 0 3px rgba(220,38,38,0.12)` } : {}),
        ...(focused && !error ? { borderColor: c.primary, boxShadow: `0 0 0 3px rgba(245,158,11,0.18)` } : {}),
        ...style,
      }}
    >
      {children}
    </select>
  );
}

function Checkbox({ label, checked, onChange, required }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; required?: boolean;
}) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', padding: '10px 14px', background: checked ? 'rgba(245,158,11,0.06)' : c.inputBg, border: `1.5px solid ${checked ? c.primary : c.border}`, borderRadius: 10, transition: 'all 0.15s' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: c.primary, flexShrink: 0, marginTop: 1 }} />
      <span style={{ fontSize: 13.5, color: c.textMid, lineHeight: 1.5 }}>
        {label}{required && <span style={{ color: c.danger, marginLeft: 3 }}>*</span>}
      </span>
    </label>
  );
}

function MultiSelect({ options, selected, onChange }: {
  options: string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button key={opt} type="button" onClick={() => toggle(opt)} style={{
            padding: '7px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: `1.5px solid ${active ? c.primary : c.border}`,
            background: active ? c.primary : c.white,
            color: active ? '#000' : c.textMid, transition: 'all 0.15s',
          }}>
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function StepProgress({ current }: { current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 32 }}>
      {STEPS.map((step, i) => {
        const done = current > step.id;
        const active = current === step.id;
        return (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? '1' : undefined }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 52 }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: done ? 16 : 13, transition: 'all 0.25s',
                background: done ? c.success : active ? c.primary : c.border,
                color: done || active ? '#fff' : c.textMuted,
                boxShadow: active ? `0 0 0 4px rgba(245,158,11,0.2)` : 'none',
              }}>
                {done ? '✓' : step.icon}
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: active ? c.primary : done ? c.success : c.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? c.success : c.border, margin: '0 4px', marginBottom: 22, transition: 'background 0.3s' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validateStep(step: number, f: FormData): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 1) {
    if (!f.personal_firstName.trim()) e.personal_firstName = 'First name is required';
    if (!f.personal_lastName.trim()) e.personal_lastName = 'Last name is required';
    if (!f.personal_dateOfBirth) e.personal_dateOfBirth = 'Date of birth is required';
    if (!f.personal_gender) e.personal_gender = 'Gender is required';
    if (!f.personal_stateOfResidence) e.personal_stateOfResidence = 'State is required';
    if (!f.personal_primaryPhone.trim()) e.personal_primaryPhone = 'Phone number is required';
    if (!f.media_profilePhoto) e.media_profilePhoto = 'Profile photo is required';
  }
  if (step === 2) {
    if (f.talent_primarySkill.length === 0) e.talent_primarySkill = 'Select at least one talent';
    if (!f.talent_experienceYears) e.talent_experienceYears = 'Years of experience is required';
    if (!f.talent_skillLevel) e.talent_skillLevel = 'Skill level is required';
    if (!f.talent_strengths.trim()) e.talent_strengths = 'Tell us your strengths';
    if (!f.talent_careerGoal.trim()) e.talent_careerGoal = 'Career goal is required';
    if (!f.talent_uniqueStory.trim()) e.talent_uniqueStory = 'This field is required';
  }
  if (step === 3) {
    if (!f.category_uniqueStory.trim()) e.category_uniqueStory = 'Tell us what makes you a great TV contestant';
    if (!f.media_rightsConfirmed) e.media_rightsConfirmed = 'You must confirm content rights';
  }
  if (step === 4) {
    if (!f.bootcamp_availableFullPeriod) e.bootcamp_availableFullPeriod = 'Please indicate your availability';
    if (!f.category_housemateReadiness) e.category_housemateReadiness = 'This consent is required';
    if (!f.category_dailyFilmingConsent) e.category_dailyFilmingConsent = 'This consent is required';
    if (!f.emergency_fullName.trim()) e.emergency_fullName = 'Emergency contact name is required';
    if (!f.emergency_phone.trim()) e.emergency_phone = 'Emergency contact phone is required';
    if (!f.emergency_relationship) e.emergency_relationship = 'Relationship is required';
  }
  if (step === 5) {
    if (!f.legal_accuracyDeclaration) e.legal_accuracyDeclaration = 'Required';
    if (!f.legal_termsConsent) e.legal_termsConsent = 'Required';
    if (!f.legal_mediaRelease) e.legal_mediaRelease = 'Required';
    if (!f.legal_publicVotingConsent) e.legal_publicVotingConsent = 'Required';
    if (!f.legal_sponsorActivationConsent) e.legal_sponsorActivationConsent = 'Required';
    if (!f.legal_productionRulesConsent) e.legal_productionRulesConsent = 'Required';
    if (!f.compliance_codeOfConductAgreement) e.compliance_codeOfConductAgreement = 'Required';
    if (!f.review_confirmSubmit) e.review_confirmSubmit = 'Please confirm you are ready to submit';
  }
  return e;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function RealityTvShowApplicationWizard() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(INITIAL);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [done, setDone] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const cities = NIGERIA_CITIES_BY_STATE[form.personal_stateOfResidence] || [];

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        redirectToLogin(pathname || '/apply/reality-tv-show');
        return;
      }

      const meta = (session.user.user_metadata || {}) as Record<string, unknown>;
      const name = String(meta.full_name || meta.name || '').trim() || session.user.email?.split('@')[0] || '';
      if (!cancelled) {
        setUserName(name);
        setUserEmail(session.user.email || '');
      }

      // Create or resume draft
      const createRes = await authFetch('/api/registration/applications', {
        method: 'POST',
        body: JSON.stringify({ contestSlug: 'reality-tv-show' }),
      }, { json: true });

      if (isUnauthorized(createRes)) { redirectToLogin(pathname || '/apply/reality-tv-show'); return; }

      const createPayload = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !createPayload?.draft?.id) {
        if (!cancelled) { setGlobalError(createPayload?.error || 'Unable to start application.'); setLoading(false); }
        return;
      }

      const id = createPayload.draft.id as string;
      const readRes = await authFetch(`/api/registration/applications/${id}`, { cache: 'no-store' });
      if (isUnauthorized(readRes)) { redirectToLogin(pathname || '/apply/reality-tv-show'); return; }

      const readPayload = await readRes.json().catch(() => ({}));
      if (!readRes.ok || !readPayload?.draft) {
        if (!cancelled) { setGlobalError(readPayload?.error || 'Unable to load application.'); setLoading(false); }
        return;
      }

      if (!cancelled) {
        setDraftId(id);
        const saved = (readPayload.draft.formData || {}) as Record<string, unknown>;
        // Hydrate form from saved draft
        setForm((prev) => ({
          ...prev,
          ...flatToForm(saved),
          personal_firstName: String(saved['personal.firstName'] || name.split(' ')[0] || prev.personal_firstName),
          personal_lastName: String(saved['personal.lastName'] || name.split(' ').slice(1).join(' ') || prev.personal_lastName),
        }));
        setLoading(false);
      }
    }

    void bootstrap();
    return () => { cancelled = true; };
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function flatToForm(saved: Record<string, unknown>): Partial<FormData> {
    const get = (k: string) => saved[k];
    return {
      personal_firstName: String(get('personal.firstName') || ''),
      personal_lastName: String(get('personal.lastName') || ''),
      personal_stageName: String(get('personal.stageName') || ''),
      personal_dateOfBirth: String(get('personal.dateOfBirth') || ''),
      personal_gender: String(get('personal.gender') || ''),
      personal_stateOfResidence: String(get('personal.stateOfResidence') || ''),
      personal_city: String(get('personal.city') || ''),
      personal_primaryPhone: String(get('personal.primaryPhone') || ''),
      personal_address: String(get('personal.address') || ''),
      contest_entryMode: String(get('contest.entryMode') || 'Individual'),
      talent_primarySkill: Array.isArray(get('talent.primarySkill')) ? (get('talent.primarySkill') as string[]) : [],
      talent_experienceYears: String(get('talent.experienceYears') || ''),
      talent_skillLevel: String(get('talent.skillLevel') || ''),
      talent_strengths: String(get('talent.strengths') || ''),
      talent_careerGoal: String(get('talent.careerGoal') || ''),
      talent_uniqueStory: String(get('talent.uniqueStory') || ''),
      category_uniqueStory: String(get('category.uniqueStory') || ''),
      social_instagram: String(get('social.instagram') || ''),
      social_tiktok: String(get('social.tiktok') || ''),
      social_youtube: String(get('social.youtube') || ''),
      social_totalFollowers: String(get('social.totalFollowers') || ''),
      media_performanceLink: String(get('media.performanceLink') || ''),
      media_rightsConfirmed: Boolean(get('media.rightsConfirmed')),
      bootcamp_availableFullPeriod: String(get('bootcamp.availableFullPeriod') || ''),
      bootcamp_canTravel: Boolean(get('bootcamp.canTravel')),
      category_housemateReadiness: Boolean(get('category.housemateReadiness')),
      category_dailyFilmingConsent: Boolean(get('category.dailyFilmingConsent')),
      bootcamp_personalConsiderations: String(get('bootcamp.personalConsiderations') || ''),
      emergency_fullName: String(get('emergency.fullName') || ''),
      emergency_relationship: String(get('emergency.relationship') || ''),
      emergency_phone: String(get('emergency.phone') || ''),
      emergency_altPhone: String(get('emergency.altPhone') || ''),
    };
  }

  function formToFlat(f: FormData): Record<string, unknown> {
    return {
      'personal.firstName': f.personal_firstName,
      'personal.lastName': f.personal_lastName,
      'personal.stageName': f.personal_stageName,
      'personal.dateOfBirth': f.personal_dateOfBirth,
      'personal.gender': f.personal_gender,
      'personal.stateOfResidence': f.personal_stateOfResidence,
      'personal.city': f.personal_city,
      'personal.primaryPhone': f.personal_primaryPhone,
      'personal.address': f.personal_address,
      'contest.entryMode': f.contest_entryMode,
      'talent.primarySkill': f.talent_primarySkill,
      'talent.experienceYears': f.talent_experienceYears,
      'talent.skillLevel': f.talent_skillLevel,
      'talent.strengths': f.talent_strengths,
      'talent.careerGoal': f.talent_careerGoal,
      'talent.uniqueStory': f.talent_uniqueStory,
      'category.uniqueStory': f.category_uniqueStory,
      'social.instagram': f.social_instagram,
      'social.tiktok': f.social_tiktok,
      'social.youtube': f.social_youtube,
      'social.totalFollowers': f.social_totalFollowers,
      'media.performanceLink': f.media_performanceLink,
      'media.rightsConfirmed': f.media_rightsConfirmed,
      'bootcamp.availableFullPeriod': f.bootcamp_availableFullPeriod,
      'bootcamp.canTravel': f.bootcamp_canTravel,
      'category.housemateReadiness': f.category_housemateReadiness,
      'category.dailyFilmingConsent': f.category_dailyFilmingConsent,
      'bootcamp.personalConsiderations': f.bootcamp_personalConsiderations,
      'emergency.fullName': f.emergency_fullName,
      'emergency.relationship': f.emergency_relationship,
      'emergency.phone': f.emergency_phone,
      'emergency.altPhone': f.emergency_altPhone,
      'legal.accuracyDeclaration': f.legal_accuracyDeclaration,
      'legal.termsConsent': f.legal_termsConsent,
      'legal.mediaRelease': f.legal_mediaRelease,
      'legal.publicVotingConsent': f.legal_publicVotingConsent,
      'legal.sponsorActivationConsent': f.legal_sponsorActivationConsent,
      'legal.productionRulesConsent': f.legal_productionRulesConsent,
      'compliance.codeOfConductAgreement': f.compliance_codeOfConductAgreement,
      'review.confirmSubmit': f.review_confirmSubmit,
    };
  }

  function set(key: keyof FormData, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => { const n = { ...prev }; delete n[key as string]; return n; });
  }

  async function saveDraft(f: FormData = form) {
    if (!draftId) return;
    setSaving(true);
    try {
      await authFetch(`/api/registration/applications/${draftId}`, {
        method: 'PUT',
        body: JSON.stringify({ formData: formToFlat(f) }),
      }, { json: true });
    } finally {
      setSaving(false);
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  async function next() {
    const errs = validateStep(step, form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setErrors({});
    await saveDraft();
    setStep((s) => Math.min(s + 1, STEPS.length));
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function back() {
    setErrors({});
    setStep((s) => Math.max(s - 1, 1));
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Submit with Paystack ───────────────────────────────────────────────────

  async function handleSubmit() {
    const errs = validateStep(5, form);
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    if (!draftId) { setGlobalError('Session error — please refresh.'); return; }

    setSubmitting(true);
    setGlobalError('');

    await saveDraft();

    const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '';
    if (!publicKey || publicKey.includes('placeholder')) {
      setGlobalError('Payment gateway is not configured. Please contact support.');
      setSubmitting(false);
      return;
    }

    try {
      const PaystackPop = await loadPaystackClient();
      const handler = new PaystackPop();
      handler.newTransaction({
        key: publicKey,
        email: userEmail,
        amount: REGISTRATION_FEE * 100,
        currency: 'NGN',
        metadata: {
          custom_fields: [
            { display_name: 'Programme', variable_name: 'programme', value: 'Spotlight Reality TV Show' },
            { display_name: 'Applicant', variable_name: 'applicant', value: `${form.personal_firstName} ${form.personal_lastName}` },
          ],
        },
        onSuccess: async (transaction: { reference: string }) => {
          await submitApplication(transaction.reference);
        },
        onCancel: () => {
          setGlobalError('Payment was cancelled. Please complete payment to submit your application.');
          setSubmitting(false);
        },
        onError: (err: { message?: string }) => {
          setGlobalError(err.message || 'Payment failed. Please try again.');
          setSubmitting(false);
        },
      });
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Payment failed.');
      setSubmitting(false);
    }
  }

  async function submitApplication(paymentRef: string) {
    if (!draftId) return;
    try {
      const res = await authFetch(`/api/registration/applications/${draftId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ paymentReference: paymentRef }),
      }, { json: true });

      if (isUnauthorized(res)) { redirectToLogin(pathname || '/apply/reality-tv-show'); return; }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Submission failed.');

      setDone(true);
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
      setSubmitting(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const card: React.CSSProperties = {
    background: c.white, borderRadius: 16, padding: '28px 32px',
    boxShadow: c.shadowMd, border: `1px solid ${c.border}`,
  };

  const section: React.CSSProperties = {
    background: '#F8FAFC', borderRadius: 12, padding: '20px 20px', border: `1px solid ${c.border}`,
  };

  if (loading) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: c.textMuted }}>
        <div style={{ width: 40, height: 40, border: `3px solid ${c.border}`, borderTopColor: c.primary, borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ margin: 0, fontSize: 14 }}>Loading your application…</p>
      </div>
    );
  }

  if (done) {
    return (
      <div ref={topRef} style={{ ...card, textAlign: 'center', padding: '48px 32px' }}>
        <div style={{ fontSize: 56, marginBottom: 20 }}>🎉</div>
        <h2 style={{ color: c.textDark, fontWeight: 900, fontSize: 24, marginBottom: 10 }}>Application Submitted!</h2>
        <p style={{ color: c.textMuted, fontSize: 15, maxWidth: 440, margin: '0 auto 28px' }}>
          Thank you, {form.personal_firstName}! Your application for the Spotlight Reality TV Show has been received. We&apos;ll reach out via email about next steps.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="/user-dashboard" style={{ background: `linear-gradient(135deg, ${c.primary}, ${c.primaryDark})`, color: '#000', fontWeight: 800, padding: '12px 28px', borderRadius: 10, textDecoration: 'none', fontSize: 14 }}>
            Go to My Dashboard
          </a>
          <a href="/service-details/reality-tv-show" style={{ background: c.white, border: `1.5px solid ${c.border}`, color: c.textMid, fontWeight: 700, padding: '12px 28px', borderRadius: 10, textDecoration: 'none', fontSize: 14 }}>
            View Programme Details
          </a>
        </div>
      </div>
    );
  }

  return (
    <div ref={topRef}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: c.primary }}>🎥 Season 1 — Now Open</span>
        </div>
        <h2 style={{ color: c.textDark, fontWeight: 900, fontSize: 'clamp(1.4rem, 3vw, 1.8rem)', margin: 0, lineHeight: 1.25 }}>
          Apply for the Reality TV Show
        </h2>
        {userName && (
          <p style={{ color: c.textMuted, fontSize: 13, marginTop: 6, marginBottom: 0 }}>
            Applying as <strong style={{ color: c.textDark }}>{userName}</strong>
          </p>
        )}
      </div>

      {/* Fee notice */}
      <div style={{ background: 'rgba(245,158,11,0.08)', border: `1.5px solid rgba(245,158,11,0.3)`, borderRadius: 12, padding: '12px 16px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>💳</span>
        <div>
          <span style={{ fontSize: 13, fontWeight: 800, color: c.textDark }}>Registration fee: ₦5,000 </span>
          <span style={{ fontSize: 12.5, color: c.textMuted }}>— payment is processed at the final step via Paystack.</span>
        </div>
      </div>

      {/* Global error */}
      {globalError && (
        <div style={{ background: c.dangerBg, border: `1.5px solid ${c.danger}`, borderRadius: 10, padding: '12px 16px', marginBottom: 20, color: c.danger, fontSize: 13.5, fontWeight: 600 }}>
          ⚠ {globalError}
        </div>
      )}

      {/* Step progress */}
      <StepProgress current={step} />

      {/* ── Step 1: About You ──────────────────────────────────────────────── */}
      {step === 1 && (
        <div style={card}>
          <h3 style={{ color: c.textDark, fontWeight: 800, fontSize: 18, marginBottom: 4 }}>👤 About You</h3>
          <p style={{ color: c.textMuted, fontSize: 13.5, marginBottom: 24 }}>Your basic personal details. All starred fields are required.</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <Field label="First Name" required error={errors.personal_firstName}>
                <Input value={form.personal_firstName} error={errors.personal_firstName}
                  onChange={(e) => set('personal_firstName', e.target.value)} placeholder="e.g. Chisom" />
              </Field>
              <Field label="Last Name" required error={errors.personal_lastName}>
                <Input value={form.personal_lastName} error={errors.personal_lastName}
                  onChange={(e) => set('personal_lastName', e.target.value)} placeholder="e.g. Obi" />
              </Field>
            </div>

            <Field label="Stage Name / Nickname" help="Leave blank if same as full name">
              <Input value={form.personal_stageName}
                onChange={(e) => set('personal_stageName', e.target.value)} placeholder="e.g. Chi-Chi" />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <Field label="Date of Birth" required error={errors.personal_dateOfBirth}>
                <Input type="date" value={form.personal_dateOfBirth} error={errors.personal_dateOfBirth}
                  onChange={(e) => set('personal_dateOfBirth', e.target.value)}
                  max={new Date(Date.now() - 16 * 365.25 * 86400000).toISOString().split('T')[0]} />
              </Field>
              <Field label="Gender" required error={errors.personal_gender}>
                <Select value={form.personal_gender} error={errors.personal_gender}
                  onChange={(e) => set('personal_gender', e.target.value)}>
                  <option value="">Select…</option>
                  <option>Female</option><option>Male</option><option>Prefer not to say</option>
                </Select>
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <Field label="State of Residence" required error={errors.personal_stateOfResidence}>
                <Select value={form.personal_stateOfResidence} error={errors.personal_stateOfResidence}
                  onChange={(e) => { set('personal_stateOfResidence', e.target.value); set('personal_city', ''); }}>
                  <option value="">Select state…</option>
                  {NIGERIA_STATES.map((s) => <option key={s}>{s}</option>)}
                </Select>
              </Field>
              <Field label="City / Town">
                {cities.length > 0 ? (
                  <Select value={form.personal_city} onChange={(e) => set('personal_city', e.target.value)}>
                    <option value="">Select city…</option>
                    {cities.map((c) => <option key={c}>{c}</option>)}
                  </Select>
                ) : (
                  <Input value={form.personal_city} onChange={(e) => set('personal_city', e.target.value)} placeholder="Enter your city" />
                )}
              </Field>
            </div>

            <Field label="Phone Number" required error={errors.personal_primaryPhone}>
              <Input type="tel" value={form.personal_primaryPhone} error={errors.personal_primaryPhone}
                onChange={(e) => set('personal_primaryPhone', e.target.value)} placeholder="+234 80X XXX XXXX" />
            </Field>

            <Field label="Profile Photo" required error={errors.media_profilePhoto as string | undefined}
              help="Clear, well-lit headshot. JPG or PNG, max 5 MB.">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {/* Preview */}
                <div style={{ width: 88, height: 88, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', border: `2px solid ${errors.media_profilePhoto ? c.danger : c.border}`, background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {form.media_profilePhotoPreview
                    ? <img src={form.media_profilePhotoPreview} alt="Profile preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 32, color: '#D1D5DB' }}>👤</span>}
                </div>
                {/* Dropzone / file input */}
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '18px 20px', border: `2px dashed ${errors.media_profilePhoto ? c.danger : c.border}`, borderRadius: 12, cursor: 'pointer', background: '#FAFAFA', transition: 'border-color 0.2s' }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file && file.type.startsWith('image/')) {
                      set('media_profilePhoto', file);
                      set('media_profilePhotoPreview', URL.createObjectURL(file));
                    }
                  }}>
                  <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        set('media_profilePhoto', file);
                        set('media_profilePhotoPreview', URL.createObjectURL(file));
                      }
                    }} />
                  <span style={{ fontSize: 22 }}>📷</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: c.textMid }}>
                    {form.media_profilePhoto ? (form.media_profilePhoto as File).name : 'Click to upload or drag & drop'}
                  </span>
                  {!form.media_profilePhoto && (
                    <span style={{ fontSize: 11, color: c.textMuted }}>JPG, PNG or WEBP · max 5 MB</span>
                  )}
                  {form.media_profilePhoto && (
                    <button type="button" onClick={(e) => { e.preventDefault(); set('media_profilePhoto', null); set('media_profilePhotoPreview', ''); }}
                      style={{ fontSize: 11, color: c.danger, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, marginTop: 2 }}>
                      Remove photo
                    </button>
                  )}
                </label>
              </div>
            </Field>

            <Field label="Residential Address">
              <Input value={form.personal_address}
                onChange={(e) => set('personal_address', e.target.value)} placeholder="Street, area, city" />
            </Field>

            <Field label="Applying as">
              <div style={{ display: 'flex', gap: 10 }}>
                {ENTRY_MODES.map((mode) => (
                  <button key={mode} type="button" onClick={() => set('contest_entryMode', mode)}
                    style={{ flex: 1, padding: '10px', borderRadius: 10, border: `1.5px solid ${form.contest_entryMode === mode ? c.primary : c.border}`, background: form.contest_entryMode === mode ? 'rgba(245,158,11,0.07)' : c.white, color: form.contest_entryMode === mode ? c.textDark : c.textMuted, fontWeight: 700, cursor: 'pointer', fontSize: 13.5, transition: 'all 0.15s' }}>
                    {mode === 'Individual' ? '🧑 Individual' : '👥 Group'}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </div>
      )}

      {/* ── Step 2: Your Talent ────────────────────────────────────────────── */}
      {step === 2 && (
        <div style={card}>
          <h3 style={{ color: c.textDark, fontWeight: 800, fontSize: 18, marginBottom: 4 }}>⭐ Your Talent</h3>
          <p style={{ color: c.textMuted, fontSize: 13.5, marginBottom: 24 }}>Tell us about your skills and what you bring to the show.</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Field label="Primary Talent / Skills" required error={errors.talent_primarySkill}
              help="Select everything that applies — you can pick more than one">
              <div style={{ marginTop: 4 }}>
                <MultiSelect options={TALENT_OPTIONS} selected={form.talent_primarySkill}
                  onChange={(v) => set('talent_primarySkill', v)} />
              </div>
              {errors.talent_primarySkill && <span style={errTxt}>{errors.talent_primarySkill}</span>}
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <Field label="Years of Experience" required error={errors.talent_experienceYears}>
                <Select value={form.talent_experienceYears} error={errors.talent_experienceYears}
                  onChange={(e) => set('talent_experienceYears', e.target.value)}>
                  <option value="">Select…</option>
                  {['Less than 1 year','1 year','2 years','3 years','4 years','5+ years','10+ years'].map((y) => <option key={y}>{y}</option>)}
                </Select>
              </Field>
              <Field label="Skill Level" required error={errors.talent_skillLevel}>
                <Select value={form.talent_skillLevel} error={errors.talent_skillLevel}
                  onChange={(e) => set('talent_skillLevel', e.target.value)}>
                  <option value="">Select…</option>
                  {EXPERIENCE_LEVELS.map((l) => <option key={l}>{l}</option>)}
                </Select>
              </Field>
            </div>

            <Field label="Your Key Strengths" required error={errors.talent_strengths}
              help="What do you do exceptionally well? Be specific.">
              <Textarea value={form.talent_strengths} error={errors.talent_strengths}
                onChange={(e) => set('talent_strengths', e.target.value)}
                placeholder="e.g. I can move a crowd with my energy. I'm a natural performer and storyteller…" rows={3} />
            </Field>

            <Field label="Career Goal" required error={errors.talent_careerGoal}
              help="Where do you see yourself in 3–5 years?">
              <Textarea value={form.talent_careerGoal} error={errors.talent_careerGoal}
                onChange={(e) => set('talent_careerGoal', e.target.value)}
                placeholder="e.g. I want to become a household name in Afrobeats and represent Nigerian music globally…" rows={3} />
            </Field>

            <Field label="What makes your journey unique?" required error={errors.talent_uniqueStory}
              help="Your background, struggles, breakthroughs — the story behind your talent.">
              <Textarea value={form.talent_uniqueStory} error={errors.talent_uniqueStory}
                onChange={(e) => set('talent_uniqueStory', e.target.value)}
                placeholder="e.g. I started singing at church at age 6 with no formal training. My family…" rows={4} />
            </Field>
          </div>
        </div>
      )}

      {/* ── Step 3: Show Profile ───────────────────────────────────────────── */}
      {step === 3 && (
        <div style={card}>
          <h3 style={{ color: c.textDark, fontWeight: 800, fontSize: 18, marginBottom: 4 }}>🎬 Your Show Profile</h3>
          <p style={{ color: c.textMuted, fontSize: 13.5, marginBottom: 24 }}>Help us see you beyond the form. Add your content and online presence.</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Field label="Why would you make a great TV contestant?" required error={errors.category_uniqueStory}
              help="Think personality, charisma, conflict, growth — what makes for great television?">
              <Textarea value={form.category_uniqueStory} error={errors.category_uniqueStory}
                onChange={(e) => set('category_uniqueStory', e.target.value)}
                placeholder="e.g. I'm naturally entertaining and drama-free but I speak my truth. Viewers would relate to my authenticity and root for me…" rows={4} />
            </Field>

            <Field label="Performance / Audition Link"
              help="YouTube, TikTok, Instagram Reel, or Google Drive link to a recent performance or audition clip">
              <Input type="url" value={form.media_performanceLink}
                onChange={(e) => set('media_performanceLink', e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…" />
            </Field>

            <div style={section}>
              <p style={{ fontSize: 13, fontWeight: 700, color: c.textMid, margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Social Media Presence <span style={{ fontWeight: 400, color: c.textMuted, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <Field label="Instagram">
                  <Input value={form.social_instagram} placeholder="@handle"
                    onChange={(e) => set('social_instagram', e.target.value)} />
                </Field>
                <Field label="TikTok">
                  <Input value={form.social_tiktok} placeholder="@handle"
                    onChange={(e) => set('social_tiktok', e.target.value)} />
                </Field>
                <Field label="YouTube">
                  <Input value={form.social_youtube} placeholder="Channel name or link"
                    onChange={(e) => set('social_youtube', e.target.value)} />
                </Field>
                <Field label="Total Followers (est.)" help="Across all platforms combined">
                  <Input type="number" value={form.social_totalFollowers} placeholder="e.g. 12000"
                    onChange={(e) => set('social_totalFollowers', e.target.value)} min="0" />
                </Field>
              </div>
            </div>

            <Checkbox
              label="I confirm that all links and content I have shared belong to me or I have rights to use them."
              checked={form.media_rightsConfirmed}
              onChange={(v) => set('media_rightsConfirmed', v)}
              required
            />
            {errors.media_rightsConfirmed && <span style={errTxt}>{errors.media_rightsConfirmed}</span>}
          </div>
        </div>
      )}

      {/* ── Step 4: Readiness ──────────────────────────────────────────────── */}
      {step === 4 && (
        <div style={card}>
          <h3 style={{ color: c.textDark, fontWeight: 800, fontSize: 18, marginBottom: 4 }}>✅ Readiness & Emergency Contact</h3>
          <p style={{ color: c.textMuted, fontSize: 13.5, marginBottom: 24 }}>Confirm you are ready for the show environment and provide a contact for emergencies.</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={section}>
              <p style={{ fontSize: 13, fontWeight: 700, color: c.textMid, margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Show Readiness</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="Availability during production" required error={errors.bootcamp_availableFullPeriod}>
                  <Select value={form.bootcamp_availableFullPeriod} error={errors.bootcamp_availableFullPeriod}
                    onChange={(e) => set('bootcamp_availableFullPeriod', e.target.value)}>
                    <option value="">Select…</option>
                    <option value="Fully available">Fully available — I can commit 100%</option>
                    <option value="Available with notice">Available with advance notice</option>
                    <option value="Partially available">Partially available</option>
                  </Select>
                </Field>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Checkbox label="I am able and willing to travel to the production location." checked={form.bootcamp_canTravel}
                    onChange={(v) => set('bootcamp_canTravel', v)} />
                  <Checkbox
                    label="I am comfortable living with other contestants in a shared house environment."
                    checked={form.category_housemateReadiness}
                    onChange={(v) => set('category_housemateReadiness', v)}
                    required
                  />
                  {errors.category_housemateReadiness && <span style={errTxt}>{errors.category_housemateReadiness}</span>}
                  <Checkbox
                    label="I understand the show involves daily filming and I am comfortable being on camera regularly."
                    checked={form.category_dailyFilmingConsent}
                    onChange={(v) => set('category_dailyFilmingConsent', v)}
                    required
                  />
                  {errors.category_dailyFilmingConsent && <span style={errTxt}>{errors.category_dailyFilmingConsent}</span>}
                </div>

                <Field label="Dietary, cultural, or personal considerations"
                  help="Anything production should be aware of (optional)">
                  <Textarea value={form.bootcamp_personalConsiderations}
                    onChange={(e) => set('bootcamp_personalConsiderations', e.target.value)}
                    placeholder="e.g. I am vegetarian and observe Friday prayers…" rows={2} />
                </Field>
              </div>
            </div>

            <div style={section}>
              <p style={{ fontSize: 13, fontWeight: 700, color: c.textMid, margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Emergency Contact</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                  <Field label="Full Name" required error={errors.emergency_fullName}>
                    <Input value={form.emergency_fullName} error={errors.emergency_fullName}
                      onChange={(e) => set('emergency_fullName', e.target.value)} placeholder="e.g. Mrs. Ngozi Obi" />
                  </Field>
                  <Field label="Relationship" required error={errors.emergency_relationship}>
                    <Select value={form.emergency_relationship} error={errors.emergency_relationship}
                      onChange={(e) => set('emergency_relationship', e.target.value)}>
                      <option value="">Select…</option>
                      {EMERGENCY_RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
                    </Select>
                  </Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                  <Field label="Phone Number" required error={errors.emergency_phone}>
                    <Input type="tel" value={form.emergency_phone} error={errors.emergency_phone}
                      onChange={(e) => set('emergency_phone', e.target.value)} placeholder="+234 80X XXX XXXX" />
                  </Field>
                  <Field label="Alternative Phone" help="Optional">
                    <Input type="tel" value={form.emergency_altPhone}
                      onChange={(e) => set('emergency_altPhone', e.target.value)} placeholder="+234 80X XXX XXXX" />
                  </Field>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 5: Legal & Submit ─────────────────────────────────────────── */}
      {step === 5 && (
        <div style={card}>
          <h3 style={{ color: c.textDark, fontWeight: 800, fontSize: 18, marginBottom: 4 }}>🚀 Review & Submit</h3>
          <p style={{ color: c.textMuted, fontSize: 13.5, marginBottom: 24 }}>
            Please read and agree to all declarations below. Your application will only be submitted after the ₦5,000 registration fee is paid.
          </p>

          {/* Summary card */}
          <div style={{ ...section, marginBottom: 24 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: c.textMid, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Application Summary</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              {[
                ['Name', `${form.personal_firstName} ${form.personal_lastName}`.trim() || '—'],
                ['Stage name', form.personal_stageName || '—'],
                ['State', form.personal_stateOfResidence || '—'],
                ['Entry mode', form.contest_entryMode],
                ['Talent', form.talent_primarySkill.join(', ') || '—'],
                ['Experience', form.talent_experienceYears || '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <p style={{ fontSize: 11, color: c.textMuted, margin: 0, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</p>
                  <p style={{ fontSize: 14, color: c.textDark, fontWeight: 600, margin: '2px 0 0' }}>{v}</p>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {[
              { key: 'legal_accuracyDeclaration', text: 'I confirm that all information I have submitted is true, complete, and accurate.' },
              { key: 'legal_termsConsent', text: 'I agree to the official rules, terms, and eligibility requirements of the Spotlight Reality TV Show.' },
              { key: 'legal_mediaRelease', text: 'I grant Spotlight rights to record, broadcast, and use my participation for promotional purposes.' },
              { key: 'legal_publicVotingConsent', text: 'I understand my profile may be displayed publicly and may be subject to audience voting.' },
              { key: 'legal_sponsorActivationConsent', text: 'I understand programme activities may involve sponsors and brand integrations.' },
              { key: 'legal_productionRulesConsent', text: 'I agree to abide by production guidelines, safety protocols, and the code of conduct.' },
              { key: 'compliance_codeOfConductAgreement', text: 'I agree to Spotlight\'s code of conduct and understand that misconduct may lead to disqualification.' },
              { key: 'review_confirmSubmit', text: 'I have reviewed my application and I am ready to submit and make payment.' },
            ].map(({ key, text }) => (
              <div key={key}>
                <Checkbox label={text} checked={Boolean(form[key as keyof FormData])}
                  onChange={(v) => set(key as keyof FormData, v)} required />
                {errors[key] && <span style={{ ...errTxt, display: 'block', marginTop: 2, marginLeft: 14 }}>{errors[key]}</span>}
              </div>
            ))}
          </div>

          <div style={{ background: 'rgba(245,158,11,0.08)', border: `1.5px solid rgba(245,158,11,0.35)`, borderRadius: 12, padding: '16px 20px', marginBottom: 24 }}>
            <p style={{ fontSize: 14, fontWeight: 800, color: c.textDark, margin: '0 0 4px' }}>
              💳 Registration Fee: <span style={{ color: c.primary }}>₦5,000</span>
            </p>
            <p style={{ fontSize: 13, color: c.textMuted, margin: 0 }}>
              Clicking &ldquo;Submit & Pay&rdquo; will open a secure Paystack checkout. Your application is only submitted after successful payment.
            </p>
          </div>
        </div>
      )}

      {/* ── Navigation buttons ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, gap: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={back} disabled={step === 1}
          style={{ padding: '12px 24px', borderRadius: 10, border: `1.5px solid ${c.border}`, background: c.white, color: step === 1 ? c.textMuted : c.textMid, fontWeight: 700, cursor: step === 1 ? 'not-allowed' : 'pointer', fontSize: 14, opacity: step === 1 ? 0.5 : 1 }}>
          ← Back
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {saving && <span style={{ fontSize: 12, color: c.textMuted }}>Saving…</span>}

          {step < 5 ? (
            <button type="button" onClick={next}
              style={{ padding: '12px 28px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${c.primary}, ${c.primaryDark})`, color: '#000', fontWeight: 800, cursor: 'pointer', fontSize: 14, boxShadow: '0 4px 14px rgba(245,158,11,0.35)', display: 'flex', alignItems: 'center', gap: 6 }}>
              Continue →
            </button>
          ) : (
            <button type="button" onClick={handleSubmit} disabled={submitting}
              style={{ padding: '12px 32px', borderRadius: 10, border: 'none', background: submitting ? '#9CA3AF' : `linear-gradient(135deg, ${c.primary}, ${c.primaryDark})`, color: submitting ? 'rgba(255,255,255,0.7)' : '#000', fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 14, boxShadow: submitting ? 'none' : '0 4px 14px rgba(245,158,11,0.35)', display: 'flex', alignItems: 'center', gap: 8 }}>
              {submitting ? <><SpinnerIcon /> Processing…</> : '💳 Submit & Pay ₦5,000'}
            </button>
          )}
        </div>
      </div>

      <p style={{ textAlign: 'center', fontSize: 12, color: c.textMuted, marginTop: 18 }}>
        Step {step} of {STEPS.length} · Your progress is automatically saved
      </p>
    </div>
  );
}

function SpinnerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ animation: 'spin 0.7s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
