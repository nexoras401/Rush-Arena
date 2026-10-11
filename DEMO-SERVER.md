# Block Cash: validação local de demonstração

Disponível somente no backend Python local, com usuário autenticado. Não altera wallets, depósitos, saques nem transações financeiras. Os valores são créditos fictícios e não são resgatáveis.

- POST /api/demo/block-cash/start: entry (500,1000,2500,5000) e requestId.
- POST /api/demo/block-cash/state: objeto vazio; retoma a partida da própria conta.
- POST /api/demo/block-cash/move: roundId, revision, requestId, piece, x, y.
- POST /api/demo/block-cash/finish: roundId, revision, requestId.

Somente o servidor sorteia peças, valida posições, limpa linhas e calcula os pontos. Campos de resultado enviados pelo cliente são recusados. Uma tabela exclusiva mantém uma partida por conta; atualização serializada com BEGIN IMMEDIATE, revisão incremental e repetição idempotente da última requisição. Requisições antigas com revisão anterior são recusadas. Uma partida ativa é retomada em vez de substituída.

A meta da simulação conserva a regra anterior: ganhos virtuais devem atingir a quantidade de entrada antes de encerrar. Resultado concluído = entrada virtual + ganhos; perda = zero. Não houve alteração da carteira, nem criação de saldo em conta para os testes.

Testes cobrem regras, permissões, campos adulterados, repetição, retomada e isolamento do saldo. Não equivalem a QA visual completo nem tornam o sistema apto para operações financeiras. A API da Vercel não recebeu estas rotas.
