CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE TABLE public.schema_versions (
  id SERIAL PRIMARY KEY,
  version VARCHAR(32) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.0.0', 'Initial users and orders schema');

CREATE TABLE public.users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.orders (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unversioned schema (no schema_versions table) for Fallback Structural Comparison testing
CREATE SCHEMA auth;
CREATE TABLE auth.roles (
  id SERIAL PRIMARY KEY,
  role_name VARCHAR(50) NOT NULL UNIQUE
);

INSERT INTO auth.roles (role_name) VALUES ('DBA_ADMIN'), ('DEVELOPER'), ('VIEWER');

INSERT INTO public.users (email, full_name)
SELECT
  'customer' || g || '@example.com',
  'Customer ' || g
FROM generate_series(1, 300) AS g;

INSERT INTO public.orders (user_id, total_amount)
SELECT
  (g % 300) + 1,
  ROUND((RANDOM() * 650 + 20)::numeric, 2)
FROM generate_series(1, 3000) AS g;

ANALYZE public.users;
ANALYZE public.orders;
ANALYZE auth.roles;
