import os
import secrets
import psycopg
from api.index import password_hash

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required to run smoke tests.")

def main():
    print("Testing connection to Neon PostgreSQL...")
    with psycopg.connect(DATABASE_URL) as conn:
        tables = [r[0] for r in conn.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'").fetchall()]
        print("Existing tables:", tables)
        for t in ["users", "wallets", "deposits", "withdrawals", "wallet_transactions", "commissions", "game_rounds", "login_attempts"]:
            assert t in tables, f"Table {t} missing!"
        print("Table verification passed!")

        # Verify columns on users
        user_cols = [r[0] for r in conn.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'").fetchall()]
        assert "referral_code" in user_cols, "referral_code column missing!"
        assert "referred_by_code" in user_cols, "referred_by_code column missing!"
        print("Users columns verification passed!")

        # Verify a test round cycle
        test_uid = conn.execute("SELECT id FROM users LIMIT 1").fetchone()[0]
        round_id = "test_round_" + secrets.token_hex(4)
        conn.execute("INSERT INTO game_rounds(id, user_id, stake_cents, status) VALUES(%s, %s, %s, 'active')", (round_id, test_uid, 1000))
        assert conn.execute("SELECT id FROM game_rounds WHERE id=%s", (round_id,)).fetchone() is not None
        conn.execute("DELETE FROM game_rounds WHERE id=%s", (round_id,))
        print("Game rounds cycle verified!")

        # Verify login attempts table works
        key = "test_ip_hash_" + secrets.token_hex(4)
        conn.execute("INSERT INTO login_attempts(key_hash, ip, email, attempts) VALUES(%s, '127.0.0.1', 'test@test.com', 1)", (key,))
        conn.execute("DELETE FROM login_attempts WHERE key_hash=%s", (key,))
        print("Login attempts table verified!")

    print("ALL POSTGRES SMOKE TESTS PASSED!")

if __name__ == "__main__":
    main()
