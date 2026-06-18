import axios from 'axios';
export const meetingsApi = axios.create({ baseURL: process.env.EXPO_PUBLIC_API_URL + '/api' });
// Meeting types
export interface Meeting { id: string; title: string; agenda?: string; date: string; time: string; location?: string; type: 'physical'|'virtual'|'hybrid'; status: 'upcoming'|'ongoing'|'completed'|'cancelled'; attendee_count: number; rsvp_status?: 'yes'|'no'|'maybe'; minutes_url?: string; }
export interface MeetingAction { id: string; meeting_id: string; task: string; assignee: string; due_date: string; status: 'open'|'done'; }
export const listMeetings = (estateId: string, filter?: string) => meetingsApi.get(`/estates/${estateId}/meetings`, { params: { filter } }).then(r => r.data as Meeting[]);
export const getMeeting = (estateId: string, id: string) => meetingsApi.get(`/estates/${estateId}/meetings/${id}`).then(r => r.data as Meeting);
export const createMeeting = (estateId: string, body: Partial<Meeting>) => meetingsApi.post(`/estates/${estateId}/meetings`, body).then(r => r.data as Meeting);
export const rsvpMeeting = (estateId: string, id: string, status: string) => meetingsApi.post(`/estates/${estateId}/meetings/${id}/rsvp`, { status }).then(r => r.data);
export const checkInMeeting = (estateId: string, id: string) => meetingsApi.post(`/estates/${estateId}/meetings/${id}/checkin`).then(r => r.data);
