'use client';

import { useEffect, useState } from 'react';

type School = {
  id: string;
  schoolName: string;
  state?: string;
  status: string;
};

export default function StemSchoolJoinRequestForm() {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    schoolId: '',
    fullName: '',
    email: '',
    phone: '',
    studentId: '',
    classLevel: '',
    department: '',
    mentorName: '',
    note: '',
  });

  useEffect(() => {
    let active = true;

    async function loadSchools() {
      setLoading(true);
      try {
        const res = await fetch('/api/stem/schools?status=verified', { cache: 'no-store' });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.success) {
          throw new Error(payload?.error || 'Failed to load schools');
        }
        if (!active) return;
        setSchools((payload.schools || []) as School[]);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to load schools.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadSchools();

    return () => {
      active = false;
    };
  }, []);

  function setField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch('/api/stem/school-join-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to submit join request');
      }

      setMessage('Join request sent. School admin review is now pending.');
      setForm({
        schoolId: '',
        fullName: '',
        email: '',
        phone: '',
        studentId: '',
        classLevel: '',
        department: '',
        mentorName: '',
        note: '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Join request failed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p>Loading verified schools...</p>;

  return (
    <div style={{ color: '#000' }}>
      <form className="contact-form-items" onSubmit={(e) => e.preventDefault()}>
        <div className="row g-4">
          <div className="col-lg-6">
            <div className="form-clt">
              <span>Verified School*</span>
              <select value={form.schoolId} onChange={(e) => setField('schoolId', e.target.value)}>
                <option value="">Select school</option>
                {schools.map((school) => (
                  <option value={school.id} key={school.id}>
                    {school.schoolName} ({school.state || 'N/A'})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="col-lg-6"><div className="form-clt"><span>Full Name*</span><input value={form.fullName} onChange={(e) => setField('fullName', e.target.value)} /></div></div>
          <div className="col-lg-6"><div className="form-clt"><span>Email</span><input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} /></div></div>
          <div className="col-lg-6"><div className="form-clt"><span>Phone</span><input value={form.phone} onChange={(e) => setField('phone', e.target.value)} /></div></div>
          <div className="col-lg-6"><div className="form-clt"><span>Student ID</span><input value={form.studentId} onChange={(e) => setField('studentId', e.target.value)} /></div></div>
          <div className="col-lg-6"><div className="form-clt"><span>Class / Level</span><input value={form.classLevel} onChange={(e) => setField('classLevel', e.target.value)} /></div></div>
          <div className="col-lg-6"><div className="form-clt"><span>Department</span><input value={form.department} onChange={(e) => setField('department', e.target.value)} /></div></div>
          <div className="col-lg-6"><div className="form-clt"><span>Teacher / Mentor Name</span><input value={form.mentorName} onChange={(e) => setField('mentorName', e.target.value)} /></div></div>
          <div className="col-lg-12"><div className="form-clt"><span>Note to School Admin</span><textarea value={form.note} onChange={(e) => setField('note', e.target.value)} /></div></div>
        </div>
      </form>

      <div className="mt-4">
        <button type="button" className="theme-btn" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Submitting...' : 'Send School Join Request'}
          <i className="fa-solid fa-arrow-right-long" />
        </button>
      </div>

      {error ? <p className="mt-3" style={{ color: '#B42318', fontWeight: 600 }}>{error}</p> : null}
      {message ? <p className="mt-3" style={{ color: '#166534', fontWeight: 600 }}>{message}</p> : null}
    </div>
  );
}
