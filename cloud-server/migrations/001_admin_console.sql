ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active','suspended','closed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS admins (
  id uuid PRIMARY KEY, username text UNIQUE NOT NULL, display_name text NOT NULL,
  password_hash text NOT NULL, password_salt text NOT NULL,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','editor','finance','viewer')),
  active boolean NOT NULL DEFAULT true, last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS literature_categories (
  id uuid PRIMARY KEY, name text UNIQUE NOT NULL, slug text UNIQUE NOT NULL,
  description text NOT NULL DEFAULT '', sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS literature_documents (
  id uuid PRIMARY KEY, title text NOT NULL, authors text[] NOT NULL DEFAULT '{}', year integer,
  doi text NOT NULL DEFAULT '', url text NOT NULL DEFAULT '', abstract text NOT NULL DEFAULT '', keywords text[] NOT NULL DEFAULT '{}',
  category_id uuid REFERENCES literature_categories(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','withdrawn')),
  source text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES admins(id) ON DELETE SET NULL, updated_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS literature_doi_unique_idx ON literature_documents(lower(doi)) WHERE doi <> '';
CREATE INDEX IF NOT EXISTS literature_status_updated_idx ON literature_documents(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS literature_category_idx ON literature_documents(category_id);
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'manual', external_id text UNIQUE, amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'usd', credits integer NOT NULL CHECK (credits > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled','refunded')),
  metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders(status, created_at DESC);
CREATE TABLE IF NOT EXISTS recharge_records (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL, credits integer NOT NULL, amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd', provider text NOT NULL, external_id text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'completed', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recharge_user_created_idx ON recharge_records(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid PRIMARY KEY, admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  action text NOT NULL, entity_type text NOT NULL, entity_id text, ip text NOT NULL DEFAULT '', user_agent text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_admin_idx ON admin_audit_logs(admin_id, created_at DESC);
CREATE TABLE IF NOT EXISTS database_backups (
  id uuid PRIMARY KEY, created_by uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  format text NOT NULL, size_bytes bigint NOT NULL, sha256 text NOT NULL, payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz DEFAULT now() + interval '30 days'
);
