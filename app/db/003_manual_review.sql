ALTER TABLE repository_settings ALTER COLUMN mode SET DEFAULT 'manual';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS runner text NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS requested_model text NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS trigger text NOT NULL DEFAULT 'automatic' CHECK (trigger IN ('manual','automatic'));
ALTER TABLE runs ADD COLUMN IF NOT EXISTS requested_by bigint;
DROP INDEX IF EXISTS runs_scope_generator_version;
CREATE UNIQUE INDEX IF NOT EXISTS runs_model_version ON runs(repo_id,number,base_sha,head_sha,scope,start_sha,end_sha,generator_version,runner,requested_model);
