import unittest
import time
import hashlib
import hmac
import json
from unittest.mock import patch
import api.index as api_index
from api.index import (
    signed_webhook_valid,
    password_hash,
    bonus,
    token_hash,
    payment_provider,
    GAME_STAKES,
    HTTP_USER_AGENT,
    MIN_DEPOSIT,
    MIN_WITHDRAWAL
)


class FullPlatformUnitTests(unittest.TestCase):
    def test_webhook_hmac_signature(self):
        secret = "whsec_nyxpag_test_key_12345"
        payload = b'{"id":"evt_123","event":"transaction.approved","data":{"amount":20.0}}'
        timestamp = int(time.time())
        signed_payload = f"{timestamp}.".encode() + payload
        expected_sig = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
        header_val = f"t={timestamp},v1={expected_sig}"

        self.assertTrue(signed_webhook_valid(payload, header_val, secret, current_time=timestamp))
        # Replay attack prevention (> 300 seconds)
        self.assertFalse(signed_webhook_valid(payload, header_val, secret, current_time=timestamp + 301))
        # Tampered payload
        self.assertFalse(signed_webhook_valid(b'{"tampered":true}', header_val, secret, current_time=timestamp))

    def test_password_hash_pbkdf2(self):
        pw = "MinhaSenhaForte@2026"
        digest1, salt1 = password_hash(pw)
        self.assertEqual(len(digest1), 64) # sha256 hex
        self.assertEqual(len(salt1), 32) # 16 bytes hex

        # Verify same salt produces identical digest
        digest2, _ = password_hash(pw, bytes.fromhex(salt1))
        self.assertEqual(digest1, digest2)

        # Different password fails
        digest3, _ = password_hash("OutraSenha@99", bytes.fromhex(salt1))
        self.assertNotEqual(digest1, digest3)

    def test_bonus_tiers(self):
        self.assertEqual(bonus(2000), 0)
        self.assertEqual(bonus(3000), 1000)
        self.assertEqual(bonus(5000), 2000)
        self.assertEqual(bonus(10000), 5000)
        self.assertEqual(bonus(15000), 0)

    def test_token_hash_sha256(self):
        token = "random_session_token_xyz"
        h = token_hash(token)
        self.assertEqual(h, hashlib.sha256(token.encode()).hexdigest())

    def test_game_stakes(self):
        # Must support R$ 10, R$ 20, R$ 30, R$ 50 (in cents)
        self.assertIn(1000, GAME_STAKES)
        self.assertIn(2000, GAME_STAKES)
        self.assertIn(3000, GAME_STAKES)
        self.assertIn(5000, GAME_STAKES)
        self.assertNotIn(500, GAME_STAKES)
        self.assertNotIn(10000, GAME_STAKES)

    def test_financial_limits(self):
        self.assertEqual(MIN_DEPOSIT, 2000) # R$ 20,00
        self.assertEqual(MIN_WITHDRAWAL, 3000) # R$ 30,00

    def test_user_agent_format(self):
        # User agent must not be default Python-urllib to prevent Cloudflare Error 1010
        self.assertFalse("Python-urllib" in HTTP_USER_AGENT)
        self.assertTrue("Mozilla" in HTTP_USER_AGENT or "Chrome" in HTTP_USER_AGENT)

    def test_vulcanopay_is_preferred_when_both_providers_are_configured(self):
        with patch.object(api_index, "VULCANO_API_KEY", "vk_live_test"), \
             patch.object(api_index, "NYXPAG_API_KEY", "nyx_live_test"):
            self.assertEqual(payment_provider(), "vulcanopay")


if __name__ == "__main__":
    unittest.main()
