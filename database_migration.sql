-- 1. Milestone 6: Add programs to your Supabase schema
-- Run this in your Supabase SQL Editor dashboard to enable cloud saving for Degree Progress Tracking

ALTER TABLE public.plans 
ADD COLUMN IF NOT EXISTS programs jsonb DEFAULT '[]'::jsonb;
