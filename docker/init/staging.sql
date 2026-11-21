CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE TABLE public.schema_versions (
  id SERIAL PRIMARY KEY,
  version VARCHAR(32) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.0.0', 'Initial users and orders schema'),
  ('1.1.0', 'Add user phone number and order status');

CREATE TABLE public.users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  phone VARCHAR(30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.orders (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.users (email, full_name, phone)
SELECT
  'user' || g || '@example.com',
  'User ' || g,
  '+6012345' || LPAD(g::text, 4, '0')
FROM generate_series(1, 150) AS g;

INSERT INTO public.orders (user_id, total_amount, status)
SELECT
  (g % 150) + 1,
  ROUND((RANDOM() * 400 + 15)::numeric, 2),
  CASE WHEN g % 2 = 0 THEN 'PAID' ELSE 'PENDING' END
FROM generate_series(1, 1500) AS g;

ANALYZE public.users;
ANALYZE public.orders;
