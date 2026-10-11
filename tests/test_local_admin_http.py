"""HTTP integration checks against an isolated database; never call a PSP."""
import json
import sqlite3
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import backend


class LocalAdminHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.connections = []
        def isolated_connect():
            connection = sqlite3.connect('file:rush_admin_http_test?mode=memory&cache=shared', uri=True, check_same_thread=False)
            connection.row_factory = sqlite3.Row
            connection.execute('PRAGMA foreign_keys = ON')
            cls.connections.append(connection)
            return connection
        cls.db_patch = patch.object(backend, 'connect', isolated_connect)
        cls.db_patch.start()
        backend.migrate()
        with backend.connect() as db:
            for uid, role, token in [(1, "admin", "test-admin-token"), (2, "customer", "test-customer-token")]:
                db.execute("INSERT INTO users(id,name,email,role,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?)", (uid, role, role + "@example.test", role, "not-a-password", "00", backend.utc_now()))
                db.execute("INSERT INTO wallets VALUES(?,?,?)", (uid, uid * 100, backend.utc_now()))
                db.execute("INSERT INTO sessions VALUES(?,?,?,?)", (backend.token_hash(token), uid, (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(), backend.utc_now()))
            db.execute("INSERT INTO deposits(id,user_id,amount_cents,status,created_at,paid_at) VALUES('test',2,2000,'paid',?,?)", (backend.utc_now(), backend.utc_now()))
        class QuietHandler(backend.Handler):
            def log_message(self, *args):
                pass
        cls.server = backend.ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:' + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.db_patch.stop()
        for connection in cls.connections:
            connection.close()

    def request(self, path, token=None, data=None, extra_headers=None):
        headers = {'Authorization': 'Bearer ' + token} if token else {}
        headers.update(extra_headers or {})
        if data is not None:
            headers['Content-Type'] = 'application/json'
        try:
            response = urlopen(Request(self.base + path, headers=headers, data=None if data is None else json.dumps(data).encode()), timeout=5)
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.read().decode()

    def test_anonymous_cannot_read_admin(self):
        self.assertEqual(self.request('/api/admin/overview')[0], 401)

    def test_customer_cannot_read_admin(self):
        self.assertEqual(self.request('/api/admin/overview', 'test-customer-token')[0], 403)

    def test_admin_gets_database_totals_and_seven_day_chart(self):
        status, body = self.request('/api/admin/overview', 'test-admin-token')
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(data['totals']['accounts'], 2)
        self.assertEqual(data['totals']['wallet_cents'], 300)
        self.assertEqual(data['totals']['deposits_cents'], 2000)
        self.assertEqual(len(data['trend']), 7)
        self.assertEqual(sum(row['deposits_cents'] for row in data['trend']), 2000)
        self.assertNotIn('password_hash', body)
        self.assertNotIn('password_salt', body)

    def test_private_files_and_encoded_paths_are_blocked(self):
        for path in ['/.git/config', '/%2egit/config', '/%2eenv.local', '/data/rush_arena.sqlite3', '/%64ata/rush_arena.sqlite3', '/restart-local-server.ps1', '/tests/check-browser-syntax.cjs']:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)

    def test_unknown_api_returns_json(self):
        status, body = self.request('/api/unknown')
        self.assertEqual(status, 404)
        self.assertIn('error', json.loads(body))

    def test_same_session_survives_repeated_requests(self):
        for _ in range(3):
            status, body = self.request('/api/me', 'test-admin-token')
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)['role'], 'admin')

    def test_demo_server_ownership_replay_and_wallet_isolation(self):
        token='test-customer-token'
        before=json.loads(self.request('/api/me',token)[1])['balanceCents']
        endpoint='/api/demo/block-cash/'
        self.assertEqual(self.request(endpoint+'start',data={'entry':500,'requestId':'anonymous-start'})[0],401)
        payload={'entry':500,'requestId':'test-start-001'}
        status,body=self.request(endpoint+'start',token,payload)
        self.assertEqual(status,200)
        state=json.loads(body)['state']
        self.assertEqual(json.loads(self.request(endpoint+'start',token,payload)[1])['state'],state)
        move={'roundId':state['id'],'revision':0,'piece':0,'x':0,'y':0,'requestId':'test-move-001'}
        self.assertEqual(self.request(endpoint+'move',token,{**move,'amount':999999})[0],422)
        self.assertEqual(self.request(endpoint+'move','test-admin-token',move)[0],404)
        status,body=self.request(endpoint+'move',token,move)
        self.assertEqual(status,200)
        updated=json.loads(body)['state']
        self.assertEqual(updated['revision'],1)
        self.assertEqual(json.loads(self.request(endpoint+'move',token,move)[1])['state'],updated)
        self.assertEqual(self.request(endpoint+'move',token,{**move,'requestId':'test-stale-001'})[0],409)
        self.assertEqual(json.loads(self.request(endpoint+'state',token,{})[1])['state'],updated)
        self.assertEqual(json.loads(self.request('/api/me',token)[1])['balanceCents'],before)

    def test_z_influencer_creation_login_and_referral(self):
        payload = {'name':'Parceiro teste','email':'partner@example.test','password':'Example-test-8123'}
        self.assertEqual(self.request('/api/admin/influencers', 'test-customer-token', payload)[0], 403)
        self.assertEqual(self.request('/api/admin/influencers', None, payload)[0], 401)
        status, body = self.request('/api/admin/influencers', 'test-admin-token', payload)
        self.assertEqual(status, 201)
        code = json.loads(body)['referralCode']
        self.assertEqual(self.request('/api/admin/influencers', 'test-admin-token', payload)[0], 409)
        status, body = self.request('/api/auth/login', data=payload)
        self.assertEqual(status, 200)
        token = json.loads(body)['token']
        self.assertEqual(self.request('/api/admin/overview', token)[0], 403)
        self.assertEqual(json.loads(self.request('/api/me', token)[1])['balanceCents'], 0)
        self.assertEqual(json.loads(self.request('/api/influencer/link', token)[1])['referralCode'], code)
        status, _ = self.request('/api/auth/register', data={'name':'Indicado','email':'referral@example.test','password':'Example-test-8123','referralCode':code})
        self.assertEqual(status, 201)
        self.assertEqual(json.loads(self.request('/api/influencer/link', token)[1])['referredUsers'], 1)
        overview = json.loads(self.request('/api/admin/overview', 'test-admin-token')[1])
        partner = next(item for item in overview['influencers'] if item['referral_code'] == code)
        self.assertEqual(partner['referred_users'], 1)
        user_id = partner['id']
        self.assertEqual(self.request('/api/admin/influencers','test-admin-token',{'action':'update','userId':user_id,'active':False,'commissionRate':25})[0],200)
        self.assertEqual(self.request('/api/influencer/overview',token)[0],403)
        self.assertEqual(self.request('/api/admin/influencers','test-admin-token',{'action':'update','userId':user_id,'active':True,'commissionRate':25})[0],200)
        self.assertEqual(self.request('/api/influencer/overview',token)[0],200)
        login = json.loads(self.request('/api/auth/login',data={'email':'referral@example.test','password':'Example-test-8123'})[1])
        referred_token = login['token']
        status, body = self.request('/api/deposits',referred_token,{'amountCents':2000})
        self.assertEqual(status,201)
        deposit_id = json.loads(body)['id']
        status, _ = self.request('/api/webhooks/sandbox',data={'eventId':'commission-test-event','depositId':deposit_id},extra_headers={'X-Webhook-Secret':backend.WEBHOOK_SECRET})
        self.assertEqual(status,200)
        influencer = json.loads(self.request('/api/influencer/overview',token)[1])
        self.assertEqual(influencer['totalCommissionCents'],500)
        self.assertEqual(influencer['balanceCents'],500)
        self.assertEqual(self.request('/api/admin/influencers','test-admin-token',{'action':'reset_password','userId':user_id,'password':'New-test-password-29'})[0],200)
        self.assertEqual(self.request('/api/me',token)[0],401)
        self.assertEqual(self.request('/api/auth/login',data={'email':payload['email'],'password':'New-test-password-29'})[0],200)

    def test_y_admin_balance_adjustment_is_audited(self):
        before=json.loads(self.request('/api/me','test-customer-token')[1])['balanceCents']
        payload={'userId':2,'amountCents':1250,'reason':'Crédito de teste auditado'}
        self.assertEqual(self.request('/api/admin/balance-adjustments','test-customer-token',payload)[0],403)
        self.assertEqual(self.request('/api/admin/balance-adjustments','test-admin-token',payload)[0],200)
        self.assertEqual(json.loads(self.request('/api/me','test-customer-token')[1])['balanceCents'],before+1250)
        overview=json.loads(self.request('/api/admin/overview','test-admin-token')[1])
        self.assertTrue(any(row['kind']=='admin_credit' and row['amount_cents']==1250 for row in overview['transactions']))


if __name__ == '__main__':
    unittest.main()
