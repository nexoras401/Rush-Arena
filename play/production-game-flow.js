(function () {
    'use strict';

    if (['127.0.0.1', 'localhost'].includes(window.location.hostname)) return;

    const token = localStorage.getItem('rushArenaApiToken') || '';
    const activeRoundKey = 'rushArenaActiveRoundId';
    const activeStakeKey = 'rushArenaActiveStakeCents';
    const entryOptions = [1000, 2000, 3000, 5000]; // R$ 10, R$ 20, R$ 30, R$ 50

    const money = (cents) => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const goalFor = (cents) => (cents === 1000 ? 1500 : cents * 2);

    async function api(path, options = {}) {
        const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(`/api${path}`, { ...options, headers });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Erro na requisição.');
        return body;
    }

    if (!token) {
        // Guest mode / not logged in
        installAuthBanner();
        return;
    }

    function installAuthBanner() {
        const banner = document.createElement('div');
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;padding:12px;background:#18181b;color:#fff;text-align:center;font:700 14px system-ui;display:flex;justify-content:center;align-items:center;gap:12px;border-bottom:1px solid #333;';
        banner.innerHTML = '<span>Modo de demonstração. Entre na sua conta para jogar valendo saldo real.</span><a href="/?login=1" style="background:#22c55e;color:#000;padding:6px 14px;border-radius:8px;text-decoration:none;font-weight:900;">Entrar</a>';
        document.body.appendChild(banner);
    }

    let userState = null;
    let badge = null;

    function renderWalletBadge(balanceCents, currentStakeCents) {
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'prodWalletBadge';
            badge.style.cssText = 'position:fixed;top:16px;left:16px;z-index:11000;padding:11px 16px;border:2px solid #22c55e;border-radius:14px;background:rgba(9,30,14,.95);box-shadow:0 8px 25px rgba(0,0,0,.5);color:#fff;font:800 14px/1.3 system-ui,sans-serif;pointer-events:none;';
            document.body.appendChild(badge);
        }
        let txt = `Saldo: ${money(balanceCents)}`;
        if (currentStakeCents) {
            txt += ` • Entrada: ${money(currentStakeCents)} • Meta: ${money(goalFor(currentStakeCents))}`;
        }
        badge.textContent = txt;
    }

    function installEntryModal(balanceCents) {
        if (document.getElementById('prodPregame')) return;
        const style = document.createElement('style');
        style.textContent = `
            .prod-pregame{position:fixed;inset:0;z-index:50000;display:grid;place-items:center;padding:18px;background:rgba(3,12,6,.92);backdrop-filter:blur(10px)}
            .prod-pregame__card{width:min(100%,540px);padding:28px;border:2px solid #22c55e;border-radius:24px;background:linear-gradient(180deg,#1c261e,#0e1510);box-shadow:0 30px 90px #000;color:#fff;text-align:center}
            .prod-pregame__card h2{margin:0 0 8px;font:900 clamp(26px,6vw,38px)/1.1 system-ui}
            .prod-pregame__card p{margin:0 0 16px;color:#cbd5e1;font:600 15px/1.4 system-ui}
            .prod-entry-picker{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:18px 0}
            .prod-entry-btn{min-height:56px;padding:8px;border:2px solid #2e7d32;border-radius:14px;color:#fff;background:#14341b;font:900 16px system-ui;cursor:pointer;transition:all .15s}
            .prod-entry-btn small{display:block;margin-top:4px;color:#86efac;font-size:12px;font-weight:700}
            .prod-entry-btn.is-selected{border-color:#4ade80;background:#15803d;box-shadow:0 0 0 3px rgba(74,222,128,.3)}
            .prod-entry-btn:disabled{opacity:.35;cursor:not-allowed}
            .prod-pregame__actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:20px}
            .prod-start-btn{min-height:54px;display:flex;align-items:center;justify-content:center;border:0;border-radius:14px;color:#052e16;background:#22c55e;font:900 17px system-ui;cursor:pointer}
            .prod-start-btn:disabled{opacity:.4;cursor:not-allowed}
            .prod-back-btn{min-height:54px;display:flex;align-items:center;justify-content:center;border:1px solid #334155;border-radius:14px;color:#fff;background:#1e293b;text-decoration:none;font:800 16px system-ui}
            .prod-deposit-btn{min-height:50px;margin-top:14px;display:flex;align-items:center;justify-content:center;border-radius:14px;color:#fff;background:#e11d48;text-decoration:none;font:800 15px system-ui}
        `;
        document.head.appendChild(style);

        const overlay = document.createElement('div');
        overlay.id = 'prodPregame';
        overlay.className = 'prod-pregame';

        let selectedStake = entryOptions.find((s) => s <= balanceCents) || entryOptions[0];
        const canAfford = balanceCents >= 1000;

        let optionsHtml = entryOptions.map((s) => `
            <button type="button" class="prod-entry-btn ${s === selectedStake ? 'is-selected' : ''}" data-stake="${s}" ${s > balanceCents ? 'disabled' : ''}>
                ${money(s)}
                <small>Meta ${money(goalFor(s))}</small>
            </button>
        `).join('');

        overlay.innerHTML = `
            <div class="prod-pregame__card">
                <h2>Selecione sua entrada</h2>
                <p>Seu saldo real é de <strong>${money(balanceCents)}</strong>. O valor só é debitado quando você clicar em Iniciar.</p>
                <div class="prod-entry-picker">${optionsHtml}</div>
                <div class="prod-pregame__actions">
                    <button type="button" class="prod-start-btn" id="prodStartGame" ${!canAfford ? 'disabled' : ''}>INICIAR CORRIDA</button>
                    <a class="prod-back-btn" href="/">Voltar ao site</a>
                </div>
                ${!canAfford ? '<a class="prod-deposit-btn" href="/deposit-v2.html">Saldo insuficiente • Adicionar saldo Pix</a>' : ''}
            </div>
        `;

        overlay.querySelectorAll('.prod-entry-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                overlay.querySelectorAll('.prod-entry-btn').forEach((b) => b.classList.remove('is-selected'));
                btn.classList.add('is-selected');
                selectedStake = Number(btn.dataset.stake);
            });
        });

        overlay.querySelector('#prodStartGame')?.addEventListener('click', async () => {
            const startBtn = overlay.querySelector('#prodStartGame');
            startBtn.disabled = true;
            startBtn.textContent = 'Iniciando...';
            try {
                const res = await api('/game/bet', { method: 'POST', body: JSON.stringify({ stakeCents: selectedStake }) });
                sessionStorage.setItem(activeRoundKey, res.roundId);
                sessionStorage.setItem(activeStakeKey, String(selectedStake));
                overlay.remove();
                renderWalletBadge(res.balanceCents, selectedStake);
            } catch (err) {
                alert(err.message);
                startBtn.disabled = false;
                startBtn.textContent = 'INICIAR CORRIDA';
            }
        });

        document.body.appendChild(overlay);
    }

    async function init() {
        try {
            const res = await api('/me');
            userState = res;
            const balanceCents = Number(res.balanceCents || 0);
            const savedStake = Number(sessionStorage.getItem(activeStakeKey) || 0);
            renderWalletBadge(balanceCents, savedStake);

            const activeRoundId = sessionStorage.getItem(activeRoundKey);
            if (!activeRoundId) {
                installEntryModal(balanceCents);
            }

            // Hook window game callbacks
            window.handleDemoLoss = async function () {
                const roundId = sessionStorage.getItem(activeRoundKey);
                sessionStorage.removeItem(activeRoundKey);
                sessionStorage.removeItem(activeStakeKey);
                if (roundId) {
                    try {
                        const endRes = await api('/game/end', { method: 'POST', body: JSON.stringify({ roundId, outcome: 'lost' }) });
                        renderWalletBadge(endRes.balanceCents, 0);
                    } catch (_) {}
                }
                const modal = document.getElementById('demoLossModal');
                if (modal) {
                    const btn = modal.querySelector('.demo-loss-modal__primary');
                    if (btn) {
                        btn.textContent = 'Jogar novamente';
                        btn.onclick = (e) => { e.preventDefault(); location.reload(); };
                    }
                    modal.classList.add('is-open');
                }
            };

            window.handleLocalWithdrawal = async function (amount) {
                const roundId = sessionStorage.getItem(activeRoundKey);
                sessionStorage.removeItem(activeRoundKey);
                sessionStorage.removeItem(activeStakeKey);
                if (roundId) {
                    try {
                        const multiplier = Number(amount || 2);
                        const endRes = await api('/game/end', { method: 'POST', body: JSON.stringify({ roundId, outcome: 'won', multiplier }) });
                        renderWalletBadge(endRes.balanceCents, 0);
                    } catch (_) {}
                }
                const modal = document.getElementById('demoWinModal');
                if (modal) {
                    const btn = modal.querySelector('.demo-win-modal__primary');
                    if (btn) {
                        btn.textContent = 'Continuar jogando';
                        btn.onclick = (e) => { e.preventDefault(); location.reload(); };
                    }
                    modal.classList.add('is-open');
                }
                return true;
            };

        } catch (err) {
            console.warn('Erro ao carregar sessão do jogo:', err);
        }
    }

    init();
})();
