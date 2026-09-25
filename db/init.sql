CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (
    role IN ('Volunteer/CHW', 'Coordinator/Field officer', 'Admin', 'Management/Director')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Revoked JWTs (by jti) are recorded here so logout can work with stateless tokens.
CREATE TABLE IF NOT EXISTS token_blacklist (
  jti TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

-- A beneficiary is identified by their BHECO reference number; records from
-- the original form (no reference number) by (name, location) — see the
-- indexes in the formVersion 2 section below. Every later visit for the same person links to this
-- row via visits.beneficiary_id instead of re-deriving identity from
-- free-text fields, so a typo in one visit can't fork them into two people.
CREATE TABLE IF NOT EXISTS beneficiaries (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  age TEXT,
  weight TEXT,
  time_in_community TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visits (
  id SERIAL PRIMARY KEY,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  beneficiary_id INTEGER REFERENCES beneficiaries(id) ON DELETE SET NULL,

  -- Beneficiary info as recorded at the time of THIS visit (age/weight/etc.
  -- change over time, so this is intentionally a snapshot, not a duplicate
  -- of the beneficiaries row).
  beneficiary_name TEXT NOT NULL,
  age TEXT,
  weight TEXT,
  location TEXT NOT NULL,
  time_in_community TEXT,
  volunteer_name TEXT NOT NULL,
  -- Stored as TEXT (not DATE): the form only requires this be non-empty,
  -- not that it parse as a valid date.
  visit_date TEXT NOT NULL,

  -- Part 1A: Physical wellbeing
  appearance TEXT,
  mobility_challenges TEXT,
  signs_of_illness TEXT,
  screening_done TEXT,

  -- Part 1B: Nutrition & basic needs
  had_meals TEXT,
  food_in_home TEXT,
  clean_water TEXT,

  -- Part 1C: Living environment
  house_clean TEXT,
  bedding_adequate TEXT,
  sanitation_access TEXT,
  receiving_stipend TEXT,

  -- Part 1D: Emotional & social
  mood TEXT,
  signs_of_neglect TEXT,
  social_support TEXT,
  registered_sha TEXT,

  -- Part 1E: Needs & actions
  needs_identified TEXT,
  actions_recommendations TEXT,
  urgency_level TEXT,

  -- Part 2: Oral story & impact interview
  background_challenges TEXT,
  intervention_change TEXT,
  youth_participation TEXT,
  future_aspirations TEXT,

  -- Consent & signatures
  consent_interview TEXT,
  consent_photo_video TEXT,
  beneficiary_signature TEXT,
  volunteer_signature TEXT,
  -- TEXT, not DATE: the form allows this to be left blank.
  date_signed TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visits_created_by ON visits (created_by);
CREATE INDEX IF NOT EXISTS idx_visits_beneficiary_id ON visits (beneficiary_id);
CREATE INDEX IF NOT EXISTS idx_visits_created_at ON visits (created_at);
CREATE INDEX IF NOT EXISTS idx_visits_urgency_level ON visits (urgency_level);

-- ---------------------------------------------------------------------------
-- Digital Data Collection Form (formVersion 2). Additive only: this file is
-- re-applied on every start, and visits recorded with the original form keep
-- their data in the columns above (form_version = 1, form_data NULL).
-- ---------------------------------------------------------------------------

-- Full answers for formVersion 2 visits, keyed by field name (see
-- src/schemas/visitFormDefinition.js). The flat columns above are still
-- filled from it (name, location, officer, date, urgency...) so lists,
-- stats and the beneficiary directory work across both form versions.
ALTER TABLE visits ADD COLUMN IF NOT EXISTS form_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS form_data JSONB;

-- The BHECO household reference number (e.g. BHECO-NK-001), stored
-- normalized (no spaces, upper case). Identifies beneficiaries from form v2
-- on; older rows have none until a v2 visit links to them.
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS reference_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_beneficiaries_reference_number
  ON beneficiaries (reference_number) WHERE reference_number IS NOT NULL;

-- (name, location) identifies only beneficiaries without a reference number
-- (original-form records). Once a household has a reference number, two
-- different elders with the same name in the same village can coexist.
-- Replaces the original unconditional idx_beneficiaries_identity.
DROP INDEX IF EXISTS idx_beneficiaries_identity;
CREATE UNIQUE INDEX IF NOT EXISTS idx_beneficiaries_identity_unreferenced
  ON beneficiaries (lower(name), lower(location)) WHERE reference_number IS NULL;

-- Media & Evidence uploads. The file itself lives on disk under UPLOAD_DIR
-- as storage_name; visits reference uploads by id from form_data.
CREATE TABLE IF NOT EXISTS uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deactivated accounts can't sign in (and any session they have ends), but
-- stay on the visits they recorded; an Admin can reactivate them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- Deleted visits are hidden everywhere but kept (with their files) so an
-- Admin can restore them; src/jobs/purgeDeletedVisits.js removes them for
-- good after VISIT_TRASH_RETENTION_DAYS.
ALTER TABLE visits ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_visits_deleted_at ON visits (deleted_at) WHERE deleted_at IS NOT NULL;

-- Last number handed out per ward code for generated reference numbers
-- (BHECO-<code>-<number>). Reserving through this table keeps two officers
-- generating at the same moment from ever getting the same number.
CREATE TABLE IF NOT EXISTS reference_sequences (
  code TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL
);
