import unittest
import sys
import types

if "psycopg" not in sys.modules:
    psycopg = types.ModuleType("psycopg")
    psycopg.rows = types.ModuleType("psycopg.rows")
    psycopg.rows.dict_row = object()
    sys.modules["psycopg"] = psycopg
    sys.modules["psycopg.rows"] = psycopg.rows

from api.index import signed_webhook_valid


class NyxPagSignatureTests(unittest.TestCase):
    def test_official_signature_vector(self):
        raw = b'{"id":"evt_txn_exemplo_approved","event":"transaction.approved","createdAt":"2026-10-03T14:01:32.000Z","data":{"id":"txn_exemplo","status":"approved"}}'
        signature = "t=1789056000,v1=9f5e6880464b6149bb93f1ff9567f7ba034022f505afc84d0ea2637d0a437ea9"
        self.assertTrue(signed_webhook_valid(raw, signature, "whsec_exemplo_nyxpag", current_time=1789056000))

    def test_rejects_wrong_signature(self):
        self.assertFalse(signed_webhook_valid(b"{}", "t=1789056000,v1=bad", "whsec_exemplo_nyxpag", current_time=1789056000))

    def test_rejects_replay(self):
        signature = "t=1789056000,v1=9f5e6880464b6149bb93f1ff9567f7ba034022f505afc84d0ea2637d0a437ea9"
        self.assertFalse(signed_webhook_valid(b"{}", signature, "whsec_exemplo_nyxpag", current_time=1789057000))


if __name__ == "__main__":
    unittest.main()
