#!/usr/bin/env python3
"""Teste de ponta a ponta para o backend local já iniciado."""

import json
import secrets
import urllib.request


BASE = "http://127.0.0.1:8766"


def request(path, method="GET", body=None, token=None, webhook=False):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if webhook:
        headers["X-Webhook-Secret"] = "local-sandbox-change-me"
    raw = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, raw, headers, method=method)
    with urllib.request.urlopen(req) as response:
        return response.status, json.load(response)


suffix = secrets.token_hex(4)
email = f"smoke-{suffix}@local.dev"
status, _ = request("/api/auth/register", "POST", {
    "name": "Smoke Test", "email": email, "password": "Teste123!"
})
assert status == 201

status, login = request("/api/auth/login", "POST", {
    "email": email, "password": "Teste123!"
})
assert status == 200 and login["token"]
token = login["token"]

status, deposit = request("/api/deposits", "POST", {"amountCents": 5000}, token)
assert status == 201 and deposit["bonusCents"] == 2000

event = {"eventId": "evt_" + suffix, "depositId": deposit["id"]}
status, paid = request("/api/webhooks/sandbox", "POST", event, webhook=True)
assert status == 200 and paid["ok"]
status, duplicate = request("/api/webhooks/sandbox", "POST", event, webhook=True)
assert status == 200 and duplicate["duplicate"]

status, me = request("/api/me", token=token)
assert status == 200 and me["balanceCents"] == 7000

status, withdrawal = request("/api/withdrawals", "POST", {
    "amountCents": 3000, "pixType": "email", "pixKey": email
}, token)
assert status == 201 and withdrawal["status"] == "pending"

status, me = request("/api/me", token=token)
assert me["balanceCents"] == 4000
print("OK: cadastro, login, depósito, webhook idempotente, saldo e saque")
