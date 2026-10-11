import unittest
from unittest.mock import Mock, patch
import api.index as api
import backend

class FinancialGuards(unittest.TestCase):
    def test_unverified_games_cannot_debit_or_credit_wallet(self):
        request = object.__new__(api.handler)
        request.user = Mock(return_value={"id": 1})
        with patch.object(api, "db") as database:
            for method, payload in [(request.game_bet, {"stakeCents": 1000}), (request.game_end, {"roundId": "forged", "outcome": "won", "multiplier": 10})]:
                with self.assertRaises(api.ApiError) as error:
                    method(payload)
                self.assertEqual(error.exception.status, 503)
            database.assert_not_called()

    def test_unsupported_gateway_cannot_mark_transfer_paid(self):
        request = object.__new__(api.handler)
        request.user = Mock(return_value={"id": 1})
        with patch.object(api, "payment_provider", return_value="vulcanopay"), patch.object(api, "db") as database:
            with self.assertRaises(api.ApiError) as error:
                request.admin_withdrawal({"id": "wd_test", "action": "approve_and_pay"})
            self.assertEqual(error.exception.status, 503)
            database.assert_not_called()

    def test_local_withdrawal_requires_password_before_wallet_access(self):
        request = object.__new__(backend.Handler)
        request.auth = Mock(return_value={"id": 1, "password_hash": "hash", "password_salt": "salt"})
        with patch.object(backend, "verify_password", return_value=False), patch.object(backend, "connect") as database:
            with self.assertRaises(backend.ApiError) as error:
                request.create_withdrawal({"amountCents": 3000, "pixType": "email", "pixKey": "test@example.com"})
            self.assertEqual(error.exception.status, 403)
            database.assert_not_called()
