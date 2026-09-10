-- Grant 1 free credit to every new user at sign-up
CREATE OR REPLACE FUNCTION grant_signup_credit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO credits (user_id, balance)
    VALUES (NEW.id, 1)
    ON CONFLICT (user_id) DO UPDATE
      SET balance = credits.balance + 1, updated_at = NOW();
  INSERT INTO credit_transactions (user_id, amount, type, stripe_payment_id)
    VALUES (NEW.id, 1, 'purchase', 'signup_bonus');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION grant_signup_credit();
