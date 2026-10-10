from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from datetime import datetime, timedelta, timezone
import hashlib, hmac, json, os, re, secrets, time

import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.environ.get("DATABASE_URL", "")
NYXPAG_API_URL = os.environ.get("NYXPAG_API_URL", "https://api.nyxpag.com.br/v1").rstrip("/")
NYXPAG_API_KEY = os.environ.get("NYXPAG_API_KEY", "").strip()
NYXPAG_WEBHOOK_SECRET = os.environ.get("NYXPAG_WEBHOOK_SECRET", "").strip()
VULCANO_API_URL = os.environ.get("VULCANO_API_URL", "https://api.vulcanopay.com/v1").rstrip("/")
VULCANO_API_KEY = os.environ.get("VULCANO_API_KEY", "").strip()
VULCANO_WEBHOOK_SECRET = os.environ.get("VULCANO_WEBHOOK_SECRET", "").strip()
MIN_DEPOSIT = 2000
MIN_WITHDRAWAL = 3000
GAME_STAKES = {1000, 2000, 3000, 5000}
HTTP_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"


def now(): return datetime.now(timezone.utc)
def now_iso(): return now().isoformat()
def token_hash(value): return hashlib.sha256(value.encode()).hexdigest()
def bonus(amount): return {3000: 1000, 5000: 2000, 10000: 5000}.get(amount, 0)
def payment_provider(): return "nyxpag" if NYXPAG_API_KEY else ("vulcanopay" if VULCANO_API_KEY else "not_configured")


def signed_webhook_valid(raw, signature, secret, current_time=None):
    if not secret: return False
    parts = dict(x.strip().split("=", 1) for x in signature.split(",") if "=" in x)
    try: stamp = int(parts.get("t", "0"))
    except ValueError: return False
    if abs(int(current_time if current_time is not None else time.time()) - stamp) > 300: return False
    expected = hmac.new(secret.encode(), str(stamp).encode() + b"." + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(parts.get("v1", ""), expected)


def password_hash(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310000).hex(), salt.hex()


def db():
    if not DATABASE_URL: raise RuntimeError("DATABASE_URL ausente")
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def migrate():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,phone TEXT,cpf_hash TEXT,cpf_last4 TEXT,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'customer',referral_code TEXT UNIQUE,referred_by_code TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
        conn.execute("""ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE""")
        conn.execute("""ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_code TEXT""")
        conn.execute("""CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
        conn.execute("""CREATE TABLE IF NOT EXISTS wallets(user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,balance_cents BIGINT NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
        conn.execute("""CREATE TABLE IF NOT EXISTS deposits(id TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),amount_cents BIGINT NOT NULL,bonus_cents BIGINT NOT NULL DEFAULT 0,provider TEXT NOT NULL,provider_reference TEXT UNIQUE,status TEXT NOT NULL DEFAULT 'pending',pix_code TEXT,expires_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),paid_at TIMESTAMPTZ)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS withdrawals(id TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),amount_cents BIGINT NOT NULL,pix_type TEXT NOT NULL,pix_key TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',provider_reference TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),reviewed_at TIMESTAMPTZ,reviewed_by BIGINT REFERENCES users(id))""")
        conn.execute("""ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS provider_reference TEXT""")
        conn.execute("""CREATE TABLE IF NOT EXISTS wallet_transactions(id TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,amount_cents BIGINT NOT NULL,reference_type TEXT,reference_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(kind,reference_type,reference_id))""")
        conn.execute("""CREATE TABLE IF NOT EXISTS payment_events(event_id TEXT PRIMARY KEY,provider TEXT NOT NULL,payload JSONB NOT NULL,received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),processed_at TIMESTAMPTZ)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS influencers(user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,commission_rate INT NOT NULL DEFAULT 30,pix_key TEXT,pix_type TEXT,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
        conn.execute("""CREATE TABLE IF NOT EXISTS commissions(id TEXT PRIMARY KEY,beneficiary_user_id BIGINT NOT NULL REFERENCES users(id),referred_user_id BIGINT NOT NULL REFERENCES users(id),deposit_id TEXT NOT NULL REFERENCES deposits(id),deposit_cents BIGINT NOT NULL,commission_cents BIGINT NOT NULL,rate_percent INT NOT NULL,status TEXT NOT NULL DEFAULT 'credited',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
        conn.execute("""CREATE TABLE IF NOT EXISTS game_rounds(id TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),stake_cents BIGINT NOT NULL,multiplier NUMERIC(6,2) DEFAULT 0,payout_cents BIGINT DEFAULT 0,status TEXT NOT NULL DEFAULT 'active',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS login_attempts(key_hash TEXT PRIMARY KEY,ip TEXT,email TEXT,attempts INT NOT NULL DEFAULT 1,blocked_until TIMESTAMPTZ,last_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW())""")


class ApiError(Exception):
    def __init__(self, status, message): self.status, self.message = status, message


class handler(BaseHTTPRequestHandler):
    def route(self):
        query = parse_qs(urlparse(self.path).query)
        return "/api/" + query.get("route", [""])[0].strip("/")

    def send_json(self, status, value):
        body = json.dumps(value, ensure_ascii=False, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def body(self, raw=False):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 64000: raise ApiError(400, "Conteúdo inválido")
        value = self.rfile.read(length)
        if raw: return value
        try: data = json.loads(value)
        except json.JSONDecodeError: raise ApiError(400, "JSON inválido")
        if not isinstance(data, dict): raise ApiError(400, "JSON inválido")
        return data

    def user(self, roles=()):
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "): raise ApiError(401, "Autenticação necessária")
        with db() as conn:
            row = conn.execute("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=%s AND s.expires_at>NOW()", (token_hash(auth[7:]),)).fetchone()
        if not row: raise ApiError(401, "Sessão inválida ou expirada")
        if roles and row["role"] not in roles: raise ApiError(403, "Acesso não autorizado")
        return row

    def client_ip(self):
        forwarded = self.headers.get("X-Forwarded-For", "").strip()
        if forwarded: return forwarded.split(",")[0].strip()
        return self.headers.get("CF-Connecting-IP", "").strip() or "127.0.0.1"

    def do_GET(self):
        try:
            migrate(); path = self.route()
            if path == "/api/health":
                return self.send_json(200, {"ok": True, "database": "postgres", "payments": payment_provider(), "version": "2.2.0"})
            if path == "/api/me":
                user = self.user()
                with db() as conn:
                    wallet = conn.execute("SELECT balance_cents FROM wallets WHERE user_id=%s", (user["id"],)).fetchone()
                    ref_code = user.get("referral_code") or ""
                    if not ref_code:
                        ref_code = "RUSH-" + secrets.token_hex(3).upper()
                        conn.execute("UPDATE users SET referral_code=%s WHERE id=%s", (ref_code, user["id"]))
                return self.send_json(200, {
                    "id": user["id"], "name": user["name"], "email": user["email"],
                    "role": user["role"], "referralCode": ref_code,
                    "balanceCents": wallet["balance_cents"] if wallet else 0
                })
            if path == "/api/payments":
                user = self.user()
                with db() as conn:
                    deposits = conn.execute("SELECT id,amount_cents,bonus_cents,status,created_at,paid_at FROM deposits WHERE user_id=%s ORDER BY created_at DESC", (user["id"],)).fetchall()
                    withdrawals = conn.execute("SELECT id,amount_cents,pix_type,pix_key,status,created_at,reviewed_at FROM withdrawals WHERE user_id=%s ORDER BY created_at DESC", (user["id"],)).fetchall()
                return self.send_json(200, {"deposits": deposits, "withdrawals": withdrawals})
            if path == "/api/influencer/overview":
                return self.influencer_overview()
            if path == "/api/admin/overview":
                return self.admin_overview()
            if path == "/api/admin/nyxpag-tx":
                self.user(("admin",))
                tx_id = parse_qs(urlparse(self.path).query).get("id", [""])[0]
                url = f"{NYXPAG_API_URL}/transactions/{tx_id}?refresh=true"
                req = Request(url, headers={"Authorization": "Bearer " + NYXPAG_API_KEY, "User-Agent": HTTP_USER_AGENT, "Accept": "application/json"})
                try:
                    with urlopen(req, timeout=15) as resp:
                        return self.send_json(200, json.load(resp))
                except HTTPError as exc:
                    return self.send_json(exc.code, {"error": exc.read().decode()})
            if path == "/api/game/active":
                return self.game_active()
            raise ApiError(404, "Rota não encontrada")
        except ApiError as e: self.send_json(e.status, {"error": e.message})
        except Exception as exc: self.send_json(500, {"error": f"Erro interno: {str(exc)[:120]}"})

    def do_POST(self):
        try:
            migrate(); path = self.route()
            if path == "/api/webhooks/nyxpag": return self.nyxpag_webhook()
            if path == "/api/webhooks/vulcanopay": return self.vulcano_webhook()
            data = self.body()
            if path == "/api/auth/register": return self.register(data)
            if path == "/api/auth/login": return self.login(data)
            if path == "/api/deposits": return self.deposit(data)
            if path == "/api/withdrawals": return self.withdraw(data)
            if path == "/api/admin/withdrawals": return self.admin_withdrawal(data)
            if path == "/api/influencer/withdraw": return self.influencer_withdraw(data)
            if path == "/api/game/bet": return self.game_bet(data)
            if path == "/api/game/end": return self.game_end(data)
            raise ApiError(404, "Rota não encontrada")
        except ApiError as e: self.send_json(e.status, {"error": e.message})
        except psycopg.errors.UniqueViolation: self.send_json(409, {"error": "Registro duplicado"})
        except Exception as exc: self.send_json(500, {"error": f"Erro interno: {str(exc)[:120]}"})

    def register(self, data):
        name = str(data.get("name", "")).strip()
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))
        ref_code = str(data.get("referralCode") or data.get("ref") or "").strip().upper()
        if len(name) < 2 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(password) < 8:
            raise ApiError(422, "Dados inválidos: verifique nome, e-mail e senha (mínimo 8 dígitos).")
        digest, salt = password_hash(password)
        cpf = re.sub(r"\D", "", str(data.get("cpf", "")))
        my_ref_code = "RUSH-" + secrets.token_hex(3).upper()

        with db() as conn:
            referred_by = None
            if ref_code:
                referrer = conn.execute("SELECT referral_code FROM users WHERE referral_code=%s", (ref_code,)).fetchone()
                if referrer: referred_by = referrer["referral_code"]

            row = conn.execute("""
                INSERT INTO users(name, email, phone, cpf_hash, cpf_last4, password_hash, password_salt, referral_code, referred_by_code)
                VALUES(%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, referral_code
            """, (name, email, str(data.get("phone", "")), hashlib.sha256(cpf.encode()).hexdigest() if cpf else None,
                  cpf[-4:] if cpf else None, digest, salt, my_ref_code, referred_by)).fetchone()
            conn.execute("INSERT INTO wallets(user_id) VALUES(%s)", (row["id"],))

        self.send_json(201, {"ok": True, "referralCode": my_ref_code})

    def login(self, data):
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))
        ip = self.client_ip()
        key_hash = hashlib.sha256(f"{ip}:{email}".encode()).hexdigest()

        with db() as conn:
            attempt = conn.execute("SELECT attempts, blocked_until FROM login_attempts WHERE key_hash=%s", (key_hash,)).fetchone()
            if attempt and attempt["blocked_until"] and attempt["blocked_until"] > now():
                diff_sec = int((attempt["blocked_until"] - now()).total_seconds())
                minutes = max(1, diff_sec // 60 + 1)
                raise ApiError(429, f"Muitas tentativas incorretas. Conta temporariamente bloqueada. Tente novamente em {minutes} minuto(s).")

            user = conn.execute("SELECT * FROM users WHERE lower(email)=%s", (email,)).fetchone()
            if not user:
                self.record_failed_login(conn, key_hash, ip, email)
                raise ApiError(401, "E-mail ou senha inválidos")

            digest, _ = password_hash(password, bytes.fromhex(user["password_salt"]))
            if not hmac.compare_digest(digest, user["password_hash"]):
                self.record_failed_login(conn, key_hash, ip, email)
                raise ApiError(401, "E-mail ou senha inválidos")

            conn.execute("DELETE FROM login_attempts WHERE key_hash=%s", (key_hash,))
            token = secrets.token_urlsafe(32)
            expiry = now() + timedelta(hours=24)
            conn.execute("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(%s, %s, %s)", (token_hash(token), user["id"], expiry))

        self.send_json(200, {"token": token, "expiresAt": expiry.isoformat(), "role": user["role"]})

    def record_failed_login(self, conn, key_hash, ip, email):
        conn.execute("""
            INSERT INTO login_attempts(key_hash, ip, email, attempts, last_attempt, blocked_until)
            VALUES(%s, %s, %s, 1, NOW(), NULL)
            ON CONFLICT (key_hash) DO UPDATE SET
                attempts = login_attempts.attempts + 1,
                last_attempt = NOW(),
                blocked_until = CASE WHEN login_attempts.attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE NULL END
        """, (key_hash, ip, email))

    def deposit(self, data):
        user = self.user()
        amount = int(data.get("amountCents", 0))
        if amount < MIN_DEPOSIT: raise ApiError(422, "Depósito mínimo de R$ 20,00")
        if NYXPAG_API_KEY: return self.nyxpag_deposit(user, amount, data)
        if VULCANO_API_KEY: return self.vulcano_deposit(user, amount, data)
        raise ApiError(503, "Pagamento ainda não configurado")

    def nyxpag_deposit(self, user, amount, data):
        document = re.sub(r"\D", "", str(data.get("payerDocument", "")))
        if len(document) != 11: raise ApiError(422, "Informe um CPF válido para gerar o PIX")
        dep = "dep_" + secrets.token_urlsafe(12)
        payload = {
            "amount": amount / 100,
            "externalId": dep,
            "description": "Depósito Rush Arena",
            "coverFee": False,
            "payer": {"name": user["name"], "document": document, "email": user["email"]}
        }
        headers = {
            "Authorization": "Bearer " + NYXPAG_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": HTTP_USER_AGENT,
            "Idempotency-Key": dep
        }
        req = Request(NYXPAG_API_URL + "/transactions", json.dumps(payload, separators=(",", ":")).encode(), headers, method="POST")
        try:
            with urlopen(req, timeout=20) as response: remote = json.load(response)
        except HTTPError as exc:
            raw = exc.read(8192).decode("utf-8", "replace")
            provider_message = ""
            try:
                error_payload = json.loads(raw)
                error_value = error_payload.get("error", {})
                if isinstance(error_value, dict):
                    provider_message = str(error_value.get("message") or error_value.get("code") or "").strip()
                else:
                    provider_message = str(error_value or error_payload.get("message") or error_payload.get("code") or "").strip()
            except json.JSONDecodeError:
                provider_message = raw.strip()[:180]

            print(json.dumps({"event": "nyxpag_charge_rejected", "status": exc.code, "message": provider_message[:300]}))
            if exc.code == 401:
                raise ApiError(502, "NyxPag recusou a chave de API (401). Verifique se a chave de produção está ativa e completa.")
            if exc.code == 403:
                detail = f" Detalhe: {provider_message}" if provider_message else ""
                raise ApiError(502, f"NyxPag bloqueou a cobrança (HTTP 403).{detail}")
            if exc.code == 429:
                raise ApiError(503, "Muitas solicitações à NyxPag. Aguarde um minuto e tente novamente.")
            if provider_message:
                raise ApiError(502, f"NyxPag: {provider_message[:180]}")
            raise ApiError(502, f"NyxPag recusou a cobrança (HTTP {exc.code}).")
        except (URLError, TimeoutError):
            raise ApiError(502, "Não foi possível conectar à NyxPag. Tente novamente em instantes.")
        except json.JSONDecodeError:
            raise ApiError(502, "A NyxPag retornou uma resposta inválida.")

        if not isinstance(remote, dict) or remote.get("success") is False:
            raise ApiError(502, "A NyxPag não confirmou a criação da cobrança.")
        transaction = remote.get("data") if isinstance(remote.get("data"), dict) else remote
        pix = transaction.get("pix") if isinstance(transaction.get("pix"), dict) else (remote.get("pix") if isinstance(remote.get("pix"), dict) else {})
        code = str(
            pix.get("copyPaste") or pix.get("code") or pix.get("copy_paste") or pix.get("payload") or pix.get("brCode") or
            transaction.get("pixCopyPaste") or transaction.get("copyPaste") or transaction.get("brCode") or ""
        )
        qr_code = pix.get("qrCodeBase64") or pix.get("qrCode") or pix.get("qr_code") or transaction.get("qrCodeBase64") or transaction.get("qrCode") or ""
        ref = str(transaction.get("id") or transaction.get("externalId") or remote.get("id") or dep)

        if not code:
            if transaction.get("processingState") == "reconciling" or remote.get("warning"):
                raise ApiError(502, f"Cobrança criada na NyxPag (ID: {ref}), mas a sua conta NyxPag está em status 'reconciling'. Solicite ao suporte da NyxPag a vinculação da adquirente/rota Pix para geração imediata do QR Code.")
            sample = json.dumps(remote, ensure_ascii=False)
            raise ApiError(502, f"A NyxPag não retornou um código PIX. Resposta: {sample}")

        expires_at = transaction.get("expiresAt") or transaction.get("expires_at")

        with db() as conn:
            conn.execute("""
                INSERT INTO deposits(id, user_id, amount_cents, bonus_cents, provider, provider_reference, pix_code, expires_at)
                VALUES(%s, %s, %s, %s, 'nyxpag', %s, %s, %s)
            """, (dep, user["id"], amount, bonus(amount), ref, code, expires_at))

        self.send_json(201, {
            "id": dep, "status": str(transaction.get("status") or "pending"), "provider": "nyxpag",
            "amountCents": amount, "bonusCents": bonus(amount), "pixCopyPaste": code,
            "qrCode": qr_code, "expiresAt": expires_at
        })

    def vulcano_deposit(self, user, amount, data):
        dep = "dep_" + secrets.token_urlsafe(12)
        document = re.sub(r"\D", "", str(data.get("payerDocument", "")))
        payload = {"amount": amount, "description": "Depósito Rush Arena", "external_id": dep, "customer": {"name": user["name"], "email": user["email"]}, "metadata": {"source": "rush_arena", "user_id": user["id"]}}
        if document: payload["customer"]["document"] = document
        headers = {"Authorization": "Bearer " + VULCANO_API_KEY, "Content-Type": "application/json", "User-Agent": HTTP_USER_AGENT, "Idempotency-Key": dep}
        req = Request(VULCANO_API_URL + "/charges", json.dumps(payload).encode(), headers, method="POST")
        try:
            with urlopen(req, timeout=20) as response: remote = json.load(response)
        except HTTPError as exc:
            raw = exc.read(8192).decode("utf-8", "replace")
            try:
                error_payload = json.loads(raw)
                provider_message = str(error_payload.get("message") or error_payload.get("error") or error_payload.get("detail") or "").strip()
            except json.JSONDecodeError: provider_message = raw.strip()[:180]
            print(json.dumps({"event": "vulcanopay_charge_rejected", "status": exc.code, "message": provider_message[:300]}))
            if exc.code in {401, 403}: raise ApiError(502, "VulcanoPay recusou a cobrança. Verifique a credencial.")
            if provider_message: raise ApiError(502, f"VulcanoPay: {provider_message[:180]}")
            raise ApiError(502, f"VulcanoPay recusou a cobrança (HTTP {exc.code}).")
        except (URLError, TimeoutError): raise ApiError(502, "Não foi possível conectar à VulcanoPay.")
        except json.JSONDecodeError: raise ApiError(502, "A VulcanoPay retornou uma resposta inválida.")

        if isinstance(remote.get("data"), dict): remote = remote["data"]
        pix = remote.get("pix", {}); code = str(pix.get("copy_paste", "")); ref = str(remote.get("id", ""))
        if not code or not ref: raise ApiError(502, "Pix inválido")
        with db() as conn:
            conn.execute("INSERT INTO deposits(id,user_id,amount_cents,bonus_cents,provider,provider_reference,pix_code,expires_at) VALUES(%s,%s,%s,%s,'vulcanopay',%s,%s,%s)", (dep, user["id"], amount, bonus(amount), ref, code, remote.get("expires_at")))
        self.send_json(201, {"id": dep, "status": "pending", "provider": "vulcanopay", "amountCents": amount, "bonusCents": bonus(amount), "pixCopyPaste": code, "qrCode": pix.get("qr_code"), "expiresAt": remote.get("expires_at")})

    def nyxpag_webhook(self):
        raw = self.body(raw=True)
        signature = self.headers.get("X-NyxPag-Signature", "")
        if not signed_webhook_valid(raw, signature, NYXPAG_WEBHOOK_SECRET):
            raise ApiError(401, "Assinatura inválida")
        try: event = json.loads(raw)
        except json.JSONDecodeError: raise ApiError(400, "JSON inválido")

        transaction = event.get("data", {})
        event_name = str(event.get("event", ""))
        event_id = str(event.get("id") or self.headers.get("X-NyxPag-Delivery", ""))
        if not event_id or not isinstance(transaction, dict): raise ApiError(400, "Evento inválido")
        if self.headers.get("X-NyxPag-Event", event_name) != event_name: raise ApiError(400, "Evento inválido")

        expected_environment = "test" if NYXPAG_API_KEY.startswith("nyx_test_") else "live"
        if transaction.get("environment") and transaction.get("environment") != expected_environment:
            return self.send_json(200, {"ok": True, "ignored": True})

        with db() as conn:
            inserted = conn.execute("INSERT INTO payment_events(event_id,provider,payload) VALUES(%s,'nyxpag',%s) ON CONFLICT (event_id) DO NOTHING RETURNING event_id", (event_id, json.dumps(event))).fetchone()
            if not inserted: return self.send_json(200, {"ok": True, "duplicate": True})

            dep = conn.execute("SELECT * FROM deposits WHERE provider='nyxpag' AND (provider_reference=%s OR id=%s) FOR UPDATE", (str(transaction.get("id", "")), str(transaction.get("externalId", "")))).fetchone()
            is_deposit = transaction.get("direction") == "in" and transaction.get("type") == "payment"
            try: received_cents = round(float(transaction.get("amount", -1)) * 100)
            except (TypeError, ValueError): received_cents = -1

            if dep and is_deposit and event_name == "transaction.approved" and dep["status"] != "paid" and received_cents == dep["amount_cents"]:
                credit = dep["amount_cents"] + dep["bonus_cents"]
                conn.execute("UPDATE deposits SET status='paid', paid_at=NOW() WHERE id=%s", (dep["id"],))
                conn.execute("UPDATE wallets SET balance_cents=balance_cents+%s, updated_at=NOW() WHERE user_id=%s", (credit, dep["user_id"]))
                conn.execute("""
                    INSERT INTO wallet_transactions(id, user_id, kind, amount_cents, reference_type, reference_id)
                    VALUES(%s, %s, 'deposit_credit', %s, 'deposit', %s)
                    ON CONFLICT (kind, reference_type, reference_id) DO NOTHING
                """, ("tx_" + secrets.token_urlsafe(12), dep["user_id"], credit, dep["id"]))

                # Check and process referral commission
                user_row = conn.execute("SELECT referred_by_code FROM users WHERE id=%s", (dep["user_id"],)).fetchone()
                if user_row and user_row["referred_by_code"]:
                    ref_owner = conn.execute("""
                        SELECT u.id, u.role, COALESCE(i.commission_rate, CASE WHEN u.role='influencer' THEN 30 ELSE 10 END) AS rate
                        FROM users u LEFT JOIN influencers i ON i.user_id=u.id
                        WHERE u.referral_code=%s
                    """, (user_row["referred_by_code"],)).fetchone()
                    if ref_owner:
                        rate = int(ref_owner["rate"] or 10)
                        comm_cents = round(dep["amount_cents"] * rate / 100)
                        if comm_cents > 0:
                            cid = "comm_" + secrets.token_urlsafe(12)
                            conn.execute("""
                                INSERT INTO commissions(id, beneficiary_user_id, referred_user_id, deposit_id, deposit_cents, commission_cents, rate_percent)
                                VALUES(%s, %s, %s, %s, %s, %s, %s)
                            """, (cid, ref_owner["id"], dep["user_id"], dep["id"], dep["amount_cents"], comm_cents, rate))
                            conn.execute("UPDATE wallets SET balance_cents=balance_cents+%s, updated_at=NOW() WHERE user_id=%s", (comm_cents, ref_owner["id"]))
                            conn.execute("""
                                INSERT INTO wallet_transactions(id, user_id, kind, amount_cents, reference_type, reference_id)
                                VALUES(%s, %s, 'referral_commission', %s, 'commission', %s)
                                ON CONFLICT (kind, reference_type, reference_id) DO NOTHING
                            """, ("tx_" + secrets.token_urlsafe(12), ref_owner["id"], comm_cents, cid))

            elif dep and is_deposit and event_name in {"transaction.failed", "transaction.cancelled"} and dep["status"] == "pending":
                status = "expired" if transaction.get("expired") else ("failed" if event_name == "transaction.failed" else "cancelled")
                conn.execute("UPDATE deposits SET status=%s WHERE id=%s", (status, dep["id"]))

            conn.execute("UPDATE payment_events SET processed_at=NOW() WHERE event_id=%s", (event_id,))
        self.send_json(200, {"ok": True})

    def vulcano_webhook(self):
        raw = self.body(raw=True)
        signature = self.headers.get("X-Vulcano-Signature", "")
        if not signed_webhook_valid(raw, signature, VULCANO_WEBHOOK_SECRET):
            raise ApiError(401, "Assinatura inválida")
        event = json.loads(raw); charge = event.get("data", {}); event_id = str(event.get("id", ""))
        expected_live = VULCANO_API_KEY.startswith("vk_live_")
        if bool(event.get("livemode", False)) != expected_live: return self.send_json(200, {"ok": True, "ignored": True})

        with db() as conn:
            try: conn.execute("INSERT INTO payment_events(event_id,provider,payload) VALUES(%s,'vulcanopay',%s)", (event_id, json.dumps(event)))
            except psycopg.errors.UniqueViolation: return self.send_json(200, {"ok": True, "duplicate": True})
            dep = conn.execute("SELECT * FROM deposits WHERE provider_reference=%s OR id=%s FOR UPDATE", (str(charge.get("id", "")), str(charge.get("external_id", "")))).fetchone()
            if dep and event.get("event") == "charge.paid" and dep["status"] != "paid":
                credit = dep["amount_cents"] + dep["bonus_cents"]
                conn.execute("UPDATE deposits SET status='paid',paid_at=NOW() WHERE id=%s", (dep["id"],))
                conn.execute("UPDATE wallets SET balance_cents=balance_cents+%s,updated_at=NOW() WHERE user_id=%s", (credit, dep["user_id"]))
                conn.execute("INSERT INTO wallet_transactions(id,user_id,kind,amount_cents,reference_type,reference_id) VALUES(%s,%s,'deposit_credit',%s,'deposit',%s)", ("tx_" + secrets.token_urlsafe(12), dep["user_id"], credit, dep["id"]))
            elif dep and event.get("event") == "charge.expired" and dep["status"] == "pending":
                conn.execute("UPDATE deposits SET status='expired' WHERE id=%s", (dep["id"],))
            conn.execute("UPDATE payment_events SET processed_at=NOW() WHERE event_id=%s", (event_id,))
        self.send_json(200, {"ok": True})

    def withdraw(self, data):
        user = self.user()
        amount = int(data.get("amountCents", 0))
        kind = str(data.get("pixType", "")).lower()
        key = str(data.get("pixKey", "")).strip()
        if amount < MIN_WITHDRAWAL or kind not in {"cpf", "cnpj", "email", "phone", "random"} or len(key) < 3:
            raise ApiError(422, "Dados de saque inválidos; mínimo de R$ 30,00")
        supplied_password = str(data.get("withdrawalPassword", ""))
        if not supplied_password: raise ApiError(422, "Informe sua senha para confirmar o saque")
        digest, _ = password_hash(supplied_password, bytes.fromhex(user["password_salt"]))
        if not hmac.compare_digest(digest, user["password_hash"]): raise ApiError(401, "Senha incorreta")

        wid = "wd_" + secrets.token_urlsafe(12)
        with db() as conn:
            wallet = conn.execute("SELECT balance_cents FROM wallets WHERE user_id=%s FOR UPDATE", (user["id"],)).fetchone()
            if not wallet or wallet["balance_cents"] < amount: raise ApiError(409, "Saldo insuficiente")
            conn.execute("UPDATE wallets SET balance_cents=balance_cents-%s, updated_at=NOW() WHERE user_id=%s", (amount, user["id"]))
            conn.execute("INSERT INTO withdrawals(id,user_id,amount_cents,pix_type,pix_key) VALUES(%s,%s,%s,%s,%s)", (wid, user["id"], amount, kind, key))
            conn.execute("INSERT INTO wallet_transactions(id,user_id,kind,amount_cents,reference_type,reference_id) VALUES(%s,%s,'withdrawal_hold',%s,'withdrawal',%s)", ("tx_" + secrets.token_urlsafe(12), user["id"], -amount, wid))
        self.send_json(201, {"id": wid, "status": "pending"})

    def influencer_overview(self):
        user = self.user()
        with db() as conn:
            wallet = conn.execute("SELECT balance_cents FROM wallets WHERE user_id=%s", (user["id"],)).fetchone()
            ref_code = user.get("referral_code") or ""
            if not ref_code:
                ref_code = "RUSH-" + secrets.token_hex(3).upper()
                conn.execute("UPDATE users SET referral_code=%s WHERE id=%s", (ref_code, user["id"]))

            inf_config = conn.execute("SELECT commission_rate, active FROM influencers WHERE user_id=%s", (user["id"],)).fetchone()
            rate = inf_config["commission_rate"] if inf_config else (30 if user["role"] == "influencer" else 10)

            stats = conn.execute("""
                SELECT
                    COALESCE(SUM(commission_cents), 0) AS total_commission_cents,
                    COALESCE(SUM(deposit_cents), 0) AS total_deposits_cents,
                    COUNT(DISTINCT referred_user_id) AS active_referrals
                FROM commissions WHERE beneficiary_user_id=%s
            """, (user["id"],)).fetchone()

            total_referred = conn.execute("SELECT COUNT(*) AS count FROM users WHERE referred_by_code=%s", (ref_code,)).fetchone()["count"]

            referred_users = conn.execute("""
                SELECT
                    u.name, u.email, u.created_at,
                    COALESCE(COUNT(c.id), 0) AS deposits_count,
                    COALESCE(SUM(c.deposit_cents), 0) AS deposits_cents,
                    COALESCE(SUM(c.commission_cents), 0) AS commission_cents,
                    MAX(c.created_at) AS last_activity
                FROM users u
                LEFT JOIN commissions c ON c.referred_user_id = u.id AND c.beneficiary_user_id = %s
                WHERE u.referred_by_code = %s
                GROUP BY u.id, u.name, u.email, u.created_at
                ORDER BY last_activity DESC NULLS LAST, u.created_at DESC
                LIMIT 100
            """, (user["id"], ref_code)).fetchall()

            history = conn.execute("""
                SELECT id, kind, amount_cents, reference_type, reference_id, created_at
                FROM wallet_transactions
                WHERE user_id=%s AND kind IN ('referral_commission', 'withdrawal_hold', 'withdrawal_refund')
                ORDER BY created_at DESC LIMIT 50
            """, (user["id"],)).fetchall()

        self.send_json(200, {
            "referralCode": ref_code,
            "commissionRate": rate,
            "balanceCents": wallet["balance_cents"] if wallet else 0,
            "totalCommissionCents": stats["total_commission_cents"],
            "totalDepositsCents": stats["total_deposits_cents"],
            "totalReferredUsers": total_referred,
            "referredUsers": referred_users,
            "history": history
        })

    def influencer_withdraw(self, data):
        user = self.user()
        amount = int(data.get("amountCents", 0))
        kind = str(data.get("pixType", "")).lower()
        key = str(data.get("pixKey", "")).strip()
        if amount < 2000 or kind not in {"cpf", "cnpj", "email", "phone", "random"} or len(key) < 3:
            raise ApiError(422, "Saque mínimo de R$ 20,00 e chave Pix válida.")

        wid = "wd_inf_" + secrets.token_urlsafe(12)
        with db() as conn:
            wallet = conn.execute("SELECT balance_cents FROM wallets WHERE user_id=%s FOR UPDATE", (user["id"],)).fetchone()
            if not wallet or wallet["balance_cents"] < amount: raise ApiError(409, "Saldo insuficiente para saque de comissão.")
            conn.execute("UPDATE wallets SET balance_cents=balance_cents-%s, updated_at=NOW() WHERE user_id=%s", (amount, user["id"]))
            conn.execute("INSERT INTO withdrawals(id,user_id,amount_cents,pix_type,pix_key) VALUES(%s,%s,%s,%s,%s)", (wid, user["id"], amount, kind, key))
            conn.execute("INSERT INTO wallet_transactions(id,user_id,kind,amount_cents,reference_type,reference_id) VALUES(%s,%s,'withdrawal_hold',%s,'influencer_withdrawal',%s)", ("tx_" + secrets.token_urlsafe(12), user["id"], -amount, wid))
        self.send_json(201, {"id": wid, "status": "pending"})

    def game_bet(self, data):
        user = self.user()
        stake = int(data.get("stakeCents", 0))
        if stake not in GAME_STAKES:
            raise ApiError(422, "Valor de entrada inválido. Escolha R$ 10, R$ 20, R$ 30 ou R$ 50.")

        round_id = "round_" + secrets.token_urlsafe(12)
        with db() as conn:
            wallet = conn.execute("SELECT balance_cents FROM wallets WHERE user_id=%s FOR UPDATE", (user["id"],)).fetchone()
            if not wallet or wallet["balance_cents"] < stake:
                raise ApiError(409, "Saldo insuficiente para esta entrada. Faça um depósito para continuar.")

            conn.execute("UPDATE wallets SET balance_cents=balance_cents-%s, updated_at=NOW() WHERE user_id=%s", (stake, user["id"]))
            conn.execute("INSERT INTO game_rounds(id, user_id, stake_cents, status) VALUES(%s, %s, %s, 'active')", (round_id, user["id"], stake))
            conn.execute("INSERT INTO wallet_transactions(id, user_id, kind, amount_cents, reference_type, reference_id) VALUES(%s, %s, 'game_bet', %s, 'game_round', %s)", ("tx_" + secrets.token_urlsafe(12), user["id"], -stake, round_id))
            updated_wallet = conn.execute("SELECT balance_cents FROM wallets WHERE user_id=%s", (user["id"],)).fetchone()

        self.send_json(201, {
            "ok": True,
            "roundId": round_id,
            "stakeCents": stake,
            "balanceCents": updated_wallet["balance_cents"]
        })

    def game_end(self, data):
        user = self.user()
        round_id = str(data.get("roundId", "")).strip()
        outcome = str(data.get("outcome", "lost")).strip().lower()
        multiplier = float(data.get("multiplier", 0.0))

        if not round_id: raise ApiError(422, "ID da rodada não informado.")

        with db() as conn:
            rnd = conn.execute("SELECT * FROM game_rounds WHERE id=%s AND user_id=%s FOR UPDATE", (round_id, user["id"])).fetchone()
            if not rnd: raise ApiError(404, "Rodada não encontrada.")
            if rnd["status"] != "active": raise ApiError(409, "Esta rodada já foi finalizada.")

            payout_cents = 0
            if outcome == "won" and multiplier > 0:
                multiplier = min(multiplier, 10.0)  # Safe cap
                payout_cents = round(rnd["stake_cents"] * multiplier)
                if payout_cents > 0:
                    conn.execute("UPDATE wallets SET balance_cents=balance_cents+%s, updated_at=NOW() WHERE user_id=%s", (payout_cents, user["id"]))
                    conn.execute("INSERT INTO wallet_transactions(id, user_id, kind, amount_cents, reference_type, reference_id) VALUES(%s, %s, 'game_win', %s, 'game_round', %s)", ("tx_" + secrets.token_urlsafe(12), user["id"], payout_cents, round_id))
                conn.execute("UPDATE game_rounds SET status='won', multiplier=%s, payout_cents=%s, completed_at=NOW() WHERE id=%s", (multiplier, payout_cents, round_id))
            else:
                conn.execute("UPDATE game_rounds SET status='lost', multiplier=0, payout_cents=0, completed_at=NOW() WHERE id=%s", (round_id,))

            updated_wallet = conn.execute("SELECT balance_cents FROM wallets WHERE user_id=%s", (user["id"],)).fetchone()

        self.send_json(200, {
            "ok": True,
            "roundId": round_id,
            "outcome": outcome,
            "payoutCents": payout_cents,
            "balanceCents": updated_wallet["balance_cents"]
        })

    def game_active(self):
        user = self.user()
        with db() as conn:
            active_round = conn.execute("SELECT id, stake_cents, created_at FROM game_rounds WHERE user_id=%s AND status='active' ORDER BY created_at DESC LIMIT 1", (user["id"],)).fetchone()
        self.send_json(200, {"activeRound": active_round})

    def admin_overview(self):
        self.user(("admin",))
        with db() as conn:
            accounts = conn.execute("""
                SELECT u.id, u.name, u.email, u.phone, u.cpf_last4, u.role, u.referral_code, u.created_at, COALESCE(w.balance_cents,0) AS balance_cents
                FROM users u LEFT JOIN wallets w ON w.user_id=u.id ORDER BY u.created_at DESC LIMIT 500
            """).fetchall()
            withdrawals = conn.execute("""
                SELECT wd.id, wd.amount_cents, wd.pix_type, wd.pix_key, wd.status, wd.provider_reference, wd.created_at, wd.reviewed_at, u.name, u.email
                FROM withdrawals wd JOIN users u ON u.id=wd.user_id ORDER BY wd.created_at DESC LIMIT 500
            """).fetchall()
            totals = conn.execute("""
                SELECT
                    (SELECT COUNT(*) FROM users) AS accounts,
                    (SELECT COALESCE(SUM(amount_cents),0) FROM deposits WHERE status='paid') AS deposits_cents,
                    (SELECT COALESCE(SUM(balance_cents),0) FROM wallets) AS wallet_cents,
                    (SELECT COUNT(*) FROM withdrawals WHERE status='pending') AS pending_withdrawals,
                    (SELECT COALESCE(SUM(commission_cents),0) FROM commissions) AS commissions_cents,
                    (SELECT COUNT(*) FROM game_rounds) AS game_rounds_count
            """).fetchone()
        self.send_json(200, {"accounts": accounts, "withdrawals": withdrawals, "totals": totals})

    def admin_withdrawal(self, data):
        admin = self.user(("admin",))
        wid = str(data.get("id", "")).strip()
        action = str(data.get("action", "")).strip()
        if not wid or action not in {"approve", "approve_and_pay", "reject", "update_pix"}:
            raise ApiError(422, "Ação inválida")

        with db() as conn:
            row = conn.execute("SELECT * FROM withdrawals WHERE id=%s FOR UPDATE", (wid,)).fetchone()
            if not row: raise ApiError(404, "Saque não encontrado")

            if action == "update_pix":
                key = str(data.get("pixKey", "")).strip()
                if len(key) < 3: raise ApiError(422, "Chave Pix inválida")
                conn.execute("UPDATE withdrawals SET pix_key=%s WHERE id=%s", (key, wid))
            elif row["status"] != "pending":
                raise ApiError(409, "Saque já analisado")
            elif action == "approve_and_pay":
                # Execute automated NyxPag transfer if configured
                tx_ref = None
                if NYXPAG_API_KEY:
                    tx_ref = self.nyxpag_transfer(row["pix_key"], row["pix_type"], row["amount_cents"], wid)
                conn.execute("UPDATE withdrawals SET status='approved', provider_reference=%s, reviewed_at=NOW(), reviewed_by=%s WHERE id=%s", (tx_ref or "manual_payout", admin["id"], wid))
            elif action == "approve":
                conn.execute("UPDATE withdrawals SET status='approved', reviewed_at=NOW(), reviewed_by=%s WHERE id=%s", (admin["id"], wid))
            else:
                conn.execute("UPDATE withdrawals SET status='rejected', reviewed_at=NOW(), reviewed_by=%s WHERE id=%s", (admin["id"], wid))
                conn.execute("UPDATE wallets SET balance_cents=balance_cents+%s, updated_at=NOW() WHERE user_id=%s", (row["amount_cents"], row["user_id"]))
                conn.execute("INSERT INTO wallet_transactions(id, user_id, kind, amount_cents, reference_type, reference_id) VALUES(%s, %s, 'withdrawal_refund', %s, 'withdrawal', %s) ON CONFLICT (kind, reference_type, reference_id) DO NOTHING", ("tx_" + secrets.token_urlsafe(12), row["user_id"], row["amount_cents"], wid))

        self.send_json(200, {"ok": True})

    def nyxpag_transfer(self, pix_key, pix_type, amount_cents, external_id):
        dest_type = "evp" if pix_type in {"random", "evp"} else pix_type
        payload = {
            "amount": amount_cents / 100,
            "externalId": external_id,
            "description": "Saque Rush Arena",
            "destination": {
                "key": pix_key,
                "type": dest_type
            }
        }
        headers = {
            "Authorization": "Bearer " + NYXPAG_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": HTTP_USER_AGENT,
            "Idempotency-Key": external_id
        }
        req = Request(NYXPAG_API_URL + "/transfers", json.dumps(payload, separators=(",", ":")).encode(), headers, method="POST")
        try:
            with urlopen(req, timeout=20) as response: remote = json.load(response)
            data = remote.get("data") if isinstance(remote.get("data"), dict) else remote
            return str(data.get("id") or "transfer_ok")
        except HTTPError as exc:
            raw = exc.read(8192).decode("utf-8", "replace")
            print(json.dumps({"event": "nyxpag_transfer_error", "status": exc.code, "body": raw[:300]}))
            raise ApiError(502, f"NyxPag falhou ao enviar o Pix de saque (HTTP {exc.code}). Detalhe: {raw[:140]}")
        except Exception as exc:
            raise ApiError(502, f"Erro ao comunicar com a NyxPag para transferência: {str(exc)[:100]}")
