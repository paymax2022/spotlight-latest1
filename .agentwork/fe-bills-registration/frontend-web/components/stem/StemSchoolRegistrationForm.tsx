'use client';

import { useState } from 'react';

export default function StemSchoolRegistrationForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [form, setForm] = useState({
    schoolName: '',
    schoolType: 'Secondary school',
    state: '',
    city: '',
    officialEmail: '',
    officialPhone: '',
    schoolDescription: '',
    adminFullName: '',
    adminDesignation: 'School Admin',
    adminEmail: '',
    adminPhone: '',
    adminWhatsapp: '',
  });

  function setField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch('/api/stem/schools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolName: form.schoolName,
          schoolType: form.schoolType,
          state: form.state,
          city: form.city,
          officialEmail: form.officialEmail,
          officialPhone: form.officialPhone,
          schoolDescription: form.schoolDescription,
          adminContact: {
            fullName: form.adminFullName,
            designation: form.adminDesignation,
            email: form.adminEmail,
            phone: form.adminPhone,
            whatsapp: form.adminWhatsapp,
            preferredContactMethod: 'email',
          },
          verificationDocuments: [],
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'School registration failed.');
      }

      setMessage('School registration submitted. Spotlight admin will review and verify your school.');
      setForm({
        schoolName: '',
        schoolType: 'Secondary school',
        state: '',
        city: '',
        officialEmail: '',
        officialPhone: '',
        schoolDescription: '',
        adminFullName: '',
        adminDesignation: 'School Admin',
        adminEmail: '',
        adminPhone: '',
        adminWhatsapp: '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit school registration.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ color: '#000' }}>
      <form className="contact-form-items" onSubmit={(e) => e.preventDefault()}>
        <div className="row g-4">
          <div className="col-lg-6"><div className="form-clt"><span>School Name*</span><input value={form.schoolName} onChange={(e) => setField('schoolName', e.target.value)} /></div></div>
          <div className="col-lg-6"><div className="form-clt"><span>School Type*</span><input value={form.schoolType} onChange={(e) => setField('schoolType', e.target.value)} /></div></div>
          <div className="col-lg-6"><div className="form-clt"><span>State*</span><input value={form.state} onChange={(e) => setField('state', e.target.value)} /></div></div>
          <div className="col-lg-6"><div className="form-clt"><span>City*</span><input value={form.city} onChange={(e) => setField('city', e.target.value)} /></div></div>
          <div className="col-lg-6"><div className="form-clt"><span>Official School Email</span><input type="email" value={form.officialEmail} onChange={(e) => setField('officialEmail', e.target.value)} /></div></div>
          <div className="col-lg-6"><div className="form-clt"><span>Official School Phone</span><input value={form.officialPhone} onChange={(e) => setField('officialPhone', e.target.value)} /></div></div>
          <div className="col-lg-12"><div className="form-clt"><span>School Description</span><textarea value={form.schoolDescription} onChange={(e) => setField('schoolDescription', e.target.value)} /></div></div>

          <div className="col-lg-6"><div className="form-clt"><span>School Admin Full Name*</span><input value={form.adminFullName} onChange={(e) => setField('adminFullName', e.target.value)} /></div></div>
          <div className="col-lg-6"><div className="form-clt"><span>Designation</span><input value={form.adminDesignation} onChange={(e) => setField('adminDesignation', e.target.value)} /></div></div>
          <div className="col-lg-6"><div className="form-clt"><span>Admin Email*</span><input type="email" value={form.adminEmail} onChange={(e) => setField('adminEmail', e.target.value)} /></div></div>
          <div className="col-lg-6"><div className="form-clt"><span>Admin Phone*</span><input value={form.adminPhone} onChange={(e) => setField('adminPhone', e.target.value)} /></div></div>
          <div className="col-lg-6"><div className="form-clt"><span>Admin WhatsApp</span><input value={form.adminWhatsapp} onChange={(e) => setField('adminWhatsapp', e.target.value)} /></div></div>
        </div>
      </form>

      <div className="mt-4">
        <button type="button" className="theme-btn" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Submitting...' : 'Submit School Registration'}
          <i className="fa-solid fa-arrow-right-long" />
        </button>
      </div>

      {error ? <p className="mt-3" style={{ color: '#B42318', fontWeight: 600 }}>{error}</p> : null}
      {message ? <p className="mt-3" style={{ color: '#166534', fontWeight: 600 }}>{message}</p> : null}
    </div>
  );
}
