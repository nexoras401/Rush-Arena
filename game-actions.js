(() => {
    document.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-paid-game]');
        if (!button) return;
        event.preventDefault();
        const token = localStorage.getItem('rushArenaApiToken');
        if (!token) {
            document.querySelector('[data-open-modal="login"]')?.click();
            alert('Entre na sua conta para conferir seu saldo e jogar.');
            return;
        }
        button.disabled = true;
        try {
            const response = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
            if (response.status === 401) {
                localStorage.removeItem('rushArenaApiToken');
                document.querySelector('[data-open-modal="login"]')?.click();
                alert('Sua sessão expirou. Entre novamente para conferir o saldo.');
                return;
            }
            if (!response.ok) throw new Error('Não foi possível consultar seu saldo agora.');
            const profile = await response.json();
            const balanceCents = Number(profile.balanceCents ?? profile.balance_cents ?? profile.user?.balanceCents ?? profile.user?.balance_cents ?? 0);
            if (balanceCents <= 0) {
                if (confirm('Seu saldo está zerado. Quer abrir a página para adicionar saldo?')) window.location.assign('deposit-v2.html');
                return;
            }
            alert(`Seu saldo está disponível, mas ${button.dataset.paidGame} com saldo ainda não pode iniciar: o servidor não valida nem processa partidas pagas. Nenhum valor foi debitado.`);
        } catch (error) {
            alert(error.message || 'Não foi possível consultar seu saldo.');
        } finally {
            button.disabled = false;
        }
    });

})();
