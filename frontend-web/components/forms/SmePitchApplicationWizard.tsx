'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/src/lib/supabase/client';
import { authFetch, isUnauthorized, redirectToLogin } from '@/src/lib/auth/flow';
import {
  NIGERIA_STATES,
  NIGERIA_CITIES_BY_STATE,
  getStepIndex,
} from '@/src/features/registration/config';
import { buildStepSaveBody, draftSaveSucceeded } from '@/src/features/registration/draft-save';
import { normaliseNigerianPhone, validateStepData } from '@/src/features/registration/validation';
import type {
  RegistrationDraft,
  RegistrationField,
  RegistrationStep,
} from '@/src/features/registration/types';
import { ArrowIcon } from '@/components/season2/Icons';

const CONTEST_SLUG = 'sme-pitch-contest';
const LOGIN_PATH = `/apply/${CONTEST_SLUG}`;

// The wizard renders the LIVE schema (forms/sme-pitch-contest.ts) step for step
// and validates with the same validateStepData the server runs, so a select can
// never offer a value the server would reject and a passing client check is a
// passing server check.
const STEP_META = [
  {
    label: 'Your Entry',
    title: 'How are you entering?',
    intro: 'One application per business. Pick the entry type — the contest itself is locked to this route.',
  },
  {
    label: 'The Founder',
    title: 'The person behind the business.',
    intro: 'You as the founder or lead. Details your Spotlight account already holds are filled in and locked.',
  },
  {
    label: 'Business & Pitch',
    title: 'Show what you’ve built.',
    intro: 'The heart of your application: the business, the evidence so far, and the deck you will pitch from.',
  },
  {
    label: 'Submit',
    title: 'Review, declare, send.',
    intro: 'Check your answers, give the declarations, and send your pitch to the review team. Entry is free.',
  },
];

// The Business & Pitch schema step is one server checkpoint but reads as five
// short sections on the sheet. Order here is presentation only — validation is
// order-independent.
const BUSINESS_GROUPS: Array<{ title: string; keys: string[] }> = [
  {
    title: 'The business',
    keys: [
      'category.businessName',
      'category.businessSector',
      'category.businessStage',
      'category.productDescription',
      'category.problemSolved',
      'category.revenueModel',
      'category.tractionMetrics',
      'category.fundingNeeded',
    ],
  },
  {
    title: 'Documents',
    keys: ['identity.idType', 'identity.idUpload', 'identity.cacDocument', 'category.pitchDeck'],
  },
  {
    title: 'Online presence',
    keys: ['social.website', 'social.instagram', 'social.linkedin'],
  },
  {
    title: 'Pitch format',
    keys: ['audition.format', 'audition.onlineLink'],
  },
  {
    title: 'Public profile & declarations',
    keys: [
      'publicProfile.businessSummary',
      'compliance.registeredBusiness',
      'compliance.ownWork',
      'compliance.codeOfConductAgreement',
      'compliance.truthDeclaration',
      'publicProfile.publicVotingConsent',
    ],
  },
];

const SUBMITTED_STATUSES = new Set([
  'submitted',
  'awaiting_payment',
  'under_review',
  'more_information_requested',
  'shortlisted',
  'callback_invited',
  'approved',
  'rejected',
  'waitlisted',
  'disqualified',
  'audition_scheduled',
  'selected_for_bootcamp',
  'selected_for_public_voting',
  'eliminated',
  'winner',
]);

// The Season 2 type and colour system, shared with the reality-show sheet:
// ink on cream, Manrope labels, condensed numerals, one orange action per screen.
const c = {
  white: '#FFFDF8',
  border: '#C9B8C9',
  primary: '#FF8949',
  primaryDark: '#E86A2B',
  textDark: '#261833',
  textMid: '#4A3554',
  textMuted: '#6F5C79',
  success: '#2F7D5A',
  danger: '#A83A34',
  dangerBg: '#F7E4E1',
  inputBg: '#FBF6EF',
};

const inp: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 2,
  boxSizing: 'border-box',
  background: '#FFFDF8',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#C9B8C9',
  color: '#261833',
  WebkitTextFillColor: '#261833',
  fontSize: 15,
  lineHeight: 1.5,
  outline: 'none',
  transition: 'border-color 0.2s, box-shadow 0.2s',
  fontFamily: 'inherit',
};
const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: 12.5,
  fontWeight: 700,
  color: '#261833',
  marginBottom: 7,
};
const hint: React.CSSProperties = { fontSize: 12, color: '#6F5C79', marginTop: 5 };
const errTxt: React.CSSProperties = { fontSize: 12, color: '#A83A34', marginTop: 5, fontWeight: 600 };

function Field({ label, required, children, help, error }: {
  label: string; required?: boolean; children: React.ReactNode; help?: string; error?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={lbl}>
        {label}
        {required && <span style={{ color: c.danger, marginLeft: 4, fontWeight: 700 }}>*</span>}
        {!required && <span style={{ color: '#9CA3AF', fontSize: 12, fontWeight: 400, marginLeft: 6 }}>(optional)</span>}
      </label>
      {children}
      {help && !error && <span style={hint}>{help}</span>}
      {error && <span style={errTxt}>{error}</span>}
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
        ...(error ? { borderColor: c.danger, boxShadow: '0 0 0 3px rgba(168,58,52,0.10)' } : {}),
        ...(focused && !error ? { borderColor: c.primary, boxShadow: '0 0 0 3px rgba(232,106,43,0.16)' } : {}),
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
        minHeight: 104,
        resize: 'vertical',
        ...(error ? { borderColor: c.danger, boxShadow: '0 0 0 3px rgba(168,58,52,0.10)' } : {}),
        ...(focused && !error ? { borderColor: c.primary, boxShadow: '0 0 0 3px rgba(232,106,43,0.16)' } : {}),
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
        ...(error ? { borderColor: c.danger, boxShadow: '0 0 0 3px rgba(168,58,52,0.10)' } : {}),
        ...(focused && !error ? { borderColor: c.primary, boxShadow: '0 0 0 3px rgba(232,106,43,0.16)' } : {}),
        ...style,
      }}
    >
      {children}
    </select>
  );
}

function Checkbox({ label, checked, onChange, required, error }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; required?: boolean; error?: string;
}) {
  return (
    <div>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', padding: '11px 13px', background: checked ? 'rgba(255,137,73,0.10)' : c.inputBg, border: `1px solid ${error ? c.danger : checked ? c.primary : c.border}`, borderRadius: 2, transition: 'all 0.15s' }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
          style={{ width: 17, height: 17, accentColor: c.primaryDark, flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: 13.5, color: c.textMid, lineHeight: 1.5 }}>
          {label}{required && <span style={{ color: c.danger, marginLeft: 3 }}>*</span>}
        </span>
      </label>
      {error && <span style={errTxt}>{error}</span>}
    </div>
  );
}

function StepProgress({ steps, current }: { steps: RegistrationStep[]; current: number }) {
  return (
    <div className="apply-steps" aria-label={`Step ${current + 1} of ${steps.length}`}>
      {steps.map((step, i) => {
        const done = current > i;
        const active = current === i;
        const meta = STEP_META[i];
        return (
          <Fragment key={step.key}>
            <div className={`step${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}>
              <span className="step-no">{done ? '✓' : String(i + 1).padStart(2, '0')}</span>
              <span className="step-label">{meta?.label ?? step.title}</span>
            </div>
            {i < steps.length - 1 && <span className="step-line" aria-hidden="true" />}
          </Fragment>
        );
      })}
    </div>
  );
}

function StepHead({ index, title, intro }: { index: number; title: string; intro: string }) {
  return (
    <>
      <p className="form-kicker">
        <span>{String(index + 1).padStart(2, '0')}</span> STEP {index + 1} OF 4
      </p>
      <h3 className="form-title">{title}</h3>
      <p className="form-intro">{intro}</p>
    </>
  );
}

function SpinnerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ animation: 'sme-spin 0.7s linear infinite' }}>
      <style>{`@keyframes sme-spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export default function SmePitchApplicationWizard() {
  const supabase = useMemo(() => createClient(), []);
  const pathname = usePathname();

  const [draft, setDraft] = useState<RegistrationDraft | null>(null);
  const [steps, setSteps] = useState<RegistrationStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [done, setDone] = useState(false);
  const [userName, setUserName] = useState('');
  const topRef = useRef<HTMLDivElement>(null);

  const currentStep = steps[stepIndex];
  const isFinalStep = stepIndex === steps.length - 1;
  const cities = NIGERIA_CITIES_BY_STATE[String(formData['personal.stateOfResidence'] || '')] || [];

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        redirectToLogin(pathname || LOGIN_PATH);
        return;
      }

      const meta = (session.user.user_metadata || {}) as Record<string, unknown>;
      const name = String(meta.full_name || meta.name || '').trim() || session.user.email?.split('@')[0] || '';
      if (!cancelled) setUserName(name);

      // StrictMode double-mounts this effect in dev (a second tab can do the
      // same): two concurrent creates race the one-live-per-contest unique
      // index. Reuse the 409's existing registration and retry once so the
      // race loser lands on it.
      let id: string | undefined;
      let createError = 'Unable to start application.';
      for (let attempt = 0; attempt < 2 && !id; attempt++) {
        const createRes = await authFetch('/api/registration/applications', {
          method: 'POST',
          body: JSON.stringify({ contestSlug: CONTEST_SLUG }),
        }, { json: true });

        if (isUnauthorized(createRes)) { redirectToLogin(pathname || LOGIN_PATH); return; }

        const createPayload = await createRes.json().catch(() => ({}));
        if (createRes.ok && createPayload?.draft?.id) {
          id = createPayload.draft.id as string;
          break;
        }
        const existingId = createPayload?.registration?.id;
        if (typeof existingId === 'string' && existingId) {
          id = existingId;
          break;
        }
        createError = createPayload?.error || createPayload?.message || createError;
      }
      if (!id) {
        if (!cancelled) { setBootstrapError(createError); setLoading(false); }
        return;
      }

      const readRes = await authFetch(`/api/registration/applications/${id}`, { cache: 'no-store' });
      if (isUnauthorized(readRes)) { redirectToLogin(pathname || LOGIN_PATH); return; }

      const readPayload = await readRes.json().catch(() => ({}));
      if (!readRes.ok || !readPayload?.draft || !Array.isArray(readPayload.steps)) {
        if (!cancelled) {
          setBootstrapError(readPayload?.error || 'Unable to load application.');
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        const loaded = readPayload.draft as RegistrationDraft;
        const loadedSteps = readPayload.steps as RegistrationStep[];
        setDraft(loaded);
        setSteps(loadedSteps);
        setFormData(loaded.formData || {});
        setStepIndex(getStepIndex(loadedSteps, loaded.currentStep));
        if (SUBMITTED_STATUSES.has(loaded.status)) setDone(true);
        setLoading(false);
      }
    }

    void bootstrap();
    return () => { cancelled = true; };
  }, []);

  function set(key: string, value: unknown) {
    setFormData((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'personal.stateOfResidence') next['personal.city'] = '';
      return next;
    });
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function uploadFile(fieldKey: string, file: File) {
    setUploading((prev) => ({ ...prev, [fieldKey]: true }));
    setGlobalError('');
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
      setFormData((prev) => ({
        ...prev,
        [fieldKey]: url,
        [`${fieldKey}.__meta`]: payload.upload,
      }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next[fieldKey];
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setErrors((prev) => ({ ...prev, [fieldKey]: message }));
      setGlobalError(message);
    } finally {
      setUploading((prev) => ({ ...prev, [fieldKey]: false }));
    }
  }

  function clearUpload(fieldKey: string) {
    setFormData((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      delete next[`${fieldKey}.__meta`];
      return next;
    });
  }

  /**
   * PATCH the draft under the schema step this screen completes. Returns true
   * only when the row was actually written — the strict step endpoint answers
   * 422 with validation.isValid === false when the step fails, and nothing
   * persisted. Its errors are already keyed by schema field key, so they land
   * on the right inputs without a mapping layer.
   */
  async function saveStep(step: RegistrationStep): Promise<boolean> {
    if (!draft) return false;
    setSaving(true);
    setGlobalError('');
    try {
      const res = await authFetch(`/api/registration/applications/${draft.id}/step`, {
        method: 'PATCH',
        body: JSON.stringify(buildStepSaveBody(step.key, formData)),
      }, { json: true });

      if (isUnauthorized(res)) { redirectToLogin(pathname || LOGIN_PATH); return false; }

      const payload = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        draft?: RegistrationDraft;
        steps?: RegistrationStep[];
        validation?: { isValid?: boolean; errors?: Record<string, string> };
      };
      if (!res.ok || !draftSaveSucceeded(payload)) {
        const serverErrors = payload?.validation?.errors;
        if (serverErrors && Object.keys(serverErrors).length > 0) {
          setErrors((prev) => ({ ...prev, ...serverErrors }));
          setGlobalError('Some required information is missing or invalid — please review the highlighted fields.');
        } else {
          setGlobalError(payload?.error || 'Could not save your progress. Please check your connection and try again.');
        }
        return false;
      }
      if (payload.draft) setDraft(payload.draft);
      if (Array.isArray(payload.steps)) setSteps(payload.steps);
      return true;
    } catch {
      setGlobalError('Could not save your progress. Please check your connection and try again.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  function scrollToTop() {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function next() {
    if (!currentStep) return;
    const result = validateStepData(currentStep, formData);
    if (!result.isValid) {
      setErrors(result.errors);
      setGlobalError('');
      scrollToTop();
      return;
    }
    setErrors({});
    if (!(await saveStep(currentStep))) {
      scrollToTop();
      return;
    }
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    scrollToTop();
  }

  function back() {
    setErrors({});
    setGlobalError('');
    setStepIndex((i) => Math.max(i - 1, 0));
    scrollToTop();
  }

  async function handleSubmit() {
    if (!draft || !currentStep) return;
    const result = validateStepData(currentStep, formData);
    if (!result.isValid) {
      setErrors(result.errors);
      scrollToTop();
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      if (!(await saveStep(currentStep))) {
        scrollToTop();
        return;
      }
      const res = await authFetch(`/api/registration/applications/${draft.id}/submit`, { method: 'POST' });
      if (isUnauthorized(res)) { redirectToLogin(pathname || LOGIN_PATH); return; }
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'Submission failed. Please try again.');
      }
      if (payload.draft) setDraft(payload.draft as RegistrationDraft);
      setDone(true);
      scrollToTop();
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
      scrollToTop();
    } finally {
      setSubmitting(false);
    }
  }

  function uploadedName(fieldKey: string): string {
    const meta = formData[`${fieldKey}.__meta`] as { fileName?: string } | undefined;
    return meta?.fileName || 'Uploaded file';
  }

  function renderField(field: RegistrationField) {
    const value = formData[field.key];
    const error = errors[field.key];
    const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';

    if (field.type === 'checkbox') {
      return (
        <div className="sme-wide" key={field.key}>
          <Checkbox label={field.label} required={field.required} error={error}
            checked={value === true} onChange={(v) => set(field.key, v)} />
        </div>
      );
    }

    if (field.type === 'file') {
      const busy = Boolean(uploading[field.key]);
      const filled = typeof value === 'string' && value.trim().length > 0;
      return (
        <div className="sme-wide" key={field.key}>
          <Field label={field.label} required={field.required} error={error}
            help={field.accept ? `Accepted: ${field.accept.split(',').join(', ')}` : undefined}>
            <div className={`sme-upload${error ? ' has-error' : ''}${filled ? ' is-filled' : ''}`}>
              <input
                id={`sme-upload-${field.key}`}
                className="sme-upload-input"
                type="file"
                accept={field.accept}
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadFile(field.key, file);
                  e.target.value = '';
                }}
              />
              <label className="sme-upload-label" htmlFor={`sme-upload-${field.key}`}>
                <span>{busy ? 'Uploading…' : filled ? uploadedName(field.key) : 'Click to choose a file'}</span>
                {filled && !busy && <span className="sme-upload-state">✓ Uploaded</span>}
              </label>
              {filled && !busy && (
                <span className="sme-upload-actions">
                  <a href={String(value)} target="_blank" rel="noreferrer">View</a>
                  <button type="button" onClick={() => clearUpload(field.key)}>Remove</button>
                </span>
              )}
            </div>
          </Field>
        </div>
      );
    }

    if (field.type === 'textarea') {
      return (
        <div className="sme-wide" key={field.key}>
          <Field label={field.label} required={field.required} error={error} help={field.helpText}>
            <Textarea value={text} error={error} placeholder={field.placeholder || field.label}
              onChange={(e) => set(field.key, e.target.value)} />
          </Field>
        </div>
      );
    }

    if (field.type === 'select') {
      const options = field.key === 'personal.city' ? cities : field.options || [];
      return (
        <div key={field.key}>
          <Field label={field.label} required={field.required} error={error} help={field.helpText}>
            <Select value={text} error={error} disabled={field.readOnly}
              onChange={(e) => set(field.key, e.target.value)}>
              <option value="">{field.key === 'personal.city' && cities.length === 0 ? 'Select a state first…' : 'Select…'}</option>
              {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </Select>
          </Field>
        </div>
      );
    }

    const isPhone = field.type === 'tel';
    return (
      <div key={field.key}>
        <Field label={field.label} required={field.required} error={error} help={field.helpText}>
          <Input
            type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : 'text'}
            value={text}
            error={error}
            readOnly={field.readOnly}
            placeholder={field.placeholder || (field.type === 'tel' ? 'e.g. 0801 234 5678' : field.label)}
            min={field.type === 'number' ? 0 : undefined}
            max={field.type === 'date' ? new Date().toISOString().split('T')[0] : undefined}
            onChange={(e) => set(field.key, e.target.value)}
            onBlur={isPhone ? (e) => {
              const canonical = normaliseNigerianPhone(e.target.value);
              if (canonical) set(field.key, canonical);
            } : undefined}
            style={field.readOnly ? { background: '#F1E8E0', color: c.textMuted } : undefined}
          />
        </Field>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="sme-loading" aria-label="Loading your application" role="status">
        <div className="skeleton" style={{ width: '46%' }} />
        <div className="skeleton" style={{ width: '72%' }} />
        <div className="skeleton" style={{ width: '58%' }} />
        <div className="skeleton" style={{ width: '34%' }} />
      </div>
    );
  }

  if (bootstrapError) {
    return (
      <div className="ledger-error">
        <h3>We couldn’t open your application.</h3>
        <p>{bootstrapError}</p>
        <div>
          <button type="button" className="done-secondary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (done) {
    const firstName = String(formData['personal.firstName'] || userName.split(' ')[0] || '');
    return (
      <div ref={topRef} className="apply-done">
        <p className="form-kicker"><span>04</span> SENT TO THE REVIEW TEAM</p>
        <h2 className="done-title">Your pitch is in the room.</h2>
        <p className="done-copy">
          Thank you{firstName ? `, ${firstName}` : ''}. Your application for the Spotlight SME Pitch
          Contest has been received{draft?.reference ? <> — reference <strong>{draft.reference}</strong></> : null}.
          Watch your email for screening updates and your invitation to the next stage.
        </p>
        <div className="done-actions">
          <a href="/my-applications" className="done-primary">Track my application <ArrowIcon /></a>
          <a href="/service-details/sme-pitch-contest" className="done-secondary">Programme details</a>
        </div>
      </div>
    );
  }

  if (!currentStep) {
    return (
      <div className="ledger-error">
        <h3>The form could not be loaded.</h3>
        <p>Your application started, but its steps did not load. Refresh to try again.</p>
        <div>
          <button type="button" className="done-secondary" onClick={() => window.location.reload()}>
            Refresh
          </button>
        </div>
      </div>
    );
  }

  const meta = STEP_META[stepIndex] ?? { label: currentStep.title, title: currentStep.title, intro: currentStep.description };
  const stepFields = currentStep.fields;

  return (
    <div ref={topRef}>
      {/* The sheet's letterhead: who is applying, and under what programme. */}
      <div className="sheet-head">
        <p className="form-kicker" style={{ margin: 0 }}>
          SPOTLIGHT SME PITCH CONTEST · APPLICATION
        </p>
        <p className="sheet-applicant" style={{ margin: 0 }}>
          {userName ? <>Applying as <strong>{userName}</strong></> : null}
          {draft?.reference ? <> · Ref <strong>{draft.reference}</strong></> : null}
        </p>
      </div>

      <div className="fee-note">
        <strong>Free entry</strong>
        <span>No registration fee. Nothing is charged at any step — submit when your pitch is ready.</span>
      </div>

      {globalError && (
        <div role="alert" style={{ background: c.dangerBg, borderLeft: `3px solid ${c.danger}`, padding: '12px 16px', marginBottom: 20, color: c.danger, fontSize: 13.5, fontWeight: 600 }}>
          {globalError}
        </div>
      )}

      <StepProgress steps={steps} current={stepIndex} />

      {/* ── Step 1: Your Entry ─────────────────────────────────────────────── */}
      {currentStep.key === 'contest_selection' && (
        <div>
          <StepHead index={stepIndex} title={meta.title} intro={meta.intro} />
          <div className="sme-field-grid">
            {stepFields.filter((f) => f.key === 'contest.title').map((field) => (
              <div className="sme-wide" key={field.key}>
                <Field label="Contest" help={field.helpText}>
                  <Input value={String(formData[field.key] || 'Spotlight SME Pitch Contest')} readOnly
                    style={{ background: '#F1E8E0', color: c.textMuted }} />
                </Field>
              </div>
            ))}
            {stepFields.filter((f) => f.key === 'contest.entryMode').map((field) => (
              <div className="sme-wide" key={field.key}>
                <Field label={field.label} required={field.required} error={errors[field.key]}>
                  <div className="sme-entry-cards" role="group" aria-label={field.label}>
                    {(field.options || ['Individual', 'Group']).map((opt) => {
                      const active = formData[field.key] === opt;
                      return (
                        <button key={opt} type="button" className="sme-entry-card" aria-pressed={active}
                          onClick={() => set(field.key, opt)}>
                          <strong>{opt === 'Individual' ? 'Solo founder' : 'Team entry'}</strong>
                          <span>
                            {opt === 'Individual'
                              ? 'You founded the business and will pitch it yourself.'
                              : 'A group entering together — one lead founder submits for the team.'}
                          </span>
                          <em>{opt}</em>
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </div>
            ))}
            {stepFields.filter((f) => f.key !== 'contest.title' && f.key !== 'contest.entryMode').map(renderField)}
          </div>
        </div>
      )}

      {/* ── Step 2: The Founder ────────────────────────────────────────────── */}
      {currentStep.key === 'personal_information' && (
        <div>
          <StepHead index={stepIndex} title={meta.title} intro={meta.intro} />
          <div className="sme-field-grid">
            {stepFields.map(renderField)}
          </div>
        </div>
      )}

      {/* ── Step 3: Business & Pitch ───────────────────────────────────────── */}
      {currentStep.key === 'category_specific' && (
        <div>
          <StepHead index={stepIndex} title={meta.title} intro={meta.intro} />
          {(() => {
            const grouped = new Set(BUSINESS_GROUPS.flatMap((g) => g.keys));
            const rest = stepFields.filter((f) => !grouped.has(f.key));
            const groups = rest.length > 0
              ? [...BUSINESS_GROUPS, { title: 'Additional details', keys: rest.map((f) => f.key) }]
              : BUSINESS_GROUPS;
            return groups.map((group) => {
              const fields = group.keys
                .map((key) => stepFields.find((f) => f.key === key))
                .filter((f): f is RegistrationField => Boolean(f));
              if (fields.length === 0) return null;
              return (
                <section key={group.title} aria-label={group.title}>
                  <h4 className="form-subhead">{group.title}</h4>
                  <div className="sme-field-grid">{fields.map(renderField)}</div>
                </section>
              );
            });
          })()}
        </div>
      )}

      {/* ── Step 4: Review & Submit ────────────────────────────────────────── */}
      {currentStep.key === 'review_submit' && (
        <div>
          <StepHead index={stepIndex} title={meta.title} intro={meta.intro} />

          <div className="sme-review" aria-label="Your answers so far">
            <div className="sme-review-head">
              <h4 className="form-subhead" style={{ margin: 0 }}>Your application at a glance</h4>
              <span className="sme-review-edits">
                <button type="button" onClick={() => { setStepIndex(1); scrollToTop(); }}>Edit founder</button>
                <button type="button" onClick={() => { setStepIndex(2); scrollToTop(); }}>Edit business</button>
              </span>
            </div>
            <dl className="sme-review-grid">
              {([
                ['Business', String(formData['category.businessName'] || '—')],
                ['Sector', String(formData['category.businessSector'] || '—')],
                ['Stage', String(formData['category.businessStage'] || '—')],
                ['Founder', [formData['personal.firstName'], formData['personal.lastName']].filter(Boolean).join(' ') || '—'],
                ['Entry type', String(formData['contest.entryMode'] || '—')],
                ['Pitch format', String(formData['audition.format'] || '—')],
                ['Based in', String(formData['personal.stateOfResidence'] || '—')],
                ['Pitch deck', formData['category.pitchDeck'] ? uploadedName('category.pitchDeck') : '—'],
              ] as Array<[string, string]>).map(([term, detail]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{detail}</dd>
                </div>
              ))}
            </dl>
            {formData['category.productDescription'] ? (
              <p className="sme-review-excerpt">
                “{String(formData['category.productDescription'])}”
              </p>
            ) : null}
          </div>

          <div className="sme-field-grid">
            {stepFields.map(renderField)}
          </div>
        </div>
      )}

      {/* Fallback for any schema shape the four screens above do not name. */}
      {!['contest_selection', 'personal_information', 'category_specific', 'review_submit'].includes(currentStep.key) && (
        <div>
          <StepHead index={stepIndex} title={currentStep.title} intro={currentStep.description} />
          <div className="sme-field-grid">{stepFields.map(renderField)}</div>
        </div>
      )}

      {/* ── Navigation ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 28, gap: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={back} disabled={stepIndex === 0 || saving || submitting}
          style={{ padding: '13px 20px', borderRadius: 2, border: `1px solid ${c.border}`, background: 'transparent', color: stepIndex === 0 ? '#A79BAE' : c.textDark, fontFamily: 'var(--head)', fontWeight: 800, cursor: stepIndex === 0 ? 'not-allowed' : 'pointer', fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase' }}>
          Back
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {saving && <span style={{ fontSize: 11, color: c.textMuted }}>Saving…</span>}
          {!isFinalStep ? (
            <button type="button" onClick={() => void next()} disabled={saving}
              style={{ padding: '13px 20px', borderRadius: 2, border: 0, background: saving ? '#C9B8C9' : c.primary, color: saving ? '#5E4965' : '#150E1C', fontFamily: 'var(--head)', fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 14 }}>
              {saving ? <>Saving…</> : <>Continue <ArrowIcon /></>}
            </button>
          ) : (
            <button type="button" onClick={() => void handleSubmit()} disabled={submitting || saving}
              style={{ padding: '13px 22px', borderRadius: 2, border: 0, background: submitting ? '#C9B8C9' : c.primary, color: submitting ? '#5E4965' : '#150E1C', fontFamily: 'var(--head)', fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 10 }}>
              {submitting ? <><SpinnerIcon /> Submitting…</> : <>Submit application <ArrowIcon /></>}
            </button>
          )}
        </div>
      </div>

      <p style={{ fontFamily: 'var(--head)', textAlign: 'center', fontSize: 9, letterSpacing: '.14em', textTransform: 'uppercase', color: c.textMuted, marginTop: 20 }}>
        Step {stepIndex + 1} of {steps.length} · Progress saved after each step
      </p>
    </div>
  );
}