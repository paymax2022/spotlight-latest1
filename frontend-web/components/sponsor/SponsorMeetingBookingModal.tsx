'use client';

import { FormEvent, ReactNode, useMemo, useState } from 'react';

type BookingStatus = 'idle' | 'success' | 'error';

type SponsorMeetingBookingModalProps = {
  children: ReactNode;
  className?: string;
};

const SECTORS = [
  'FMCG & Retail',
  'Food & Beverage',
  'Telecom & Digital',
  'Technology & Electronics',
  'Banking & Finance',
  'Insurance',
  'Oil & Energy',
  'Healthcare',
  'Education',
  'Media & Entertainment',
  'Automotive & Mobility',
  'Travel & Hospitality',
  'Real Estate & Property',
  'Fashion, Beauty & Personal Care',
  'NGOs & Public Sector',
  'Other',
];

const SPONSORSHIP_INTERESTS = [
  'Title Sponsor',
  'Platinum Sponsor',
  'Gold Sponsor',
  'Category Sponsor',
  'Activation Partner',
  'Media Partner',
  'Custom Sponsor Package',
];

const JOB_TITLES = [
  'Founder / CEO',
  'Managing Director',
  'Marketing Director',
  'Brand Manager',
  'Partnerships Manager',
  'Corporate Communications',
  'CSR / Sustainability Lead',
  'Business Development',
  'Media Buyer / Agency Lead',
  'Other',
];

const TIME_SLOTS = [
  '09:00',
  '09:30',
  '10:00',
  '10:30',
  '11:00',
  '11:30',
  '12:00',
  '13:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
];

const fieldClassName =
  'mt-2 w-full rounded-md border border-[#b8871f] bg-white px-4 py-3 text-[#050505] placeholder:text-[#5f5f5f] shadow-sm outline-none focus:border-[#064024] focus:ring-2 focus:ring-[#d5a13b]/35';

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function makeDefaultDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return formatDateInput(date);
}

function downloadIcs(ics: string) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'spotlight-sponsor-meeting.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function SponsorMeetingBookingModal({ children, className }: SponsorMeetingBookingModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<BookingStatus>('idle');
  const [message, setMessage] = useState('');
  const [calendarUrl, setCalendarUrl] = useState('');
  const [ics, setIcs] = useState('');

  const defaultDate = useMemo(() => makeDefaultDate(), []);

  function closeModal() {
    if (loading) return;
    setOpen(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus('idle');
    setMessage('');
    setCalendarUrl('');
    setIcs('');

    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const payload = {
        organization: String(formData.get('organization') || '').trim(),
        contactName: String(formData.get('contactName') || '').trim(),
        jobTitle: String(formData.get('jobTitle') || '').trim(),
        email: String(formData.get('email') || '').trim(),
        phone: String(formData.get('phone') || '').trim(),
        sector: String(formData.get('sector') || '').trim(),
        sponsorshipInterest: String(formData.get('sponsorshipInterest') || '').trim(),
        preferredDate: String(formData.get('preferredDate') || '').trim(),
        preferredTime: String(formData.get('preferredTime') || '').trim(),
        durationMinutes: Number(formData.get('durationMinutes') || 30),
        location: 'Virtual',
        objectives: String(formData.get('objectives') || '').trim(),
        consent: formData.get('consent') === 'on',
      };

      const response = await fetch('/api/sponsor-meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || 'Unable to submit meeting request.');
      }

      setStatus('success');
      setMessage(result.message || 'Meeting request submitted.');
      setCalendarUrl(result?.data?.googleCalendarUrl || '');
      setIcs(result?.data?.ics || '');
      form.reset();
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Unable to submit meeting request.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-black/65 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="sponsor-meeting-title">
          <div className="mx-auto max-w-3xl rounded-2xl border border-[#d5a13b]/45 bg-[#fbf5e9] text-[#102820] shadow-2xl">
            <div className="flex items-start justify-between gap-5 border-b border-[#e2cfad] px-5 py-4 md:px-7">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#b8871f]">Sponsor Meeting</p>
                <h2 id="sponsor-meeting-title" className="font-display text-3xl text-[#07371f]">Book a Partnership Meeting</h2>
                <p className="mt-1 text-sm text-[#3a3934]">Choose a virtual meeting slot and share your sponsorship goals.</p>
              </div>
              <button type="button" onClick={closeModal} className="rounded-full border border-[#d5a13b]/55 px-3 py-1.5 text-sm font-bold text-[#07371f]" aria-label="Close sponsor meeting modal">
                Close
              </button>
            </div>

            <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 px-5 py-5 md:grid-cols-2 md:px-7">
              <label className="text-sm font-semibold text-[#24362e]">
                Organization Name
                <input name="organization" required className={fieldClassName} />
              </label>

              <label className="text-sm font-semibold text-[#24362e]">
                Contact Person
                <input name="contactName" required className={fieldClassName} />
              </label>

              <label className="text-sm font-semibold text-[#24362e]">
                Job Title
                <select name="jobTitle" required defaultValue="" className={fieldClassName}>
                  <option value="" disabled>Select job title</option>
                  {JOB_TITLES.map((title) => (
                    <option key={title} value={title}>{title}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-semibold text-[#24362e]">
                Email Address
                <input name="email" type="email" required className={fieldClassName} />
              </label>

              <label className="text-sm font-semibold text-[#24362e]">
                Phone Number
                <input name="phone" type="tel" required className={fieldClassName} />
              </label>

              <label className="text-sm font-semibold text-[#24362e]">
                Sector
                <select name="sector" required defaultValue="" className={fieldClassName}>
                  <option value="" disabled>Select sector</option>
                  {SECTORS.map((sector) => (
                    <option key={sector} value={sector}>{sector}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-semibold text-[#24362e]">
                Sponsorship Interest
                <select name="sponsorshipInterest" required defaultValue="" className={fieldClassName}>
                  <option value="" disabled>Select interest</option>
                  {SPONSORSHIP_INTERESTS.map((interest) => (
                    <option key={interest} value={interest}>{interest}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-semibold text-[#24362e]">
                Preferred Date
                <input name="preferredDate" type="date" required min={defaultDate} defaultValue={defaultDate} className={fieldClassName} />
              </label>

              <label className="text-sm font-semibold text-[#24362e]">
                Preferred Time (WAT)
                <select name="preferredTime" required defaultValue="10:00" className={fieldClassName}>
                  {TIME_SLOTS.map((time) => (
                    <option key={time} value={time}>{time}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-semibold text-[#24362e]">
                Duration
                <select name="durationMinutes" defaultValue="30" className={fieldClassName}>
                  <option value="30">30 minutes</option>
                  <option value="45">45 minutes</option>
                  <option value="60">60 minutes</option>
                </select>
              </label>

              <label className="text-sm font-semibold text-[#24362e]">
                Meeting Location
                <input name="location" value="Virtual" readOnly className="mt-2 w-full rounded-md border border-[#b8871f] bg-[#f1eadb] px-4 py-3 text-[#050505] shadow-sm outline-none" />
              </label>

              <label className="md:col-span-2 text-sm font-semibold text-[#24362e]">
                Sponsorship Objectives
                <textarea name="objectives" required rows={4} className={fieldClassName} placeholder="Tell us what you want to achieve: visibility, sales activation, youth engagement, product trial, CSR, media reach..." />
              </label>

              <label className="md:col-span-2 flex items-start gap-2 text-xs text-[#3a3934]">
                <input type="checkbox" name="consent" required className="mt-0.5" />
                I consent to being contacted by Spotlight regarding this sponsor meeting request.
              </label>

              <div className="md:col-span-2 flex flex-col gap-3 border-t border-[#e2cfad] pt-4 sm:flex-row sm:items-center">
                <button type="submit" disabled={loading} className="inline-flex items-center justify-center rounded-md border-2 border-[#d5a13b] bg-[#064024] px-7 py-3.5 text-sm font-extrabold uppercase tracking-wide text-[#f3cf72] shadow-[0_12px_24px_rgba(6,64,36,0.28)] transition hover:bg-[#07371f] disabled:opacity-60">
                  {loading ? 'Booking...' : 'Submit Meeting Request'}
                </button>
                {status === 'success' ? <span className="text-sm font-semibold text-green-700">{message}</span> : null}
                {status === 'error' ? <span className="text-sm font-semibold text-red-700">{message}</span> : null}
              </div>

              {status === 'success' ? (
                <div className="md:col-span-2 flex flex-wrap gap-3 rounded-md border border-[#d5a13b]/40 bg-white/70 p-4">
                  {calendarUrl ? (
                    <a href={calendarUrl} target="_blank" rel="noreferrer" className="rounded-md border border-[#d5a13b] px-4 py-2 text-sm font-bold text-[#b07617]">
                      Add to Google Calendar
                    </a>
                  ) : null}
                  {ics ? (
                    <button type="button" onClick={() => downloadIcs(ics)} className="rounded-md border border-[#d5a13b] px-4 py-2 text-sm font-bold text-[#b07617]">
                      Download Calendar Invite
                    </button>
                  ) : null}
                </div>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
