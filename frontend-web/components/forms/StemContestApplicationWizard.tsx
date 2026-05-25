'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { StemContest, StemSchool } from '@/src/features/stem/types';

type WizardProps = {
  contestSlug: string;
};

export default function StemContestApplicationWizard({ contestSlug }: WizardProps) {
  const [loading, setLoading] = useState(true);
  const [contest, setContest] = useState<StemContest | null>(null);
  const [schools, setSchools] = useState<StemSchool[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [applicationId, setApplicationId] = useState<string>('');
  const [applicationReference, setApplicationReference] = useState<string>('');
  const [applicationStatus, setApplicationStatus] = useState<string>('');
  const [timeline, setTimeline] = useState<Array<{ id: string; newStatus: string; note?: string; createdAt: string }>>([]);

  const [startData, setStartData] = useState({
    track: 'school_student',
    applicantType: 'student',
    applicantName: '',
    applicantEmail: '',
    applicantPhone: '',
    schoolId: '',
  });

  const [formData, setFormData] = useState<Record<string, unknown>>({
    'consent.accuracyDeclaration': false,
    'consent.terms': false,
    'consent.dataPrivacy': false,
  });

  const [projectData, setProjectData] = useState<Record<string, unknown>>({});
  const [currentStep, setCurrentStep] = useState<'start' | 'project' | 'review'>('start');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      setLoading(true);
      setError('');
      try {
        const [contestRes, schoolsRes] = await Promise.all([
          fetch(`/api/stem/contests/${contestSlug}`, { cache: 'no-store' }),
          fetch('/api/stem/schools?status=verified', { cache: 'no-store' }),
        ]);

        const contestPayload = await contestRes.json().catch(() => ({}));
        const schoolsPayload = await schoolsRes.json().catch(() => ({}));

        if (!contestRes.ok || !contestPayload?.success || !contestPayload?.contest) {
          throw new Error(contestPayload?.error || 'Unable to load STEM contest.');
        }

        if (!active) return;

        setContest(contestPayload.contest as StemContest);
        setSchools(Array.isArray(schoolsPayload?.schools) ? (schoolsPayload.schools as StemSchool[]) : []);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load STEM application resources.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [contestSlug]);

  const requiresSchool = useMemo(() => {
    return startData.applicantType === 'student' || startData.track === 'school_student';
  }, [startData.applicantType, startData.track]);

  function setStartField(key: keyof typeof startData, value: string) {
    setStartData((prev) => ({ ...prev, [key]: value }));
  }

  function setProjectField(key: string, value: unknown) {
    setProjectData((prev) => ({ ...prev, [key]: value }));
  }

  function setFormField(key: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  async function refreshTimeline(appId: string) {
    const res = await fetch(`/api/stem/applications/${appId}/status`, { cache: 'no-store' });
    const payload = await res.json().catch(() => ({}));
    if (res.ok && payload?.success && Array.isArray(payload?.timeline)) {
      setTimeline(payload.timeline);
    }
  }

  async function startApplication() {
    if (!contest) return;

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch('/api/stem/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contestSlug: contest.slug,
          track: startData.track,
          applicantType: startData.applicantType,
          schoolId: requiresSchool ? startData.schoolId || undefined : undefined,
          applicantName: startData.applicantName,
          applicantEmail: startData.applicantEmail,
          applicantPhone: startData.applicantPhone,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success || !payload?.application?.id) {
        const reason = payload?.errors
          ? Object.values(payload.errors as Record<string, string>).join(' ')
          : payload?.error || 'Unable to start application.';
        throw new Error(reason);
      }

      setApplicationId(payload.application.id as string);
      setApplicationReference(String(payload.application.reference || ''));
      setApplicationStatus(String(payload.application.status || 'draft'));
      setCurrentStep('project');
      setMessage('Application draft created. Complete your project details below.');
      await refreshTimeline(payload.application.id as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start STEM application.');
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!applicationId) return;

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch(`/api/stem/applications/${applicationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: applicationStatus || 'draft',
          formData,
          projectData,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success || !payload?.application) {
        throw new Error(payload?.error || 'Unable to save draft.');
      }

      setApplicationStatus(String(payload.application.status || 'draft'));
      setMessage('Draft saved successfully.');
      await refreshTimeline(applicationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft.');
    } finally {
      setBusy(false);
    }
  }

  async function submitApplication() {
    if (!applicationId) return;

    setBusy(true);
    setError('');
    setMessage('');

    try {
      await saveDraft();
      const res = await fetch(`/api/stem/applications/${applicationId}/submit`, { method: 'POST' });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok || !payload?.success || !payload?.application) {
        const reason = payload?.errors
          ? Object.values(payload.errors as Record<string, string>).join(' ')
          : payload?.error || 'Unable to submit application.';
        throw new Error(reason);
      }

      setApplicationStatus(String(payload.application.status || 'submitted'));
      setCurrentStep('review');
      setMessage('Application submitted successfully.');
      await refreshTimeline(applicationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit application.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p>Loading STEM contest registration...</p>;
  }

  if (!contest) {
    return <p>STEM contest not found.</p>;
  }

  return (
    <div style={{ color: '#000' }}>
      <div className="section-title">
        <span>STEM CONTEST REGISTRATION</span>
        <h2>{contest.title}</h2>
      </div>

      <p className="mt-3">{contest.description}</p>
      <div className="mt-3 d-flex flex-wrap gap-2">
        <Link href="/stem/schools/register" className="theme-btn">
          Register School
          <i className="fa-solid fa-arrow-right-long" />
        </Link>
        <Link href="/stem/schools/join" className="theme-btn">
          Student School Join Request
          <i className="fa-solid fa-arrow-right-long" />
        </Link>
      </div>

      {applicationReference ? (
        <div className="mt-3" style={{ padding: 12, border: '1px solid #d7dee8', borderRadius: 10, background: '#fff' }}>
          <div><strong>Reference:</strong> {applicationReference}</div>
          <div><strong>Status:</strong> {applicationStatus.replaceAll('_', ' ')}</div>
        </div>
      ) : null}

      {currentStep === 'start' ? (
        <form className="contact-form-items mt-4" onSubmit={(e) => e.preventDefault()}>
          <div className="row g-4">
            <div className="col-lg-6">
              <div className="form-clt">
                <span>Participation Track*</span>
                <select value={startData.track} onChange={(e) => setStartField('track', e.target.value)}>
                  {(contest.tracksAllowed || []).map((track) => (
                    <option value={track} key={track}>{track.replaceAll('_', ' ')}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="col-lg-6">
              <div className="form-clt">
                <span>Applicant Type*</span>
                <select value={startData.applicantType} onChange={(e) => setStartField('applicantType', e.target.value)}>
                  <option value="student">Student</option>
                  <option value="independent_innovator">Independent Innovator</option>
                  <option value="team_lead">Team Lead</option>
                  <option value="school_admin">School Admin</option>
                </select>
              </div>
            </div>

            <div className="col-lg-6"><div className="form-clt"><span>Full Name*</span><input value={startData.applicantName} onChange={(e) => setStartField('applicantName', e.target.value)} /></div></div>
            <div className="col-lg-6"><div className="form-clt"><span>Email*</span><input type="email" value={startData.applicantEmail} onChange={(e) => setStartField('applicantEmail', e.target.value)} /></div></div>
            <div className="col-lg-6"><div className="form-clt"><span>Phone*</span><input value={startData.applicantPhone} onChange={(e) => setStartField('applicantPhone', e.target.value)} /></div></div>

            {requiresSchool ? (
              <div className="col-lg-6">
                <div className="form-clt">
                  <span>School*</span>
                  <select value={startData.schoolId} onChange={(e) => setStartField('schoolId', e.target.value)}>
                    <option value="">Select Verified School</option>
                    {schools.map((school) => (
                      <option value={school.id} key={school.id}>
                        {school.schoolName} ({school.state || 'N/A'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-4">
            <button className="theme-btn" type="button" onClick={() => void startApplication()} disabled={busy}>
              {busy ? 'Starting...' : 'Start STEM Application'}
              <i className="fa-solid fa-arrow-right-long" />
            </button>
          </div>
        </form>
      ) : null}

      {currentStep !== 'start' ? (
        <>
          <form className="contact-form-items mt-4" onSubmit={(e) => e.preventDefault()}>
            <div className="row g-4">
              {(contest.requiredProjectFields || []).map((field) => {
                const val = projectData[field.key];
                const full = field.type === 'textarea' || field.type === 'file' || field.type === 'multi_select';
                return (
                  <div className={full ? 'col-lg-12' : 'col-lg-6'} key={field.key}>
                    <div className="form-clt">
                      <span>{field.label}{field.required ? '*' : ''}</span>

                      {field.type === 'textarea' ? (
                        <textarea
                          value={typeof val === 'string' ? val : ''}
                          onChange={(e) => setProjectField(field.key, e.target.value)}
                          placeholder={field.placeholder || field.label}
                        />
                      ) : field.type === 'select' ? (
                        <select
                          value={typeof val === 'string' ? val : ''}
                          onChange={(e) => setProjectField(field.key, e.target.value)}
                        >
                          <option value="">Select an option</option>
                          {(field.options || []).map((option) => (
                            <option value={option} key={option}>{option}</option>
                          ))}
                        </select>
                      ) : field.type === 'checkbox' ? (
                        <label className="d-flex gap-2">
                          <input
                            type="checkbox"
                            checked={val === true}
                            onChange={(e) => setProjectField(field.key, e.target.checked)}
                          />
                          <span>{field.helpText || field.label}</span>
                        </label>
                      ) : (
                        <input
                          type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text'}
                          value={typeof val === 'string' || typeof val === 'number' ? String(val) : ''}
                          onChange={(e) => setProjectField(field.key, e.target.value)}
                          placeholder={field.placeholder || field.label}
                        />
                      )}

                      {field.helpText ? <small>{field.helpText}</small> : null}
                    </div>
                  </div>
                );
              })}

              <div className="col-lg-12">
                <div className="form-clt">
                  <span>Required Consents*</span>
                  <label className="d-flex gap-2 mt-1">
                    <input
                      type="checkbox"
                      checked={formData['consent.accuracyDeclaration'] === true}
                      onChange={(e) => setFormField('consent.accuracyDeclaration', e.target.checked)}
                    />
                    <span>I confirm all submitted information is accurate.</span>
                  </label>
                  <label className="d-flex gap-2 mt-1">
                    <input
                      type="checkbox"
                      checked={formData['consent.terms'] === true}
                      onChange={(e) => setFormField('consent.terms', e.target.checked)}
                    />
                    <span>I agree to contest terms and conditions.</span>
                  </label>
                  <label className="d-flex gap-2 mt-1">
                    <input
                      type="checkbox"
                      checked={formData['consent.dataPrivacy'] === true}
                      onChange={(e) => setFormField('consent.dataPrivacy', e.target.checked)}
                    />
                    <span>I consent to data processing for programme administration.</span>
                  </label>
                </div>
              </div>
            </div>
          </form>

          <div className="mt-4 d-flex flex-wrap gap-2">
            <button type="button" className="theme-btn" onClick={() => void saveDraft()} disabled={busy}>
              {busy ? 'Saving...' : 'Save Draft'}
              <i className="fa-solid fa-arrow-right-long" />
            </button>
            <button type="button" className="theme-btn" onClick={() => void submitApplication()} disabled={busy}>
              {busy ? 'Submitting...' : 'Submit STEM Application'}
              <i className="fa-solid fa-arrow-right-long" />
            </button>
          </div>
        </>
      ) : null}

      {error ? <p className="mt-3" style={{ color: '#B42318', fontWeight: 600 }}>{error}</p> : null}
      {message ? <p className="mt-3" style={{ color: '#166534', fontWeight: 600 }}>{message}</p> : null}

      <div className="mt-5">
        <h4>Application Timeline</h4>
        {timeline.length === 0 ? (
          <p>No timeline entries yet.</p>
        ) : (
          <ul>
            {timeline
              .slice()
              .reverse()
              .map((item) => (
                <li key={item.id} style={{ marginBottom: 8 }}>
                  <strong>{item.newStatus.replaceAll('_', ' ')}</strong> • {new Date(item.createdAt).toLocaleString()}
                  {item.note ? <div>{item.note}</div> : null}
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
