-- Jetty Planning System - Migration 046
-- Add optional free-text B/L split field to shipping instructions.

BEGIN;

ALTER TABLE public.shipping_instructions
  ADD COLUMN IF NOT EXISTS bl_split_text TEXT;

COMMIT;

