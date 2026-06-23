// ── Spotlight Realtor — Hotel + channel sync hooks (V3) ──────────────────────
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as h from '../api/realtorHotel.api';
import type { HotelBookingDraft, RoomBoardItem, ChannelKey } from '../types/realtor.hotel.types';

const KEY = 'realtor-hotel';

export function useHotelSearch(query?: string) {
  return useQuery({ queryKey: [KEY, 'search', query], queryFn: () => h.searchHotels(query), staleTime: 20_000 });
}
export function useHotel(id: string) {
  return useQuery({ queryKey: [KEY, 'hotel', id], queryFn: () => h.getHotel(id), enabled: !!id });
}
export function useBookHotel() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (d: HotelBookingDraft) => h.bookHotel(d), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }) });
}
export function useReservation(id: string) {
  return useQuery({ queryKey: [KEY, 'res', id], queryFn: () => h.getReservation(id), enabled: !!id });
}
export function useDeskSummary() {
  return useQuery({ queryKey: [KEY, 'desk'], queryFn: h.getDeskSummary, staleTime: 30_000 });
}
export function useArrivals() {
  return useQuery({ queryKey: [KEY, 'arrivals'], queryFn: h.getArrivals, staleTime: 30_000 });
}
export function useRoomBoard() {
  return useQuery({ queryKey: [KEY, 'rooms'], queryFn: h.getRoomBoard, staleTime: 15_000 });
}
export function useSetRoomStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { roomId: string; status: RoomBoardItem['status'] }) => h.setRoomStatus(args.roomId, args.status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY, 'rooms'] }); qc.invalidateQueries({ queryKey: [KEY, 'desk'] }); },
  });
}
export function useChannelSync() {
  return useQuery({ queryKey: [KEY, 'channels'], queryFn: h.getChannelSync, staleTime: 20_000 });
}
export function useRunChannelSync() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => h.runChannelSync(), onSuccess: (s) => qc.setQueryData([KEY, 'channels'], s) });
}
export function useToggleChannel() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (args: { key: ChannelKey; connected: boolean }) => h.toggleChannel(args.key, args.connected), onSuccess: (s) => qc.setQueryData([KEY, 'channels'], s) });
}
