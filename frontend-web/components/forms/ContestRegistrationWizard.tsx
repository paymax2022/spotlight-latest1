'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  buildRegistrationSteps,
  getStepIndex,
  contestRegistrationCatalog,
  TALENT_SKILL_OPTIONS,
  NIGERIA_CITIES_BY_STATE,
  resolveContestRegistration,
} from '@/src/features/registration/config';
import { registrationMicrocopy } from '@/src/features/registration/microcopy';
import type {
  RegistrationDraft,
  RegistrationStatusEvent,
  RegistrationStep,
} from '@/src/features/registration/types';
import { getOptionalEnv } from '@/src/lib/config/env';
import { loadPaystackClient } from '@/src/lib/payments/paystack-client';

function getFieldValue(formData: Record<string, unknown>, key: string) {
  return formData[key];
}

function stringifyFieldValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function arrayFieldValue(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function formatOptionLabel(option: string) {
  if (!option) return option;
  if (!option.includes('_')) return option;
  return option
    .split('_')
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

export default function ContestRegistrationWizard({ contestSlug }: { contestSlug: string }) {
  const formTextColor = '#000000';
  const ui = {
    pageBg: '#F5F7FA',
    cardBg: '#FFFFFF',
    border: '#D7DEE8',
    mutedText: '#4B5563',
    subtleText: '#6B7280',
    primary: '#2563EB',
    success: '#166534',
    successBg: '#ECFDF3',
    danger: '#B42318',
    dangerBg: '#FEF3F2',
    fieldBg: '#FFFFFF',
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [draft, setDraft] = useState<RegistrationDraft | null>(null);
  const [steps, setSteps] = useState<RegistrationStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [timeline, setTimeline] = useState<RegistrationStatusEvent[]>([]);
  const [availableContestTitles, setAvailableContestTitles] = useState<string[]>(
    contestRegistrationCatalog.map((item) => item.title)
  );

  const contest = useMemo(() => resolveContestRegistration(contestSlug), [contestSlug]);
  const currentStep = steps[stepIndex];
  const isFinalStep = stepIndex === steps.length - 1;

  async function fetchTimeline(applicationId: string) {
    const response = await fetch(`/api/registration/applications/${applicationId}/status`, {
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload?.success && Array.isArray(payload?.timeline)) {
      setTimeline(payload.timeline);
    }
  }

  async function fetchContestTitles() {
    try {
      const res = await fetch('/api/registration/contests', { cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      const list = Array.isArray(payload?.contests) ? payload.contests : [];
      const titles = list
        .map((item: { title?: string }) => String(item?.title || '').trim())
        .filter(Boolean);
      if (titles.length > 0) setAvailableContestTitles(titles);
    } catch {
      // keep local fallback catalog titles
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      if (!contest) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorMessage('');

      try {
        const createRes = await fetch('/api/registration/applications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contestSlug: contest.slug }),
        });

        const createPayload = await createRes.json().catch(() => ({}));
        if (!createRes.ok || !createPayload?.success || !createPayload?.draft?.id) {
          throw new Error(createPayload?.error || 'Unable to start application.');
        }

        const appId = createPayload.draft.id as string;
        const readRes = await fetch(`/api/registration/applications/${appId}`, { cache: 'no-store' });
        const readPayload = await readRes.json().catch(() => ({}));
        if (!readRes.ok || !readPayload?.success || !readPayload?.draft) {
          throw new Error(readPayload?.error || 'Unable to load application.');
        }

        if (!isMounted) return;

        const loadedDraft = readPayload.draft as RegistrationDraft;
        const loadedSteps = (readPayload.steps || buildRegistrationSteps(loadedDraft)) as RegistrationStep[];

        setDraft(loadedDraft);
        setFormData(loadedDraft.formData || {});
        setSteps(loadedSteps);
        setStepIndex(getStepIndex(loadedSteps, loadedDraft.currentStep));
        setMessage(registrationMicrocopy.startApplication);

        await fetchTimeline(loadedDraft.id);
      } catch (error) {
        if (!isMounted) return;
        setErrorMessage(error instanceof Error ? error.message : 'Failed to initialize application.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void bootstrap();
    void fetchContestTitles();

    return () => {
      isMounted = false;
    };
  }, [contest]);

  function getDynamicOptions(fieldKey: string, fallback: string[] = []) {
    if (fieldKey === 'contest.title') return availableContestTitles;
    if (fieldKey === 'contest.region' || fieldKey === 'audition.state') {
      const states = formData['derived.auditionStates'];
      if (Array.isArray(states) && states.length > 0) return states.map((item) => String(item));
    }
    if (fieldKey === 'contest.applicantCategory') {
      const categories = formData['derived.applicantCategories'];
      if (Array.isArray(categories) && categories.length > 0) return categories.map((item) => String(item));
    }
    if (fieldKey === 'account.city') {
      const state = String(formData['account.state'] || '');
      return NIGERIA_CITIES_BY_STATE[state] || [];
    }
    if (fieldKey === 'personal.city') {
      const state = String(formData['personal.stateOfResidence'] || '');
      return NIGERIA_CITIES_BY_STATE[state] || [];
    }
    if (fieldKey === 'emergency.city') {
      const state = String(formData['emergency.state'] || '');
      return NIGERIA_CITIES_BY_STATE[state] || [];
    }
    if (fieldKey === 'contest.preferredAuditionCity') {
      const state = String(formData['contest.region'] || '');
      return NIGERIA_CITIES_BY_STATE[state] || [];
    }
    if (fieldKey === 'audition.city') {
      const state = String(formData['audition.state'] || formData['contest.region'] || '');
      return NIGERIA_CITIES_BY_STATE[state] || [];
    }
    if (fieldKey === 'talent.secondarySkill') {
      const primary = arrayFieldValue(formData['talent.primarySkill']);
      if (primary.length === 0) return [];
      return TALENT_SKILL_OPTIONS.filter((option) => !primary.includes(option));
    }
    return fallback;
  }

  async function saveCurrentStep(nextStepIndex?: number) {
    if (!draft || !currentStep) return false;

    setSaving(true);
    setErrorMessage('');
    setMessage('');

    try {
      const res = await fetch(`/api/registration/applications/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stepKey: currentStep.key,
          values: formData,
        }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to save application step.');
      }

      if (payload.validation?.isValid === false) {
        setErrors(payload.validation.errors || {});
        setErrorMessage('Please fix the highlighted fields before continuing.');
        return false;
      }

      const updatedDraft = payload.draft as RegistrationDraft;
      const updatedSteps = (payload.steps || buildRegistrationSteps(updatedDraft)) as RegistrationStep[];

      setErrors({});
      setDraft(updatedDraft);
      setSteps(updatedSteps);
      setFormData(updatedDraft.formData || {});

      if (typeof nextStepIndex === 'number') {
        const boundedIndex = Math.max(0, Math.min(updatedSteps.length - 1, nextStepIndex));
        setStepIndex(boundedIndex);
      }

      setMessage(registrationMicrocopy.saveDraft);
      await fetchTimeline(updatedDraft.id);
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to save step.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(fieldKey: string, file: File) {
    const uploadForm = new FormData();
    uploadForm.append('file', file);

    const response = await fetch('/api/registration/uploads', {
      method: 'POST',
      body: uploadForm,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.error || registrationMicrocopy.uploadFailed);
    }

    const upload = payload.upload || {};
    setFormData((prev) => ({
      ...prev,
      [fieldKey]: upload.previewUrl || upload.storagePath || '',
      [`${fieldKey}.__meta`]: upload,
    }));
  }

  function handleFieldChange(fieldKey: string, value: unknown) {
    setFormData((prev) => {
      const next = { ...prev, [fieldKey]: value };
      if (fieldKey === 'account.state') next['account.city'] = '';
      if (fieldKey === 'personal.stateOfResidence') next['personal.city'] = '';
      if (fieldKey === 'emergency.state') next['emergency.city'] = '';
      if (fieldKey === 'contest.region') {
        next['contest.preferredAuditionCity'] = '';
        next['audition.city'] = '';
      }
      if (fieldKey === 'audition.state') next['audition.city'] = '';
      if (fieldKey === 'talent.primarySkill') {
        const selected = Array.isArray(value) ? value.map((item) => String(item)) : [];
        const existingSecondary = arrayFieldValue(next['talent.secondarySkill']);
        next['talent.secondarySkill'] = existingSecondary.filter((item) => !selected.includes(item));
      }
      return next;
    });
    setErrors((prev) => {
      if (!prev[fieldKey]) return prev;
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }

  async function handleSubmitFinal() {
    if (!draft) return;

    setSubmitting(true);
    setErrorMessage('');
    setMessage('');

    try {
      const saveOk = await saveCurrentStep(stepIndex);
      if (!saveOk) return;

      const isPaidContest = Boolean(formData['derived.isPaidContest']);
      const feeAmount = Number(formData['payment.feeAmount'] || 0);
      const alreadyPaid = String(formData['payment.paymentStatus'] || '') === 'paid';

      if (isPaidContest && feeAmount > 0 && !alreadyPaid) {
        const email =
          String(formData['personal.email'] || formData['account.email'] || '').trim();
        if (!email) {
          setErrorMessage('Email is required before payment can be processed.');
          return;
        }

        const publicKey = getOptionalEnv('NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY');
        if (!publicKey) {
          setErrorMessage('Paystack public key is missing. Please contact support.');
          return;
        }

        const Paystack = await loadPaystackClient();
        const reference = `SPOT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const amountKobo = Math.round(feeAmount * 100);

        await new Promise<void>((resolve, reject) => {
          const popup = new Paystack();
          popup.newTransaction({
            key: publicKey,
            email,
            amount: amountKobo,
            currency: 'NGN',
            firstName: String(formData['personal.firstName'] || formData['account.fullName'] || ''),
            lastName: String(formData['personal.lastName'] || ''),
            phone: String(formData['personal.primaryPhone'] || formData['account.phone'] || ''),
            metadata: {
              custom_fields: [
                { display_name: 'Application Reference', variable_name: 'application_reference', value: String(draft.reference) },
                { display_name: 'Contest', variable_name: 'contest_title', value: String(formData['contest.title'] || '') },
              ],
            },
            onSuccess: (tx) => {
              void (async () => {
                try {
                  await fetch(`/api/registration/applications/${draft.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      stepKey: currentStep.key,
                      values: {
                        ...formData,
                        'payment.transactionReference': tx?.reference || reference,
                        'payment.paymentStatus': 'paid',
                      },
                    }),
                  });
                  setFormData((prev) => ({
                    ...prev,
                    'payment.transactionReference': tx?.reference || reference,
                    'payment.paymentStatus': 'paid',
                  }));
                  resolve();
                } catch (err) {
                  reject(err);
                }
              })();
            },
            onCancel: () => reject(new Error('Payment was cancelled.')),
            onError: (error) => reject(new Error(error?.message || 'Payment failed.')),
          });
        });
      }

      const res = await fetch(`/api/registration/applications/${draft.id}/submit`, {
        method: 'POST',
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'Submission failed.');
      }

      const submittedDraft = payload.draft as RegistrationDraft;
      setDraft(submittedDraft);
      setMessage(payload.message || 'Application submitted successfully.');
      await fetchTimeline(submittedDraft.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWithdraw() {
    if (!draft) return;
    setErrorMessage('');

    const res = await fetch(`/api/registration/applications/${draft.id}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Applicant withdrew from wizard page' }),
    });
    const payload = await res.json().catch(() => ({}));

    if (!res.ok || !payload?.success) {
      setErrorMessage(payload?.error || 'Unable to withdraw application.');
      return;
    }

    setDraft(payload.draft as RegistrationDraft);
    setMessage('Application withdrawn. You can start a new application at any time.');
    await fetchTimeline((payload.draft as RegistrationDraft).id);
  }

  if (!contest) {
    return <p style={{ color: formTextColor }}>Contest not found for this application route.</p>;
  }

  if (loading) {
    return <p style={{ color: formTextColor }}>Loading registration wizard...</p>;
  }

  if (!draft || !currentStep) {
    return <p style={{ color: formTextColor }}>Unable to initialize the registration form.</p>;
  }

  const progress = draft.completionPercent || 0;

  return (
    <div
      style={{
        color: formTextColor,
        backgroundColor: ui.pageBg,
        border: `1px solid ${ui.border}`,
        borderRadius: 16,
        padding: 24,
      }}
    >
      <div className="section-title" style={{ color: formTextColor, marginBottom: 0 }}>
        <span style={{ color: ui.primary, fontWeight: 700, letterSpacing: '0.06em' }}>CONTEST REGISTRATION ENGINE</span>
        <h2>{contest.title}</h2>
      </div>
      <p className="mt-3" style={{ color: ui.mutedText }}>{registrationMicrocopy.startApplication}</p>

      <div
        className="mt-4"
        style={{
          backgroundColor: ui.cardBg,
          border: `1px solid ${ui.border}`,
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div className="d-flex justify-content-between">
          <strong>Application Reference</strong>
          <span>{draft.reference}</span>
        </div>
        <div className="d-flex justify-content-between mt-1">
          <strong>Status</strong>
          <span style={{ textTransform: 'capitalize', color: ui.primary, fontWeight: 600 }}>
            {draft.status.replaceAll('_', ' ')}
          </span>
        </div>
      </div>

      <div className="mt-4" style={{ backgroundColor: ui.cardBg, border: `1px solid ${ui.border}`, borderRadius: 12, padding: 16 }}>
        <div className="d-flex justify-content-between mb-2">
          <span style={{ fontWeight: 600 }}>Completion</span>
          <span style={{ fontWeight: 700 }}>{progress}%</span>
        </div>
        <div style={{ width: '100%', background: '#E5E7EB', borderRadius: 9999, height: 12 }}>
          <div style={{ width: `${progress}%`, background: ui.primary, borderRadius: 9999, height: 12, transition: 'width 220ms ease' }} />
        </div>
      </div>

      <div className="mt-4 mb-3" style={{ backgroundColor: ui.cardBg, border: `1px solid ${ui.border}`, borderRadius: 12, padding: 16 }}>
        <strong>
          Step {stepIndex + 1} of {steps.length}: {currentStep.title}
        </strong>
        <p className="mt-1" style={{ color: ui.mutedText }}>{currentStep.description}</p>
      </div>

      <form
        className="contact-form-items"
        onSubmit={(e) => e.preventDefault()}
        style={{
          color: formTextColor,
          backgroundColor: ui.cardBg,
          border: `1px solid ${ui.border}`,
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div className="row g-4">
          {currentStep.fields.map((field) => {
            const value = getFieldValue(formData, field.key);
            const error = errors[field.key];
            const colClass = field.type === 'textarea' || field.type === 'file' || field.type === 'multi_select' ? 'col-lg-12' : 'col-lg-6';

            return (
              <div className={colClass} key={field.key}>
                <div className="form-clt">
                  <span style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: formTextColor }}>
                    {field.label}
                    {field.required ? <span style={{ color: ui.danger }}> *</span> : ''}
                  </span>

                  {field.type === 'textarea' && (
                    <textarea
                      name={field.key}
                      placeholder={field.placeholder || field.label}
                      value={stringifyFieldValue(value)}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      disabled={field.readOnly}
                      style={{
                        color: formTextColor,
                        backgroundColor: ui.fieldBg,
                        border: `1px solid ${error ? ui.danger : ui.border}`,
                        borderRadius: 10,
                        minHeight: 130,
                        padding: '12px 14px',
                      }}
                    />
                  )}

                  {field.type === 'select' && (
                    <select
                      name={field.key}
                      value={stringifyFieldValue(value)}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      disabled={field.readOnly}
                      style={{
                        color: formTextColor,
                        backgroundColor: ui.fieldBg,
                        border: `1px solid ${error ? ui.danger : ui.border}`,
                        borderRadius: 10,
                        minHeight: 48,
                        padding: '0 14px',
                      }}
                    >
                      <option value="">Select an option</option>
                      {getDynamicOptions(field.key, field.options || []).map((option) => (
                        <option value={option} key={option}>
                          {formatOptionLabel(option)}
                        </option>
                      ))}
                    </select>
                  )}

                  {field.type === 'multi_select' && (
                    <select
                      multiple
                      name={field.key}
                      value={arrayFieldValue(value)}
                      onChange={(e) => {
                        const selected = Array.from(e.currentTarget.selectedOptions).map((option) => option.value);
                        handleFieldChange(field.key, selected);
                      }}
                      disabled={field.readOnly}
                      style={{
                        color: formTextColor,
                        backgroundColor: ui.fieldBg,
                        border: `1px solid ${error ? ui.danger : ui.border}`,
                        borderRadius: 10,
                        minHeight: 120,
                        padding: '10px 14px',
                      }}
                    >
                      {getDynamicOptions(field.key, field.options || []).map((option) => (
                        <option value={option} key={option}>
                          {formatOptionLabel(option)}
                        </option>
                      ))}
                    </select>
                  )}

                  {field.type === 'checkbox' && (
                    <label className="d-flex align-items-start gap-2" style={{ marginTop: 8 }}>
                      <input
                        type="checkbox"
                        checked={value === true}
                        onChange={(e) => handleFieldChange(field.key, e.target.checked)}
                        style={{ marginTop: 4 }}
                      />
                      <span style={{ color: formTextColor }}>{field.helpText || field.label}</span>
                    </label>
                  )}

                  {field.type === 'file' && (
                    <>
                      <input
                        type="file"
                        accept={field.accept}
                        style={{
                          color: formTextColor,
                          backgroundColor: ui.fieldBg,
                          border: `1px solid ${error ? ui.danger : ui.border}`,
                          borderRadius: 10,
                          minHeight: 48,
                          padding: '10px 12px',
                        }}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            setSaving(true);
                            setErrorMessage('');
                            await handleUpload(field.key, file);
                            setMessage('File uploaded successfully.');
                          } catch (error) {
                            setErrorMessage(error instanceof Error ? error.message : registrationMicrocopy.uploadFailed);
                          } finally {
                            setSaving(false);
                          }
                        }}
                      />
                      {typeof value === 'string' && value ? (
                        <p className="mt-1" style={{ fontSize: 12, color: ui.success }}>
                          Uploaded: <a href={value} target="_blank" rel="noreferrer" style={{ color: ui.primary, textDecoration: 'underline' }}>View file</a>
                        </p>
                      ) : null}
                    </>
                  )}

                  {!['textarea', 'select', 'multi_select', 'checkbox', 'file'].includes(field.type) && (
                    <input
                      type={field.type}
                      name={field.key}
                      placeholder={field.placeholder || field.label}
                      value={stringifyFieldValue(value)}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      disabled={field.readOnly}
                      style={{
                        color: formTextColor,
                        backgroundColor: ui.fieldBg,
                        border: `1px solid ${error ? ui.danger : ui.border}`,
                        borderRadius: 10,
                        minHeight: 48,
                        padding: '0 14px',
                      }}
                    />
                  )}

                  {field.helpText ? <small style={{ color: ui.subtleText, display: 'block', marginTop: 6 }}>{field.helpText}</small> : null}
                  {error ? <small style={{ color: ui.danger, display: 'block', marginTop: 6, fontWeight: 600 }}>{error}</small> : null}
                </div>
              </div>
            );
          })}
        </div>
      </form>

      {errorMessage ? (
        <p className="mt-3" style={{ color: ui.danger, fontWeight: 600, backgroundColor: ui.dangerBg, borderRadius: 10, padding: '10px 12px' }}>
          {errorMessage}
        </p>
      ) : null}
      {message ? (
        <p className="mt-3" style={{ color: ui.success, fontWeight: 600, backgroundColor: ui.successBg, borderRadius: 10, padding: '10px 12px' }}>
          {message}
        </p>
      ) : null}

      <div className="mt-4 d-flex flex-wrap gap-2">
        <button
          type="button"
          className="theme-btn"
          onClick={() => void saveCurrentStep(stepIndex)}
          disabled={saving || submitting}
        >
          {saving ? 'Saving...' : 'Save Draft'}
          <i className="fa-solid fa-arrow-right-long" />
        </button>

        <button
          type="button"
          className="theme-btn"
          onClick={() => {
            if (stepIndex > 0) setStepIndex(stepIndex - 1);
          }}
          disabled={stepIndex === 0 || saving || submitting}
        >
          Previous
          <i className="fa-solid fa-arrow-right-long" />
        </button>

        {!isFinalStep ? (
          <button
            type="button"
            className="theme-btn"
            onClick={() => void saveCurrentStep(stepIndex + 1)}
            disabled={saving || submitting}
          >
            Continue
            <i className="fa-solid fa-arrow-right-long" />
          </button>
        ) : (
          <button
            type="button"
            className="theme-btn"
            onClick={() => void handleSubmitFinal()}
            disabled={saving || submitting}
          >
            {submitting ? 'Submitting...' : 'Submit Application'}
            <i className="fa-solid fa-arrow-right-long" />
          </button>
        )}

        <button
          type="button"
          className="theme-btn"
          onClick={() => void handleWithdraw()}
          disabled={saving || submitting}
        >
          Withdraw Application
          <i className="fa-solid fa-arrow-right-long" />
        </button>
      </div>

      <div className="mt-5" style={{ backgroundColor: ui.cardBg, border: `1px solid ${ui.border}`, borderRadius: 12, padding: 16 }}>
        <h4>Application Status Timeline</h4>
        <div className="mt-2">
          {timeline.length === 0 ? (
            <p style={{ color: ui.mutedText }}>No status updates yet.</p>
          ) : (
            <ul style={{ color: formTextColor }}>
              {timeline
                .slice()
                .reverse()
                .map((event) => (
                  <li key={event.id} style={{ marginBottom: 10, borderBottom: `1px solid ${ui.border}`, paddingBottom: 10 }}>
                    <strong style={{ textTransform: 'capitalize' }}>{event.newStatus.replaceAll('_', ' ')}</strong> •{' '}
                    <span style={{ color: ui.subtleText }}>{new Date(event.createdAt).toLocaleString()}</span>
                    {event.note ? <div>{event.note}</div> : null}
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      <p className="mt-4" style={{ fontSize: 12, opacity: 0.75 }}>
        Legal note: these consent templates are implementation drafts and should be reviewed by a qualified legal practitioner before public launch.
      </p>
    </div>
  );
}
