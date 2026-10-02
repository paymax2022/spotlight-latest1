'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/src/lib/supabase/client';
import { authFetch, isUnauthorized, redirectToLogin } from '@/src/lib/auth/flow';
import { NIGERIA_STATES, NIGERIA_CITIES_BY_STATE } from '@/src/features/registration/config';
import { buildStepSaveBody, draftSaveSucceeded } from '@/src/features/registration/draft-save';
import { loadPaystackClient } from '@/src/lib/payments';
import {
  REALITY_TV_WIZARD_INITIAL,
  REALITY_TV_WIZARD_STEP_SAVE_KEY,
  flatErrorKeyToFormKey,
  realityTvFieldOptions,
  realityTvWizardFormToFlat,
  realityTvWizardHydrate,
  realityTvWizardIsMinor,
  realityTvWizardSchemaErrors,
  validateRealityTvWizardStep,
  type RealityTvUploadMeta,
  type RealityTvWizardForm,
} from '@/src/features/registration/reality-tv-show-wizard-map';
import type { RegistrationStepKey } from '@/src/features/registration/types';

// Option lists come from the LIVE schema (realityTvFieldOptions reads
// forms/reality-tv-show.ts) so a wizard select can never offer a value the
// server-side validator would reject — 'Prefer not to say' and 'Mentor'
// slipped in exactly that way (AUD-FE-009).
const TALENT_OPTIONS = realityTvFieldOptions('talent.primarySkill');
const SKILL_LEVEL_OPTIONS = realityTvFieldOptions('talent.skillLevel');
const GENDER_OPTIONS = realityTvFieldOptions('personal.gender');
const EMERGENCY_RELATIONSHIPS = realityTvFieldOptions('emergency.relationship');
const BOOTCAMP_AVAILABILITY = realityTvFieldOptions('bootcamp.availableFullPeriod');
const ID_TYPE_OPTIONS = realityTvFieldOptions('identity.idType');
const AUDITION_FORMATS = realityTvFieldOptions('audition.format');
const HEALTH_STATUS_OPTIONS = realityTvFieldOptions('medical.generalHealthStatus');
const MEDICAL_CONDITION_OPTIONS = realityTvFieldOptions('medical.knownConditions');
const ALLERGY_OPTIONS = realityTvFieldOptions('medical.allergies');
const ENTRY_MODES = ['Individual', 'Group'];

const STEPS = [
  { id: 1, label: 'About You',    icon: '👤' },
  { id: 2, label: 'Your Talent',  icon: '⭐' },
  { id: 3, label: 'Show Profile', icon: '🎬' },
  { id: 4, label: 'Readiness',    icon: '✅' },
  { id: 5, label: 'Submit',       icon: '🚀' },
];

const REGISTRATION_FEE = 5000;

type FormData = RealityTvWizardForm;
const INITIAL: FormData = REALITY_TV_WIZARD_INITIAL;

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

export default function RealityTvShowApplicationWizard() {
  const supabase = useMemo(() => createClient(), []);
  const pathname = usePathname();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(INITIAL);
  // The upload POST response per schema file key ('media.profilePhoto' etc.)
  // — persisted into the draft as `<key>.__meta` alongside the previewUrl
  // value, so file names survive a reload.
  const [uploadMeta, setUploadMeta] = useState<RealityTvUploadMeta>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
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
  const emergencyCities = NIGERIA_CITIES_BY_STATE[form.emergency_state] || [];
  const isMinor = realityTvWizardIsMinor(form.personal_dateOfBirth);

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
        // Hydrate form + upload metadata from the saved draft.
        const hydrated = realityTvWizardHydrate(saved);
        setUploadMeta(hydrated.uploadMeta);
        setForm((prev) => ({
          ...prev,
          ...hydrated.form,
          personal_firstName: String(saved['personal.firstName'] || name.split(' ')[0] || prev.personal_firstName),
          personal_lastName: String(saved['personal.lastName'] || name.split(' ').slice(1).join(' ') || prev.personal_lastName),
        }));
        setLoading(false);
      }
    }

    void bootstrap();
    return () => { cancelled = true; };
  }, []);

  function set(key: keyof FormData, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => { const n = { ...prev }; delete n[key as string]; return n; });
  }

  // Uploads go through POST /api/registration/uploads (multipart body), which
  // proxies to R2 (or local disk in dev) and returns { previewUrl, storageKey,
  // fileName, ... }. The previewUrl is what the draft stores — the schema's
  // `file` validator accepts any non-empty string/object with a storage key.
  async function uploadFile(
    flatKey: string,
    urlKey: keyof FormData,
    nameKey: keyof FormData,
    file: File,
  ): Promise<string> {
    setUploading((prev) => ({ ...prev, [flatKey]: true }));
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/registration/uploads', { method: 'POST', body });
      const payload = (await res.json().catch(() => ({}))) as {
        success?: boolean; error?: string; upload?: Record<string, unknown>;
      };
      if (!res.ok || !payload?.success || !payload.upload) {
        throw new Error(payload?.error || 'Upload failed. Please try again.');
      }
      const url = String(payload.upload.previewUrl || payload.upload.storageKey || '');
      set(urlKey, url);
      set(nameKey, String(payload.upload.fileName || file.name));
      setUploadMeta((prev) => ({ ...prev, [flatKey]: payload.upload as Record<string, unknown> }));
      return url;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setErrors((prev) => ({ ...prev, [urlKey as string]: message }));
      setGlobalError(message);
      return '';
    } finally {
      setUploading((prev) => ({ ...prev, [flatKey]: false }));
    }
  }

  function clearUpload(flatKey: string, urlKey: keyof FormData, nameKey: keyof FormData) {
    set(urlKey, '');
    set(nameKey, '');
    setUploadMeta((prev) => {
      const next = { ...prev };
      delete next[flatKey];
      return next;
    });
  }

  function pickProfilePhoto(file: File) {
    if (!file.type.startsWith('image/')) return;
    set('media_profilePhoto', file);
    set('media_profilePhotoPreview', URL.createObjectURL(file));
    void uploadFile('media.profilePhoto', 'media_profilePhotoUrl', 'media_profilePhotoName', file);
  }

  /**
   * PATCH the draft under the schema stepKey that wizard step completes (see
   * REALITY_TV_WIZARD_STEP_SAVE_KEY). Returns true only when the draft row
   * was actually written — the server returns 200 with
   * validation.isValid === false when the named step fails, in which case
   * nothing persisted; its field errors are mapped back onto wizard keys so
   * the offending inputs get highlighted.
   */
  async function saveDraft(stepKey: RegistrationStepKey, f: FormData = form): Promise<boolean> {
    if (!draftId) {
      setGlobalError('Session error — please refresh.');
      return false;
    }
    setSaving(true);
    try {
      const res = await authFetch(`/api/registration/applications/${draftId}`, {
        method: 'PATCH',
        body: JSON.stringify(buildStepSaveBody(stepKey, realityTvWizardFormToFlat(f, uploadMeta))),
      }, { json: true });

      if (isUnauthorized(res)) {
        redirectToLogin(pathname || '/apply/reality-tv-show');
        return false;
      }

      const payload = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        validation?: { isValid?: boolean; errors?: Record<string, string> };
      };
      if (!res.ok || !draftSaveSucceeded(payload)) {
        const serverErrors = payload?.validation?.errors;
        if (serverErrors && typeof serverErrors === 'object' && Object.keys(serverErrors).length > 0) {
          const mapped: Record<string, string> = {};
          for (const [flatKey, message] of Object.entries(serverErrors)) {
            mapped[flatErrorKeyToFormKey(flatKey)] = String(message);
          }
          setErrors((prev) => ({ ...prev, ...mapped }));
          setGlobalError('Some required information is missing or invalid — please review the highlighted fields.');
        } else {
          setGlobalError(payload.error || 'Could not save your progress. Please check your connection and try again.');
        }
        return false;
      }
      return true;
    } catch {
      setGlobalError('Could not save your progress. Please check your connection and try again.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function next() {
    const errs = validateRealityTvWizardStep(step, form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setErrors({});
    // Don't advance when the draft save failed — the error is surfaced via
    // globalError and the user stays on the step so they can retry.
    if (!(await saveDraft(REALITY_TV_WIZARD_STEP_SAVE_KEY[step]))) {
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length));
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function back() {
    setErrors({});
    setStep((s) => Math.max(s - 1, 1));
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleSubmit() {
    const errs = validateRealityTvWizardStep(5, form);
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    if (!draftId) { setGlobalError('Session error — please refresh.'); return; }

    // Full schema re-check — the same validator submitRegistration runs —
    // BEFORE any money moves. Without it a schema-required key the wizard
    // missed would only surface as a 400 after Paystack had already charged.
    const schemaErrs = realityTvWizardSchemaErrors(form, uploadMeta);
    if (Object.keys(schemaErrs).length > 0) {
      const mapped: Record<string, string> = {};
      for (const [flatKey, message] of Object.entries(schemaErrs)) {
        mapped[flatErrorKeyToFormKey(flatKey)] = String(message);
      }
      setErrors(mapped);
      setGlobalError('Please complete the highlighted fields before paying.');
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    setSubmitting(true);
    setGlobalError('');

    // Payment must never run against an unsaved draft — abort loudly.
    if (!(await saveDraft('review_submit'))) {
      setSubmitting(false);
      return;
    }

    const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '';
    if (!publicKey || publicKey.includes('placeholder')) {
      setGlobalError('Payment gateway is not configured. Please contact support.');
      setSubmitting(false);
      return;
    }

    try {
      // Register the charge BEFORE Paystack collects: the intent row gives the
      // webhook/recover path a fulfilment target when the browser never makes
      // it back (AUD-FE-003 residual), and binds the popup to the server-minted
      // reference the submit gate re-verifies.
      const initRes = await authFetch(`/api/registration/applications/${draftId}/payment/initiate`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ method: 'PAYSTACK', email: userEmail, inline: true }),
      }, { json: true });
      const initPayload = await initRes.json().catch(() => ({})) as {
        success?: boolean; reference?: string; status?: string; amountKobo?: number; error?: string;
      };
      if (!initRes.ok || !initPayload?.success || !initPayload.reference) {
        setGlobalError(initPayload?.error || 'Could not start payment. Please try again.');
        setSubmitting(false);
        return;
      }
      if (initPayload.status === 'completed') {
        // A previous attempt already settled (webhook/recover fulfilled it) —
        // no second charge; submit straight away.
        await submitApplication(initPayload.reference);
        return;
      }

      const PaystackPop = await loadPaystackClient();
      const handler = new PaystackPop();
      handler.newTransaction({
        key: publicKey,
        email: userEmail,
        // Server-quoted fee from the locked draft — the same figure fulfilment
        // and the submit gate reconcile against.
        amount: Number(initPayload.amountKobo) || REGISTRATION_FEE * 100,
        currency: 'NGN',
        reference: initPayload.reference,
        metadata: {
          custom_fields: [
            { display_name: 'Programme', variable_name: 'programme', value: 'Spotlight Reality TV Show' },
            { display_name: 'Applicant', variable_name: 'applicant', value: `${form.personal_firstName} ${form.personal_lastName}` },
          ],
        },
        onSuccess: async (transaction: { reference: string }) => {
          // Server-side verify settles the intent and stamps the paid marker +
          // reference + method on the draft (the submit gate re-verifies them);
          // self-asserted PATCH flags are not the proof path.
          try {
            await authFetch(
              `/api/registration/applications/${draftId}/payment/verify?reference=${encodeURIComponent(transaction.reference)}`,
            );
          } catch {
            // Webhook/recover fulfilment still covers the charge; let submit
            // run and land on awaiting_payment if the marker never persisted.
          }
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

  const card: React.CSSProperties = {
    background: c.white, borderRadius: 16, padding: '28px 32px',
    boxShadow: c.shadowMd, border: `1px solid ${c.border}`,
  };

  const section: React.CSSProperties = {
    background: '#F8FAFC', borderRadius: 12, padding: '20px 20px', border: `1px solid ${c.border}`,
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: 13, fontWeight: 700, color: c.textMid, margin: '0 0 16px',
    textTransform: 'uppercase', letterSpacing: '0.06em',
  };

  function filePicker(
    flatKey: string,
    urlKey: keyof FormData,
    nameKey: keyof FormData,
    accept: string,
    icon = '📎',
  ) {
    const uploadedUrl = String(form[urlKey] || '');
    const uploadedName = String(form[nameKey] || '');
    const busy = Boolean(uploading[flatKey]);
    return (
      <label style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '14px 18px', border: `2px dashed ${errors[urlKey as string] ? c.danger : c.border}`,
        borderRadius: 12, cursor: 'pointer', background: '#FAFAFA', transition: 'border-color 0.2s',
      }}>
        <input type="file" accept={accept} style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadFile(flatKey, urlKey, nameKey, file);
          }} />
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: c.textMid }}>
          {busy ? 'Uploading…' : uploadedName || 'Click to upload'}
        </span>
        {uploadedUrl && !busy && (
          <span style={{ fontSize: 12, color: c.success, fontWeight: 700 }}>✓ Uploaded</span>
        )}
        {uploadedUrl && !busy && (
          <button type="button"
            onClick={(e) => { e.preventDefault(); clearUpload(flatKey, urlKey, nameKey); }}
            style={{ fontSize: 11, color: c.danger, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
            Remove
          </button>
        )}
      </label>
    );
  }

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
              <Field label="Middle Name">
                <Input value={form.personal_middleName}
                  onChange={(e) => set('personal_middleName', e.target.value)} placeholder="(optional)" />
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
                  {GENDER_OPTIONS.map((g) => <option key={g}>{g}</option>)}
                </Select>
              </Field>
              <Field label="Nationality" required help="The Reality TV Show is currently open to Nigerian applicants.">
                <Input value={form.personal_nationality} readOnly disabled
                  style={{ background: '#F3F4F6', color: c.textMuted }} />
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <Field label="State of Origin" required error={errors.personal_stateOfOrigin}>
                <Select value={form.personal_stateOfOrigin} error={errors.personal_stateOfOrigin}
                  onChange={(e) => set('personal_stateOfOrigin', e.target.value)}>
                  <option value="">Select state…</option>
                  {NIGERIA_STATES.map((s) => <option key={s}>{s}</option>)}
                </Select>
              </Field>
              <Field label="State of Residence" required error={errors.personal_stateOfResidence}>
                <Select value={form.personal_stateOfResidence} error={errors.personal_stateOfResidence}
                  onChange={(e) => { set('personal_stateOfResidence', e.target.value); set('personal_city', ''); }}>
                  <option value="">Select state…</option>
                  {NIGERIA_STATES.map((s) => <option key={s}>{s}</option>)}
                </Select>
              </Field>
              <Field label="City / Town" required error={errors.personal_city}>
                {cities.length > 0 ? (
                  <Select value={form.personal_city} error={errors.personal_city}
                    onChange={(e) => set('personal_city', e.target.value)}>
                    <option value="">Select city…</option>
                    {cities.map((city) => <option key={city}>{city}</option>)}
                  </Select>
                ) : (
                  <Input value={form.personal_city} error={errors.personal_city}
                    onChange={(e) => set('personal_city', e.target.value)} placeholder="Enter your city" />
                )}
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <Field label="Phone Number" required error={errors.personal_primaryPhone}>
                <Input type="tel" value={form.personal_primaryPhone} error={errors.personal_primaryPhone}
                  onChange={(e) => set('personal_primaryPhone', e.target.value)} placeholder="+234 80X XXX XXXX" />
              </Field>
              <Field label="WhatsApp Number" error={errors.personal_whatsapp}>
                <Input type="tel" value={form.personal_whatsapp} error={errors.personal_whatsapp}
                  onChange={(e) => set('personal_whatsapp', e.target.value)} placeholder="+234 80X XXX XXXX" />
              </Field>
            </div>

            <Field label="Residential Address" required error={errors.personal_address}>
              <Textarea value={form.personal_address} error={errors.personal_address} rows={2}
                onChange={(e) => set('personal_address', e.target.value)} placeholder="Street, area, city" />
            </Field>

            <Field label="Profile Photo" required error={errors.media_profilePhotoUrl}
              help="Clear, well-lit headshot. JPG or PNG, max 5 MB.">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {/* Preview */}
                <div style={{ width: 88, height: 88, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', border: `2px solid ${errors.media_profilePhotoUrl ? c.danger : c.border}`, background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {form.media_profilePhotoPreview
                    ? <img src={form.media_profilePhotoPreview} alt="Profile preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 32, color: '#D1D5DB' }}>👤</span>}
                </div>
                {/* Dropzone / file input */}
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '18px 20px', border: `2px dashed ${errors.media_profilePhotoUrl ? c.danger : c.border}`, borderRadius: 12, cursor: 'pointer', background: '#FAFAFA', transition: 'border-color 0.2s' }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) pickProfilePhoto(file);
                  }}>
                  <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) pickProfilePhoto(file);
                    }} />
                  <span style={{ fontSize: 22 }}>📷</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: c.textMid }}>
                    {uploading['media.profilePhoto']
                      ? 'Uploading…'
                      : (form.media_profilePhotoName || (form.media_profilePhoto as File | null)?.name || 'Click to upload or drag & drop')}
                  </span>
                  {form.media_profilePhotoUrl && !uploading['media.profilePhoto'] && (
                    <span style={{ fontSize: 12, color: c.success, fontWeight: 700 }}>✓ Uploaded</span>
                  )}
                  {!form.media_profilePhotoUrl && !uploading['media.profilePhoto'] && (
                    <span style={{ fontSize: 11, color: c.textMuted }}>JPG, PNG or WEBP · max 5 MB</span>
                  )}
                  {(form.media_profilePhotoUrl || form.media_profilePhoto) && !uploading['media.profilePhoto'] && (
                    <button type="button" onClick={(e) => {
                      e.preventDefault();
                      set('media_profilePhoto', null);
                      set('media_profilePhotoPreview', '');
                      clearUpload('media.profilePhoto', 'media_profilePhotoUrl', 'media_profilePhotoName');
                    }}
                      style={{ fontSize: 11, color: c.danger, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, marginTop: 2 }}>
                      Remove photo
                    </button>
                  )}
                </label>
              </div>
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

            {/* Guardian consent — schema-required whenever derived.age < 18. */}
            {isMinor && (
              <div style={section}>
                <p style={sectionTitle}>🛡 Parent / Guardian Consent <span style={{ fontWeight: 400, color: c.danger, textTransform: 'none', letterSpacing: 0 }}>(required — applicant is under 18)</span></p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                    <Field label="Parent/Guardian Full Name" required error={errors.guardian_fullName}>
                      <Input value={form.guardian_fullName} error={errors.guardian_fullName}
                        onChange={(e) => set('guardian_fullName', e.target.value)} placeholder="e.g. Mrs. Ngozi Obi" />
                    </Field>
                    <Field label="Relationship to Applicant" required error={errors.guardian_relationship}>
                      <Input value={form.guardian_relationship} error={errors.guardian_relationship}
                        onChange={(e) => set('guardian_relationship', e.target.value)} placeholder="e.g. Mother" />
                    </Field>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                    <Field label="Parent/Guardian Phone" required error={errors.guardian_phone}>
                      <Input type="tel" value={form.guardian_phone} error={errors.guardian_phone}
                        onChange={(e) => set('guardian_phone', e.target.value)} placeholder="+234 80X XXX XXXX" />
                    </Field>
                    <Field label="Parent/Guardian Email" required error={errors.guardian_email}>
                      <Input type="email" value={form.guardian_email} error={errors.guardian_email}
                        onChange={(e) => set('guardian_email', e.target.value)} placeholder="guardian@example.com" />
                    </Field>
                  </div>
                  <Field label="Parent/Guardian Address" required error={errors.guardian_address}>
                    <Textarea value={form.guardian_address} error={errors.guardian_address} rows={2}
                      onChange={(e) => set('guardian_address', e.target.value)} placeholder="Street, area, city" />
                  </Field>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                    <Field label="Digital Signature (typed name)" required error={errors.guardian_digitalSignature}
                      help="The parent/guardian should type their full legal name">
                      <Input value={form.guardian_digitalSignature} error={errors.guardian_digitalSignature}
                        onChange={(e) => set('guardian_digitalSignature', e.target.value)} placeholder="Full legal name" />
                    </Field>
                    <Field label="Parent/Guardian ID Upload" error={errors.guardian_idUploadUrl}
                      help="JPG, PNG or PDF">
                      {filePicker('guardian.idUpload', 'guardian_idUploadUrl', 'guardian_idUploadName', '.jpg,.jpeg,.png,.pdf', '🪪')}
                    </Field>
                  </div>
                  <Checkbox
                    label="I authorize this applicant to participate in Spotlight programme activities."
                    checked={form.guardian_consentGranted}
                    onChange={(v) => set('guardian_consentGranted', v)}
                    required
                  />
                  {errors.guardian_consentGranted && <span style={errTxt}>{errors.guardian_consentGranted}</span>}
                </div>
              </div>
            )}
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
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <Field label="Years of Experience" required error={errors.talent_experienceYears}
                help="A whole number of years — e.g. 0, 2, 7">
                <Input type="number" min={0} max={80} step={1} value={form.talent_experienceYears}
                  error={errors.talent_experienceYears}
                  onChange={(e) => set('talent_experienceYears', e.target.value)} placeholder="e.g. 3" />
              </Field>
              <Field label="Skill Level" required error={errors.talent_skillLevel}>
                <Select value={form.talent_skillLevel} error={errors.talent_skillLevel}
                  onChange={(e) => set('talent_skillLevel', e.target.value)}>
                  <option value="">Select…</option>
                  {SKILL_LEVEL_OPTIONS.map((l) => <option key={l}>{l}</option>)}
                </Select>
              </Field>
            </div>

            <Field label="Previous Competitions" help="Contests or shows you have entered before">
              <Textarea value={form.talent_previousCompetitions}
                onChange={(e) => set('talent_previousCompetitions', e.target.value)}
                placeholder="e.g. Nigerian Idol auditions 2023, church talent shows…" rows={2} />
            </Field>

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
          <p style={{ color: c.textMuted, fontSize: 13.5, marginBottom: 24 }}>Identity, media, and how you&apos;d like to audition — help us see you beyond the form.</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Field label="Why would you make a great TV contestant?" required error={errors.category_uniqueStory}
              help="Think personality, charisma, conflict, growth — what makes for great television?">
              <Textarea value={form.category_uniqueStory} error={errors.category_uniqueStory}
                onChange={(e) => set('category_uniqueStory', e.target.value)}
                placeholder="e.g. I'm naturally entertaining and drama-free but I speak my truth. Viewers would relate to my authenticity and root for me…" rows={4} />
            </Field>

            <div style={section}>
              <p style={sectionTitle}>Identity Verification</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <Field label="Government-issued ID type" required error={errors.identity_idType}>
                  <Select value={form.identity_idType} error={errors.identity_idType}
                    onChange={(e) => set('identity_idType', e.target.value)}>
                    <option value="">Select…</option>
                    {ID_TYPE_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                  </Select>
                </Field>
                <Field label="ID Number">
                  <Input value={form.identity_idNumber}
                    onChange={(e) => set('identity_idNumber', e.target.value)} placeholder="e.g. NIN / passport no." />
                </Field>
              </div>
              <div style={{ marginTop: 14 }}>
                <Field label="ID Upload" required error={errors.identity_idUploadUrl}
                  help="JPG, PNG or PDF — a clear photo or scan of the document">
                  {filePicker('identity.idUpload', 'identity_idUploadUrl', 'identity_idUploadName', '.jpg,.jpeg,.png,.pdf', '🪪')}
                </Field>
              </div>
            </div>

            <Field label="Performance / Audition Link" error={errors.media_performanceLink}
              help="YouTube, TikTok, Instagram Reel, or Google Drive link to a recent performance or audition clip">
              <Input type="url" value={form.media_performanceLink} error={errors.media_performanceLink}
                onChange={(e) => set('media_performanceLink', e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…" />
            </Field>

            <Field label="Short intro / audition video" error={errors.media_introVideoUrl}
              help="Optional — MP4 or MOV, a short clip introducing yourself">
              {filePicker('media.introVideo', 'media_introVideoUrl', 'media_introVideoName', '.mp4,.mov', '🎥')}
            </Field>

            <Field label="Preferred audition format" required error={errors.audition_format}>
              <Select value={form.audition_format} error={errors.audition_format}
                onChange={(e) => set('audition_format', e.target.value)}>
                <option value="">Select…</option>
                {AUDITION_FORMATS.map((f) => <option key={f}>{f}</option>)}
              </Select>
            </Field>

            <div style={section}>
              <p style={{ ...sectionTitle, margin: '0 0 14px' }}>
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
                <Field label="X / Twitter">
                  <Input value={form.social_x} placeholder="@handle"
                    onChange={(e) => set('social_x', e.target.value)} />
                </Field>
                <Field label="Total Followers (est.)" help="Across all platforms combined">
                  <Input type="number" value={form.social_totalFollowers} placeholder="e.g. 12000"
                    onChange={(e) => set('social_totalFollowers', e.target.value)} min="0" />
                </Field>
              </div>
              <div style={{ marginTop: 12 }}>
                <Checkbox
                  label="I am willing to invite my fans and followers to vote for me."
                  checked={form.social_willingToInviteVoting}
                  onChange={(v) => set('social_willingToInviteVoting', v)}
                />
              </div>
            </div>

            <Field label="Talent summary for public voting profile" error={errors.publicProfile_talentSummary}
              help="One or two sentences shown on your public voting page (optional)">
              <Textarea value={form.publicProfile_talentSummary} rows={2}
                onChange={(e) => set('publicProfile_talentSummary', e.target.value)}
                placeholder="e.g. Singer and dancer from Lagos bringing big energy to the house…" />
            </Field>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Checkbox
                label="I confirm that all links and content I have shared belong to me or I have rights to use them."
                checked={form.media_rightsConfirmed}
                onChange={(v) => set('media_rightsConfirmed', v)}
                required
              />
              {errors.media_rightsConfirmed && <span style={errTxt}>{errors.media_rightsConfirmed}</span>}
              <Checkbox
                label="I consent to my profile being visible for public voting."
                checked={form.publicProfile_publicVotingConsent}
                onChange={(v) => set('publicProfile_publicVotingConsent', v)}
                required
              />
              {errors.publicProfile_publicVotingConsent && <span style={errTxt}>{errors.publicProfile_publicVotingConsent}</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── Step 4: Readiness ──────────────────────────────────────────────── */}
      {step === 4 && (
        <div style={card}>
          <h3 style={{ color: c.textDark, fontWeight: 800, fontSize: 18, marginBottom: 4 }}>✅ Readiness, Welfare & Emergency Contact</h3>
          <p style={{ color: c.textMuted, fontSize: 13.5, marginBottom: 24 }}>Confirm you are ready for the show environment, tell us about your health, and provide a contact for emergencies.</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={section}>
              <p style={sectionTitle}>Show Readiness</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="Availability during production" required error={errors.bootcamp_availableFullPeriod}>
                  <Select value={form.bootcamp_availableFullPeriod} error={errors.bootcamp_availableFullPeriod}
                    onChange={(e) => set('bootcamp_availableFullPeriod', e.target.value)}>
                    <option value="">Select…</option>
                    {BOOTCAMP_AVAILABILITY.map((a) => <option key={a}>{a}</option>)}
                  </Select>
                </Field>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Checkbox label="I am able and willing to travel to the production location." checked={form.bootcamp_canTravel}
                    onChange={(v) => set('bootcamp_canTravel', v)} required />
                  {errors.bootcamp_canTravel && <span style={errTxt}>{errors.bootcamp_canTravel}</span>}
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
                  <Checkbox
                    label="I am comfortable with public voting and possible eviction."
                    checked={form.bootcamp_comfortPublicVoting}
                    onChange={(v) => set('bootcamp_comfortPublicVoting', v)}
                  />
                </div>

                <Field label="Any travel restrictions?"
                  help="Visa issues, dates you cannot travel, etc. (optional)">
                  <Textarea value={form.bootcamp_travelRestrictions}
                    onChange={(e) => set('bootcamp_travelRestrictions', e.target.value)}
                    placeholder="e.g. I cannot travel during the last two weeks of August…" rows={2} />
                </Field>

                <Field label="Dietary, cultural, or personal considerations"
                  help="Anything production should be aware of (optional)">
                  <Textarea value={form.bootcamp_personalConsiderations}
                    onChange={(e) => set('bootcamp_personalConsiderations', e.target.value)}
                    placeholder="e.g. I am vegetarian and observe Friday prayers…" rows={2} />
                </Field>
              </div>
            </div>

            <div style={section}>
              <p style={sectionTitle}>Health & Welfare</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Field label="General health status" required error={errors.medical_generalHealthStatus}
                  help="Select everything that applies">
                  <MultiSelect options={HEALTH_STATUS_OPTIONS} selected={form.medical_generalHealthStatus}
                    onChange={(v) => set('medical_generalHealthStatus', v)} />
                </Field>
                <Field label="Known medical conditions" error={errors.medical_knownConditions}
                  help="Select 'None' if not applicable">
                  <MultiSelect options={MEDICAL_CONDITION_OPTIONS} selected={form.medical_knownConditions}
                    onChange={(v) => set('medical_knownConditions', v)} />
                </Field>
                <Field label="Allergies" error={errors.medical_allergies}
                  help="Select 'None' if not applicable">
                  <MultiSelect options={ALLERGY_OPTIONS} selected={form.medical_allergies}
                    onChange={(v) => set('medical_allergies', v)} />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                  <Field label="Medication currently used" error={errors.medical_currentMedication}>
                    <Textarea value={form.medical_currentMedication} rows={2}
                      onChange={(e) => set('medical_currentMedication', e.target.value)}
                      placeholder="e.g. Ventolin inhaler as needed…" />
                  </Field>
                  <Field label="Dietary restrictions" error={errors.medical_dietaryRestrictions}>
                    <Textarea value={form.medical_dietaryRestrictions} rows={2}
                      onChange={(e) => set('medical_dietaryRestrictions', e.target.value)}
                      placeholder="e.g. Halal only, lactose intolerant…" />
                  </Field>
                </div>
                <Checkbox
                  label="I consent to emergency medical support where necessary."
                  checked={form.medical_emergencyTreatmentConsent}
                  onChange={(v) => set('medical_emergencyTreatmentConsent', v)}
                  required
                />
                {errors.medical_emergencyTreatmentConsent && <span style={errTxt}>{errors.medical_emergencyTreatmentConsent}</span>}
              </div>
            </div>

            <div style={section}>
              <p style={sectionTitle}>Emergency Contact</p>
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
                  <Field label="Alternative Phone" help="Optional" error={errors.emergency_altPhone}>
                    <Input type="tel" value={form.emergency_altPhone} error={errors.emergency_altPhone}
                      onChange={(e) => set('emergency_altPhone', e.target.value)} placeholder="+234 80X XXX XXXX" />
                  </Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                  <Field label="State" required error={errors.emergency_state}>
                    <Select value={form.emergency_state} error={errors.emergency_state}
                      onChange={(e) => { set('emergency_state', e.target.value); set('emergency_city', ''); }}>
                      <option value="">Select state…</option>
                      {NIGERIA_STATES.map((s) => <option key={s}>{s}</option>)}
                    </Select>
                  </Field>
                  <Field label="City" required error={errors.emergency_city}>
                    {emergencyCities.length > 0 ? (
                      <Select value={form.emergency_city} error={errors.emergency_city}
                        onChange={(e) => set('emergency_city', e.target.value)}>
                        <option value="">Select city…</option>
                        {emergencyCities.map((city) => <option key={city}>{city}</option>)}
                      </Select>
                    ) : (
                      <Input value={form.emergency_city} error={errors.emergency_city}
                        onChange={(e) => set('emergency_city', e.target.value)} placeholder="Enter city" />
                    )}
                  </Field>
                </div>
              </div>
            </div>

            <div style={section}>
              <p style={sectionTitle}>Declarations & Compliance</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Checkbox
                  label="I have previously participated in a reality show."
                  checked={form.compliance_previouslyInRealityShow}
                  onChange={(v) => set('compliance_previouslyInRealityShow', v)}
                />
                <Checkbox
                  label="I am currently under an exclusive talent contract."
                  checked={form.compliance_exclusiveContract}
                  onChange={(v) => set('compliance_exclusiveContract', v)}
                />
                <Checkbox
                  label="I have a legal restriction that may affect participation (e.g. ongoing court matter)."
                  checked={form.compliance_legalRestriction}
                  onChange={(v) => set('compliance_legalRestriction', v)}
                />
                <Checkbox
                  label="I agree to Spotlight's code of conduct."
                  checked={form.compliance_codeOfConductAgreement}
                  onChange={(v) => set('compliance_codeOfConductAgreement', v)}
                  required
                />
                {errors.compliance_codeOfConductAgreement && <span style={errTxt}>{errors.compliance_codeOfConductAgreement}</span>}
                <Checkbox
                  label="I agree to additional background checks if selected."
                  checked={form.compliance_backgroundCheckAgreement}
                  onChange={(v) => set('compliance_backgroundCheckAgreement', v)}
                  required
                />
                {errors.compliance_backgroundCheckAgreement && <span style={errTxt}>{errors.compliance_backgroundCheckAgreement}</span>}
                <Checkbox
                  label="I confirm all submitted information is true and accurate."
                  checked={form.compliance_truthDeclaration}
                  onChange={(v) => set('compliance_truthDeclaration', v)}
                  required
                />
                {errors.compliance_truthDeclaration && <span style={errTxt}>{errors.compliance_truthDeclaration}</span>}
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
            <p style={sectionTitle}>Application Summary</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              {[
                ['Name', `${form.personal_firstName} ${form.personal_lastName}`.trim() || '—'],
                ['Stage name', form.personal_stageName || '—'],
                ['State', form.personal_stateOfResidence || '—'],
                ['Entry mode', form.contest_entryMode],
                ['Talent', form.talent_primarySkill.join(', ') || '—'],
                ['Experience', form.talent_experienceYears !== '' ? `${form.talent_experienceYears} yr(s)` : '—'],
                ['Audition', form.audition_format || '—'],
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
              { key: 'legal_privacyConsent', text: 'I consent to my personal data being processed for registration and programme administration.' },
              { key: 'legal_mediaRelease', text: 'I grant Spotlight rights to record, broadcast, and use my participation for promotional purposes.' },
              { key: 'legal_publicVotingConsent', text: 'I understand my profile may be displayed publicly and may be subject to audience voting.' },
              { key: 'legal_productionRulesConsent', text: 'I agree to abide by production guidelines, safety protocols, and the code of conduct.' },
              { key: 'legal_disqualificationAcknowledgment', text: 'I understand that misconduct or fraud may lead to disqualification.' },
              { key: 'legal_ageGuardianConfirmation', text: 'I meet the age requirements, or I have valid parent/guardian consent.' },
              { key: 'legal_communicationConsent', text: 'I agree to receive updates via email, SMS, WhatsApp, or in-app notifications.' },
              { key: 'legal_sponsorActivationConsent', text: 'I understand programme activities may involve sponsors and brand integrations.' },
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
