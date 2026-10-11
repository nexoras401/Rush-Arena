(function () {
    'use strict';

    // Legacy offline preview only; HTTP pages use the authenticated server API.
    if (location.protocol !== 'file:') return;

    const localHosts = new Set(['127.0.0.1', 'localhost']);
    const storageKey = 'rushArenaLocalTestSession';
    const depositKey = 'rushArenaLocalTestDeposit';
    const walletKey = 'rushArenaLocalTestWallet';
    const withdrawProfileKey = 'rushArenaLocalWithdrawProfile';
    const pixOverrideKey = 'rushArenaLocalPixOverrides';
    const withdrawRequestsKey = 'rushArenaLocalWithdrawRequests';
    const activeEntryKey = 'rushArenaActiveGameEntry';
    const entryCost = 10;

    if (!localHosts.has(window.location.hostname)) {
        return;
    }

    document.documentElement.setAttribute('data-local-demo-auth', 'loaded');

    const referralFromUrl = new URLSearchParams(window.location.search).get('ref');
    if (referralFromUrl && /^[A-Z0-9-]{5,24}$/i.test(referralFromUrl)) {
        window.localStorage.setItem('rushArenaPendingReferral', JSON.stringify({ code: referralFromUrl.toUpperCase(), capturedAt: new Date().toISOString() }));
    }

    function readSession() {
        try {
            return JSON.parse(window.localStorage.getItem(storageKey) || 'null');
        } catch (error) {
            return null;
        }
    }

    function closeModals() {
        document.querySelectorAll('[data-modal]').forEach(function (modal) {
            modal.hidden = true;
        });
        document.body.style.overflow = '';
    }

    function formatAccountDate(value) {
        const date = value ? new Date(value) : new Date();
        if (Number.isNaN(date.getTime())) return 'Hoje';
        return new Intl.DateTimeFormat('pt-BR').format(date);
    }

    function formatMoney(value) {
        return Number(value || 0).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        });
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (character) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
        });
    }

    function readWithdrawProfile() {
        try {
            const profile = JSON.parse(window.localStorage.getItem(withdrawProfileKey) || 'null');
            const session = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
            const overrides = JSON.parse(window.localStorage.getItem(pixOverrideKey) || '{}');
            const override = session && overrides[String(session.email || '').toLowerCase()];
            if (profile && override) {
                profile.pixKey = override.pixKey;
                profile.pixType = override.pixType || profile.pixType;
                profile.updatedAt = override.updatedAt || profile.updatedAt;
            }
            return profile;
        } catch (error) {
            return null;
        }
    }

    async function hashWithdrawalPassword(value) {
        const bytes = new TextEncoder().encode(String(value));
        const digest = await window.crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest)).map(function (byte) {
            return byte.toString(16).padStart(2, '0');
        }).join('');
    }

    function setWithdrawNotice(form, message, success) {
        const notice = form.querySelector('[data-withdraw-notice]');
        if (!notice) return;
        notice.textContent = message;
        notice.classList.toggle('is-success', Boolean(success));
        notice.hidden = false;
    }

    function maskPixKey(type, value) {
        const key = String(value || '').trim();
        if (!key) return 'Não informada';
        if (type === 'email' && key.includes('@')) {
            const parts = key.split('@');
            return parts[0].slice(0, 2) + '***@' + parts.slice(1).join('@');
        }
        const digits = key.replace(/\D/g, '');
        if (type === 'cpf' && digits.length >= 2) return '***.***.***-' + digits.slice(-2);
        if (type === 'phone' && digits.length >= 4) return '(**) *****-' + digits.slice(-4);
        return key.length > 8 ? key.slice(0, 4) + '••••' + key.slice(-4) : '••••' + key.slice(-2);
    }

    function openAccountPanel(account, initialTab) {
        const previous = document.getElementById('localAccountOverlay');
        if (previous) previous.remove();

        const wallet = readWallet();
        const deposit = readDeposit();
        const withdrawProfile = readWithdrawProfile();
        const balance = Number(wallet && wallet.balance || 0);
        const withdrawals = (wallet && Array.isArray(wallet.transactions) ? wallet.transactions : []).filter(function (item) {
            return item.type === 'withdrawal';
        });
        const withdrawalRows = withdrawals.length ? withdrawals.map(function (item) {
            const statusLabel = item.status === 'pending' ? 'Em andamento' : 'Registrado';
            const createdAt = item.createdAt ? new Date(item.createdAt).toLocaleString('pt-BR') : '—';
            return '<div class="local-withdraw-history-item"><div><strong>' + formatMoney(item.amount) + '</strong><small>' + escapeHtml(createdAt) + '</small></div><span class="' + (item.status === 'pending' ? 'is-pending' : '') + '">' + statusLabel + '</span></div>';
        }).join('') : '<p class="local-withdraw-history-empty">Nenhum saque solicitado ainda.</p>';
        const username = escapeHtml(String(account.email || 'conta-teste').split('@')[0] || 'conta-teste');
        const email = escapeHtml(account.email || 'teste@local.dev');

        const overlay = document.createElement('div');
        overlay.id = 'localAccountOverlay';
        overlay.className = 'local-account-overlay';
        overlay.innerHTML = '<section class="local-account-modal" role="dialog" aria-modal="true" aria-labelledby="localAccountTitle">' +
            '<a href="index.htm" class="local-account-close" aria-label="Fechar">×</a>' +
            '<header class="local-account-profile">' +
                '<div class="local-account-avatar" aria-hidden="true">👤</div>' +
                '<div><h2 id="localAccountTitle">' + username + '</h2><p>' + email + '</p><span>Membro desde ' + formatAccountDate(account.createdAt) + '</span></div>' +
            '</header>' +
            '<nav class="local-account-tabs" aria-label="Seções da conta">' +
                '<button type="button" class="is-active" data-account-tab="info">Informações</button>' +
                '<button type="button" data-account-tab="wallet">Carteira</button>' +
                '<button type="button" data-account-tab="withdraw">Saque</button>' +
                '<button type="button" data-account-tab="history">Registros</button>' +
            '</nav>' +
            '<div class="local-account-panel is-active" data-account-panel="info">' +
                '<h3>Informações pessoais</h3>' +
                '<div class="local-account-field"><span>E-mail</span><strong>' + email + '</strong></div>' +
                '<div class="local-account-field"><span>Telefone</span><strong>Não informado</strong></div>' +
                '<div class="local-account-field"><span>Documento</span><strong>Conta de teste</strong></div>' +
                '<p class="local-account-note">Seus dados ficam salvos somente neste navegador.</p>' +
            '</div>' +
            '<div class="local-account-panel" data-account-panel="wallet" hidden>' +
                '<h3>Minha carteira</h3>' +
                '<div class="local-wallet-card"><span>Saldo disponível</span><strong>' + formatMoney(balance) + '</strong><small>' + (deposit ? 'Depósito de teste ativo' : 'Nenhum depósito de teste') + '</small></div>' +
                '<div class="local-wallet-actions"><a href="deposit-v2.html">Adicionar saldo</a><a href="referral.html" class="is-secondary">Indicações</a></div>' +
                '<p class="local-account-note">Valores simulados para demonstração local. Não representam dinheiro real.</p>' +
            '</div>' +
            '<div class="local-account-panel local-withdraw-panel" data-account-panel="withdraw" hidden>' +
                '<h3>Saque por Pix</h3>' +
                '<div class="local-withdraw-minimum"><span>Mínimo para saque</span><strong>R$ 30,00</strong></div>' +
                '<form class="local-withdraw-form" data-withdraw-profile-form>' +
                    '<h4>Dados para retirada</h4>' +
                    '<label><span>Tipo da chave Pix</span><select name="pixType" required>' +
                        '<option value="cpf"' + (withdrawProfile && withdrawProfile.pixType === 'cpf' ? ' selected' : '') + '>CPF</option>' +
                        '<option value="email"' + (withdrawProfile && withdrawProfile.pixType === 'email' ? ' selected' : '') + '>E-mail</option>' +
                        '<option value="phone"' + (withdrawProfile && withdrawProfile.pixType === 'phone' ? ' selected' : '') + '>Telefone</option>' +
                        '<option value="random"' + (withdrawProfile && withdrawProfile.pixType === 'random' ? ' selected' : '') + '>Chave aleatória</option>' +
                    '</select></label>' +
                    '<label><span>Chave Pix</span><input name="pixKey" value="' + escapeHtml(withdrawProfile && withdrawProfile.pixKey || '') + '" minlength="3" maxlength="120" autocomplete="off" required placeholder="Digite sua chave Pix"></label>' +
                    '<label><span>Senha de retirada</span><input name="withdrawPassword" type="password" inputmode="numeric" pattern="[0-9]{4,12}" minlength="4" maxlength="12" autocomplete="new-password" required placeholder="Crie uma senha de 4 a 12 números"></label>' +
                    '<button type="submit">' + (withdrawProfile ? 'Atualizar dados de saque' : 'Cadastrar dados de saque') + '</button>' +
                    '<p class="local-withdraw-notice" data-withdraw-notice hidden></p>' +
                '</form>' +
                '<form class="local-withdraw-form local-withdraw-request" data-withdraw-request-form>' +
                    '<h4>Solicitar saque</h4>' +
                '<p class="local-withdraw-status">' + (withdrawProfile && withdrawProfile.withdrawalStatus === 'pending' ? 'Saque em andamento — aguarde a análise.' : withdrawProfile ? 'Chave Pix cadastrada neste navegador.' : 'Cadastre sua chave Pix e senha antes de solicitar.') + '</p>' +
                    '<label><span>Valor do saque</span><input name="amount" type="number" min="30" step="0.01" required placeholder="Mínimo R$ 30,00"></label>' +
                    '<label><span>Senha de retirada</span><input name="withdrawPassword" type="password" inputmode="numeric" pattern="[0-9]{4,12}" required placeholder="Digite sua senha"></label>' +
                    '<button type="submit"' + (withdrawProfile ? '' : ' disabled') + '>Solicitar saque de teste</button>' +
                    '<p class="local-withdraw-notice" data-withdraw-notice hidden></p>' +
                '</form>' +
                '<p class="local-account-note">Simulação local: nenhuma chave Pix ou solicitação é enviada a terceiros. Não use uma senha real.</p>' +
            '</div>' +
            '<div class="local-account-panel" data-account-panel="history" hidden>' +
                '<h3>Registro de saques</h3>' +
                '<div class="local-withdraw-history">' + withdrawalRows + '</div>' +
                '<p class="local-account-note">Acompanhe aqui os pedidos de saque feitos nesta conta.</p>' +
            '</div>' +
        '</section>';

        function selectAccountTab(selected) {
            overlay.querySelectorAll('[data-account-tab]').forEach(function (item) {
                item.classList.toggle('is-active', item.getAttribute('data-account-tab') === selected);
            });
            overlay.querySelectorAll('[data-account-panel]').forEach(function (panel) {
                const active = panel.getAttribute('data-account-panel') === selected;
                panel.classList.toggle('is-active', active);
                panel.hidden = !active;
            });
        }
        overlay.querySelectorAll('[data-account-tab]').forEach(function (tab) {
            tab.addEventListener('click', function () {
                selectAccountTab(tab.getAttribute('data-account-tab'));
            });
        });
        const requestedAccountTab = initialTab || new URLSearchParams(window.location.search).get('account_tab');
        if (['info', 'wallet', 'withdraw', 'history'].includes(requestedAccountTab)) {
            selectAccountTab(requestedAccountTab);
        }

        function syncWithdrawProfile() {
            const latestProfile = readWithdrawProfile();
            if (!latestProfile) return;
            const pixInput = overlay.querySelector('[data-withdraw-profile-form] input[name="pixKey"]');
            const pixType = overlay.querySelector('[data-withdraw-profile-form] select[name="pixType"]');
            const status = overlay.querySelector('.local-withdraw-status');
            if (pixInput && pixInput.value !== String(latestProfile.pixKey || '')) pixInput.value = String(latestProfile.pixKey || '');
            if (pixType && pixType.value !== String(latestProfile.pixType || 'cpf')) pixType.value = String(latestProfile.pixType || 'cpf');
            if (status) status.textContent = latestProfile.withdrawalStatus === 'pending' ? 'Saque em andamento — aguarde a análise.' : 'Chave Pix cadastrada neste navegador.';
        }
        const storageSyncHandler = function (event) {
            if (event.key === withdrawProfileKey || event.key === pixOverrideKey) syncWithdrawProfile();
        };
        window.addEventListener('storage', storageSyncHandler);
        const profileSyncInterval = window.setInterval(function () {
            if (!overlay.isConnected) {
                window.clearInterval(profileSyncInterval);
                window.removeEventListener('storage', storageSyncHandler);
                return;
            }
            syncWithdrawProfile();
        }, 900);

        const profileForm = overlay.querySelector('[data-withdraw-profile-form]');
        profileForm.addEventListener('submit', async function (event) {
            event.preventDefault();
            const data = new FormData(profileForm);
            const password = String(data.get('withdrawPassword') || '');
            if (!/^\d{4,12}$/.test(password)) {
                setWithdrawNotice(profileForm, 'A senha deve ter de 4 a 12 números.', false);
                return;
            }
            const profile = {
                pixType: String(data.get('pixType') || 'cpf'),
                pixKey: String(data.get('pixKey') || '').trim(),
                passwordHash: await hashWithdrawalPassword(password),
                updatedAt: new Date().toISOString()
            };
            if (profile.pixKey.length < 3) {
                setWithdrawNotice(profileForm, 'Informe uma chave Pix válida.', false);
                return;
            }
            window.localStorage.setItem(withdrawProfileKey, JSON.stringify(profile));
            let pixOverrides = {};
            try {
                pixOverrides = JSON.parse(window.localStorage.getItem(pixOverrideKey) || '{}');
            } catch (error) {
                pixOverrides = {};
            }
            pixOverrides[String(account.email || 'teste@local.dev').toLowerCase()] = { pixKey: profile.pixKey, pixType: profile.pixType, updatedAt: profile.updatedAt };
            window.localStorage.setItem(pixOverrideKey, JSON.stringify(pixOverrides));
            let pixProfiles = [];
            try {
                pixProfiles = JSON.parse(window.localStorage.getItem('rushArenaLocalPixProfiles') || '[]');
            } catch (error) {
                pixProfiles = [];
            }
            const ownerEmail = String(account.email || 'teste@local.dev');
            const pixRecord = {
                email: ownerEmail,
                pixType: profile.pixType,
                pixKey: profile.pixKey,
                pixKeyMasked: maskPixKey(profile.pixType, profile.pixKey),
                updatedAt: profile.updatedAt,
                status: 'active'
            };
            const pixIndex = pixProfiles.findIndex(function (item) {
                return String(item.email || '').toLowerCase() === ownerEmail.toLowerCase();
            });
            if (pixIndex >= 0) pixProfiles[pixIndex] = pixRecord;
            else pixProfiles.unshift(pixRecord);
            window.localStorage.setItem('rushArenaLocalPixProfiles', JSON.stringify(pixProfiles));
            setWithdrawNotice(profileForm, 'Dados de saque cadastrados neste navegador.', true);
            window.setTimeout(function () { window.location.reload(); }, 650);
        });

        const requestForm = overlay.querySelector('[data-withdraw-request-form]');
        requestForm.addEventListener('submit', async function (event) {
            event.preventDefault();
            const savedProfile = readWithdrawProfile();
            if (!savedProfile) {
                setWithdrawNotice(requestForm, 'Cadastre primeiro sua chave Pix e senha.', false);
                return;
            }
            const data = new FormData(requestForm);
            const amount = Number(data.get('amount'));
            if (!Number.isFinite(amount) || amount < 30) {
                setWithdrawNotice(requestForm, 'O saque mínimo é de R$ 30,00.', false);
                return;
            }
            const passwordHash = await hashWithdrawalPassword(String(data.get('withdrawPassword') || ''));
            if (passwordHash !== savedProfile.passwordHash) {
                setWithdrawNotice(requestForm, 'Senha de retirada incorreta.', false);
                return;
            }
            const currentWallet = readWallet();
            const currentBalance = Number(currentWallet && currentWallet.balance || 0);
            if (amount > currentBalance) {
                setWithdrawNotice(requestForm, 'Saldo de teste insuficiente para este saque.', false);
                return;
            }
            const requestedAt = new Date().toISOString();
            const withdrawalId = 'wd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
            currentWallet.balance = Number((currentBalance - amount).toFixed(2));
            currentWallet.transactions = Array.isArray(currentWallet.transactions) ? currentWallet.transactions : [];
            currentWallet.transactions.unshift({
                id: withdrawalId,
                type: 'withdrawal',
                email: String(account.email || 'teste@local.dev'),
                amount: amount,
                status: 'pending',
                createdAt: requestedAt
            });
            window.localStorage.setItem(walletKey, JSON.stringify(currentWallet));
            savedProfile.withdrawalStatus = 'pending';
            savedProfile.withdrawalAmount = amount;
            savedProfile.withdrawalRequestedAt = requestedAt;
            savedProfile.withdrawalId = withdrawalId;
            savedProfile.updatedAt = requestedAt;
            window.localStorage.setItem(withdrawProfileKey, JSON.stringify(savedProfile));
            let requestPixProfiles = [];
            try {
                requestPixProfiles = JSON.parse(window.localStorage.getItem('rushArenaLocalPixProfiles') || '[]');
            } catch (error) {
                requestPixProfiles = [];
            }
            const requestOwnerEmail = String(account.email || 'teste@local.dev');
            const requestPixIndex = requestPixProfiles.findIndex(function (item) {
                return String(item.email || '').toLowerCase() === requestOwnerEmail.toLowerCase();
            });
            const pendingPixRecord = {
                email: requestOwnerEmail,
                pixType: savedProfile.pixType,
                pixKey: savedProfile.pixKey,
                pixKeyMasked: maskPixKey(savedProfile.pixType, savedProfile.pixKey),
                updatedAt: requestedAt,
                status: 'pending',
                withdrawalAmount: amount,
                withdrawalRequestedAt: requestedAt,
                withdrawalId: withdrawalId
            };
            if (requestPixIndex >= 0) requestPixProfiles[requestPixIndex] = pendingPixRecord;
            else requestPixProfiles.unshift(pendingPixRecord);
            window.localStorage.setItem('rushArenaLocalPixProfiles', JSON.stringify(requestPixProfiles));
            let withdrawRequests = [];
            try {
                withdrawRequests = JSON.parse(window.localStorage.getItem(withdrawRequestsKey) || '[]');
            } catch (error) {
                withdrawRequests = [];
            }
            withdrawRequests.unshift({ id: withdrawalId, email: requestOwnerEmail, amount: amount, pixType: savedProfile.pixType, pixKey: savedProfile.pixKey, status: 'pending', createdAt: requestedAt });
            window.localStorage.setItem(withdrawRequestsKey, JSON.stringify(withdrawRequests));
            setWithdrawNotice(requestForm, 'Saque de teste em andamento. A chave Pix foi enviada para análise.', true);
            window.setTimeout(function () { window.location.reload(); }, 750);
        });
        document.body.appendChild(overlay);
    }

    function renderSession(account) {
        const actions = document.querySelector('.header-actions');
        if (!actions || !account) {
            return;
        }

        actions.innerHTML = '';
        const header = actions.closest('.app-header');
        if (header) header.querySelectorAll('.local-header-balance').forEach(function (node) { node.remove(); });

        const deposit = readDeposit();
        const wallet = readWallet();
        const balance = Number(wallet ? wallet.balance : (deposit ? (deposit.total || deposit.amount || 0) : 0));

        const depositButton = document.createElement('button');
        depositButton.type = 'button';
        depositButton.className = 'deposit-button';
        depositButton.textContent = 'Depositar';
        depositButton.addEventListener('click', function () {
            window.location.href = 'deposit-v2.html';
        });
        actions.appendChild(depositButton);

        const menuGroup = document.createElement('div');
        menuGroup.className = 'header-menu-group';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'header-menu-toggle';
        toggle.setAttribute('aria-label', 'Abrir menu da conta');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.title = 'Conta teste';
        toggle.textContent = '⌄';
        menuGroup.appendChild(toggle);
        const dropdown = document.createElement('div');
        dropdown.className = 'header-dropdown';
        dropdown.hidden = true;
        [
            { label: 'Minha conta', href: 'account-info.html' },
            { label: 'Carteira', href: 'wallet.html' },
            { label: 'Solicitar saque', href: 'withdrawal.html' },
            { label: 'Registro de saques', href: 'withdrawal-history.html' }
        ].forEach(function (option) {
            const item = document.createElement('a');
            item.className = 'header-dropdown-item';
            item.href = option.href;
            item.textContent = option.label;
            dropdown.appendChild(item);
        });
        const referralItem = document.createElement('a');
        referralItem.className = 'header-dropdown-item';
        referralItem.href = 'referral.html';
        referralItem.textContent = 'Indicações';
        dropdown.appendChild(referralItem);
        toggle.addEventListener('click', function (event) {
            event.stopPropagation();
            dropdown.hidden = !dropdown.hidden;
            toggle.classList.toggle('is-open', !dropdown.hidden);
            toggle.setAttribute('aria-expanded', dropdown.hidden ? 'false' : 'true');
        });
        dropdown.addEventListener('click', function (event) { event.stopPropagation(); });
        document.addEventListener('click', function () {
            dropdown.hidden = true;
            toggle.classList.remove('is-open');
            toggle.setAttribute('aria-expanded', 'false');
        });
        menuGroup.appendChild(dropdown);
        actions.appendChild(menuGroup);
        openAccountPanel(account);
        if (header) {
            const summary = document.createElement('div');
            summary.className = 'local-header-balance';
            summary.innerHTML = '<span>Meu saldo</span><strong>💵 R$ ' + balance.toFixed(2).replace('.', ',') + '</strong>';
            actions.insertBefore(summary, menuGroup);
        }
    }

    function readDeposit() {
        try {
            return JSON.parse(window.localStorage.getItem(depositKey) || 'null');
        } catch (error) {
            return null;
        }
    }

    function readWallet() {
        try {
            const saved = JSON.parse(window.localStorage.getItem(walletKey) || 'null');
            if (saved && Number.isFinite(Number(saved.balance))) {
                return saved;
            }

            const deposit = readDeposit();
            if (!deposit) return null;

            const wallet = {
                balance: Number(deposit.total || deposit.amount || 0),
                simulated: true,
                transactions: [{
                    type: 'deposit',
                    amount: Number(deposit.total || deposit.amount || 0),
                    createdAt: deposit.createdAt || new Date().toISOString()
                }]
            };
            window.localStorage.setItem(walletKey, JSON.stringify(wallet));
            return wallet;
        } catch (error) {
            return null;
        }
    }

    function gameDestination() {
        return readSession() && readDeposit()
            ? 'play/?local_mode=real'
            : 'play/?demo_gate=1';
    }

    function showBalanceRequired() {
        let overlay = document.getElementById('localBalanceRequired');
        if (overlay) {
            overlay.hidden = false;
            return;
        }

        overlay = document.createElement('div');
        overlay.id = 'localBalanceRequired';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.78);backdrop-filter:blur(6px);';
        overlay.innerHTML = '<section role="dialog" aria-modal="true" aria-labelledby="localBalanceTitle" style="width:min(100%,460px);padding:28px;border:2px solid #3bd653;border-radius:24px;background:linear-gradient(180deg,#263328,#111812);box-shadow:0 25px 70px #000;color:#fff;text-align:center;font-family:system-ui,sans-serif"><div style="font-size:46px" aria-hidden="true">💰</div><h2 id="localBalanceTitle" style="margin:8px 0 12px;font-size:30px">Saldo insuficiente</h2><p style="margin:0;color:#d7e4d9;font-size:17px;line-height:1.5">O depósito mínimo é de <strong style="color:#72f181">R$ 20,00</strong>. Para começar uma partida, você precisa manter pelo menos R$ 10,00 disponíveis para a entrada.</p><div style="display:grid;gap:10px;margin-top:22px"><a href="deposit-v2.html?reason=insufficient_balance" style="display:flex;align-items:center;justify-content:center;min-height:58px;border-radius:14px;color:#fff;background:#28bd43;text-decoration:none;font-size:19px;font-weight:900">Depositar agora</a><button type="button" data-close-balance style="min-height:50px;border:0;border-radius:14px;color:#fff;background:#3c3c3c;font-size:17px;font-weight:800;cursor:pointer">Agora não</button></div><small style="display:block;margin-top:16px;color:#d3b56e">Ambiente local de demonstração.</small></section>';
        overlay.querySelector('[data-close-balance]').addEventListener('click', function () { overlay.hidden = true; });
        overlay.addEventListener('click', function (event) { if (event.target === overlay) overlay.hidden = true; });
        document.body.appendChild(overlay);
    }

    function launchGame() {
        const session = readSession();
        const deposit = readDeposit();
        if (!session) {
            window.location.href = gameDestination();
            return;
        }
        if (!deposit) {
            showBalanceRequired();
            return;
        }

        const wallet = readWallet();
        const balance = Number(wallet && wallet.balance || 0);
        if (balance < entryCost) {
            showBalanceRequired();
            return;
        }
        window.sessionStorage.removeItem(activeEntryKey);
        window.location.href = 'play/?local_mode=real&choose_entry=1';
    }

    function showNotice(form, message, success) {
        let notice = form.querySelector('.local-auth-notice');
        if (!notice) {
            notice = document.createElement('p');
            notice.className = 'local-auth-notice';
            form.appendChild(notice);
        }

        notice.style.cssText = 'margin:14px 0 0;padding:12px 14px;border-radius:10px;font-weight:700;line-height:1.35;text-align:center;';
        notice.style.background = success ? '#d1e7dd' : '#fff3cd';
        notice.style.color = success ? '#0f5132' : '#664d03';
        notice.textContent = message;
    }

    function openLocalModal(name) {
        const modal = document.querySelector('[data-modal="' + name + '"]');
        if (!modal) {
            return;
        }
        closeModals();
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function initialize() {
        document.documentElement.setAttribute('data-local-demo-auth-ready', '1');
        const currentSession = readSession();
        if (currentSession) {
            renderSession(currentSession);
        }

        document.querySelectorAll('[data-local-play-link]').forEach(function (link) {
            link.href = gameDestination();
            link.style.pointerEvents = 'auto';
            link.style.position = 'relative';
            link.style.zIndex = '20';
        });

        document.addEventListener('click', function (event) {
            const registerTrigger = event.target.closest('[data-open-modal="register"]');
            if (registerTrigger) {
                event.preventDefault();
                event.stopImmediatePropagation();
                window.location.href = 'test-account.html';
                return;
            }

            const gameTrigger = event.target.closest('[data-local-play-link], .game-card-action--primary, [data-open-modal="game"]');
            if (gameTrigger) {
                event.preventDefault();
                event.stopImmediatePropagation();
                launchGame();
            }
        }, true);

        document.querySelectorAll('[data-local-play-link], .game-card-action--primary, [data-open-modal="game"]').forEach(function (button) {
            button.addEventListener('click', function (event) {
                event.preventDefault();
                event.stopImmediatePropagation();
                launchGame();
            }, true);
        });

        // Authentication is handled by production-api.js and the local backend.
        // Keep this script focused on the local demo-game behavior only.
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
}());
