-- Migration: Add paystack_reference column to user_profiles
-- Timestamp: 20260401020000

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS paystack_reference TEXT DEFAULT '';

-- Update payment_status check to include 'Paid' status
-- (payment_status column already exists from previous migration)
