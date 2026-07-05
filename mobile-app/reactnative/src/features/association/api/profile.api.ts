// ── Association — Member profile API wrapper (C) ──────────────────────────────

import { api } from '@/api/client';
import { USE_MOCK, ASSOCIATION_API_BASE as BASE } from '../constants/association.constants';
import type {
  MyProfile, ProfileEdit, PrivacySettings, ProfileCompletion, ActivityEntry,
} from '../types/profile.types';
import { MOCK_MY_PROFILE, MOCK_PRIVACY, MOCK_ACTIVITY } from './profile.mock';

const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// In mock mode we keep edits in-memory for the session so the UI reflects saves.
let current: MyProfile = { ...MOCK_MY_PROFILE };
let privacy: PrivacySettings = { ...MOCK_PRIVACY };

export async function getMyProfile(): Promise<MyProfile> {
  if (USE_MOCK) { await delay(); return current; }
  const { data } = await api.get(`${BASE}/me/profile`);
  return data;
}

export async function updateMyProfile(edit: ProfileEdit): Promise<MyProfile> {
  if (USE_MOCK) {
    await delay(400);
    current = { ...current, ...edit };
    return current;
  }
  const { data } = await api.put(`${BASE}/me/profile`, edit);
  return data;
}

export function computeCompletion(p: MyProfile, priv: PrivacySettings): ProfileCompletion {
  const items = [
    { key: 'photo', label: 'Add a profile photo', done: Boolean(p.photoUrl) },
    { key: 'phone', label: 'Add phone number', done: Boolean(p.phone) },
    { key: 'profession', label: 'Add your profession', done: Boolean(p.profession) },
    { key: 'bio', label: 'Write a short bio', done: p.bio.trim().length > 10 },
    { key: 'emergency', label: 'Add an emergency contact', done: Boolean(p.emergency.name && p.emergency.phone) },
    { key: 'nok', label: 'Add next of kin', done: Boolean(p.nextOfKin.name && p.nextOfKin.phone) },
    { key: 'privacy', label: 'Review privacy settings', done: priv.showInDirectory || !priv.showInDirectory ? true : false },
  ];
  const done = items.filter((i) => i.done).length;
  return { percent: Math.round((done / items.length) * 100), items };
}

export async function getPrivacy(): Promise<PrivacySettings> {
  if (USE_MOCK) { await delay(150); return privacy; }
  const { data } = await api.get(`${BASE}/me/privacy`);
  return data;
}

export async function updatePrivacy(next: PrivacySettings): Promise<PrivacySettings> {
  if (USE_MOCK) { await delay(200); privacy = { ...next }; return privacy; }
  const { data } = await api.put(`${BASE}/me/privacy`, next);
  return data;
}

export async function getActivity(): Promise<ActivityEntry[]> {
  if (USE_MOCK) { await delay(); return MOCK_ACTIVITY; }
  const { data } = await api.get(`${BASE}/me/activity`);
  return data;
}
