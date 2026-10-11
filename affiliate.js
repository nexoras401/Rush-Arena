(async () => {
  const token = localStorage.getItem('rushArenaApiToken');
  const status = document.getElementById('status');
  if (!token) { location.replace('panel.html'); return; }
  document.getElementById('logout').onclick = () => { localStorage.removeItem('rushArenaApiToken'); location.replace('panel.html'); };
  try {
    const response = await fetch('/api/influencer/link', {headers:{Authorization:'Bearer '+token}});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível carregar seu link.');
    document.getElementById('name').textContent = data.name;
    document.getElementById('link').value = location.origin+'/?ref='+encodeURIComponent(data.referralCode);
    document.getElementById('count').textContent = data.referredUsers+' cadastros indicados';
    status.textContent = '';
    const button = document.getElementById('copy'); button.disabled = false;
    button.onclick = async () => { try { await navigator.clipboard.writeText(document.getElementById('link').value); status.textContent='Link copiado.'; } catch { document.getElementById('link').select(); status.textContent='Selecione e copie o link acima.'; } };
  } catch (error) { status.textContent=error.message; }
})();
