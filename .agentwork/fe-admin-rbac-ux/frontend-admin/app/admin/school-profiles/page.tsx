'use client';

import { useEffect, useState } from 'react';
import { createStemSchoolProfile, listStemSchoolProfiles } from '@/services/stemService';
import type { StemSchoolProfile } from '@/types/stem';

export default function AdminSchoolProfilesPage() {
  const [rows, setRows] = useState<StemSchoolProfile[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [roleType, setRoleType] = useState('SCHOOL_ADMIN');
  const [fullName, setFullName] = useState('');

  async function load() {
    setRows(await listStemSchoolProfiles(200));
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate() {
    if (!schoolId.trim() || !roleType.trim() || !fullName.trim()) return;
    const created = await createStemSchoolProfile({
      schoolId: schoolId.trim(),
      roleType: roleType.trim(),
      fullName: fullName.trim(),
    });
    if (created) {
      setSchoolId('');
      setFullName('');
      await load();
    }
  }

  return (
    <section>
      <h1>School Profiles</h1>
      <p>School-linked user profiles for admins, coaches, and students.</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <input placeholder="School ID" value={schoolId} onChange={(e) => setSchoolId(e.target.value)} />
        <select value={roleType} onChange={(e) => setRoleType(e.target.value)}>
          <option value="SCHOOL_ADMIN">SCHOOL_ADMIN</option>
          <option value="TEACHER_COACH">TEACHER_COACH</option>
          <option value="STUDENT_CONTESTANT">STUDENT_CONTESTANT</option>
        </select>
        <input placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <button type="button" onClick={() => void onCreate()}>Create Profile</button>
      </div>
      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {rows.map((row) => (
          <article key={row.id || `${row.schoolId}-${row.fullName}`} style={{ border: '1px solid #2a2a2a', padding: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{row.fullName}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>Role: {row.roleType} · School ID: {row.schoolId}</p>
          </article>
        ))}
        {rows.length === 0 ? <p>No school profiles found yet.</p> : null}
      </div>
    </section>
  );
}
