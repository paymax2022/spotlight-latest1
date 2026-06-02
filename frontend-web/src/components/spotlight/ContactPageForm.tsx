'use client';

import { FormEvent, useState } from 'react';

type SubmitStatus = 'idle' | 'success' | 'error';

const REQUEST_TYPES = [
  'Sponsorship',
  'Media Request',
  'Talent Support',
  'Institutional Partnership',
  'General Inquiry',
  'Other',
] as const;

export default function ContactPageForm() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [message, setMessage] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus('idle');
    setMessage('');

    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const fullName = String(formData.get('fullName') || '').trim();
      const email = String(formData.get('email') || '').trim();
      const requestType = String(formData.get('requestType') || '').trim();
      const content = String(formData.get('message') || '').trim();
      const consent = formData.get('consent') === 'on';

      if (!fullName || !email || !requestType || !content) {
        throw new Error('Please complete all required fields.');
      }

      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          requestType,
          message: content,
          consent,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || 'Failed to send your message.');
      }

      setStatus('success');
      setMessage('Your message has been sent. Our team will get back to you shortly.');
      form.reset();
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Failed to send your message.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="glass-card rounded-md p-6 grid grid-cols-1 gap-4" action="#" onSubmit={onSubmit}>
      <h2 className="font-display text-2xl text-foreground">Send a Message</h2>

      <input type="text" name="fullName" className="form-input" placeholder="Full Name" required />
      <input type="email" name="email" className="form-input" placeholder="Email Address" required />

      <select name="requestType" className="form-input" required defaultValue="">
        <option value="" disabled>
          Select Request Type
        </option>
        {REQUEST_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>

      <textarea name="message" className="form-input" placeholder="Message" rows={5} required />

      <label className="text-xs text-foreground/60 flex items-start gap-2">
        <input type="checkbox" name="consent" required className="mt-0.5" />
        I consent to being contacted by Spotlight regarding this request.
      </label>

      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary text-xs py-3 px-6" disabled={loading}>
          {loading ? 'Sending...' : 'Send Message'}
        </button>
        {status === 'success' ? <span className="text-sm text-green-600">{message}</span> : null}
        {status === 'error' ? <span className="text-sm text-red-600">{message}</span> : null}
      </div>
    </form>
  );
}
