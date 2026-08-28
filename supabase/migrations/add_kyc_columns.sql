-- Migration: Add dedicated KYC columns to users table
-- Run this in the Supabase SQL Editor

ALTER TABLE public.users
  -- Personal KYC
  ADD COLUMN IF NOT EXISTS first_name        text,
  ADD COLUMN IF NOT EXISTS last_name         text,
  ADD COLUMN IF NOT EXISTS birth_date        text,
  ADD COLUMN IF NOT EXISTS nationality       text,
  ADD COLUMN IF NOT EXISTS profession        text,
  ADD COLUMN IF NOT EXISTS doc_type          text,
  ADD COLUMN IF NOT EXISTS doc_number        text,
  ADD COLUMN IF NOT EXISTS doc_country       text,
  ADD COLUMN IF NOT EXISTS residence_country text,
  ADD COLUMN IF NOT EXISTS city              text,
  ADD COLUMN IF NOT EXISTS address           text,
  ADD COLUMN IF NOT EXISTS zip_code          text,
  -- Business
  ADD COLUMN IF NOT EXISTS company_name      text,
  ADD COLUMN IF NOT EXISTS company_country   text,
  ADD COLUMN IF NOT EXISTS company_city      text,
  ADD COLUMN IF NOT EXISTS company_address   text,
  ADD COLUMN IF NOT EXISTS tax_id            text,
  ADD COLUMN IF NOT EXISTS tax_id_type       text,
  -- Legal representative
  ADD COLUMN IF NOT EXISTS rep_legal_name    text,
  ADD COLUMN IF NOT EXISTS rep_first_name    text,
  ADD COLUMN IF NOT EXISTS rep_last_name     text,
  ADD COLUMN IF NOT EXISTS rep_dob           text,
  ADD COLUMN IF NOT EXISTS rep_nationality   text,
  ADD COLUMN IF NOT EXISTS rep_doc_type      text,
  ADD COLUMN IF NOT EXISTS rep_doc_number    text,
  ADD COLUMN IF NOT EXISTS rep_doc_country   text,
  ADD COLUMN IF NOT EXISTS is_pep            boolean DEFAULT false,
  -- Documents (base64 or storage URLs)
  ADD COLUMN IF NOT EXISTS documents         jsonb DEFAULT '{}';
