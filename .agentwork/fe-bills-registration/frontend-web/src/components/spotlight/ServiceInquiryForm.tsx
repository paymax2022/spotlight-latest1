'use client';

import { useState } from 'react';
import type { ServiceFormType } from '@/src/data/services';

type Field = {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'select';
  required?: boolean;
  options?: string[];
};

const fieldsByForm: Record<ServiceFormType, Field[]> = {
  talentRegistration: [
    { name: 'fullName', label: 'Full name', required: true },
    { name: 'stageName', label: 'Stage name' },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone number', type: 'tel', required: true },
    { name: 'location', label: 'State / Location', required: true },
    { name: 'category', label: 'Talent category', type: 'select', options: ['Music', 'Acting', 'Comedy', 'Dance', 'Content Creation', 'Other'], required: true },
    { name: 'portfolio', label: 'Audition video or portfolio link', type: 'url' },
    { name: 'bio', label: 'Short bio', type: 'textarea', required: true },
  ],
  sponsorInquiry: [
    { name: 'organization', label: 'Organization name', required: true },
    { name: 'contactPerson', label: 'Contact person', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone', type: 'tel', required: true },
    { name: 'interest', label: 'Sponsorship interest', required: true },
    { name: 'budget', label: 'Budget range', required: true },
    { name: 'message', label: 'Partnership objective', type: 'textarea', required: true },
  ],
  governmentPartnership: [
    { name: 'institution', label: 'Ministry / Agency / Organization', required: true },
    { name: 'contactPerson', label: 'Contact person', required: true },
    { name: 'email', label: 'Official email', type: 'email', required: true },
    { name: 'phone', label: 'Phone', type: 'tel', required: true },
    { name: 'mandate', label: 'Mandate area', required: true },
    { name: 'beneficiaries', label: 'Target beneficiaries', required: true },
    { name: 'message', label: 'Program interest', type: 'textarea', required: true },
  ],
  mediaPartnership: [
    { name: 'organization', label: 'Media organization', required: true },
    { name: 'platform', label: 'Platform type', required: true },
    { name: 'contactPerson', label: 'Contact person', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone', type: 'tel', required: true },
    { name: 'model', label: 'Partnership model', required: true },
    { name: 'message', label: 'Broadcast interest', type: 'textarea', required: true },
  ],
  schoolProgram: [
    { name: 'schoolName', label: 'School name', required: true },
    { name: 'contactPerson', label: 'Contact person', required: true },
    { name: 'schoolType', label: 'School type', required: true },
    { name: 'location', label: 'Location', required: true },
    { name: 'studentCount', label: 'Number of students', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'message', label: 'Program interest', type: 'textarea', required: true },
  ],
  productionRequest: [
    { name: 'clientName', label: 'Client / Institution name', required: true },
    { name: 'projectType', label: 'Production type', required: true },
    { name: 'objective', label: 'Project objective', type: 'textarea', required: true },
    { name: 'timeline', label: 'Timeline', required: true },
    { name: 'budget', label: 'Budget range', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone', type: 'tel', required: true },
  ],
  contestRegistration: [
    { name: 'name', label: 'Applicant / Team name', required: true },
    { name: 'category', label: 'Category', required: true },
    { name: 'projectTitle', label: 'Project / Submission title', required: true },
    { name: 'description', label: 'Short description', type: 'textarea', required: true },
    { name: 'portfolio', label: 'Pitch or media link', type: 'url' },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone', type: 'tel', required: true },
  ],
  serviceInquiry: [
    { name: 'organization', label: 'Organization', required: true },
    { name: 'contactPerson', label: 'Contact person', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone', type: 'tel', required: true },
    { name: 'need', label: 'Service need', type: 'textarea', required: true },
  ],
};

export default function ServiceInquiryForm({ formType, serviceName }: { formType: ServiceFormType; serviceName: string }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');
  const fields = fieldsByForm[formType];

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setStatus('idle');
    setMessage('');

    try {
      const form = e.currentTarget;
      const formData = new FormData(form);
      const consent = formData.get('consent') === 'on';
      const payloadFields: Record<string, unknown> = {};

      fields.forEach((field) => {
        payloadFields[field.name] = formData.get(field.name);
      });

      const response = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceName,
          formType,
          consent,
          fields: payloadFields,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || 'Submission failed');
      }

      setStatus('success');
      setMessage(result?.message || 'Request submitted successfully.');
      form.reset();
    } catch {
      setStatus('error');
      setMessage('Submission failed. Please retry.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-card p-6 md:p-8 rounded-md">
      <h3 className="font-display text-2xl text-foreground">Apply / Partner Request</h3>
      <p className="text-sm text-foreground/60 mt-2">
        Submit your details for {serviceName}. Our team will respond with next steps.
      </p>

      <form className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4" onSubmit={onSubmit}>
        {fields.map((field) => {
          const base = 'form-input px-4 py-3 rounded-sm';
          if (field.type === 'textarea') {
            return (
              <label key={field.name} className="md:col-span-2 text-sm text-foreground/80">
                {field.label}
                <textarea name={field.name} required={field.required} className={`${base} mt-2 min-h-[110px]`} />
              </label>
            );
          }

          if (field.type === 'select') {
            return (
              <label key={field.name} className="text-sm text-foreground/80">
                {field.label}
                <select name={field.name} required={field.required} className={`${base} mt-2 w-full bg-bg-card`}>
                  <option value="">Select</option>
                  {(field.options || []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            );
          }

          return (
            <label key={field.name} className="text-sm text-foreground/80">
              {field.label}
              <input name={field.name} type={field.type || 'text'} required={field.required} className={`${base} mt-2 w-full`} />
            </label>
          );
        })}

        <label className="md:col-span-2 text-xs text-foreground/60 flex items-start gap-2 mt-1">
          <input type="checkbox" name="consent" required className="mt-0.5" />
          I consent to being contacted by Spotlight regarding this request.
        </label>

        <div className="md:col-span-2 flex items-center gap-3 pt-2">
          <button type="submit" disabled={loading} className="btn-primary text-xs py-3 px-6">
            {loading ? 'Submitting...' : 'Submit Request'}
          </button>
          {status === 'success' && <span className="text-sm text-green-400">{message}</span>}
          {status === 'error' && <span className="text-sm text-red-400">{message}</span>}
        </div>
      </form>
    </div>
  );
}
