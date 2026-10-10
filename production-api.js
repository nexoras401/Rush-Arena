(() => {
  'use strict';

  if (['localhost', '127.0.0.1'].includes(location.hostname)) return;

  const TOKEN_KEY = 'rushArenaApiToken';
  const SESSION_KEY = 'rushArenaApiSession';
  const money = (cents) => (Number(cents || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL'
  });
  const token = () => localStorage.getItem(TOKEN_KEY) || '';
  const normalize = (value) => String(value || '').trim();
  const digits = (value) => normalize(value).replace(/\D/g, '');

  const urlRef = new URLSearchParams(location.search).get('ref');
  if (urlRef) localStorage.setItem('rushArenaReferralCode', urlRef.trim().toUpperCase());

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const response = await fetch(`/api${path}`, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || body.message || `Erro ${response.status}`);
    return body;
  }

  function field(form, patterns, type) {
    const inputs = [...form.querySelectorAll('input, select')];
    return inputs.find((input) => {
      const haystack = `${input.name} ${input.id} ${input.placeholder} ${input.autocomplete}`.toLowerCase();
      return (!type || input.type === type) && patterns.some((pattern) => haystack.includes(pattern));
    });
  }

  function notify(message, kind = 'info') {
    let box = document.querySelector('[data-api-notice]');
    if (!box) {
      box = document.createElement('div');
      box.dataset.apiNotice = 'true';
      Object.assign(box.style, {
        position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483647',
        maxWidth: '380px', padding: '14px 16px', borderRadius: '12px', color: '#fff',
        font: '600 14px/1.4 system-ui', boxShadow: '0 12px 35px #0008'
      });
      document.body.appendChild(box);
    }
    box.style.background = kind === 'error' ? '#b42318' : kind === 'success' ? '#087a55' : '#262a35';
    box.textContent = message;
    box.hidden = false;
    clearTimeout(box._timer);
    box._timer = setTimeout(() => { box.hidden = true; }, 6500);
  }

  function saveSession(result) {
    if (result.token) localStorage.setItem(TOKEN_KEY, result.token);
    const user = result.user || result;
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    if (user && (user.email || user.name)) {
      localStorage.setItem('rushArenaLocalTestSession', JSON.stringify({
        id: user.id,
        name: user.name || user.email,
        email: user.email || '',
        role: user.role || 'customer',
        authenticated: true
      }));
    }
  }

  function updatePage(user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    localStorage.setItem('rushArenaLocalTestSession', JSON.stringify({
      id: user.id,
      name: user.name || user.email,
      email: user.email || '',
      role: user.role || 'customer',
      authenticated: true
    }));
    document.querySelectorAll('[data-user-balance], .user-balance, #userBalance, #headerBalance, .balance-value')
      .forEach((el) => { el.textContent = money(user.balanceCents); });
    document.querySelectorAll('[data-user-name], #userName, .user-name')
      .forEach((el) => { el.textContent = user.name || user.email || 'Minha conta'; });
    document.documentElement.dataset.authenticated = 'true';

    const actions = document.querySelector('.header-actions');
    if (actions && actions.dataset.apiRendered !== 'true') {
      actions.dataset.apiRendered = 'true';
      actions.replaceChildren();

      const deposit = document.createElement('a');
      deposit.className = 'deposit-button';
      deposit.href = '/deposit-v2.html';
      deposit.textContent = 'Depositar';
      actions.appendChild(deposit);

      const balance = document.createElement('div');
      balance.className = 'local-header-balance';
      const balanceLabel = document.createElement('span');
      balanceLabel.textContent = 'Meu saldo';
      const balanceValue = document.createElement('strong');
      balanceValue.dataset.userBalance = 'true';
      balanceValue.textContent = money(user.balanceCents);
      balance.append(balanceLabel, balanceValue);
      actions.appendChild(balance);

      const menu = document.createElement('div');
      menu.className = 'header-menu-group';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'header-menu-toggle';
      toggle.setAttribute('aria-label', 'Abrir menu da conta');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = '⌄';
      const dropdown = document.createElement('div');
      dropdown.className = 'header-dropdown';
      dropdown.hidden = true;
      const options = [
        ['Minha conta', '/account-info.html'],
        ['Carteira', '/wallet.html'],
        ['Solicitar saque', '/withdrawal.html'],
        ['Registro de saques', '/withdrawal-history.html'],
        ['Indicações', '/referral.html']
      ];
      if (user.role === 'admin') options.unshift(['Painel administrativo', '/admin.html?view=dashboard']);
      options.forEach(([label, href]) => {
        const item = document.createElement('a');
        item.className = 'header-dropdown-item';
        item.href = href;
        item.textContent = label;
        dropdown.appendChild(item);
      });
      const logout = document.createElement('button');
      logout.type = 'button';
      logout.className = 'header-dropdown-item';
      logout.dataset.logout = 'true';
      logout.textContent = 'Sair';
      dropdown.appendChild(logout);
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        dropdown.hidden = !dropdown.hidden;
        toggle.classList.toggle('is-open', !dropdown.hidden);
        toggle.setAttribute('aria-expanded', dropdown.hidden ? 'false' : 'true');
      });
      dropdown.addEventListener('click', (event) => event.stopPropagation());
      document.addEventListener('click', () => {
        dropdown.hidden = true;
        toggle.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
      menu.append(toggle, dropdown);
      actions.appendChild(menu);
    } else if (actions) {
      actions.querySelectorAll('[data-user-balance]').forEach((el) => {
        el.textContent = money(user.balanceCents);
      });
    }
  }

  async function refreshUser() {
    if (!token()) return null;
    try {
      const result = await api('/me');
      const user = result.user || result;
      updatePage(user);
      return user;
    } catch (_) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem('rushArenaLocalTestSession');
      delete document.documentElement.dataset.authenticated;
      return null;
    }
  }

  function classify(form) {
    if (form.querySelector('[name="modal_login_submit"]')) return 'login';
    if (form.querySelector('[name="modal_register_submit"]')) return 'register';
    const text = `${form.id} ${form.className} ${form.getAttribute('action') || ''} ${form.textContent}`.toLowerCase();
    if (/deposit|depósito|pix/.test(text) && /valor|amount|deposit/.test(text)) return 'deposit';
    if (/saque|withdraw/.test(text)) return 'withdrawal';
    if (/cadastro|registr|criar conta/.test(text)) return 'register';
    if (/entrar|login|acessar/.test(text)) return 'login';
    return '';
  }

  async function handleAuth(form, mode) {
    const emailInput = field(form, ['email', 'e-mail'], 'email') || field(form, ['email', 'e-mail']);
    const passwordInput = field(form, ['senha', 'password'], 'password');
    if (!emailInput || !passwordInput) return false;
    const email = normalize(emailInput.value).toLowerCase();
    const password = passwordInput.value;
    if (!email || !password) throw new Error('Informe o e-mail e a senha.');
    if (mode === 'register' && password.length < 8) {
      throw new Error('A senha de uma nova conta deve ter pelo menos 8 caracteres.');
    }

    if (mode === 'register') {
      const nameInput = field(form, ['nome', 'name']);
      const cpfInput = field(form, ['cpf', 'document']);
      const referralCode = localStorage.getItem('rushArenaReferralCode') || '';
      await api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: normalize(nameInput?.value) || email.split('@')[0],
          email,
          password,
          cpf: digits(cpfInput?.value),
          referralCode
        })
      });
    }
    const result = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    saveSession(result);
    const profile = await api('/me');
    const user = profile.user || profile;
    saveSession({ ...result, user });
    updatePage(user);
    notify(mode === 'register' ? 'Conta criada e login realizado.' : 'Login realizado.', 'success');
    setTimeout(() => { location.href = '/'; }, 500);
    return true;
  }

  async function handleDeposit(form) {
    if (!token()) throw new Error('Entre na sua conta antes de depositar.');
    const amountInput = field(form, ['valor', 'amount', 'deposit']);
    const cpfInput = field(form, ['cpf', 'document']);
    const selected = form.querySelector('[data-amount].active, [data-value].active, input[name*=amount]:checked, input[name*=valor]:checked');
    const rawAmount = amountInput?.value || selected?.dataset.amount || selected?.dataset.value || selected?.value;
    const amount = Number(String(rawAmount || '').replace(',', '.').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(amount) || amount < 20) throw new Error('O depósito mínimo é R$ 20,00.');
    const result = await api('/deposits', {
      method: 'POST', body: JSON.stringify({ amountCents: Math.round(amount * 100), payerDocument: digits(cpfInput?.value) })
    });
    const payload = result.deposit || result;
    const pix = payload.pixCopyPaste || payload.pixCopiaECola || payload.qrCodeText || payload.copyPaste;
    let panel = document.querySelector('[data-pix-panel]');
    if (!panel) {
      panel = document.createElement('section');
      panel.dataset.pixPanel = 'true';
      panel.style.cssText = 'margin-top:18px;padding:18px;border:1px solid #ffffff26;border-radius:14px;background:#101010;text-align:center';
      form.insertAdjacentElement('afterend', panel);
    }
    panel.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = 'PIX gerado';
    const status = document.createElement('p');
    status.textContent = `Valor: ${money(payload.amountCents || Math.round(amount * 100))} • Aguardando pagamento`;
    panel.append(title, status);
    const qrCode = payload.qrCode;
    if (qrCode) {
      const image = document.createElement('img');
      image.alt = 'QR Code PIX';
      image.style.cssText = 'display:block;width:min(260px,100%);margin:16px auto;background:#fff;padding:10px;border-radius:12px';
      image.src = String(qrCode).startsWith('data:') || String(qrCode).startsWith('http')
        ? qrCode
        : `data:image/png;base64,${qrCode}`;
      panel.appendChild(image);
    }
    if (pix) {
      const output = document.createElement('textarea');
      output.dataset.pixOutput = 'true';
      output.readOnly = true;
      output.setAttribute('aria-label', 'Código PIX copia e cola');
      output.style.cssText = 'width:100%;min-height:110px;margin-top:16px;padding:12px;border-radius:10px';
      output.value = pix;
      output.textContent = pix;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'primary';
      copy.textContent = 'Copiar código PIX';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(pix);
          copy.textContent = 'Código copiado';
        } catch (_) {
          output.focus();
          output.select();
        }
      });
      panel.append(output, copy);
    }
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    notify('Cobrança PIX criada. O saldo será atualizado após o pagamento.', 'success');
    return true;
  }

  async function handleWithdrawal(form) {
    if (!token()) throw new Error('Entre na sua conta antes de solicitar saque.');
    const amountInput = field(form, ['valor', 'amount']);
    const keyInput = field(form, ['chave', 'pix', 'key']);
    const passwordInput = field(form, ['senha', 'password'], 'password');
    const amount = Number(String(amountInput?.value || '').replace(',', '.').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(amount) || amount < 30) throw new Error('O saque mínimo é R$ 30,00.');
    if (!normalize(keyInput?.value)) throw new Error('Informe sua chave PIX.');
    await api('/withdrawals', {
      method: 'POST', body: JSON.stringify({ amountCents: Math.round(amount * 100), pixKey: normalize(keyInput.value), withdrawalPassword: passwordInput?.value || '' })
    });
    notify('Saque solicitado e enviado para análise.', 'success');
    form.reset();
    return true;
  }

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('form');
    if (!form) return;
    const mode = classify(form);
    if (!mode) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const button = form.querySelector('[type=submit]');
    if (button) button.disabled = true;
    try {
      if (mode === 'register' || mode === 'login') await handleAuth(form, mode);
      if (mode === 'deposit') await handleDeposit(form);
      if (mode === 'withdrawal') await handleWithdrawal(form);
    } catch (error) {
      notify(error.message || 'Não foi possível concluir.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }, true);

  document.addEventListener('click', (event) => {
    const logout = event.target.closest('[data-logout], .logout, #logoutButton');
    if (!logout) return;
    event.preventDefault();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('rushArenaLocalTestSession');
    location.href = '/';
  });

  window.RushArenaAPI = {
    api,
    refreshUser,
    token,
    bet: (stakeCents) => api('/game/bet', { method: 'POST', body: JSON.stringify({ stakeCents }) }),
    endGame: (roundId, outcome, multiplier) => api('/game/end', { method: 'POST', body: JSON.stringify({ roundId, outcome, multiplier }) }),
    logout: () => {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem('rushArenaLocalTestSession');
      location.href = '/';
    }
  };
  refreshUser();
})();
