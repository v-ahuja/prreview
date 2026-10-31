ALTER TABLE pulls ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE repository_settings ALTER COLUMN mode SET DEFAULT 'on_update';
ALTER TABLE repository_settings ADD COLUMN IF NOT EXISTS synced_at timestamptz;
ALTER TABLE repository_settings ADD COLUMN IF NOT EXISTS sync_error text;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'full' CHECK (scope IN ('full','since','range'));
ALTER TABLE runs ADD COLUMN IF NOT EXISTS start_sha text NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS end_sha text NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS generator_version integer NOT NULL DEFAULT 1;
ALTER TABLE runs ALTER COLUMN generator_version SET DEFAULT 2;
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_repo_id_number_base_sha_head_sha_key;
DROP INDEX IF EXISTS runs_scope_version;
CREATE UNIQUE INDEX IF NOT EXISTS runs_scope_generator_version ON runs(repo_id,number,base_sha,head_sha,scope,start_sha,end_sha,generator_version);
CREATE TABLE IF NOT EXISTS review_marks (
  repo_id bigint NOT NULL,
  number integer NOT NULL,
  user_id bigint NOT NULL,
  head_sha text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(repo_id,number,user_id),
  FOREIGN KEY(repo_id,number) REFERENCES pulls(repo_id,number) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
