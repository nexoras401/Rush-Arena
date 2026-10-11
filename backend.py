#!/usr/bin/env python3
"""Backend local inicial da Rush Arena.

Somente bibliotecas nativas: HTTP, SQLite, PBKDF2 e sessões Bearer.
Pagamentos ficam em modo sandbox até a integração com um PSP Pix.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
from api import demo_blocks
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = Path(os.environ.get("RUSH_DB_PATH", DATA_DIR / "rush_arena.sqlite3"))
HOST = os.environ.get("RUSH_HOST", "127.0.0.1")
PORT = int(os.environ.get("RUSH_PORT", "8766"))
WEBHOOK_SECRET = os.environ.get("RUSH_WEBHOOK_SECRET", "local-sandbox-change-me")
ZORYX_API_URL = os.environ.get("ZORYX_API_URL", "https://api.zoryxpay.com/v1").rstrip("/")
ZORYX_API_TOKEN = os.environ.get("ZORYX_API_TOKEN", "").strip()
ZORYX_WEBHOOK_SECRET = os.environ.get("ZORYX_WEBHOOK_SECRET", "").strip()
PUBLIC_BASE_URL = os.environ.get("RUSH_PUBLIC_BASE_URL", "").rstrip("/")
MISTIC_API_URL = os.environ.get("MISTIC_API_URL", "https://api.misticpay.com/api").rstrip("/")
MISTIC_CLIENT_ID = os.environ.get("MISTIC_CLIENT_ID", "").strip()
MISTIC_CLIENT_SECRET = os.environ.get("MISTIC_CLIENT_SECRET", "").strip()
MISTIC_WEBHOOK_SECRET = os.environ.get("MISTIC_WEBHOOK_SECRET", "").strip()
VULCANO_API_URL = os.environ.get("VULCANO_API_URL", "https://api.vulcanopay.com/v1").rstrip("/")
VULCANO_API_KEY = os.environ.get("VULCANO_API_KEY", "").strip()
VULCANO_WEBHOOK_SECRET = os.environ.get("VULCANO_WEBHOOK_SECRET", "").strip()
SESSION_HOURS = 24
MIN_DEPOSIT_CENTS = 2_000
MIN_WITHDRAWAL_CENTS = 3_000
RATE_LIMITS: dict[tuple[str, str], list[float]] = {}
RATE_LOCK = threading.Lock()
BLOCKED_SUFFIXES = {".py", ".pyc", ".md", ".cmd", ".bat", ".ps1", ".cjs", ".sqlite3", ".db", ".log", ".env", ".map"}
BLOCKED_NAMES = {"backend_smoke_test.py", "inspect_video.py", "sync_missing_assets.py", "webcopy-origin.txt"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")
    return db


def migrate() -> None:
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                phone TEXT,
                cpf TEXT,
                cpf_hash TEXT,
                cpf_last4 TEXT,
                password_hash TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin','influencer')),
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS wallets (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                balance_cents INTEGER NOT NULL DEFAULT 0 CHECK(balance_cents >= 0),
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS deposits (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                amount_cents INTEGER NOT NULL CHECK(amount_cents >= 2000),
                bonus_cents INTEGER NOT NULL DEFAULT 0,
                provider TEXT NOT NULL DEFAULT 'sandbox',
                provider_reference TEXT UNIQUE,
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','cancelled','failed')),
                created_at TEXT NOT NULL,
                paid_at TEXT
            );
            CREATE TABLE IF NOT EXISTS withdrawals (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                amount_cents INTEGER NOT NULL CHECK(amount_cents >= 3000),
                pix_type TEXT NOT NULL,
                pix_key TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','paid','failed')),
                created_at TEXT NOT NULL,
                reviewed_at TEXT,
                reviewed_by INTEGER REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                kind TEXT NOT NULL,
                amount_cents INTEGER NOT NULL,
                reference_type TEXT,
                reference_id TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(kind, reference_type, reference_id)
            );
            CREATE TABLE IF NOT EXISTS payment_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL,
                event_id TEXT NOT NULL UNIQUE,
                payload TEXT NOT NULL,
                received_at TEXT NOT NULL,
                processed_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_transactions_user ON wallet_transactions(user_id, created_at DESC);
            """
        )
        columns = {row["name"] for row in db.execute("PRAGMA table_info(users)")}
        if "cpf_hash" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN cpf_hash TEXT")
        if "cpf_last4" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN cpf_last4 TEXT")
        if "referral_code" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN referral_code TEXT")
        if "referred_by_code" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN referred_by_code TEXT")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_referral ON users(referral_code)")
        db.execute("CREATE TABLE IF NOT EXISTS demo_block_rounds(user_id INTEGER PRIMARY KEY REFERENCES users(id),state TEXT NOT NULL,last_request TEXT,last_payload TEXT)")
        deposit_columns = {row["name"] for row in db.execute("PRAGMA table_info(deposits)")}
        if "pix_code" not in deposit_columns:
            db.execute("ALTER TABLE deposits ADD COLUMN pix_code TEXT")
        if "expires_at" not in deposit_columns:
            db.execute("ALTER TABLE deposits ADD COLUMN expires_at TEXT")


def password_hash(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return digest.hex(), salt.hex()


def verify_password(password: str, expected: str, salt_hex: str) -> bool:
    actual, _ = password_hash(password, bytes.fromhex(salt_hex))
    return hmac.compare_digest(actual, expected)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def money_bonus(amount: int) -> int:
    return {3_000: 1_000, 5_000: 2_000, 10_000: 5_000}.get(amount, 0)


def zoryx_request(path: str, payload: dict) -> dict:
    if not ZORYX_API_TOKEN:
        raise ApiError(503, "ZoryxPay ainda não foi configurada")
    request = Request(
        ZORYX_API_URL + path,
        json.dumps(payload).encode(),
        {"Authorization": "Bearer " + ZORYX_API_TOKEN, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            value = json.load(response)
            if not isinstance(value, dict):
                raise ApiError(502, "Resposta inválida da ZoryxPay")
            return value
    except HTTPError as error:
        print(f"ZoryxPay HTTP {error.code}", file=sys.stderr)
        raise ApiError(502, "A ZoryxPay recusou a operação")
    except (URLError, TimeoutError, json.JSONDecodeError):
        raise ApiError(502, "Não foi possível comunicar com a ZoryxPay")


def mistic_request(path: str, payload: dict) -> dict:
    if not MISTIC_CLIENT_ID or not MISTIC_CLIENT_SECRET:
        raise ApiError(503, "MisticPay ainda não foi configurada")
    credentials = (MISTIC_CLIENT_ID + ":" + MISTIC_CLIENT_SECRET).encode()
    authorization = "Basic " + __import__("base64").b64encode(credentials).decode()
    request = Request(
        MISTIC_API_URL + path,
        json.dumps(payload).encode(),
        {"Authorization": authorization, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            value = json.load(response)
            if not isinstance(value, dict):
                raise ApiError(502, "Resposta inválida da MisticPay")
            return value
    except HTTPError as error:
        print(f"MisticPay HTTP {error.code}", file=sys.stderr)
        raise ApiError(502, "A MisticPay recusou a operação")
    except (URLError, TimeoutError, json.JSONDecodeError):
        raise ApiError(502, "Não foi possível comunicar com a MisticPay")


def vulcano_request(path: str, payload: dict | None = None, method: str = "POST", idempotency_key: str = "") -> dict:
    if not VULCANO_API_KEY:
        raise ApiError(503, "VulcanoPay ainda não foi configurada")
    headers = {"Authorization": "Bearer " + VULCANO_API_KEY, "Content-Type": "application/json"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    request = Request(VULCANO_API_URL + path, None if payload is None else json.dumps(payload).encode(), headers, method=method)
    try:
        with urlopen(request, timeout=20) as response:
            value = json.load(response)
            if not isinstance(value, dict):
                raise ApiError(502, "Resposta inválida da VulcanoPay")
            return value
    except HTTPError as error:
        print(f"VulcanoPay HTTP {error.code}", file=sys.stderr)
        raise ApiError(502, "A VulcanoPay recusou a operação")
    except (URLError, TimeoutError, json.JSONDecodeError):
        raise ApiError(502, "Não foi possível comunicar com a VulcanoPay")


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message


class Handler(SimpleHTTPRequestHandler):
    server_version = "RushArena"
    sys_version = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path: str) -> str:
        if urlparse(path).path == "/":
            return str(ROOT / "index.htm")
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'")
        self.send_header("Cache-Control", "no-store" if self.path.startswith("/api/") else "no-cache")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def forbidden_static_path(self) -> bool:
        path = urlparse(self.path).path
        normalized = unquote(path).replace("\\", "/").lower()
        name = Path(normalized).name
        return (
            normalized.startswith("/data/")
            or normalized.startswith("/video-")
            or any(part.startswith(".") for part in normalized.split("/") if part)
            or name in BLOCKED_NAMES
            or Path(name).suffix in BLOCKED_SUFFIXES
        )

    def rate_limit(self, bucket: str, maximum: int, window_seconds: int):
        address = self.client_address[0] if self.client_address else "unknown"
        key = (address, bucket)
        now = time.monotonic()
        with RATE_LOCK:
            attempts = [stamp for stamp in RATE_LIMITS.get(key, []) if now - stamp < window_seconds]
            if len(attempts) >= maximum:
                raise ApiError(429, "Muitas tentativas. Aguarde e tente novamente")
            attempts.append(now)
            RATE_LIMITS[key] = attempts

    def json_response(self, status: int, payload: dict | list):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 64_000:
                raise ValueError
            value = json.loads(self.rfile.read(length))
            if not isinstance(value, dict):
                raise ValueError
            return value
        except (ValueError, json.JSONDecodeError):
            raise ApiError(400, "JSON inválido")

    def auth(self, roles: tuple[str, ...] = ()) -> sqlite3.Row:
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            raise ApiError(401, "Autenticação necessária")
        with connect() as db:
            user = db.execute(
                """SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
                   WHERE s.token_hash=? AND s.expires_at>?""",
                (token_hash(header[7:]), utc_now()),
            ).fetchone()
        if not user:
            raise ApiError(401, "Sessão inválida ou expirada")
        if roles and user["role"] not in roles:
            raise ApiError(403, "Acesso não autorizado")
        return user

    def do_GET(self):
        try:
            path = urlparse(self.path).path
            if path == "/api/health":
                provider = "vulcanopay" if VULCANO_API_KEY else ("misticpay" if MISTIC_CLIENT_ID and MISTIC_CLIENT_SECRET else ("zoryxpay" if ZORYX_API_TOKEN else "sandbox"))
                return self.json_response(200, {"ok": True, "database": "sqlite", "payments": provider})
            if path == "/api/me":
                user = self.auth()
                with connect() as db:
                    wallet = db.execute("SELECT balance_cents FROM wallets WHERE user_id=?", (user["id"],)).fetchone()
                return self.json_response(200, {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"], "balanceCents": wallet["balance_cents"]})
            if path == "/api/payments":
                user = self.auth()
                with connect() as db:
                    deposits = [dict(row) for row in db.execute("SELECT id,amount_cents,bonus_cents,status,created_at,paid_at FROM deposits WHERE user_id=? ORDER BY created_at DESC", (user["id"],))]
                    withdrawals = [dict(row) for row in db.execute("SELECT id,amount_cents,pix_type,pix_key,status,created_at,reviewed_at FROM withdrawals WHERE user_id=? ORDER BY created_at DESC", (user["id"],))]
                return self.json_response(200, {"deposits": deposits, "withdrawals": withdrawals})
            if path == "/api/admin/overview":
                return self.admin_overview()
            if path == "/api/influencer/link":
                user = self.auth(("influencer",))
                with connect() as db:
                    count = db.execute("SELECT COUNT(*) FROM users WHERE referred_by_code=?", (user["referral_code"],)).fetchone()[0]
                return self.json_response(200, {"name": user["name"], "referralCode": user["referral_code"], "referredUsers": count})
            if path.startswith("/api/"):
                raise ApiError(404, "Rota não encontrada")
            if self.forbidden_static_path():
                raise ApiError(404, "Recurso não encontrado")
            return super().do_GET()
        except ApiError as error:
            return self.json_response(error.status, {"error": error.message})
        except Exception:
            return self.json_response(500, {"error": "Erro interno"})

    def do_POST(self):
        try:
            path = urlparse(self.path).path
            if path == "/api/webhooks/vulcanopay":
                return self.vulcano_webhook()
            if path == "/api/auth/login":
                self.rate_limit("login", 10, 600)
            elif path == "/api/auth/register":
                self.rate_limit("register", 5, 600)
            data = self.read_json()
            if path == "/api/auth/register":
                return self.register(data)
            if path == "/api/auth/login":
                return self.login(data)
            if path == "/api/admin/influencers":
                return self.create_influencer(data)
            if path.startswith("/api/demo/block-cash/"):
                return self.demo_block_action(path.rsplit('/', 1)[-1], data)
            if path == "/api/deposits":
                return self.create_deposit(data)
            if path == "/api/withdrawals":
                return self.create_withdrawal(data)
            if path == "/api/webhooks/sandbox":
                return self.sandbox_webhook(data)
            if path.startswith("/api/webhooks/zoryxpay/"):
                return self.zoryx_webhook(path.rsplit("/", 1)[-1], data)
            if path.startswith("/api/webhooks/misticpay/"):
                return self.mistic_webhook(path.rsplit("/", 1)[-1], data)
            if path.startswith("/api/admin/withdrawals/") and path.endswith("/approve"):
                return self.approve_withdrawal(path.split("/")[-2])
            raise ApiError(404, "Rota não encontrada")
        except ApiError as error:
            return self.json_response(error.status, {"error": error.message})
        except sqlite3.IntegrityError:
            return self.json_response(409, {"error": "Registro duplicado ou inválido"})
        except Exception as error:
            print(f"backend error: {error}", file=sys.stderr)
            return self.json_response(500, {"error": "Erro interno"})

    def do_HEAD(self):
        if self.forbidden_static_path():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        return super().do_HEAD()

    def register(self, data: dict):
        name = str(data.get("name", "")).strip()
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))
        if len(name) < 2 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(password) < 8:
            raise ApiError(422, "Nome, e-mail ou senha inválidos")
        digest, salt = password_hash(password)
        cpf_digits = re.sub(r"\D", "", str(data.get("cpf", "")))
        if cpf_digits and len(cpf_digits) != 11:
            raise ApiError(422, "O CPF deve conter 11 dígitos")
        cpf_digest = hashlib.sha256(cpf_digits.encode()).hexdigest() if cpf_digits else None
        cpf_last4 = cpf_digits[-4:] if cpf_digits else None
        with connect() as db:
            cursor = db.execute("INSERT INTO users(name,email,phone,cpf,cpf_hash,cpf_last4,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?,?,?)", (name, email, str(data.get("phone", "")), cpf_digits or None, cpf_digest, cpf_last4, digest, salt, utc_now()))
            db.execute("INSERT INTO wallets(user_id,balance_cents,updated_at) VALUES(?,0,?)", (cursor.lastrowid, utc_now()))
            referral = str(data.get("referralCode", "")).strip().upper()
            if referral and db.execute("SELECT 1 FROM users WHERE referral_code=? AND role='influencer'", (referral,)).fetchone():
                db.execute("UPDATE users SET referred_by_code=? WHERE id=?", (referral, cursor.lastrowid))
        return self.json_response(201, {"ok": True})

    def login(self, data: dict):
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))
        with connect() as db:
            user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            if not user or not verify_password(password, user["password_hash"], user["password_salt"]):
                raise ApiError(401, "E-mail ou senha inválidos")
            token = secrets.token_urlsafe(32)
            expiry = (datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)).isoformat()
            db.execute("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)", (token_hash(token), user["id"], expiry, utc_now()))
        return self.json_response(200, {"token": token, "expiresAt": expiry, "role": user["role"]})

    def create_deposit(self, data: dict):
        user = self.auth()
        amount = int(data.get("amountCents", 0))
        if amount < MIN_DEPOSIT_CENTS:
            raise ApiError(422, "Depósito mínimo de R$ 20,00")
        deposit_id = "dep_" + secrets.token_urlsafe(12)
        provider = "vulcanopay" if VULCANO_API_KEY else ("misticpay" if MISTIC_CLIENT_ID and MISTIC_CLIENT_SECRET else ("zoryxpay" if ZORYX_API_TOKEN else "sandbox"))
        payer_document = re.sub(r"\D", "", str(data.get("payerDocument", "")))
        if provider in {"misticpay", "zoryxpay"} and len(payer_document) not in {11, 14}:
            raise ApiError(422, "CPF/CNPJ do pagador é obrigatório para o Pix")
        with connect() as db:
            db.execute("INSERT INTO deposits(id,user_id,amount_cents,bonus_cents,provider,created_at) VALUES(?,?,?,?,?,?)", (deposit_id, user["id"], amount, money_bonus(amount), provider, utc_now()))
        if provider == "sandbox":
            return self.json_response(201, {"id": deposit_id, "status": "pending", "amountCents": amount, "bonusCents": money_bonus(amount), "provider": provider})
        if provider == "vulcanopay":
            customer = {"name": user["name"], "email": user["email"]}
            phone = re.sub(r"\D", "", user["phone"] or "")
            if phone:
                customer["phone"] = phone
            if payer_document:
                customer["document"] = payer_document
            payload = {"amount": amount, "description": "Depósito Rush Arena", "external_id": deposit_id, "customer": customer, "metadata": {"source": "rush_arena", "user_id": user["id"]}}
            try:
                remote = vulcano_request("/charges", payload, idempotency_key=deposit_id)
            except ApiError:
                with connect() as db:
                    db.execute("UPDATE deposits SET status='failed' WHERE id=?", (deposit_id,))
                raise
            pix = remote.get("pix") if isinstance(remote.get("pix"), dict) else {}
            provider_reference = str(remote.get("id", ""))
            pix_code = str(pix.get("copy_paste", ""))
            qr_code = str(pix.get("qr_code", ""))
            expires_at = remote.get("expires_at")
            if not provider_reference or not pix_code:
                with connect() as db:
                    db.execute("UPDATE deposits SET status='failed' WHERE id=?", (deposit_id,))
                raise ApiError(502, "A VulcanoPay não retornou um Pix válido")
            with connect() as db:
                db.execute("UPDATE deposits SET provider_reference=?,pix_code=?,expires_at=? WHERE id=?", (provider_reference, pix_code, expires_at, deposit_id))
            return self.json_response(201, {"id": deposit_id, "providerTransactionId": provider_reference, "status": str(remote.get("status", "pending")).lower(), "amountCents": amount, "bonusCents": money_bonus(amount), "provider": provider, "pixCopyPaste": pix_code, "qrCode": qr_code, "expiresAt": expires_at, "livemode": bool(remote.get("livemode", False))})
        if provider == "misticpay":
            if not PUBLIC_BASE_URL or not MISTIC_WEBHOOK_SECRET:
                with connect() as db:
                    db.execute("UPDATE deposits SET status='failed' WHERE id=?", (deposit_id,))
                raise ApiError(503, "Configure RUSH_PUBLIC_BASE_URL e MISTIC_WEBHOOK_SECRET")
            payload = {
                "amount": round(amount / 100, 2),
                "payerName": user["name"],
                "payerDocument": payer_document,
                "transactionId": deposit_id,
                "description": "Depósito Rush Arena",
                "projectWebhook": f"{PUBLIC_BASE_URL}/api/webhooks/misticpay/{MISTIC_WEBHOOK_SECRET}",
            }
            try:
                remote = mistic_request("/transactions/create", payload)
            except ApiError:
                with connect() as db:
                    db.execute("UPDATE deposits SET status='failed' WHERE id=?", (deposit_id,))
                raise
            remote_data = remote.get("data") if isinstance(remote.get("data"), dict) else {}
            provider_reference = str(remote_data.get("transactionId", deposit_id))
            pix_code = str(remote_data.get("copyPaste", ""))
            qr_code = str(remote_data.get("qrCodeBase64") or remote_data.get("qrcodeUrl") or "")
            with connect() as db:
                db.execute("UPDATE deposits SET provider_reference=?,pix_code=? WHERE id=?", (provider_reference, pix_code, deposit_id))
            return self.json_response(201, {"id": deposit_id, "providerTransactionId": provider_reference, "status": "pending", "amountCents": amount, "bonusCents": money_bonus(amount), "provider": provider, "pixCopyPaste": pix_code, "qrCode": qr_code})
        if not PUBLIC_BASE_URL or not ZORYX_WEBHOOK_SECRET:
            with connect() as db:
                db.execute("UPDATE deposits SET status='failed' WHERE id=?", (deposit_id,))
            raise ApiError(503, "Configure RUSH_PUBLIC_BASE_URL e ZORYX_WEBHOOK_SECRET")
        payload = {
            "external_id": deposit_id,
            "amount": round(amount / 100, 2),
            "currency": "BRL",
            "callback_url": f"{PUBLIC_BASE_URL}/api/webhooks/zoryxpay/{ZORYX_WEBHOOK_SECRET}",
            "payer": {
                "name": user["name"], "email": user["email"],
                "phone": re.sub(r"\D", "", user["phone"] or ""), "document": payer_document,
            },
        }
        try:
            remote = zoryx_request("/cash-in/pix", payload)
        except ApiError:
            with connect() as db:
                db.execute("UPDATE deposits SET status='failed' WHERE id=?", (deposit_id,))
            raise
        pix_code = str(remote.get("pix_copia_cola", ""))
        expires_at = remote.get("expires_at")
        with connect() as db:
            db.execute("UPDATE deposits SET provider_reference=?,pix_code=?,expires_at=? WHERE id=?", (str(remote.get("external_id", deposit_id)), pix_code, expires_at, deposit_id))
        return self.json_response(201, {"id": deposit_id, "status": str(remote.get("status", "PENDING")).lower(), "amountCents": amount, "bonusCents": money_bonus(amount), "provider": provider, "pixCopyPaste": pix_code, "expiresAt": expires_at})

    def vulcano_webhook(self):
        if not VULCANO_WEBHOOK_SECRET:
            raise ApiError(503, "Webhook da VulcanoPay não configurado")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 64_000:
            raise ApiError(400, "Webhook inválido")
        raw = self.rfile.read(length)
        fields = {}
        for item in self.headers.get("X-Vulcano-Signature", "").split(","):
            key, separator, value = item.strip().partition("=")
            if separator:
                fields[key] = value
        try:
            timestamp = int(fields.get("t", "0"))
        except ValueError:
            timestamp = 0
        if not timestamp or abs(int(time.time()) - timestamp) > 300:
            raise ApiError(401, "Assinatura de webhook expirada")
        expected = hmac.new(VULCANO_WEBHOOK_SECRET.encode(), str(timestamp).encode() + b"." + raw, hashlib.sha256).hexdigest()
        if not fields.get("v1") or not hmac.compare_digest(fields["v1"], expected):
            raise ApiError(401, "Assinatura de webhook inválida")
        try:
            event_data = json.loads(raw)
        except json.JSONDecodeError:
            raise ApiError(400, "JSON inválido")
        if not isinstance(event_data, dict):
            raise ApiError(400, "Webhook inválido")
        event_id = str(event_data.get("id", ""))
        event_name = str(event_data.get("event", "")).lower()
        charge = event_data.get("data") if isinstance(event_data.get("data"), dict) else {}
        reference = str(charge.get("id", ""))
        external_id = str(charge.get("external_id", ""))
        if not event_id or not event_name:
            raise ApiError(422, "Evento inválido")
        expected_live = VULCANO_API_KEY.startswith("vk_live_")
        if bool(event_data.get("livemode", False)) != expected_live:
            return self.json_response(200, {"ok": True, "ignored": True})
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                db.execute("INSERT INTO payment_events(provider,event_id,payload,received_at) VALUES('vulcanopay',?,?,?)", (event_id, raw.decode("utf-8", "replace"), utc_now()))
            except sqlite3.IntegrityError:
                return self.json_response(200, {"ok": True, "duplicate": True})
            deposit = db.execute("SELECT * FROM deposits WHERE provider='vulcanopay' AND (id=? OR provider_reference=?)", (external_id, reference)).fetchone()
            if not deposit:
                db.execute("UPDATE payment_events SET processed_at=? WHERE event_id=?", (utc_now(), event_id))
                return self.json_response(200, {"ok": True, "ignored": True})
            if event_name == "charge.paid" and deposit["status"] != "paid":
                credit = deposit["amount_cents"] + deposit["bonus_cents"]
                db.execute("UPDATE deposits SET status='paid',paid_at=? WHERE id=?", (utc_now(), deposit["id"]))
                db.execute("UPDATE wallets SET balance_cents=balance_cents+?,updated_at=? WHERE user_id=?", (credit, utc_now(), deposit["user_id"]))
                db.execute("INSERT INTO wallet_transactions(id,user_id,kind,amount_cents,reference_type,reference_id,created_at) VALUES(?,?,?,?,?,?,?)", ("tx_" + secrets.token_urlsafe(12), deposit["user_id"], "deposit_credit", credit, "deposit", deposit["id"], utc_now()))
            elif event_name == "charge.expired" and deposit["status"] == "pending":
                db.execute("UPDATE deposits SET status='expired' WHERE id=?", (deposit["id"],))
            db.execute("UPDATE payment_events SET processed_at=? WHERE event_id=?", (utc_now(), event_id))
        return self.json_response(200, {"ok": True})

    def zoryx_webhook(self, supplied_secret: str, data: dict):
        if not ZORYX_WEBHOOK_SECRET or not hmac.compare_digest(supplied_secret, ZORYX_WEBHOOK_SECRET):
            raise ApiError(404, "Rota não encontrada")
        event = str(data.get("event", "")).lower()
        status = str(data.get("status", "")).lower()
        external_id = str(data.get("transaction_id", ""))
        if event != "transaction" or not external_id:
            return self.json_response(200, {"ok": True, "ignored": True})
        event_id = "zoryx:" + hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                db.execute("INSERT INTO payment_events(provider,event_id,payload,received_at) VALUES('zoryxpay',?,?,?)", (event_id, json.dumps(data), utc_now()))
            except sqlite3.IntegrityError:
                return self.json_response(200, {"ok": True, "duplicate": True})
            deposit = db.execute("SELECT * FROM deposits WHERE id=?", (external_id,)).fetchone()
            if not deposit:
                return self.json_response(200, {"ok": True, "ignored": True})
            if status == "paid" and deposit["status"] != "paid":
                credit = deposit["amount_cents"] + deposit["bonus_cents"]
                db.execute("UPDATE deposits SET status='paid',paid_at=? WHERE id=?", (utc_now(), external_id))
                db.execute("UPDATE wallets SET balance_cents=balance_cents+?,updated_at=? WHERE user_id=?", (credit, utc_now(), deposit["user_id"]))
                db.execute("INSERT INTO wallet_transactions(id,user_id,kind,amount_cents,reference_type,reference_id,created_at) VALUES(?,?,?,?,?,?,?)", ("tx_" + secrets.token_urlsafe(12), deposit["user_id"], "deposit_credit", credit, "deposit", external_id, utc_now()))
            elif status in {"failed", "canceled"} and deposit["status"] == "pending":
                db.execute("UPDATE deposits SET status=? WHERE id=?", ("cancelled" if status == "canceled" else "failed", external_id))
            db.execute("UPDATE payment_events SET processed_at=? WHERE event_id=?", (utc_now(), event_id))
        return self.json_response(200, {"ok": True})

    def mistic_webhook(self, supplied_secret: str, data: dict):
        if not MISTIC_WEBHOOK_SECRET or not hmac.compare_digest(supplied_secret, MISTIC_WEBHOOK_SECRET):
            raise ApiError(404, "Rota não encontrada")
        transaction_type = str(data.get("transactionType", "")).upper()
        status = str(data.get("status", "")).upper()
        reference = str(data.get("transactionId", ""))
        if transaction_type != "DEPOSITO" or not reference:
            return self.json_response(200, {"ok": True, "ignored": True})
        event_id = "mistic:" + hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                db.execute("INSERT INTO payment_events(provider,event_id,payload,received_at) VALUES('misticpay',?,?,?)", (event_id, json.dumps(data), utc_now()))
            except sqlite3.IntegrityError:
                return self.json_response(200, {"ok": True, "duplicate": True})
            deposit = db.execute("SELECT * FROM deposits WHERE id=? OR provider_reference=?", (reference, reference)).fetchone()
            if not deposit:
                return self.json_response(200, {"ok": True, "ignored": True})
            if status == "COMPLETO" and deposit["status"] != "paid":
                credit = deposit["amount_cents"] + deposit["bonus_cents"]
                db.execute("UPDATE deposits SET status='paid',paid_at=? WHERE id=?", (utc_now(), deposit["id"]))
                db.execute("UPDATE wallets SET balance_cents=balance_cents+?,updated_at=? WHERE user_id=?", (credit, utc_now(), deposit["user_id"]))
                db.execute("INSERT INTO wallet_transactions(id,user_id,kind,amount_cents,reference_type,reference_id,created_at) VALUES(?,?,?,?,?,?,?)", ("tx_" + secrets.token_urlsafe(12), deposit["user_id"], "deposit_credit", credit, "deposit", deposit["id"], utc_now()))
            elif status in {"FALHA", "CANCELADO"} and deposit["status"] == "pending":
                db.execute("UPDATE deposits SET status=? WHERE id=?", ("cancelled" if status == "CANCELADO" else "failed", deposit["id"]))
            db.execute("UPDATE payment_events SET processed_at=? WHERE event_id=?", (utc_now(), event_id))
        return self.json_response(200, {"ok": True})

    def sandbox_webhook(self, data: dict):
        if not hmac.compare_digest(self.headers.get("X-Webhook-Secret", ""), WEBHOOK_SECRET):
            raise ApiError(401, "Assinatura de webhook inválida")
        event_id = str(data.get("eventId", ""))
        deposit_id = str(data.get("depositId", ""))
        if not event_id or not deposit_id:
            raise ApiError(422, "Evento inválido")
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                db.execute("INSERT INTO payment_events(provider,event_id,payload,received_at) VALUES('sandbox',?,?,?)", (event_id, json.dumps(data), utc_now()))
            except sqlite3.IntegrityError:
                return self.json_response(200, {"ok": True, "duplicate": True})
            deposit = db.execute("SELECT * FROM deposits WHERE id=?", (deposit_id,)).fetchone()
            if not deposit:
                raise ApiError(404, "Depósito não encontrado")
            if deposit["status"] != "paid":
                credit = deposit["amount_cents"] + deposit["bonus_cents"]
                db.execute("UPDATE deposits SET status='paid',paid_at=?,provider_reference=? WHERE id=?", (utc_now(), event_id, deposit_id))
                db.execute("UPDATE wallets SET balance_cents=balance_cents+?,updated_at=? WHERE user_id=?", (credit, utc_now(), deposit["user_id"]))
                db.execute("INSERT INTO wallet_transactions(id,user_id,kind,amount_cents,reference_type,reference_id,created_at) VALUES(?,?,?,?,?,?,?)", ("tx_" + secrets.token_urlsafe(12), deposit["user_id"], "deposit_credit", credit, "deposit", deposit_id, utc_now()))
            db.execute("UPDATE payment_events SET processed_at=? WHERE event_id=?", (utc_now(), event_id))
        return self.json_response(200, {"ok": True})

    def create_withdrawal(self, data: dict):
        user = self.auth()
        password = str(data.get("withdrawalPassword", ""))
        if not verify_password(password, user["password_hash"], user["password_salt"]):
            raise ApiError(403, "Senha da conta incorreta")
        amount = int(data.get("amountCents", 0))
        pix_type = str(data.get("pixType", "")).strip().lower()
        pix_key = str(data.get("pixKey", "")).strip()
        if amount < MIN_WITHDRAWAL_CENTS or pix_type not in {"cpf", "email", "phone", "random"} or len(pix_key) < 3:
            raise ApiError(422, "Dados de saque inválidos; mínimo de R$ 30,00")
        withdrawal_id = "wd_" + secrets.token_urlsafe(12)
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            wallet = db.execute("SELECT balance_cents FROM wallets WHERE user_id=?", (user["id"],)).fetchone()
            if not wallet or wallet["balance_cents"] < amount:
                raise ApiError(409, "Saldo insuficiente")
            db.execute("UPDATE wallets SET balance_cents=balance_cents-?,updated_at=? WHERE user_id=?", (amount, utc_now(), user["id"]))
            db.execute("INSERT INTO withdrawals(id,user_id,amount_cents,pix_type,pix_key,created_at) VALUES(?,?,?,?,?,?)", (withdrawal_id, user["id"], amount, pix_type, pix_key, utc_now()))
            db.execute("INSERT INTO wallet_transactions(id,user_id,kind,amount_cents,reference_type,reference_id,created_at) VALUES(?,?,?,?,?,?,?)", ("tx_" + secrets.token_urlsafe(12), user["id"], "withdrawal_hold", -amount, "withdrawal", withdrawal_id, utc_now()))
        return self.json_response(201, {"id": withdrawal_id, "status": "pending"})

    def demo_block_action(self, action, data):
        user = self.auth()
        if action not in {'start','move','finish','state'}:
            raise ApiError(404, 'Rota não encontrada')
        allowed = {'start': {'requestId','entry'}, 'move': {'requestId','roundId','revision','piece','x','y'}, 'finish': {'requestId','roundId','revision'}, 'state': set()}[action]
        if set(data) - allowed:
            raise ApiError(422, 'Campos não permitidos. O resultado é calculado pelo servidor.')
        request_id = data.get('requestId')
        if action != 'state' and (not isinstance(request_id,str) or not 8 <= len(request_id) <= 100):
            raise ApiError(422, 'Identificador de requisição inválido')
        payload = json.dumps([action,data],sort_keys=True)
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM demo_block_rounds WHERE user_id=?',(user['id'],)).fetchone()
            current = json.loads(row['state']) if row else None
            if action == 'state':
                return self.json_response(200, {'state': current})
            if row and row['last_request'] == request_id:
                if row['last_payload'] != payload: raise ApiError(409, 'Identificador reutilizado para outra ação')
                return self.json_response(200, {'state': current})
            try:
                if action == 'start':
                    if current and current['status'] == 'active':
                        raise ApiError(409, 'Existe uma partida ativa. Retome a partida atual.')
                    state = demo_blocks.new_game(data.get('entry'))
                else:
                    if not current or current['id'] != data.get('roundId'):
                        raise ApiError(404, 'Partida não encontrada nesta conta')
                    if type(data.get('revision')) is not int or current['revision'] != data['revision']:
                        raise ApiError(409, 'Partida desatualizada. Sincronize antes de jogar.')
                    state = demo_blocks.advance(current, action, data)
            except ValueError as error:
                raise ApiError(422, str(error))
            db.execute('INSERT INTO demo_block_rounds(user_id,state,last_request,last_payload) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,last_request=excluded.last_request,last_payload=excluded.last_payload', (user['id'],json.dumps(state),request_id,payload))
        return self.json_response(200, {'state':state})

    def create_influencer(self, data):
        self.auth(("admin",))
        name = str(data.get("name", "")).strip()
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))
        if not 2 <= len(name) <= 120 or len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or not 8 <= len(password) <= 128:
            raise ApiError(422, "Informe nome, e-mail válido e senha de 8 a 128 caracteres")
        digest, salt = password_hash(password)
        code = "RUSH-" + secrets.token_hex(8).upper()
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
                raise ApiError(409, "Este e-mail já possui uma conta. Nenhuma alteração foi feita.")
            cursor = db.execute("INSERT INTO users(name,email,role,password_hash,password_salt,referral_code,created_at) VALUES(?,?,'influencer',?,?,?,?)", (name,email,digest,salt,code,utc_now()))
            db.execute("INSERT INTO wallets(user_id,balance_cents,updated_at) VALUES(?,0,?)", (cursor.lastrowid,utc_now()))
        return self.json_response(201, {"id": cursor.lastrowid, "referralCode": code})

    def admin_overview(self):
        self.auth(("admin",))
        with connect() as db:
            db.execute("BEGIN")
            accounts = [dict(row) for row in db.execute("SELECT u.id,u.name,u.email,u.phone,u.cpf,u.cpf_last4,u.role,u.created_at,w.balance_cents FROM users u JOIN wallets w ON w.user_id=u.id ORDER BY u.id DESC")]
            withdrawals = [dict(row) for row in db.execute("SELECT w.*,u.name,u.email FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.created_at DESC LIMIT 500")]
            deposits = [dict(row) for row in db.execute("SELECT d.*,u.name,u.email FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY d.created_at DESC LIMIT 500")]
            transactions = [dict(row) for row in db.execute("SELECT t.*,u.name,u.email FROM wallet_transactions t JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 500")]
            paid = db.execute("SELECT COALESCE(SUM(amount_cents),0) FROM deposits WHERE status='paid'").fetchone()[0]
            influencers = [dict(row) for row in db.execute("SELECT u.id,u.name,u.email,u.referral_code,0 AS commission_cents,0 AS balance_cents,0 AS commission_rate,1 AS active,(SELECT COUNT(*) FROM users r WHERE r.referred_by_code=u.referral_code) AS referred_users FROM users u WHERE u.role='influencer' ORDER BY u.id DESC")]
            trend = []
            for offset in range(6, -1, -1):
                day = (datetime.now(timezone.utc) - timedelta(days=offset)).date().isoformat()
                total = db.execute("SELECT COALESCE(SUM(amount_cents),0) FROM deposits WHERE status='paid' AND substr(paid_at,1,10)=?", (day,)).fetchone()[0]
                trend.append({"day": day, "deposits_cents": total})
        return self.json_response(200, {
            "environment": "local", "capabilities": {"balanceAdjustments": False, "withdrawalManagement": False, "commissions": False, "influencers": True, "createInfluencers": True},
            "totals": {"accounts": len(accounts), "wallet_cents": sum(row["balance_cents"] for row in accounts), "deposits_cents": paid, "commissions_cents": 0},
            "accounts": accounts, "withdrawals": withdrawals, "deposits": deposits,
            "transactions": transactions, "activities": transactions[:15], "trend": trend,
            "commissions": [], "influencers": influencers,
        })

    def approve_withdrawal(self, withdrawal_id: str):
        admin = self.auth(("admin",))
        with connect() as db:
            cursor = db.execute("UPDATE withdrawals SET status='approved',reviewed_at=?,reviewed_by=? WHERE id=? AND status='pending'", (utc_now(), admin["id"], withdrawal_id))
            if cursor.rowcount != 1:
                raise ApiError(409, "Saque não está pendente")
        return self.json_response(200, {"ok": True, "status": "approved"})


if __name__ == "__main__":
    migrate()
    print(f"Rush Arena backend: http://{HOST}:{PORT} | DB: {DB_PATH}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
