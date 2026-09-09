-- Credits balance per authenticated user
CREATE TABLE IF NOT EXISTS credits (
  user_id    UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance    INTEGER     NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_credits" ON credits
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Immutable transaction log
CREATE TABLE IF NOT EXISTS credit_transactions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount             INTEGER     NOT NULL,
  type               TEXT        NOT NULL CHECK (type IN ('purchase', 'use')),
  stripe_payment_id  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_transactions" ON credit_transactions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Atomic check + deduct — SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION check_and_deduct_credit(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_balance INTEGER;
BEGIN
  SELECT balance INTO v_balance FROM credits WHERE user_id = p_user_id FOR UPDATE;
  IF v_balance IS NULL OR v_balance < 1 THEN RETURN FALSE; END IF;
  UPDATE credits SET balance = balance - 1, updated_at = NOW() WHERE user_id = p_user_id;
  INSERT INTO credit_transactions (user_id, amount, type) VALUES (p_user_id, -1, 'use');
  RETURN TRUE;
END;
$$;

-- Add credits after Stripe payment — SECURITY DEFINER
CREATE OR REPLACE FUNCTION add_credits(p_user_id UUID, p_amount INTEGER, p_stripe_payment_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO credits (user_id, balance)
    VALUES (p_user_id, p_amount)
    ON CONFLICT (user_id) DO UPDATE
      SET balance = credits.balance + p_amount, updated_at = NOW();
  INSERT INTO credit_transactions (user_id, amount, type, stripe_payment_id)
    VALUES (p_user_id, p_amount, 'purchase', p_stripe_payment_id);
END;
$$;
