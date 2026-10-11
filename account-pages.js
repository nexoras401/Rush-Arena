(function () {
    'use strict';

    const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    const page = document.body.dataset.page;
    const content = document.getElementById('pageContent');

    if (location.protocol === 'http:' || location.protocol === 'https:') {
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

    content.textContent = 'Abra o site pelo servidor HTTP para acessar sua conta.';
}());
