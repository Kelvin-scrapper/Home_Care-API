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

-- A beneficiary is identified once, on first visit, by (name, location) — see
-- the unique index below. Every later visit for the same person links to this
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

-- Case-insensitive identity key. Used as the ON CONFLICT target for the
-- find-or-create upsert in src/routes/visits.js.
CREATE UNIQUE INDEX IF NOT EXISTS idx_beneficiaries_identity
  ON beneficiaries (lower(name), lower(location));

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
