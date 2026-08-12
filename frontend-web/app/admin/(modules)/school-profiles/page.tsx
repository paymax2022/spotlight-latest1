'use client';

import { useEffect, useState } from 'react';
import { createStemSchoolProfile, listStemSchoolProfiles } from '@/services/stemService';
import type { StemSchoolProfile } from '@/types/stem';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader title="School Profiles" subtitle="School-linked user profiles for admins, coaches, and students." />
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input placeholder="School ID" value={schoolId} onChange={(e) => setSchoolId(e.target.value)} />
          <select value={roleType} onChange={(e) => setRoleType(e.target.value)}>
            <option value="SCHOOL_ADMIN">SCHOOL_ADMIN</option>
            <option value="TEACHER_COACH">TEACHER_COACH</option>
            <option value="STUDENT_CONTESTANT">STUDENT_CONTESTANT</option>
          </select>
          <Input placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <Button variant="primary" onClick={() => void onCreate()}>Create Profile</Button>
        </div>
      </Card>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((row) => (
          <Card key={row.id || `${row.schoolId}-${row.fullName}`} style={{ padding: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{row.fullName}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: colors.muted }}>Role: {row.roleType} · School ID: {row.schoolId}</p>
          </Card>
        ))}
        {rows.length === 0 ? <p style={{ color: colors.muted }}>No school profiles found yet.</p> : null}
      </div>
    </Page>
  );
}
