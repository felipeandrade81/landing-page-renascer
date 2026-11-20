# Emissão fiscal (NFC-e): o que existe, como testar e o que ainda falta

> **Leia primeiro.** Nada aqui emite nota sozinho. Para emitir, a empresa precisa dos requisitos da seção 1 (certificado, credenciamento, CSC...)
> e de uma conta em um provedor fiscal. Este projeto prepara o sistema para isso e **nunca foi executado contra a SEFAZ ou a FocusNFe de verdade**.
> Os valores tributários (NCM, CFOP, CST/CSOSN, alíquotas) **são do seu contador**: o sistema não os adivinha, e nenhum foi preenchido por mim.

## 1. Requisitos da empresa (e onde cada um aparece no sistema)

| Requisito | Quem faz | Onde conferir no sistema |
|---|---|---|
| CNPJ ativo | já consta no Cartão CNPJ (ativa desde 17/09/2026) | Fiscal › Integração fiscal (automático) |
| Inscrição estadual habilitada na SEFAZ-PE | você/contador, no portal da SEFAZ | Informe a IE em *Dados fiscais* e marque "confirmado" |
| Regime tributário (CRT) | contador | *Dados fiscais › Regime tributário* (define se vale CSOSN ou CST) |
| Certificado digital A1 (ou A3) | você compra; **envia ao provedor** (FocusNFe) | marque "confirmado" e informe a validade. **O arquivo nunca entra neste sistema** |
| Credenciamento SEFAZ (homologação e depois produção) | você/contador, no portal da SEFAZ | marcar cada um |
| CSC (ID + token) | gerado no portal da SEFAZ | informe o **ID** em *Configurar*; o **token** é cadastrado no painel do provedor |
| Token do provedor | você, na conta da FocusNFe | `.env` do servidor (`FOCUSNFE_TOKEN_HOMOLOGACAO` / `_PRODUCAO`) |
| Matriz fiscal dos produtos | contador | Fiscal › Matriz fiscal dos produtos |

O painel **Fiscal › Integração fiscal** mostra o que está pronto e o que falta. A **produção só é liberada** quando todos os itens estão prontos.

## 2. Como funciona

```
PDV (venda) ──► servidor (NestJS) ──► FocusNFe ──► SEFAZ
                 │  monta o JSON da NFC-e (fiscal-core.ts)
                 │  valida empresa + matriz fiscal (lista as pendências)
                 │  envia com uma referência fixa (reenviar NÃO duplica)
                 └► grava chave, protocolo, QR Code, DANFCE e o JSON enviado
```

- **Núcleo fiscal** (`backend/src/fiscal/fiscal-core.ts`): sem dependências; converte a venda no JSON da NFC-e (formato da FocusNFe), rateia o desconto,
  calcula ICMS/PIS/COFINS conforme o regime e valida tudo. É o **mesmo código** que roda dentro da tela do PDV (botão "Conferir NFC-e").
- **Cliente FocusNFe** (`focusnfe.client.ts`): `POST /v2/nfce?ref=...`, `GET /v2/nfce/{ref}`, `DELETE /v2/nfce/{ref}`; autenticação Basic com o token; tempo limite de 25 s.
- **Serviço/rotas** (`fiscal-nfce.ts`): prontidão, configurações, prévia, emissão, consulta de status e cancelamento.

### Rotas (todas exigem login)
| Rota | Perfil | O que faz |
|---|---|---|
| `GET /fiscal/readiness` | Gerente, Financeiro | checklist de prontidão e produtos com matriz incompleta |
| `GET/PUT /fiscal/settings` | Gerente, Financeiro | ambiente, provedor, série, ID do CSC e confirmações manuais |
| `GET /fiscal/sales/:id/nfce/preview` | operação | JSON que seria enviado + pendências (não envia) |
| `POST /fiscal/sales/:id/nfce/emit` | operação | envia à FocusNFe e grava o resultado |
| `GET /fiscal/sales/:id/nfce/status` | operação | consulta e atualiza (nota "processando") |
| `POST /fiscal/sales/:id/nfce/cancel` | Gerente | cancela (justificativa de 15+ caracteres) |

### Proteções
- Emitir sem token no servidor → erro claro e **nada é enviado**.
- **Produção bloqueada** até `FISCAL_ALLOW_PRODUCTION=1` no servidor **e** checklist completo.
- Dados fiscais incompletos → `422` com a lista de pendências, sem chamar o provedor.
- Referência fixa por nota (`nfce-<id>`): se a internet cair no meio, reenviar não duplica.
- A matriz fiscal do produto é **congelada na venda** (`taxSnapshot`): mudar o produto depois não altera notas antigas.
- O JSON enviado fica salvo na nota (auditoria). Tokens, certificado e CSC **nunca** são gravados no banco nem no navegador.

## 3. Passo a passo para testar em HOMOLOGAÇÃO

1. Crie a conta na **FocusNFe**, cadastre a empresa (CNPJ, IE, regime), **envie o certificado A1** e informe o **CSC** (ID e token) no painel deles. Pegue o **token de homologação**.
2. No `backend/.env`: `FOCUSNFE_TOKEN_HOMOLOGACAO=...` (veja `docs/BANCO-DE-DADOS.md` para o banco). Rode `npm run db:push` e `npm run db:seed`.
3. Com o contador, preencha a **matriz fiscal** de cada produto (na tela Fiscal do PDV de prévia você vê o formato; no backend os campos estão em `/products`: `ncm`, `cfop`, `origin`, `cst`, `icmsRate`, `pisCst`, `pisRate`, `cofinsCst`, `cofinsRate`) e os dados da empresa (`PUT /company`: IE, `crt`, endereço).
4. `GET /fiscal/readiness` até ficar `readyForHomologation: true`.
5. Faça uma venda de varejo (`POST /sales`), veja `GET /fiscal/sales/{id}/nfce/preview` e então `POST /fiscal/sales/{id}/nfce/emit`.
6. Rejeitou? A mensagem da SEFAZ fica em `lastMessage`/`rejectionReason`. Corrija e emita de novo (mesma referência).

## 4. Matriz fiscal: o que o sistema valida e o que **não** suporta ainda

- **NCM** com 8 dígitos · **CFOP** `5xxx` (NFC-e é venda dentro do estado) · **origem** 0 a 8 · **CEST** com 7 dígitos (se houver).
- **Simples Nacional**: CSOSN **101** (exige alíquota de crédito), **102**, **103**, **300**, **400**.
- **Regime Normal**: CST **00** (exige alíquota de ICMS), **40**, **41**, **50**.
- **PIS/COFINS**: CST 01 e 02 (exigem alíquota), 04 a 09, 49 e 99.
- **Ainda não suportados** (o sistema recusa com mensagem, em vez de enviar campos errados): CSOSN 201/202/203/500/900 e CST 10/20/30/51/60/70/90, ou seja,
  **substituição tributária, redução de base e diferimento**. Carnes, laticínios e frios costumam cair nesses casos: **veja com o contador antes**. Se for o seu caso, o próximo passo é implementar esses campos.

## 5. Formas de pagamento (PDV → código fiscal)
Dinheiro `01` · Crédito `03` · Débito `04` · PIX `17` · Transferência `18` · **Vale `99` (Outros): confirme com o contador o tipo correto**.
Troco vai no registro do dinheiro. Cartão integrado (TEF) exige bandeira e autorização, que ainda **não** são enviadas.

## 6. O que ainda NÃO foi feito
- **NF-e (modelo 55)** do atacado, boleto e venda a prazo (hoje só NFC-e).
- **Contingência offline real** da NFC-e (o PDV só marca "contingência" e a nota fica pendente).
- Inutilização e Carta de Correção pelo provedor; **webhook** da FocusNFe (hoje há consulta manual de status); provedor **NFE.io** (só o espaço reservado).
- O modelo de venda do backend guarda **uma** forma de pagamento (o PDV de prévia aceita várias e troco): falta uma tabela de pagamentos da venda.
- O **PDV de prévia (HTML) não chama o servidor**: ele confere e mostra o JSON, mas a emissão real depende de ligar o PDV às rotas acima.
- Tributos aproximados (Lei da Transparência), CPF na nota pelo PDV e NFC-e acima de R$ 10.000 sem identificação (só aviso).

## 7. Testes
- `cd backend && npm run test:fiscal`: 36 testes do núcleo e do cliente + 27 do serviço (banco e provedor falsos). Rodam sem internet.
- `tests/e2e/fiscal_e2e.py`: a tela do PDV (matriz, prontidão, conferência da NFC-e) em um navegador real.
