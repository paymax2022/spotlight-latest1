'use client';

import { useMemo, useState } from 'react';

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

const fields = [
  'Full Name',
  'Stage Name / Brand Name (Optional)',
  'Date of Birth',
  'Gender',
  'Phone Number / WhatsApp',
  'Email Address',
  'State of Residence',
  'State of Origin',
  'Current City',
  'Social Media Handles',
  'Application Category',
  'Talent Description',
  'Years of Experience',
  'Audition State Preference',
  'Short Bio',
  'Why You Want to Join Spotlight',
  'Recent Photo URL',
  'Audition Video Link',
  'Previous Performance Link (Optional)',
  'Portfolio Link (Optional)',
];

const consentItems = [
  'I confirm the information provided is accurate',
  'I agree to Spotlight audition rules',
  'I agree to be contacted by Spotlight',
  'I agree to media usage terms if selected',
];

export default function Season2ApplicationForm() {
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [simulateError, setSimulateError] = useState(false);

  const statusText = useMemo(() => {
    if (submitState === 'loading') return 'Submitting...';
    if (submitState === 'success') return 'Application saved. We will contact you after screening.';
    if (submitState === 'error') return 'Submission failed. Please try again.';
    return 'Ready to submit';
  }, [submitState]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState('loading');

    // TODO: Replace this simulation with real API integration when endpoint is finalized.
    await new Promise((resolve) => setTimeout(resolve, 900));

    if (simulateError) {
      setSubmitState('error');
      return;
    }

    setSubmitState('success');
  }

  return (
    <form className="mt-5 glass-card rounded-md p-6 grid grid-cols-1 md:grid-cols-2 gap-4" onSubmit={handleSubmit}>
      {fields.map((field) => (
        <label key={field} className="text-sm text-foreground/80">
          {field}
          <input className="form-input mt-2 w-full" type="text" placeholder={field} required={!field.includes('Optional')} />
        </label>
      ))}
      <div className="md:col-span-2 space-y-2 text-sm text-foreground/80">
        {consentItems.map((item) => (
          <label key={item} className="flex gap-2 items-start">
            <input type="checkbox" className="mt-1" required />
            {item}
          </label>
        ))}
      </div>
      <div className="md:col-span-2 flex flex-wrap items-center gap-3 pt-2">
        <button type="submit" className="btn-primary text-xs py-3 px-6" disabled={submitState === 'loading'}>
          {submitState === 'loading' ? 'Submitting Application' : 'Submit Application'}
        </button>
        <label className="text-xs text-foreground/65 flex items-center gap-2">
          <input type="checkbox" checked={simulateError} onChange={(e) => setSimulateError(e.target.checked)} />
          Simulate error state
        </label>
      </div>
      <p className="md:col-span-2 text-xs text-foreground/60">Status: {statusText}</p>
      <p className="md:col-span-2 text-xs text-foreground/50">Integration mode: frontend only. Backend endpoint TODO.</p>
    </form>
  );
}
