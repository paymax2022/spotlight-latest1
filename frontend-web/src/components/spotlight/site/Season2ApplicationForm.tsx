'use client';

import { useMemo, useState } from 'react';

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

// Map display labels to camelCase keys sent in accountData
const FIELD_DEFS: Array<{ label: string; key: string; optional?: boolean }> = [
  { label: 'Full Name', key: 'fullName' },
  { label: 'Stage Name / Brand Name', key: 'stageName', optional: true },
  { label: 'Date of Birth', key: 'dateOfBirth' },
  { label: 'Gender', key: 'gender' },
  { label: 'Phone Number / WhatsApp', key: 'phone' },
  { label: 'Email Address', key: 'email' },
  { label: 'State of Residence', key: 'stateOfResidence' },
  { label: 'State of Origin', key: 'stateOfOrigin' },
  { label: 'Current City', key: 'currentCity' },
  { label: 'Social Media Handles', key: 'socialMediaHandles' },
  { label: 'Application Category', key: 'applicationCategory' },
  { label: 'Talent Description', key: 'talentDescription' },
  { label: 'Years of Experience', key: 'yearsOfExperience' },
  { label: 'Audition State Preference', key: 'auditionStatePreference' },
  { label: 'Short Bio', key: 'shortBio' },
  { label: 'Why You Want to Join Spotlight', key: 'whyJoin' },
  { label: 'Recent Photo URL', key: 'recentPhotoUrl' },
  { label: 'Audition Video Link', key: 'auditionVideoLink' },
  { label: 'Previous Performance Link', key: 'previousPerformanceLink', optional: true },
  { label: 'Portfolio Link', key: 'portfolioLink', optional: true },
];

const consentItems = [
  'I confirm the information provided is accurate',
  'I agree to Spotlight audition rules',
  'I agree to be contacted by Spotlight',
  'I agree to media usage terms if selected',
];

// Season 2 contest slug — update this when the slug is confirmed in the DB
const SEASON2_CONTEST_SLUG = 'spotlight-season-2';

export default function Season2ApplicationForm() {
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const statusText = useMemo(() => {
    if (submitState === 'loading') return 'Submitting...';
    if (submitState === 'success') return 'Application saved. We will contact you after screening.';
    if (submitState === 'error') return errorMessage || 'Submission failed. Please try again.';
    return 'Ready to submit';
  }, [submitState, errorMessage]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState('loading');
    setErrorMessage('');

    // Collect field values from the form via FormData
    const formData = new FormData(event.currentTarget);
    const accountData: Record<string, string> = {};
    for (const def of FIELD_DEFS) {
      const val = (formData.get(def.key) as string | null) ?? '';
      if (val.trim()) accountData[def.key] = val.trim();
    }

    try {
      const res = await fetch('/api/registration/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contestSlug: SEASON2_CONTEST_SLUG,
          role: 'contestant',
          accountData,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = (json as { error?: string; message?: string }).error
          ?? (json as { error?: string; message?: string }).message
          ?? `Server error (${res.status})`;
        setErrorMessage(msg);
        setSubmitState('error');
        return;
      }

      setSubmitState('success');
    } catch (err) {
      setErrorMessage('Network error — please check your connection and try again.');
      setSubmitState('error');
    }
  }

  return (
    <form
      className="mt-5 glass-card rounded-md p-6 grid grid-cols-1 md:grid-cols-2 gap-4"
      onSubmit={handleSubmit}
    >
      {FIELD_DEFS.map((def) => (
        <label key={def.key} className="text-sm text-foreground/80">
          {def.label}{def.optional ? ' (Optional)' : ''}
          <input
            className="form-input mt-2 w-full"
            type="text"
            name={def.key}
            placeholder={def.label}
            required={!def.optional}
            disabled={submitState === 'loading' || submitState === 'success'}
          />
        </label>
      ))}

      <div className="md:col-span-2 space-y-2 text-sm text-foreground/80">
        {consentItems.map((item) => (
          <label key={item} className="flex gap-2 items-start">
            <input
              type="checkbox"
              className="mt-1"
              required
              disabled={submitState === 'loading' || submitState === 'success'}
            />
            {item}
          </label>
        ))}
      </div>

      <div className="md:col-span-2 flex flex-wrap items-center gap-3 pt-2">
        {submitState !== 'success' && (
          <button
            type="submit"
            className="btn-primary text-xs py-3 px-6"
            disabled={submitState === 'loading'}
          >
            {submitState === 'loading' ? 'Submitting Application' : 'Submit Application'}
          </button>
        )}
        {submitState === 'success' && (
          <p className="text-sm text-green-400 font-medium">
            Your application has been received. We will be in touch after screening.
          </p>
        )}
      </div>

      <p
        className={[
          'md:col-span-2 text-xs',
          submitState === 'error' ? 'text-red-400' : 'text-foreground/60',
        ].join(' ')}
      >
        Status: {statusText}
      </p>
    </form>
  );
}
