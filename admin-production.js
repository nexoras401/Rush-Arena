(function () {
  'use strict';
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = cents => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const date = value => value ? new Date(value).toLocaleString('pt-BR') : '—';
  const statusLabels = { pending:'Pendente', paid:'Pago', approved:'Aprovado', rejected:'Recusado', expired:'Expirado', cancelled:'Cancelado', failed:'Falhou', credited:'Creditada' };
  const roleLabels = { admin:'Administrador', customer:'Cliente', influencer:'Influenciador' };
  const pixLabels = { cpf:'CPF', cnpj:'CNPJ', email:'E-mail', phone:'Telefone', random:'Aleatória' };
  const token = () => localStorage.getItem('rushArenaApiToken') || '';
  async function api(path, options) {
    const response = await fetch('/api' + path, Object.assign({}, options || {}, { headers: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, options && options.headers || {}) }));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || 'Erro ao consultar o painel.');
      error.status = response.status;
      throw error;
    }
    return body;
  }
  function mask(value) { const raw = String(value || ''); return raw.length > 7 ? raw.slice(0, 2) + '•••••' + raw.slice(-5) : raw; }
  function cpf(value, last4) { const digits=String(value||'').replace(/\D/g,''); return digits.length===11 ? digits.slice(0,3)+'.'+digits.slice(3,6)+'.'+digits.slice(6,9)+'-'+digits.slice(9) : (last4 ? 'CPF antigo: final '+last4 : 'Não informado'); }
  function renderChart(rows) {
    const data = Array.isArray(rows) ? rows.slice(-7) : [];
    while (data.length < 7) data.unshift({ day: '', deposits_cents: 0 });
    const values = data.map(item => Number(item.deposits_cents || 0));
    const maximum = Math.max(1, ...values);
    const points = values.map((value, index) => {
      const x = 48 + (652 * index / 6);
      const y = 260 - (210 * value / maximum);
      return [x, y];
    });
    const line = points.map((point, index) => (index ? 'L' : 'M') + point[0].toFixed(1) + ' ' + point[1].toFixed(1)).join(' ');
    document.getElementById('chartLine').setAttribute('d', line);
    document.getElementById('chartArea').setAttribute('d', line + ' L700 260 L48 260 Z');
    document.getElementById('chartLabels').innerHTML = data.map((item, index) => {
      const parsed = item.day ? new Date(String(item.day).slice(0, 10) + 'T12:00:00') : null;
      const label = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '') : '—';
      return '<text x="' + (48 + (652 * index / 6)).toFixed(1) + '" y="282" text-anchor="middle">' + esc(label) + '</text>';
    }).join('');
    document.getElementById('chartTotal').textContent = money(values.reduce((sum, value) => sum + value, 0));
  }
  function renderActivities(rows) {
    const labels = { deposit: 'Depósito pago', deposit_credit: 'Depósito creditado', referral_commission: 'Comissão de indicação', admin_credit: 'Crédito administrativo', admin_debit: 'Débito administrativo', withdrawal_hold: 'Saque solicitado', withdrawal_refund: 'Saque devolvido', game_bet: 'Entrada no jogo', game_win: 'Prêmio do jogo' };
    const data = Array.isArray(rows) ? rows : [];
    document.getElementById('activityList').innerHTML = data.length ? data.map(item => {
      const amount = Number(item.amount_cents || 0);
      return '<div class="activity"><div class="activity-icon">' + (amount < 0 ? '↗' : '↙') + '</div><div><strong>' + esc(labels[item.kind] || item.kind || 'Movimentação') + '</strong><small>' + esc(item.name || item.email || 'Conta') + ' · ' + date(item.created_at) + '</small></div><b class="' + (amount < 0 ? 'negative' : 'positive') + '">' + (amount < 0 ? '-' : '+') + money(Math.abs(amount)) + '</b></div>';
    }).join('') : '<div class="empty">Nenhuma movimentação ainda.</div>';
  }
  const kindLabels = { deposit: 'Depósito', deposit_credit: 'Depósito creditado', referral_commission: 'Comissão de indicação', admin_credit: 'Crédito administrativo', admin_debit: 'Débito administrativo', withdrawal_hold: 'Saque solicitado', withdrawal_refund: 'Saque devolvido', game_bet: 'Entrada no jogo', game_win: 'Prêmio do jogo' };
  function configureProductionViews() {
    const accountsPanel = document.querySelector('[data-view-panel="accounts"]');
    if (accountsPanel) {
      accountsPanel.querySelector('h2').textContent = 'Dados das contas';
      accountsPanel.querySelector('.section-heading p').textContent = 'Nome, e-mail, telefone, CPF cadastrado, perfil e data de cadastro.';
      accountsPanel.querySelectorAll('th')[1].textContent = 'E-mail';
      accountsPanel.querySelectorAll('th')[3].textContent = 'CPF';
      accountsPanel.querySelector('.privacy').textContent = 'Cadastros novos exibem o CPF informado. Contas antigas podem mostrar somente os quatro últimos dígitos. Senhas nunca são exibidas.';
      document.getElementById('accountSearch').placeholder = 'Nome, e-mail, telefone ou CPF';
    }
    const layouts = {
      demos: { label: '⇄ Transações', title: 'Transações da carteira', description: 'Movimentações registradas no banco de dados.', html: '<article class="card table-card"><div class="table-tools"><input class="search" id="transactionSearch" placeholder="Buscar por conta ou tipo"></div><div class="table-wrap"><table><thead><tr><th>Conta</th><th>Movimentação</th><th>Valor</th><th>Referência</th><th>Data</th></tr></thead><tbody id="transactionRows"></tbody></table></div></article>' },
      balance: { label: '▣ Depósitos', title: 'Depósitos', description: 'Cobranças PIX e situação de pagamento.', html: '<article class="card table-card"><div class="table-tools"><input class="search" id="depositSearch" placeholder="Buscar por conta, cobrança ou status"></div><div class="table-wrap"><table><thead><tr><th>Conta</th><th>Valor</th><th>Provedor</th><th>Status</th><th>Referência</th><th>Criado em</th><th>Pago em</th></tr></thead><tbody id="depositRows"></tbody></table></div></article>' },
      commissions: { label: '$ Comissões', title: 'Comissões', description: 'Comissões confirmadas no sistema de indicações.', html: '<div class="commission-grid"><article class="card kpi"><span>Total gerado</span><strong id="commissionTotal">R$ 0,00</strong><small>Registrado no banco</small></article><article class="card kpi"><span>Volume indicado</span><strong id="networkDeposits">R$ 0,00</strong><small>Depósitos com comissão</small></article><article class="card kpi"><span>Parceiros ativos</span><strong id="networkUsers">0</strong><small>Influenciadores cadastrados</small></article></div><article class="card table-card"><div class="table-wrap"><table><thead><tr><th>Parceiro</th><th>Indicado</th><th>Depósito</th><th>Comissão</th><th>Taxa</th><th>Status</th><th>Data</th></tr></thead><tbody id="commissionRows"></tbody></table></div></article>' },
      influencers: { label: '★ Influenciadores', title: 'Influenciadores', description: 'Parceiros e desempenho de indicações.', html: '<article class="card table-card"><div class="table-tools"><input class="search" id="influencerSearch" placeholder="Buscar por nome, e-mail ou código"></div><div class="table-wrap"><table><thead><tr><th>Parceiro</th><th>E-mail</th><th>Código</th><th>Indicados</th><th>Comissão</th><th>Saldo</th><th>Taxa</th><th>Status</th></tr></thead><tbody id="influencerRows"></tbody></table></div></article>' }
    };
    Object.entries(layouts).forEach(([key, layout]) => {
      const button = document.querySelector('[data-view="' + key + '"]');
      const panel = document.querySelector('[data-view-panel="' + key + '"]');
      const productionKey = key === 'demos' ? 'transactions' : key === 'balance' ? 'deposits' : key;
      if (button) { button.hidden = false; button.dataset.view = productionKey; button.innerHTML = '<b aria-hidden="true">' + layout.label.split(' ')[0] + '</b>' + layout.label.slice(layout.label.indexOf(' ') + 1); }
      if (panel) { panel.hidden = false; panel.dataset.viewPanel = productionKey; panel.innerHTML = '<div class="section-heading"><div><h2>' + layout.title + '</h2><p>' + layout.description + '</p></div></div>' + layout.html; }
    });
    const banner = document.querySelector('.local-banner');
    if (banner) banner.innerHTML = '<span><strong>Produção:</strong> dados sincronizados com o banco da Rush Arena.</span><span>Informações atualizadas automaticamente.</span>';
  }
  window.RushAdminProduction = async function () {
    if (!token()) { location.replace('panel.html'); return; }
    configureProductionViews();
    const influencerPanel = document.querySelector('[data-view-panel="influencers"]');
    const legacyInfluencerForm = document.getElementById('influencerForm');
    if (legacyInfluencerForm) legacyInfluencerForm.closest('.two-col').hidden = true;
    influencerPanel.insertAdjacentHTML('afterbegin', '<form id="createInfluencer" class="card" hidden style="padding:20px;margin-bottom:20px"><h2>Criar conta de influenciador</h2><p>Conta sem crédito de saldo. O parceiro acessa seu link pelo portal de gestão.</p><label>Nome <input class="search" name="name" required minlength="2" maxlength="120"></label> <label>E-mail <input class="search" name="email" type="email" required maxlength="254"></label> <label>Senha inicial <input class="search" name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label> <button class="filter is-active" type="submit">Criar conta</button><p id="influencerCreateStatus" role="status"></p><div id="influencerLinks"></div></form>');
    const activateView = view => {
      const button = document.querySelector('[data-view="' + CSS.escape(view) + '"]:not([hidden])') || document.querySelector('[data-view="dashboard"]');
      if (!button) return;
      document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('is-active', item === button));
      document.querySelectorAll('[data-view-panel]').forEach(panel => panel.classList.toggle('is-active', panel.dataset.viewPanel === button.dataset.view));
      document.getElementById('pageTitle').textContent = button.lastChild && button.lastChild.textContent ? button.lastChild.textContent.trim() : button.textContent.trim();
      document.getElementById('sidebar').classList.remove('is-open');
      document.getElementById('sidebarShade').classList.remove('is-open');
      history.replaceState(null, '', '?view=' + encodeURIComponent(button.dataset.view));
    };
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => activateView(button.dataset.view)));
    try {
      const me = await api('/me');
      if (me.role !== 'admin') { location.replace('/'); return; }
      document.getElementById('adminName').textContent = me.name || 'Administrador';
      document.getElementById('adminRole').textContent = 'Administrador';
      document.getElementById('panelLogout').addEventListener('click', () => { localStorage.removeItem('rushArenaApiToken'); location.replace('panel.html'); });
      document.getElementById('menuToggle').addEventListener('click', () => { document.getElementById('sidebar').classList.add('is-open'); document.getElementById('sidebarShade').classList.add('is-open'); });
      document.getElementById('sidebarShade').addEventListener('click', () => { document.getElementById('sidebar').classList.remove('is-open'); document.getElementById('sidebarShade').classList.remove('is-open'); });
      let currentAccounts = [];
      let currentWithdrawals = [];
      let currentData = {};
      const renderAccounts = accounts => {
        document.getElementById('accountRows').innerHTML = accounts.length ? accounts.map(item => '<tr><td><strong>' + esc(item.name) + '</strong><br><span class="muted">' + esc(roleLabels[item.role] || item.role) + '</span></td><td>' + esc(item.email) + '</td><td>' + esc(item.phone || 'Não informado') + '</td><td>' + esc(cpf(item.cpf,item.cpf_last4)) + '</td><td><span class="badge">Ref: ' + esc(item.referral_code || '—') + '</span></td><td><span class="badge">Protegida</span></td><td><strong>' + money(item.balance_cents) + '</strong></td><td><button class="filter is-active" data-live-balance="' + esc(item.id) + '" data-live-email="' + esc(item.email) + '">Ajustar saldo</button></td><td>' + date(item.created_at) + '</td></tr>').join('') : '<tr><td colspan="9" class="empty">Nenhuma conta.</td></tr>';
      };
      const renderWithdrawals = withdrawals => {
        document.getElementById('pixCount').textContent = String(withdrawals.length);
        document.getElementById('pixRows').innerHTML = withdrawals.length ? withdrawals.map(item => '<tr><td><strong>' + esc(item.name) + '</strong><br>' + esc(item.email) + '</td><td><span class="badge">' + esc(pixLabels[item.pix_type] || item.pix_type) + '</span></td><td><input class="search" data-live-pix="' + esc(item.id) + '" value="' + esc(item.pix_key) + '"></td><td>' + money(item.amount_cents) + '</td><td><span class="badge">' + esc(statusLabels[item.status] || item.status) + '</span>' + (item.provider_reference ? '<br><small class="muted">' + esc(item.provider_reference) + '</small>' : '') + '</td><td>' + date(item.created_at) + '</td><td><button class="filter" data-live-save="' + esc(item.id) + '">Salvar</button>' + (item.status === 'pending' ? ' <button class="filter is-active" data-live-approve="' + esc(item.id) + '">Aprovar</button> <button class="filter" data-live-approve-pay="' + esc(item.id) + '">Aprovar &amp; Pagar Pix</button> <button class="filter" data-live-reject="' + esc(item.id) + '">Rejeitar</button>' : '') + '</td></tr>').join('') : '<tr><td colspan="7" class="empty">Nenhum saque.</td></tr>';
      };
      const renderTransactions = rows => {
        const target = document.getElementById('transactionRows');
        if (!target) return;
        target.innerHTML = rows.length ? rows.map(item => '<tr><td><strong>' + esc(item.name) + '</strong><br><span class="muted">' + esc(item.email) + '</span></td><td>' + esc(kindLabels[item.kind] || item.kind) + '</td><td class="' + (Number(item.amount_cents) < 0 ? 'negative' : 'positive') + '">' + money(item.amount_cents) + '</td><td>' + esc(item.reference_type || '—') + (item.reference_id ? '<br><small class="muted">' + esc(item.reference_id) + '</small>' : '') + '</td><td>' + date(item.created_at) + '</td></tr>').join('') : '<tr><td colspan="5" class="empty">Nenhuma movimentação.</td></tr>';
      };
      const renderDeposits = rows => {
        const target = document.getElementById('depositRows');
        if (!target) return;
        target.innerHTML = rows.length ? rows.map(item => '<tr><td><strong>' + esc(item.name) + '</strong><br><span class="muted">' + esc(item.email) + '</span></td><td>' + money(item.amount_cents) + (Number(item.bonus_cents) ? '<br><small class="muted">Bônus: ' + money(item.bonus_cents) + '</small>' : '') + '</td><td>' + esc(item.provider) + '</td><td><span class="badge">' + esc(statusLabels[item.status] || item.status) + '</span></td><td>' + esc(item.provider_reference || item.id) + '</td><td>' + date(item.created_at) + '</td><td>' + date(item.paid_at) + '</td></tr>').join('') : '<tr><td colspan="7" class="empty">Nenhum depósito registrado.</td></tr>';
      };
      const renderCommissions = rows => {
        const target = document.getElementById('commissionRows');
        if (!target) return;
        target.innerHTML = rows.length ? rows.map(item => '<tr><td><strong>' + esc(item.beneficiary_name) + '</strong><br><span class="muted">' + esc(item.beneficiary_email) + '</span></td><td>' + esc(item.referred_name) + '<br><span class="muted">' + esc(item.referred_email) + '</span></td><td>' + money(item.deposit_cents) + '</td><td class="positive">+' + money(item.commission_cents) + '</td><td>' + esc(item.rate_percent) + '%</td><td><span class="badge">' + esc(statusLabels[item.status] || item.status) + '</span></td><td>' + date(item.created_at) + '</td></tr>').join('') : '<tr><td colspan="7" class="empty">Nenhuma comissão registrada.</td></tr>';
      };
      const renderInfluencers = rows => {
        const target = document.getElementById('influencerRows');
        if (!target) return;
        target.innerHTML = rows.length ? rows.map(item => '<tr><td><strong>' + esc(item.name) + '</strong></td><td>' + esc(item.email) + '</td><td><a href="/?ref=' + encodeURIComponent(item.referral_code || '') + '"><span class="badge">' + esc(item.referral_code || '—') + '</span></a></td><td>' + esc(item.referred_users) + '</td><td>' + money(item.commission_cents) + '</td><td>' + money(item.balance_cents) + '</td><td><input class="search" style="width:76px" type="number" min="0" max="50" value="' + esc(item.commission_rate) + '" data-rate="' + esc(item.id) + '"></td><td><button class="filter" data-toggle-influencer="' + esc(item.id) + '" data-active="' + (item.active ? '1' : '0') + '">' + (item.active ? 'Desativar' : 'Ativar') + '</button> <button class="filter" data-reset-influencer="' + esc(item.id) + '">Trocar senha</button></td></tr>').join('') : '<tr><td colspan="8" class="empty">Nenhum parceiro cadastrado.</td></tr>';
      };
      async function refresh() {
        const data = await api('/admin/overview'); const totals = data.totals || {}; const accounts = data.accounts || []; const withdrawals = data.withdrawals || [];
        currentData = data;
        document.getElementById('kpiBalance').textContent = money(totals.wallet_cents);
        document.getElementById('kpiDeposits').textContent = money(totals.deposits_cents);
        document.getElementById('kpiAccounts').textContent = String(totals.accounts || 0);
        document.getElementById('kpiCommissions').textContent = money(totals.commissions_cents || 0);
        currentAccounts = accounts; currentWithdrawals = withdrawals;
        renderAccounts(accounts); renderWithdrawals(withdrawals);
        renderChart(data.trend); renderActivities(data.activities);
        renderTransactions(data.transactions || []); renderDeposits(data.deposits || []);
        renderCommissions(data.commissions || []); renderInfluencers(data.influencers || []);
        const capabilities = data.capabilities || {};
        document.getElementById('createInfluencer').hidden = !capabilities.createInfluencers;
        document.getElementById('influencerLinks').innerHTML = (data.influencers || []).filter(item => item.referral_code).map(item => '<p>'+esc(item.name)+': <a href="/?ref='+encodeURIComponent(item.referral_code)+'">'+esc(location.origin+'/?ref='+encodeURIComponent(item.referral_code))+'</a></p>').join('');
        const banner = document.querySelector('.local-banner');
        if (banner && data.environment === 'local') banner.textContent = 'Banco local: dados persistentes desta instalação. Transferências Pix automáticas permanecem desativadas sem um provedor de payout configurado.';
        if (capabilities.balanceAdjustments === false) document.querySelectorAll('[data-live-balance]').forEach(button => { button.disabled = true; button.title = 'Ajustes indisponíveis neste servidor local'; });
        if (capabilities.withdrawalManagement === false) document.querySelectorAll('[data-live-save],[data-live-approve],[data-live-approve-pay],[data-live-reject],[data-live-pix]').forEach(control => { control.disabled = true; control.title = 'Gestão de saques indisponível neste servidor local'; });
        if (capabilities.autoPayout === false) document.querySelectorAll('[data-live-approve-pay]').forEach(button => { button.hidden = true; });
        if (capabilities.commissions === false) document.getElementById('commissionRows').innerHTML = '<tr><td colspan="7" class="empty">Comissões não implementadas neste servidor local.</td></tr>';
        if (capabilities.influencers === false) document.getElementById('influencerRows').innerHTML = '<tr><td colspan="8" class="empty">Gestão de parceiros não implementada neste servidor local.</td></tr>';
        document.getElementById('commissionTotal').textContent = money(totals.commissions_cents || 0);
        document.getElementById('networkDeposits').textContent = money((data.commissions || []).reduce((sum, item) => sum + Number(item.deposit_cents || 0), 0));
        document.getElementById('networkUsers').textContent = String((data.influencers || []).length);
      }
      document.getElementById('accountSearch').addEventListener('input', event => { const q = event.target.value.trim().toLowerCase(); renderAccounts(currentAccounts.filter(item => [item.name,item.email,item.phone,item.cpf,item.cpf_last4,item.role].map(value=>String(value || '')).join(' ').toLowerCase().includes(q))); if (currentData.capabilities && currentData.capabilities.balanceAdjustments === false) document.querySelectorAll('[data-live-balance]').forEach(button => { button.disabled = true; }); });
      document.getElementById('pixSearch').addEventListener('input', event => { const q = event.target.value.trim().toLowerCase(); renderWithdrawals(currentWithdrawals.filter(item => (String(item.name) + ' ' + String(item.email) + ' ' + String(item.pix_key)).toLowerCase().includes(q))); });
      document.getElementById('transactionSearch').addEventListener('input', event => { const q = event.target.value.trim().toLowerCase(); renderTransactions((currentData.transactions || []).filter(item => (String(item.name) + ' ' + String(item.email) + ' ' + String(item.kind)).toLowerCase().includes(q))); });
      document.getElementById('depositSearch').addEventListener('input', event => { const q = event.target.value.trim().toLowerCase(); renderDeposits((currentData.deposits || []).filter(item => (String(item.name) + ' ' + String(item.email) + ' ' + String(item.status) + ' ' + String(item.id)).toLowerCase().includes(q))); });
      document.getElementById('influencerSearch').addEventListener('input', event => { const q = event.target.value.trim().toLowerCase(); renderInfluencers((currentData.influencers || []).filter(item => (String(item.name) + ' ' + String(item.email) + ' ' + String(item.referral_code)).toLowerCase().includes(q))); });
      document.addEventListener('click', async event => {
        const toggleInfluencer = event.target.closest('[data-toggle-influencer]');
        const resetInfluencer = event.target.closest('[data-reset-influencer]');
        if (toggleInfluencer || resetInfluencer) {
          const button = toggleInfluencer || resetInfluencer;
          const userId = Number(button.getAttribute(toggleInfluencer ? 'data-toggle-influencer' : 'data-reset-influencer'));
          button.disabled = true;
          try {
            if (toggleInfluencer) {
              const rate = Number(document.querySelector('[data-rate="' + CSS.escape(String(userId)) + '"]').value);
              await api('/admin/influencers', {method:'POST', body:JSON.stringify({action:'update',userId,active:button.dataset.active !== '1',commissionRate:rate})});
            } else {
              const password = prompt('Nova senha (mínimo de 8 caracteres):');
              if (password == null) { button.disabled=false; return; }
              await api('/admin/influencers', {method:'POST', body:JSON.stringify({action:'reset_password',userId,password})});
              alert('Senha alterada e sessões antigas encerradas.');
            }
            await refresh();
          } catch (error) { alert(error.message); button.disabled=false; }
          return;
        }
        const balanceButton = event.target.closest('[data-live-balance]');
        if (balanceButton) {
          const accountEmail = balanceButton.getAttribute('data-live-email') || 'esta conta';
          const amountText = prompt('Use valor positivo para adicionar ou negativo para remover de ' + accountEmail + ' (ex.: 50 ou -20):');
          if (amountText == null) return;
          const amount = Number(String(amountText).replace(',', '.'));
          if (!Number.isFinite(amount) || amount === 0) { alert('Informe um valor diferente de zero.'); return; }
          const reason = prompt('Motivo obrigatório do ajuste:');
          if (reason == null || reason.trim().length < 3) { alert('Informe um motivo com pelo menos 3 caracteres.'); return; }
          if (!confirm('Confirmar ajuste de ' + amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) + ' em ' + accountEmail + '?')) return;
          balanceButton.disabled = true;
          try {
            await api('/admin/balance-adjustments', { method: 'POST', body: JSON.stringify({ userId: Number(balanceButton.getAttribute('data-live-balance')), amountCents: Math.round(amount * 100), reason: reason.trim() }) });
            await refresh();
          } catch (error) { alert(error.message); balanceButton.disabled = false; }
          return;
        }
        const approvePay = event.target.closest('[data-live-approve-pay]');
        const approve = event.target.closest('[data-live-approve]');
        const reject = event.target.closest('[data-live-reject]');
        const save = event.target.closest('[data-live-save]');
        const button = approvePay || approve || reject || save;
        if (!button) return;
        const id = button.getAttribute(approvePay ? 'data-live-approve-pay' : approve ? 'data-live-approve' : reject ? 'data-live-reject' : 'data-live-save');
        const action = approvePay ? 'approve_and_pay' : approve ? 'approve' : reject ? 'reject' : 'update_pix';
        const input = document.querySelector('[data-live-pix="' + CSS.escape(id) + '"]');
        button.disabled = true;
        try {
          await api('/admin/withdrawals', { method: 'POST', body: JSON.stringify({ id, action, pixKey: input && input.value }) });
          await refresh();
        } catch (error) { alert(error.message); button.disabled = false; }
      });
      document.getElementById('createInfluencer').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector('button[type="submit"]');
        const notice = document.getElementById('influencerCreateStatus');
        if (button.disabled) return;
        button.disabled = true; notice.textContent = 'Criando conta…';
        try {
          const fields = new FormData(form);
          await api('/admin/influencers', {method:'POST', body:JSON.stringify({name:fields.get('name'),email:fields.get('email'),password:fields.get('password')})});
          form.reset(); notice.textContent = 'Conta criada. O influenciador entra pelo portal de gestão com o e-mail e a senha informados.';
          await refresh();
        } catch (error) { notice.textContent=error.message; }
        finally { button.disabled=false; }
      });
      await refresh();
      const requestedView = new URLSearchParams(location.search).get('view') || 'dashboard';
      activateView(requestedView === 'demos' ? 'transactions' : requestedView === 'balance' ? 'deposits' : requestedView);
      window.setInterval(() => refresh().catch(error => console.error('Atualização automática falhou:', error)), 30000);
    } catch (error) {
      const message = String(error && error.message || 'Erro ao carregar o painel.');
      if ((error && (error.status === 401 || error.status === 403)) || /autentica|sessão|acesso não autorizado/i.test(message)) {
        localStorage.removeItem('rushArenaApiToken');
        location.replace('panel.html');
        return;
      }
      console.error('Falha ao carregar o painel administrativo:', error);
      alert(message + ' Atualize a página para tentar novamente.');
    }
  };
}());
