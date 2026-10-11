# Revisão de prontidão — 11/10/2026

Escopo: inspeção do código local, testes automatizados e consulta de saúde do servidor. Não é uma certificação de segurança ou auditoria regulatória. Não houve publicação, cobrança ou saque real nem teste visual completo dos jogos.

## Verificado

- Autenticação e permissões administrativas testadas por HTTP em banco isolado.
- Criação de influenciador restrita ao administrador; e-mail duplicado rejeitado; saldo inicial zero.
- Login do influenciador, link exclusivo e atribuição do cadastro ao indicador testados.
- Contagem de indicados visível para o influenciador e administrador testada.
- Contas e gráfico consultam o banco local, sem dados fictícios.
- CPF completo não está disponível: cadastro mantém hash e quatro dígitos finais. Não há recuperação do documento a partir do hash.

## Impedimentos para lançar a operação financeira

1. A API de jogos bloqueia entrada e liquidação com HTTP 503. Ainda não há motor autoritativo no servidor validando jogadas, resultados e liquidação idempotente. Block Cash permanece uma simulação no navegador.
2. O servidor consultado em 127.0.0.1:8766 respondeu payments=sandbox. Isso não informa o estado da instalação publicada.
3. backend.py (SQLite local) e api/index.py (PostgreSQL/Vercel) têm diferenças. Criação de influenciador e /influencer/link foram implementados apenas localmente; publicar os arquivos não migra contas ou dados automaticamente.
4. Gestão de saques, ajustes e comissões têm funcionalidades indisponíveis no backend local. Não foram testados pagamentos reais, estornos ou conciliação ponta a ponta.
5. Links com localhost/127.0.0.1 não servem para divulgação externa.

## Próximas verificações recomendadas

- Unificar contratos das APIs e executar os mesmos testes no ambiente de homologação PostgreSQL.
- Testar todas as telas no navegador, celular, sessão expirada, rede indisponível e clique duplicado. Os testes atuais não cobrem integralmente essas situações.
- Validar recuperação de senha, verificação de e-mail, autenticação adicional de administradores, auditoria de alterações e backup/restauração.
- Rever publicação estática: excluir banco, segredos, scripts internos e cópias de desenvolvimento. O script de reinício foi excluído do pacote e bloqueado no servidor local nesta revisão.
- Definir processo de tratamento de documentos caso seja necessário CPF completo, com armazenamento protegido, controle de acesso e registro de consultas. Não inferir números a partir dos quatro dígitos existentes.
- Revisar regras, textos promocionais, autorizações de uso dos jogos e requisitos aplicáveis com os responsáveis antes do lançamento.

Não há evidência suficiente para afirmar que todas as opções funcionam ou que o site está pronto para operar com dinheiro real.
