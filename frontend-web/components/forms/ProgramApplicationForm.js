'use client';

import { useMemo, useState } from 'react';

function programToFormTypeValue(formType) {
  return formType || 'serviceInquiry';
}

export default function ProgramApplicationForm({ program, config }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  const fields = useMemo(() => config?.fields || [], [config]);

  if (!program || !config) {
    return null;
  }

  async function onSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setStatus('idle');
    setMessage('');

    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const consent = formData.get('consent') === 'on';
      const payloadFields = {};

      fields.forEach((field) => {
        payloadFields[field.name] = formData.get(field.name);
      });

      const response = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceName: program.title,
          formType: programToFormTypeValue(config.formType),
          consent,
          fields: payloadFields,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || 'Submission failed');
      }

      setStatus('success');
      setMessage(result?.message || 'Application submitted successfully.');
      form.reset();
    } catch (error) {
      setStatus('error');
      setMessage(error?.message || 'Submission failed. Please retry.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="contact-content">
      <h3>{config.heading}</h3>
      <p>{config.helperText}</p>
      <form onSubmit={onSubmit} className="contact-form-items">
        <div className="row g-4">
          {fields.map((field) => {
            const isTextarea = field.type === 'textarea';
            const isSelect = field.type === 'select';

            return (
              <div className={isTextarea ? 'col-lg-12' : 'col-lg-6'} key={field.name}>
                <div className="form-clt">
                  <span>{field.label}{field.required ? '*' : ''}</span>
                  {isTextarea ? (
                    <textarea
                      name={field.name}
                      placeholder={field.placeholder || field.label}
                      required={Boolean(field.required)}
                    />
                  ) : isSelect ? (
                    <select name={field.name} required={Boolean(field.required)}>
                      <option value="">Select an option</option>
                      {(field.options || []).map((option) => (
                        <option value={option} key={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type || 'text'}
                      name={field.name}
                      placeholder={field.placeholder || field.label}
                      required={Boolean(field.required)}
                    />
                  )}
                </div>
              </div>
            );
          })}

          <div className="col-lg-12">
            <label className="d-flex align-items-start gap-2">
              <input type="checkbox" name="consent" required style={{ marginTop: '5px' }} />
              <span>
                I consent to being contacted by Spotlight regarding my application for {program.title}.
              </span>
            </label>
          </div>

          <div className="col-lg-12">
            <button type="submit" className="theme-btn" disabled={loading}>
              {loading ? 'Submitting...' : 'Submit Application'}
              <i className="fa-solid fa-arrow-right-long" />
            </button>
          </div>

          {status === 'success' && (
            <div className="col-lg-12">
              <p style={{ color: '#2da44e', fontWeight: 600, marginBottom: 0 }}>{message}</p>
            </div>
          )}
          {status === 'error' && (
            <div className="col-lg-12">
              <p style={{ color: '#d1242f', fontWeight: 600, marginBottom: 0 }}>{message}</p>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
