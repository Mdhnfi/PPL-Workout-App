CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE TABLE public.schema_versions (
  id SERIAL PRIMARY KEY,
  version VARCHAR(32) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.0.0', 'Initial users and orders schema'),
  ('1.1.0', 'Add user phone number and order status'),
  ('1.3.0', 'Add audit_logs table and composite order index');

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

CREATE TABLE public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_email VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_user_status ON public.orders(user_id, status);
CREATE INDEX idx_unused_audit_action ON public.audit_logs(action);

INSERT INTO public.users (email, full_name, phone)
SELECT
  'user' || g || '@example.com',
  'User ' || g,
  '+6012345' || LPAD(g::text, 4, '0')
FROM generate_series(1, 250) AS g;

INSERT INTO public.orders (user_id, total_amount, status)
SELECT
  (g % 250) + 1,
  ROUND((RANDOM() * 500 + 10)::numeric, 2),
  CASE WHEN g % 3 = 0 THEN 'PAID' WHEN g % 3 = 1 THEN 'PENDING' ELSE 'SHIPPED' END
FROM generate_series(1, 2500) AS g;

ANALYZE public.users;
ANALYZE public.orders;
ANALYZE public.audit_logs;
