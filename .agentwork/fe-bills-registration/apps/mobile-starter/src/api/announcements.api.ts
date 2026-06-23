import axios from 'axios';
const api = axios.create({ baseURL: process.env.EXPO_PUBLIC_API_URL + '/api' });
export interface Announcement { id: string; title: string; body: string; category: 'general'|'security'|'payment'|'maintenance'|'meeting'|'election'|'emergency'; priority: 'low'|'medium'|'high'|'urgent'; created_at: string; author_name: string; attachment_url?: string; read?: boolean; }
export const listAnnouncements = (estateId: string) => api.get(`/estates/${estateId}/announcements`).then(r => r.data as Announcement[]);
export const getAnnouncement = (estateId: string, id: string) => api.get(`/estates/${estateId}/announcements/${id}`).then(r => r.data as Announcement);
export const createAnnouncement = (estateId: string, body: Partial<Announcement>) => api.post(`/estates/${estateId}/announcements`, body).then(r => r.data as Announcement);
export const markAnnouncementRead = (estateId: string, id: string) => api.post(`/estates/${estateId}/announcements/${id}/read`).then(r => r.data);
