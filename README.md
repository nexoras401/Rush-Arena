# Rush Arena Brasil 🎮⚡

Plataforma moderna de entretenimento e jogos com premiações reais, carteira digital integrada e pagamentos instantâneos via Pix.

---

## 🚀 Funcionalidades Principais

- **Autenticação Segura:**
  - Cadastro e login com hash criptográfico PBKDF2 (SHA-256) e salt individual por usuário.
  - Sessões protegidas com tokens aleatórios e expiração automática.
  - Proteção contra força bruta (*Rate Limiting* com bloqueio temporário após tentativas inválidas consecutivas).

- **Carteira Digital & Saldo Real:**
  - Saldo armazenado e validado atomicamente em centavos no banco de dados (**Neon PostgreSQL**).
  - Bloqueio de concorrência (`FOR UPDATE`) para garantir integridade financeira em todas as operações.

- **Depósitos Pix:**
  - Geração de cobranças Pix (QR Code dinâmico e código Copia e Cola).
  - Bônus progressivo configurado por faixas de depósito.
  - Confirmação via Webhooks assinados com verificação de integridade criptográfica **HMAC-SHA256** e proteção anti-replay.
  - Idempotência rigorosa para prevenir créditos duplicados.

- **Saques Pix:**
  - Solicitação de retirada para chaves Pix (CPF, e-mail, telefone ou chave aleatória).
  - Verificação de segurança obrigatória da senha da conta.
  - Reserva imediata do saldo para evitar gastos concorrentes.
  - Processamento automatizado de transferências via API.

- **Sistema de Afiliados & Influenciadores:**
  - Geração de link e código de indicação único para cada jogador (`RUSH-XXXXXX`).
  - Atribuição automática no cadastro via parâmetro na URL (`?ref=...`).
  - Comissionamento em tempo real (10% padrão / 30% para influenciadores) creditado no saldo do indicador no momento da aprovação do depósito.
  - Painel exclusivo de afiliados e influenciadores para acompanhamento de métricas e solicitação de saque de comissões.

- **Entradas do Jogo Integradas:**
  - Validação de rodadas com apostas em valores reais (R$ 10, R$ 20, R$ 30 e R$ 50).
  - Débito atômico na carteira antes do início da partida.
  - Premiação creditada diretamente na carteira em caso de vitória.

- **Painel Administrativo:**
  - Controle de acesso restrito à função de administrador.
  - Visão geral da plataforma, métricas financeiras, usuários cadastrados e movimentações.
  - Gestão e aprovação direta de saques Pix.

---

## 🛠️ Tecnologias Utilizadas

- **Backend:** Python 3.12+ (Serverless Functions na Vercel)
- **Banco de Dados:** PostgreSQL hospedado no [Neon](https://neon.tech) com Pooler de conexões
- **Frontend:** HTML5, CSS3 moderno, Vanilla JavaScript (ES6+ modular)
- **Integração de Pagamentos:** NyxPag / VulcanoPay (Pix Instantâneo)
- **Hospedagem:** [Vercel](https://vercel.com)

---

## ⚙️ Variáveis de Ambiente

Para o funcionamento completo da aplicação, configure as seguintes variáveis no seu ambiente ou no painel da Vercel:

| Variável | Descrição |
| --- | --- |
| `DATABASE_URL` | URL de conexão do PostgreSQL (Neon com SSL obrigatório) |
| `NYXPAG_API_KEY` | Chave de API de produção da NyxPag |
| `NYXPAG_WEBHOOK_SECRET` | Segredo HMAC para validação dos webhooks da NyxPag |
| `NYXPAG_API_URL` | URL base da API da NyxPag (padrão: `https://api.nyxpag.com.br/v1`) |
| `ADMIN_BOOTSTRAP_PASSWORD` | Senha inicial para criação da conta de administrador |

---

## 🔒 Segurança

- Todos os endpoints financeiros utilizam transações SQL atômicas com locks seletivos.
- Proteção nativa contra injeção SQL através de queries parametrizadas com `psycopg`.
- Cabeçalhos de segurança HTTP configurados (`Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `HSTS`).
- Validação estrita de CPF com algoritmo oficial e sanitização de entradas.

---

## 📄 Licença

Propriedade privada de **Rush Arena Brasil**. Todos os direitos reservados.
