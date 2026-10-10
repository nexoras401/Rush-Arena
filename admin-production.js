(function () {
  'use strict';
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = cents => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const date = value => value ? new Date(value).toLocaleString('pt-BR') : '—';
  const token = () => localStorage.getItem('rushArenaApiToken') || '';
  async function api(path, options) {
    const response = await fetch('/api' + path, Object.assign({}, options || {}, { headers: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, options && options.headers || {}) }));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Erro ao consultar o painel.');
    return body;
  }
  function mask(value) { const raw = String(value || ''); return raw.length > 7 ? raw.slice(0, 2) + '•••••' + raw.slice(-5) : raw; }
  window.RushAdminProduction = async function () {
    if (!token()) { location.replace('panel.html'); return; }
    try {
      const me = await api('/me');
      if (me.role !== 'admin') { location.replace('/'); return; }
      ['demos', 'balance', 'commissions', 'influencers'].forEach(view => {
        const button = document.querySelector('[data-view="' + view + '"]');
        const panel = document.querySelector('[data-view-panel="' + view + '"]');
        if (button) button.hidden = true;
        if (panel) panel.hidden = true;
      });
      document.getElementById('adminName').textContent = me.name || 'Administrador';
      document.getElementById('adminRole').textContent = 'Administrador';
      document.getElementById('panelLogout').addEventListener('click', () => { localStorage.removeItem('rushArenaApiToken'); location.replace('panel.html'); });
      document.getElementById('menuToggle').addEventListener('click', () => document.getElementById('sidebar').classList.add('is-open'));
      document.getElementById('sidebarShade').addEventListener('click', () => document.getElementById('sidebar').classList.remove('is-open'));
      document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
        const view = button.dataset.view;
        document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('is-active', item === button));
        document.querySelectorAll('[data-view-panel]').forEach(panel => panel.classList.toggle('is-active', panel.dataset.viewPanel === view));
        document.getElementById('pageTitle').textContent = button.textContent.trim();
      }));
      async function refresh() {
        const data = await api('/admin/overview'); const totals = data.totals || {}; const accounts = data.accounts || []; const withdrawals = data.withdrawals || [];
        document.getElementById('kpiBalance').textContent = money(totals.wallet_cents);
        document.getElementById('kpiDeposits').textContent = money(totals.deposits_cents);
        document.getElementById('kpiAccounts').textContent = String(totals.accounts || 0);
        document.getElementById('kpiCommissions').textContent = money(totals.commissions_cents || 0);
        document.getElementById('accountRows').innerHTML = accounts.length ? accounts.map(item => '<tr><td><strong>' + esc(item.name) + '</strong><br><span class="muted">' + esc(item.role) + '</span></td><td>' + esc(item.email) + '</td><td>' + esc(item.phone || 'Não informado') + '</td><td>' + esc(item.cpf_last4 ? '•••' + item.cpf_last4 : 'Não informado') + '</td><td><span class="badge">Ref: ' + esc(item.referral_code || '—') + '</span></td><td><span class="badge">Protegida</span></td><td>' + date(item.created_at) + '</td></tr>').join('') : '<tr><td colspan="7" class="empty">Nenhuma conta.</td></tr>';
        document.getElementById('pixCount').textContent = String(withdrawals.length);
        document.getElementById('pixRows').innerHTML = withdrawals.length ? withdrawals.map(item => '<tr><td><strong>' + esc(item.name) + '</strong><br>' + esc(item.email) + '</td><td><span class="badge">' + esc(item.pix_type) + '</span></td><td><input class="search" data-live-pix="' + esc(item.id) + '" value="' + esc(item.pix_key) + '"></td><td>' + money(item.amount_cents) + '</td><td><span class="badge">' + esc(item.status) + '</span>' + (item.provider_reference ? '<br><small class="muted">' + esc(item.provider_reference) + '</small>' : '') + '</td><td>' + date(item.created_at) + '</td><td><button class="filter" data-live-save="' + esc(item.id) + '">Salvar</button>' + (item.status === 'pending' ? ' <button class="filter is-active" data-live-approve="' + esc(item.id) + '">Aprovar</button> <button class="filter" data-live-approve-pay="' + esc(item.id) + '">Aprovar &amp; Pagar Pix</button> <button class="filter" data-live-reject="' + esc(item.id) + '">Rejeitar</button>' : '') + '</td></tr>').join('') : '<tr><td colspan="7" class="empty">Nenhum saque.</td></tr>';
      }
      document.addEventListener('click', async event => {
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
      await refresh();
    } catch (error) { localStorage.removeItem('rushArenaApiToken'); location.replace('panel.html'); }
  };
}());
