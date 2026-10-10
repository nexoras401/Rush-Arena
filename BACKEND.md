# Backend Rush Arena

Base inicial em Python e SQLite, sem dependências externas.

Senhas usam PBKDF2 com salt individual. O CPF não é persistido em texto aberto:
somente hash e os quatro últimos dígitos são armazenados.

## Executar

```bat
start-backend.cmd
```

O site e a API ficam em `http://127.0.0.1:8766`. O banco é criado em
`data/rush_arena.sqlite3`.

## VulcanoPay

A VulcanoPay é o provedor preferencial quando estas variáveis estiverem presentes:

```text
VULCANO_API_KEY=vk_test_...
VULCANO_WEBHOOK_SECRET=whsec_...
```

O backend cria cobranças PIX em `POST https://api.vulcanopay.com/v1/charges`,
enviando valores em centavos e uma chave de idempotência por depósito. Cadastre
no painel da VulcanoPay o webhook público:

```text
https://seu-dominio.com/api/webhooks/vulcanopay
```

O webhook valida `X-Vulcano-Signature` com HMAC-SHA256, recusa eventos com mais
de cinco minutos, impede processamento duplicado e separa eventos de teste e
produção. O saldo só é creditado após `charge.paid`. Comece com uma chave
`vk_test_`; troque para `vk_live_` somente depois da homologação.

## ZoryxPay

Configure os segredos somente no ambiente do servidor:

```text
ZORYX_API_TOKEN=token_do_painel
ZORYX_WEBHOOK_SECRET=segredo_longo_e_aleatorio
RUSH_PUBLIC_BASE_URL=https://seu-dominio-publico.com
```

Com as três variáveis configuradas, `POST /api/deposits` cria o Cash-In em
`https://api.zoryxpay.com/v1/cash-in/pix` e devolve o código Pix copia e cola.
Sem token, a API permanece em sandbox. O CPF/CNPJ do pagador é recebido como
`payerDocument` somente no pedido e não é persistido em texto aberto.

O callback configurado na cobrança é
`/api/webhooks/zoryxpay/{ZORYX_WEBHOOK_SECRET}`. A documentação pública atual
não informa o nome do header nem o algoritmo de assinatura; por isso o segredo
na URL é obrigatório, além da idempotência no banco. Substitua por validação
HMAC oficial assim que a ZoryxPay fornecer esses detalhes.

## MisticPay

A MisticPay é o provedor preferencial quando estas variáveis estiverem presentes:

```text
MISTIC_CLIENT_ID=pk_...
MISTIC_CLIENT_SECRET=sk_...
MISTIC_WEBHOOK_SECRET=segredo_longo_e_aleatorio
RUSH_PUBLIC_BASE_URL=https://seu-dominio-publico.com
```

O backend usa autenticação HTTP Basic e cria cobranças em
`POST https://api.misticpay.com/api/transactions/create`. A resposta devolve o
QR Code e o Pix copia e cola. O saldo do cliente só é creditado após o webhook
informar `DEPOSITO` com status `COMPLETO`, de forma idempotente.

A documentação informa que a MisticPay não possui sandbox. Portanto, sem as
credenciais acima, o sistema continua no modo local e nenhuma chamada é enviada
à API de produção. O segredo nunca deve ser colocado no frontend.

## Rotas iniciais

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/me`
- `POST /api/deposits` (mínimo R$ 20)
- `POST /api/webhooks/sandbox` (confirmação idempotente)
- `POST /api/webhooks/vulcanopay` (assinatura HMAC e idempotência)
- `POST /api/withdrawals` (mínimo R$ 30)
- `POST /api/admin/withdrawals/:id/approve`
- `GET /api/payments`
- `GET /api/health`

Envie o token recebido no login como `Authorization: Bearer TOKEN`.

## Antes de produção

Trocar `RUSH_WEBHOOK_SECRET`, usar HTTPS, mover segredos para um cofre, aplicar
rate limiting distribuído e passar por revisão jurídica/compliance. Sem uma
chave VulcanoPay configurada, o modo local não movimenta dinheiro real.

## Proteções do servidor

- Arquivos Python, banco SQLite, arquivos de ambiente, mapas de código e scripts
  internos retornam `404`.
- A listagem de diretórios está desativada.
- Respostas incluem CSP, proteção contra MIME sniffing, framing e políticas de
  câmera, microfone, localização e pagamentos.
- Login permite no máximo 10 tentativas por IP a cada 10 minutos; cadastro, 5.
- Senhas e tokens não são enviados em respostas administrativas.

HTML, CSS e JavaScript entregues ao navegador sempre podem ser inspecionados.
Minificação/obfuscação não substitui autenticação. Antes de publicação, as telas
administrativas devem consumir exclusivamente as APIs autenticadas do backend;
`localStorage` deve ficar restrito a preferências visuais, nunca saldos ou regras.
