-- Allow 'restore' as a credit transaction type
ALTER TABLE credit_transactions DROP CONSTRAINT credit_transactions_type_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_type_check
  CHECK (type IN ('purchase', 'use', 'restore'));

-- Restore one credit after a generation failure — SECURITY DEFINER
CREATE OR REPLACE FUNCTION restore_credit(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE credits SET balance = balance + 1, updated_at = NOW() WHERE user_id = p_user_id;
  INSERT INTO credit_transactions (user_id, amount, type) VALUES (p_user_id, 1, 'restore');
END;
$$;
