CREATE TABLE IF NOT EXISTS installations (
  id bigint PRIMARY KEY,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash text PRIMARY KEY,
  user_id bigint NOT NULL,
  login text NOT NULL,
  token_cipher text NOT NULL,
  refresh_cipher text,
  token_expires_at timestamptz,
  refresh_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repository_settings (
  repo_id bigint PRIMARY KEY,
  installation_id bigint NOT NULL REFERENCES installations(id),
  owner text NOT NULL,
  repo text NOT NULL,
  mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'on_open', 'on_update')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pulls (
  repo_id bigint NOT NULL,
  number integer NOT NULL,
  owner text NOT NULL,
  repo text NOT NULL,
  installation_id bigint NOT NULL REFERENCES installations(id),
  title text NOT NULL,
  private boolean NOT NULL,
  base_sha text NOT NULL,
  head_sha text NOT NULL,
  comment_id bigint,
  comment_version_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_id, number)
);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY,
  repo_id bigint NOT NULL,
  number integer NOT NULL,
  base_sha text NOT NULL,
  head_sha text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  result jsonb,
  error text,
  model text,
  usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (repo_id, number, base_sha, head_sha),
  FOREIGN KEY (repo_id, number) REFERENCES pulls(repo_id, number) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS runs_queue ON runs (created_at) WHERE status = 'queued';
