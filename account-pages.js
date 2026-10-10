(function () {
    'use strict';

    const keys = {
        session: 'rushArenaLocalTestSession',
        wallet: 'rushArenaLocalTestWallet',
        deposit: 'rushArenaLocalTestDeposit',
        profile: 'rushArenaLocalWithdrawProfile',
        pix: 'rushArenaLocalPixProfiles',
        overrides: 'rushArenaLocalPixOverrides',
        requests: 'rushArenaLocalWithdrawRequests'
    };
    const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch (error) { return fallback; } };
    const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
    const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    const session = read(keys.session, null);
    const page = document.body.dataset.page;
    const content = document.getElementById('pageContent');

    if (!['localhost', '127.0.0.1'].includes(location.hostname)) {
        const token = localStorage.getItem('rushArenaApiToken') || '';
        const api = async (path, options) => {
            const response = await fetch('/api' + path, Object.assign({}, options || {}, {
                headers: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, options && options.headers || {})
            }));
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'Não foi possível concluir.');
            return body;
        };
        const maskKey = value => {
            const raw = String(value || '').trim();
            if (raw.length <= 7) return raw;
            return raw.slice(0, 2) + '•'.repeat(Math.max(4, raw.length - 7)) + raw.slice(-5);
        };
        const showError = message => { content.innerHTML = '<section class="panel"><div class="notice">' + esc(message) + '</div></section>'; };
        if (!token) { location.replace('/?login=1'); return; }
        (async () => {
            try {
                const user = await api('/me');
                if (page === 'info') {
                    content.innerHTML = '<section class="panel"><h2>Minha conta</h2><p class="panel-subtitle">Dados protegidos da sua conta.</p><div class="profile-row"><span>Usuário</span><strong>' + esc(user.name) + '</strong></div><div class="profile-row"><span>E-mail</span><strong>' + esc(user.email) + '</strong></div><p class="privacy">Os dados financeiros são mantidos no servidor.</p></section>';
                    return;
                }
                const payments = await api('/payments');
                const deposits = Array.isArray(payments.deposits) ? payments.deposits : [];
                const withdrawals = Array.isArray(payments.withdrawals) ? payments.withdrawals : [];
                if (page === 'wallet') {
                    content.innerHTML = '<section class="panel"><h2>Minha carteira</h2><p class="panel-subtitle">Saldo confirmado e movimentações da conta.</p><div class="summary"><div class="summary-card"><span>Saldo disponível</span><strong>' + money(Number(user.balanceCents || 0) / 100) + '</strong></div><div class="summary-card"><span>Depósitos</span><strong>' + deposits.length + '</strong></div><div class="summary-card"><span>Saques</span><strong>' + withdrawals.length + '</strong></div></div><div class="action-grid"><a class="action" href="deposit-v2.html">Adicionar saldo</a><a class="action secondary" href="withdrawal.html">Solicitar saque</a></div><p class="privacy">Somente pagamentos confirmados pela operadora entram no saldo.</p></section>';
                    return;
                }
                if (page === 'history') {
                    content.innerHTML = '<section class="panel"><h2>Registro de saques</h2><p class="panel-subtitle">Acompanhe o andamento de cada pedido.</p><div class="history">' + (withdrawals.length ? withdrawals.map(item => '<article class="history-item"><div><strong>' + money(Number(item.amount_cents || 0) / 100) + '</strong><small>Chave: ' + esc(maskKey(item.pix_key)) + ' · ' + new Date(item.created_at).toLocaleString('pt-BR') + '</small></div><span class="status ' + (item.status === 'approved' ? 'approved' : '') + '">' + (item.status === 'approved' ? 'Saque aprovado' : 'Em andamento') + '</span></article>').join('') : '<div class="empty">Nenhum saque solicitado.</div>') + '</div></section>';
                    return;
                }
                if (page === 'withdrawal') {
                    content.innerHTML = '<section class="panel"><h2>Solicitar saque</h2><p class="panel-subtitle">O valor ficará reservado até a análise.</p><form class="form-grid" id="liveWithdrawal"><label>Valor do saque<input name="amount" type="number" min="30" step="0.01" required></label><label>Tipo da chave<select name="pixType"><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="email">E-mail</option><option value="phone">Telefone</option><option value="random">Aleatória</option></select></label><label>Chave Pix<input name="pixKey" minlength="3" maxlength="120" required></label><label>Senha da conta<input name="password" type="password" autocomplete="current-password" required></label><button class="action">Solicitar saque</button><div id="liveNotice" hidden></div></form><p class="privacy">Saque mínimo de R$ 30,00.</p></section>';
                    document.getElementById('liveWithdrawal').addEventListener('submit', async event => {
                        event.preventDefault();
                        const form = event.currentTarget; const data = new FormData(form); const notice = document.getElementById('liveNotice');
                        try {
                            await api('/withdrawals', { method: 'POST', body: JSON.stringify({ amountCents: Math.round(Number(data.get('amount')) * 100), pixType: String(data.get('pixType')), pixKey: String(data.get('pixKey')).trim(), withdrawalPassword: String(data.get('password')) }) });
                            notice.hidden = false; notice.className = 'notice success'; notice.textContent = 'Saque solicitado e enviado para análise.';
                            setTimeout(() => location.href = 'withdrawal-history.html', 700);
                        } catch (error) { notice.hidden = false; notice.className = 'notice'; notice.textContent = error.message; }
                    });
                }
            } catch (error) {
                if (/Sessão|Autenticação/.test(error.message)) { localStorage.removeItem('rushArenaApiToken'); location.replace('/?login=1'); return; }
                showError(error.message);
            }
        })();
        return;
    }

    if (!session) {
        location.href = 'test-account.html';
        return;
    }

    function effectiveProfile() {
        const profile = read(keys.profile, null);
        const override = read(keys.overrides, {})[String(session.email || '').toLowerCase()];
        if (profile && override) return Object.assign({}, profile, { pixKey: override.pixKey, pixType: override.pixType || profile.pixType, updatedAt: override.updatedAt || profile.updatedAt });
        return profile;
    }

    function historyMaskedKey(value) {
        const raw = String(value || '').trim();
        if (!raw) return 'Não cadastrada';
        const digits = raw.replace(/\D/g, '');
        if (digits.length > 7) return digits.slice(0, 2) + '•'.repeat(Math.max(4, digits.length - 7)) + digits.slice(-5);
        if (raw.length > 7) return raw.slice(0, 2) + '•'.repeat(Math.max(4, raw.length - 7)) + raw.slice(-5);
        return raw;
    }

    async function hashPassword(value) {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
        return Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    }

    function upsertPix(profile, extra) {
        const rows = read(keys.pix, []);
        const email = String(session.email || 'teste@local.dev');
        const index = rows.findIndex(row => String(row.email || '').toLowerCase() === email.toLowerCase());
        const previous = index >= 0 ? rows[index] : {};
        const row = Object.assign({}, previous, {
            email,
            pixType: profile.pixType,
            pixKey: profile.pixKey,
            pixKeyMasked: historyMaskedKey(profile.pixKey),
            updatedAt: profile.updatedAt
        }, extra || {});
        if (!row.status) row.status = 'active';
        if (index >= 0) rows[index] = row; else rows.unshift(row);
        write(keys.pix, rows);
    }

    function readRequests() {
        const requests = read(keys.requests, []);
        const wallet = read(keys.wallet, { balance: 0, transactions: [] });
        const profile = effectiveProfile();
        const adminPix = read(keys.pix, []).find(item => String(item.email || '').toLowerCase() === String(session.email || '').toLowerCase());
        let changed = false;

        (wallet.transactions || []).filter(item => item.type === 'withdrawal').forEach((transaction, index) => {
            if (!transaction.id) {
                transaction.id = 'wd_legacy_' + new Date(transaction.createdAt || Date.now()).getTime().toString(36) + '_' + index;
                changed = true;
            }
            if (!requests.some(item => item.id === transaction.id)) {
                const approvedByAdmin = Boolean(adminPix && adminPix.status === 'approved' && index === 0 && Number(adminPix.withdrawalAmount || 0) === Number(transaction.amount || 0));
                requests.push({
                    id: transaction.id,
                    email: session.email,
                    amount: Number(transaction.amount || 0),
                    pixType: profile && profile.pixType || 'phone',
                    pixKey: profile && profile.pixKey || '',
                    pixKeyMasked: historyMaskedKey(profile && profile.pixKey),
                    status: transaction.status === 'approved' || approvedByAdmin ? 'approved' : 'pending',
                    createdAt: transaction.createdAt || new Date().toISOString(),
                    approvedAt: transaction.approvedAt || (approvedByAdmin && adminPix.approvedAt) || null
                });
                changed = true;
            }
        });

        if (changed) {
            write(keys.wallet, wallet);
            write(keys.requests, requests);
        }
        return requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    function renderInfo() {
        content.innerHTML = '<section class="panel"><h2>Minha conta</h2><p class="panel-subtitle">Dados da sua conta de demonstração.</p><div class="profile-row"><span>Usuário</span><strong>' + esc(String(session.email || 'usuário').split('@')[0]) + '</strong></div><div class="profile-row"><span>E-mail</span><strong>' + esc(session.email) + '</strong></div><div class="profile-row"><span>Conta criada em</span><strong>' + new Date(session.createdAt || Date.now()).toLocaleDateString('pt-BR') + '</strong></div><p class="privacy">Dados armazenados somente neste navegador.</p></section>';
    }

    function renderWallet() {
        const wallet = read(keys.wallet, { balance: 0, transactions: [] });
        content.innerHTML = '<section class="panel"><h2>Minha carteira</h2><p class="panel-subtitle">Saldo e atalhos da conta.</p><div class="summary"><div class="summary-card"><span>Saldo disponível</span><strong>' + money(wallet.balance) + '</strong></div><div class="summary-card"><span>Saques registrados</span><strong>' + String(readRequests().length) + '</strong></div></div><div class="action-grid"><a class="action" href="deposit-v2.html">Adicionar saldo</a><a class="action secondary" href="withdrawal.html">Solicitar saque</a></div><p class="privacy">Valores simulados para demonstração local.</p></section>';
    }

    function showNotice(id, message, success) {
        const notice = document.getElementById(id);
        notice.hidden = false;
        notice.className = 'notice' + (success ? ' success' : '');
        notice.textContent = message;
    }

    function renderWithdrawal() {
        const profile = effectiveProfile();
        content.innerHTML = '<section class="panel"><h2>Solicitar saque</h2><p class="panel-subtitle">Cadastre a chave e solicite a análise do Admin.</p><div class="key-preview"><span>Chave atual</span><strong data-key-preview>' + esc(profile && profile.pixKey || 'Não cadastrada') + '</strong></div><form class="form-grid" id="profileForm"><label>Tipo da chave<select name="pixType"><option value="cpf">CPF</option><option value="email">E-mail</option><option value="phone">Telefone</option><option value="random">Aleatória</option></select></label><label>Chave Pix<input name="pixKey" minlength="3" maxlength="120" required></label><label>Senha de retirada<input name="password" type="password" inputmode="numeric" pattern="[0-9]{4,12}" required placeholder="4 a 12 números"></label><button class="action">Salvar dados</button><div id="profileNotice" hidden></div></form><hr style="margin:24px 0;border:0;border-top:1px solid var(--line)"><form class="form-grid" id="requestForm"><label>Valor do saque<input name="amount" type="number" min="30" step="0.01" required placeholder="Mínimo R$ 30,00"></label><label>Senha de retirada<input name="password" type="password" inputmode="numeric" required></label><button class="action"' + (profile ? '' : ' disabled') + '>Solicitar saque</button><div id="requestNotice" hidden></div></form><p class="privacy">O pedido ficará “Em andamento” até ser aprovado pelo Admin.</p></section>';
        const profileForm = document.getElementById('profileForm');
        profileForm.pixType.value = profile && profile.pixType || 'cpf';
        profileForm.pixKey.value = profile && profile.pixKey || '';

        profileForm.addEventListener('submit', async event => {
            event.preventDefault();
            const data = new FormData(profileForm);
            const password = String(data.get('password') || '');
            if (!/^\d{4,12}$/.test(password)) {
                showNotice('profileNotice', 'Use uma senha de 4 a 12 números.', false);
                return;
            }
            const saved = Object.assign({}, effectiveProfile() || {}, {
                pixType: String(data.get('pixType')),
                pixKey: String(data.get('pixKey')).trim(),
                passwordHash: await hashPassword(password),
                updatedAt: new Date().toISOString()
            });
            write(keys.profile, saved);
            const overrides = read(keys.overrides, {});
            overrides[String(session.email).toLowerCase()] = { pixKey: saved.pixKey, pixType: saved.pixType, updatedAt: saved.updatedAt };
            write(keys.overrides, overrides);
            upsertPix(saved, saved.withdrawalStatus ? { status: saved.withdrawalStatus, withdrawalId: saved.withdrawalId, withdrawalAmount: saved.withdrawalAmount, withdrawalRequestedAt: saved.withdrawalRequestedAt } : null);
            showNotice('profileNotice', 'Dados de saque atualizados.', true);
            window.setTimeout(renderWithdrawal, 500);
        });

        document.getElementById('requestForm').addEventListener('submit', async event => {
            event.preventDefault();
            const saved = effectiveProfile();
            if (!saved) {
                showNotice('requestNotice', 'Cadastre primeiro sua chave Pix.', false);
                return;
            }
            const data = new FormData(event.currentTarget);
            const amount = Number(data.get('amount'));
            if (!Number.isFinite(amount) || amount < 30) {
                showNotice('requestNotice', 'O saque mínimo é R$ 30,00.', false);
                return;
            }
            if (await hashPassword(String(data.get('password') || '')) !== saved.passwordHash) {
                showNotice('requestNotice', 'Senha de retirada incorreta.', false);
                return;
            }
            const wallet = read(keys.wallet, { balance: 0, transactions: [] });
            if (amount > Number(wallet.balance || 0)) {
                showNotice('requestNotice', 'Saldo insuficiente.', false);
                return;
            }
            const createdAt = new Date().toISOString();
            const id = 'wd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
            const request = { id, email: session.email, amount, pixType: saved.pixType, pixKey: saved.pixKey, pixKeyMasked: historyMaskedKey(saved.pixKey), status: 'pending', createdAt };
            wallet.balance = Number((Number(wallet.balance) - amount).toFixed(2));
            wallet.transactions = Array.isArray(wallet.transactions) ? wallet.transactions : [];
            wallet.transactions.unshift({ id, type: 'withdrawal', email: session.email, amount, status: 'pending', pixKeyMasked: request.pixKeyMasked, createdAt });
            write(keys.wallet, wallet);
            const requests = readRequests().filter(item => item.id !== id);
            requests.unshift(request);
            write(keys.requests, requests);
            saved.withdrawalStatus = 'pending';
            saved.withdrawalAmount = amount;
            saved.withdrawalRequestedAt = createdAt;
            saved.withdrawalId = id;
            write(keys.profile, saved);
            upsertPix(saved, { status: 'pending', withdrawalAmount: amount, withdrawalRequestedAt: createdAt, withdrawalId: id });
            showNotice('requestNotice', 'Saque em andamento. Aguarde a aprovação do Admin.', true);
            window.setTimeout(() => location.href = 'withdrawal-history.html', 650);
        });

        window.setInterval(() => {
            const latest = effectiveProfile();
            const preview = document.querySelector('[data-key-preview]');
            const input = document.querySelector('#profileForm input[name="pixKey"]');
            if (preview && latest) preview.textContent = latest.pixKey || 'Não cadastrada';
            if (input && latest && document.activeElement !== input) input.value = latest.pixKey || '';
        }, 900);
    }

    function renderHistory() {
        const requests = readRequests().filter(item => String(item.email || '').toLowerCase() === String(session.email || '').toLowerCase());
        content.innerHTML = '<section class="panel"><h2>Registro de saques</h2><p class="panel-subtitle">Acompanhe o andamento de cada pedido.</p><div class="history">' + (requests.length ? requests.map(item => {
            const approved = item.status === 'approved';
            return '<article class="history-item"><div><strong>' + money(item.amount) + '</strong><small>Chave: ' + esc(historyMaskedKey(item.pixKey)) + ' · ' + new Date(item.createdAt).toLocaleString('pt-BR') + '</small></div><span class="status ' + (approved ? 'approved' : '') + '">' + (approved ? 'Saque aprovado' : 'Em andamento') + '</span></article>';
        }).join('') : '<div class="empty">Nenhum saque solicitado.</div>') + '</div><p class="privacy">Somente no registro a chave é censurada, mantendo os 5 últimos números visíveis.</p></section>';
    }

    if (page === 'info') renderInfo();
    if (page === 'wallet') renderWallet();
    if (page === 'withdrawal') renderWithdrawal();
    if (page === 'history') {
        renderHistory();
        window.setInterval(renderHistory, 1000);
    }
}());
