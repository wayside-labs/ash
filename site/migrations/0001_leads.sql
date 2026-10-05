-- Leads from /investor. Only what the form asks: no IP, no user-agent (see the privacy page).
-- Timestamps are ISO 8601 UTC strings written by the function; e-mail is stored lower-cased.
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('investor', 'founder', 'other')),
  email TEXT NOT NULL UNIQUE,
  lang TEXT NOT NULL CHECK (lang IN ('en', 'pt')),
  consent_at TEXT NOT NULL,
  listmonk_status TEXT NOT NULL DEFAULT 'pending' CHECK (listmonk_status IN ('pending', 'sent'))
);
CREATE INDEX leads_pending ON leads (listmonk_status, created_at);
