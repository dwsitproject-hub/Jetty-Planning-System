BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_source TEXT NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS oidc_sub TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_auth_source_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_auth_source_check
      CHECK (auth_source IN ('local', 'sso'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc_sub_unique
  ON public.users (oidc_sub)
  WHERE oidc_sub IS NOT NULL;

COMMIT;
