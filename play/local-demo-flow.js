(function () {
    'use strict';

    if (!new Set(['127.0.0.1', 'localhost']).has(window.location.hostname)) {
        return;
    }

    document.documentElement.setAttribute('data-local-demo-flow', 'ready');

    let session = null;
    let deposit = null;
    let wallet = null;
    try {
        session = JSON.parse(localStorage.getItem('rushArenaLocalTestSession') || 'null');
        deposit = JSON.parse(localStorage.getItem('rushArenaLocalTestDeposit') || 'null');
        wallet = JSON.parse(localStorage.getItem('rushArenaLocalTestWallet') || 'null');
    } catch (error) {
        session = null;
        deposit = null;
        wallet = null;
    }

    const isRealMode = new URLSearchParams(location.search).get('local_mode') === 'real';
    const walletKey = 'rushArenaLocalTestWallet';
    const activeEntryKey = 'rushArenaActiveGameEntry';
    const minimumEntryCost = 10;
    const entryOptions = [10, 20, 30, 50];

    function money(value) {
        return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function goalFor(stake) {
        return stake === 10 ? 15 : stake * 2;
    }

    function ensureWallet() {
        if (wallet && Number.isFinite(Number(wallet.balance))) return wallet;
        if (!deposit) return null;
        wallet = {
            balance: Number(deposit.total || deposit.amount || 0),
            simulated: true,
            transactions: [{ type: 'deposit', amount: Number(deposit.total || deposit.amount || 0), createdAt: deposit.createdAt || new Date().toISOString() }]
        };
        localStorage.setItem(walletKey, JSON.stringify(wallet));
        return wallet;
    }

    function renderWalletBadge() {
        if (!isRealMode || !session || !deposit) return;
        const currentWallet = ensureWallet();
        let badge = document.getElementById('localWalletBadge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'localWalletBadge';
            badge.style.cssText = 'position:fixed;top:16px;left:16px;z-index:1100;padding:11px 15px;border:2px solid #42df57;border-radius:14px;background:rgba(9,37,16,.92);box-shadow:0 7px 20px rgba(0,0,0,.3);color:#fff;font:800 15px/1.2 system-ui,sans-serif;pointer-events:none;';
            document.body.appendChild(badge);
        }
        let activeEntry = null;
        try { activeEntry = JSON.parse(sessionStorage.getItem(activeEntryKey) || 'null'); } catch (error) { activeEntry = null; }
        const activeCost = activeEntry && entryOptions.includes(Number(activeEntry.cost)) ? Number(activeEntry.cost) : 0;
        badge.textContent = 'Saldo teste: ' + money(currentWallet ? currentWallet.balance : 0) + (activeCost ? ' • Entrada: ' + money(activeCost) + ' • Meta: ' + money(goalFor(activeCost)) : '');
    }

    function establishPaidEntry() {
        if (!isRealMode || !session || !deposit) return false;
        const params = new URLSearchParams(location.search);
        const requestedToken = params.get('entry');
        let activeEntry = null;
        try { activeEntry = JSON.parse(sessionStorage.getItem(activeEntryKey) || 'null'); } catch (error) { activeEntry = null; }

        if (requestedToken && activeEntry && activeEntry.paid && activeEntry.token === requestedToken) {
            return true;
        }

        const currentWallet = ensureWallet();
        if (!currentWallet || Number(currentWallet.balance || 0) < minimumEntryCost) {
            location.replace('../deposit-v2.html?reason=insufficient_balance');
            return false;
        }
        return false;
    }

    const entryReady = establishPaidEntry();

    function installEntryPickerStyles() {
        if (document.getElementById('localEntryPickerStyles')) return;
        const style = document.createElement('style');
        style.id = 'localEntryPickerStyles';
        style.textContent = '.local-entry-picker{margin:18px auto 4px;max-width:460px}.local-entry-picker__label{display:block;margin-bottom:10px;color:#fff;font:800 16px/1.2 system-ui,sans-serif}.local-entry-picker__options{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}.local-entry-picker__button{min-height:54px;padding:7px;border:2px solid #319846;border-radius:12px;color:#fff;background:#173e20;font:900 15px/1.25 system-ui,sans-serif;cursor:pointer}.local-entry-picker__button small{display:block;margin-top:4px;color:#bcffc5;font-size:12px}.local-entry-picker__button.is-selected{border-color:#76ff72;background:#24a83e;box-shadow:0 0 0 3px rgba(70,239,82,.18)}.local-entry-picker__button:disabled{opacity:.35;cursor:not-allowed}.local-entry-picker__note{margin:10px 0 0;color:#d9eadb;font:700 14px/1.3 system-ui,sans-serif}.local-round-home{display:flex!important;width:min(100%,300px)!important;min-height:54px!important;margin:0 auto!important;align-items:center!important;justify-content:center!important;border-radius:14px!important;background:#3b3b3b!important;color:#fff!important}.local-pregame{position:fixed;inset:0;z-index:5000;display:grid;place-items:center;padding:18px;background:rgba(3,12,6,.9);backdrop-filter:blur(8px)}.local-pregame__card{width:min(100%,560px);padding:26px;border:2px solid #3cbd50;border-radius:24px;background:linear-gradient(180deg,#243226,#101811);box-shadow:0 28px 80px #000;color:#fff;text-align:center}.local-pregame__card h2{margin:0 0 8px;font:900 clamp(28px,7vw,42px)/1.1 system-ui,sans-serif}.local-pregame__card>p{margin:0;color:#d6e5d8;font:700 16px/1.4 system-ui,sans-serif}.local-pregame__actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}.local-pregame__start,.local-pregame__home{min-height:56px;display:flex;align-items:center;justify-content:center;border:0;border-radius:14px;color:#fff;text-decoration:none;font:900 18px/1 system-ui,sans-serif;cursor:pointer}.local-pregame__start{background:#27bd43}.local-pregame__home{background:#3b3b3b}@media(max-width:480px){.local-pregame__actions{grid-template-columns:1fr}}';
        document.head.appendChild(style);
    }

    let nextRoundStarting = false;
    function startNextRound(stake, note) {
        if (nextRoundStarting) return;
        const currentWallet = ensureWallet();
        if (!entryOptions.includes(stake) || !currentWallet || Number(currentWallet.balance || 0) < stake) {
            if (note) note.textContent = 'Saldo insuficiente para essa entrada. Escolha um valor menor ou adicione saldo.';
            return;
        }
        nextRoundStarting = true;
        if (note) note.textContent = 'Iniciando nova partida com entrada de ' + money(stake) + ' e meta de ' + money(goalFor(stake)) + '...';
        if (!Array.isArray(currentWallet.transactions)) currentWallet.transactions = [];
        currentWallet.balance = Math.round((Number(currentWallet.balance || 0) - stake) * 100) / 100;
        const goal = goalFor(stake);
        currentWallet.transactions.push({ type: 'game_entry', amount: -stake, goal: goal, createdAt: new Date().toISOString() });
        localStorage.setItem(walletKey, JSON.stringify(currentWallet));
        wallet = currentWallet;
        const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
        sessionStorage.setItem(activeEntryKey, JSON.stringify({ token: token, paid: true, cost: stake, goal: goal }));
        location.href = location.pathname + '?local_mode=real&entry=' + encodeURIComponent(token);
    }

    function addEntryPicker(modal, primary, secondary) {
        installEntryPickerStyles();
        const actions = primary.closest('[class$="__actions"]') || primary.parentElement;
        let picker = modal.querySelector('.local-entry-picker');
        if (!picker) {
            picker = document.createElement('div');
            picker.className = 'local-entry-picker';
            picker.innerHTML = '<span class="local-entry-picker__label">Escolha a entrada da próxima partida:</span><div class="local-entry-picker__options"></div><p class="local-entry-picker__note"></p>';
            actions.parentElement.insertBefore(picker, actions);
        }
        const optionsBox = picker.querySelector('.local-entry-picker__options');
        const note = picker.querySelector('.local-entry-picker__note');
        const balance = Number(ensureWallet().balance || 0);
        optionsBox.innerHTML = '';
        entryOptions.forEach(function (stake) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'local-entry-picker__button';
            button.innerHTML = 'Jogar ' + money(stake) + '<small>Meta ' + money(goalFor(stake)) + '</small>';
            button.disabled = stake > balance;
            button.addEventListener('click', function () {
                optionsBox.querySelectorAll('button').forEach(function (item) { item.disabled = true; });
                startNextRound(stake, note);
            });
            optionsBox.appendChild(button);
        });
        note.textContent = balance >= 10 ? 'Clique em uma entrada para começar imediatamente.' : 'Saldo abaixo da entrada mínima de R$ 10,00.';
        primary.hidden = true;
        primary.style.display = 'none';
        secondary.removeAttribute('data-demo-native-flow');
        secondary.hidden = false;
        secondary.style.display = 'inline-flex';
        secondary.classList.add('local-round-home');
        secondary.href = '../';
        secondary.textContent = 'Voltar ao início';
        if (actions) { actions.style.gap = '12px'; actions.style.display = 'grid'; actions.style.marginTop = '14px'; }
    }

    function openRoundEnd(mode, winnings) {
        if (window.freezeDemoScene) window.freezeDemoScene(mode === 'loss' ? 'loss' : 'win');
        const isLoss = mode === 'loss';
        const modal = document.getElementById(isLoss ? 'demoLossModal' : 'demoWinModal');
        if (!modal) return;
        const title = document.getElementById(isLoss ? 'demoLossModalTitle' : 'demoWinModalTitle');
        const primary = modal.querySelector(isLoss ? '.demo-loss-modal__primary' : '.demo-win-modal__primary');
        const secondary = modal.querySelector(isLoss ? '.demo-loss-modal__secondary' : '.demo-win-modal__secondary');
        if (title) title.textContent = isLoss ? 'Você bateu! Quer tentar de novo?' : (winnings > 0 ? 'Moedas adicionadas ao saldo de teste!' : 'Corrida encerrada');
        modal.querySelectorAll(isLoss ? '.demo-loss-modal__text' : '.demo-win-modal__text').forEach(function (node) { node.hidden = true; });
        let result = modal.querySelector('.local-round-result');
        if (!result) {
            result = document.createElement('div');
            result.className = 'local-round-result';
            result.style.cssText = 'margin:10px auto;color:#fff;font:800 18px/1.4 system-ui,sans-serif;text-align:center;';
            primary.parentElement.parentElement.insertBefore(result, primary.parentElement);
        }
        result.textContent = isLoss ? 'A entrada desta rodada foi encerrada. Saldo atual: ' + money(ensureWallet().balance) + '.' : (winnings > 0 ? money(winnings) + ' das moedas foram adicionados. ' : 'Nenhuma moeda foi acumulada. ') + 'Saldo atual: ' + money(ensureWallet().balance) + '.';
        addEntryPicker(modal, primary, secondary);
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
    }

    function showPreGameSelection() {
        if (!isRealMode || !session || !deposit || entryReady || document.getElementById('localPregame')) return;
        installEntryPickerStyles();
        const overlay = document.createElement('div');
        overlay.id = 'localPregame';
        overlay.className = 'local-pregame';
        overlay.innerHTML = '<div class="local-pregame__card"><h2>Escolha sua entrada</h2><p>A meta muda conforme o valor escolhido. A entrada só será descontada quando você começar.</p><div class="local-entry-picker"><span class="local-entry-picker__label">Selecione entrada e meta:</span><div class="local-entry-picker__options"></div><p class="local-entry-picker__note"></p></div><div class="local-pregame__actions"><button type="button" class="local-pregame__start">Começar jogo</button><a class="local-pregame__home" href="../">Voltar ao início</a></div></div>';
        const optionsBox = overlay.querySelector('.local-entry-picker__options');
        const note = overlay.querySelector('.local-entry-picker__note');
        const startButton = overlay.querySelector('.local-pregame__start');
        const balance = Number(ensureWallet().balance || 0);
        let selectedStake = entryOptions.find(function (stake) { return stake <= balance; }) || 0;
        entryOptions.forEach(function (stake) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'local-entry-picker__button';
            button.innerHTML = money(stake) + '<small>Meta ' + money(goalFor(stake)) + '</small>';
            button.disabled = stake > balance;
            button.classList.toggle('is-selected', stake === selectedStake);
            button.addEventListener('click', function () {
                selectedStake = stake;
                optionsBox.querySelectorAll('button').forEach(function (item) { item.classList.toggle('is-selected', item === button); });
                note.textContent = 'Entrada: ' + money(stake) + ' • Meta: ' + money(goalFor(stake)) + ' • Saldo restante: ' + money(balance - stake);
            });
            optionsBox.appendChild(button);
        });
        note.textContent = selectedStake ? 'Entrada: ' + money(selectedStake) + ' • Meta: ' + money(goalFor(selectedStake)) + ' • Saldo restante: ' + money(balance - selectedStake) : 'Saldo insuficiente. Adicione saldo para jogar.';
        startButton.disabled = !selectedStake;
        startButton.addEventListener('click', function () { startNextRound(selectedStake, note); });
        document.body.appendChild(overlay);
    }

    let withdrawalCommitted = false;
    window.handleLocalWithdrawal = function (amount) {
        if (!isRealMode || !session || !deposit || !entryReady) return false;
        if (withdrawalCommitted) return true;
        withdrawalCommitted = true;

        const winnings = Math.max(0, Math.round(Number(amount || 0) * 100) / 100);
        const currentWallet = ensureWallet();
        if (!Array.isArray(currentWallet.transactions)) currentWallet.transactions = [];
        currentWallet.balance = Math.round((Number(currentWallet.balance || 0) + winnings) * 100) / 100;
        currentWallet.simulated = true;
        currentWallet.transactions.push({ type: 'game_withdrawal', amount: winnings, createdAt: new Date().toISOString() });
        localStorage.setItem(walletKey, JSON.stringify(currentWallet));
        wallet = currentWallet;
        renderWalletBadge();

        openRoundEnd('win', winnings);
        return true;
    };

    function configureModal(modalSelector, primarySelector, secondarySelector) {
        const modal = document.querySelector(modalSelector);
        const primary = document.querySelector(primarySelector);
        const secondary = document.querySelector(secondarySelector);
        if (!modal || !primary) return;

        if (!session) {
            primary.href = '../test-account.html?next=deposit';
            primary.textContent = 'Criar conta e depositar';
            if (secondary) secondary.hidden = true;
            return;
        }

        if (!deposit) {
            primary.href = '../deposit-v2.html';
            primary.textContent = 'Depositar e continuar';
            if (secondary) secondary.hidden = true;
            modal.querySelectorAll('.demo-win-modal__step-badge, .demo-loss-modal__text--body').forEach(function (node) {
                if (node.textContent.toLowerCase().includes('cadastre')) node.hidden = true;
            });
            return;
        }

        primary.href = '../';
        primary.textContent = isRealMode ? 'Voltar ao site' : 'Continuar jogando';
        if (secondary) secondary.hidden = true;
    }

    configureModal('#demoLossModal', '.demo-loss-modal__primary', '.demo-loss-modal__secondary');
    configureModal('#demoWinModal', '.demo-win-modal__primary', '.demo-win-modal__secondary');
    const originalHandleDemoLoss = window.handleDemoLoss;
    if (isRealMode && session && deposit && entryReady) {
        window.handleDemoLoss = function () { openRoundEnd('loss', 0); };
    } else if (typeof originalHandleDemoLoss === 'function') {
        window.handleDemoLoss = originalHandleDemoLoss;
    }
    renderWalletBadge();
    showPreGameSelection();
}());
