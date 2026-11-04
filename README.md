# Sistema RENASCER · publicar no GitHub Pages e ligar ao Supabase

Arquivos desta pasta: `index.html` (o sistema), `config.js` (onde você cola os dados do Supabase),
`supabase-setup.sql` (cria a tabela no banco), `404.html` e `.nojekyll`.

---

## Parte 1 · Publicar no GitHub Pages

O erro "404 · File not found" aparece quando não existe um arquivo chamado **exatamente `index.html`** na raiz do site.

1. Em **github.com**, clique em **New repository**, dê um nome (ex.: `renascer`), marque **Public** e crie.
2. Clique em **uploading an existing file** e arraste **os arquivos soltos** (não a pasta): `index.html`, `config.js`, `404.html`, `supabase-setup.sql`, `.nojekyll`.
   Eles ficam **na raiz** do repositório. O `.nojekyll` é opcional (alguns computadores escondem arquivos com ponto).
3. **Commit changes**.
4. **Settings › Pages › Build and deployment**: *Deploy from a branch* · branch **main** · pasta **/ (root)** · **Save**.
5. Espere 1 a 3 minutos. O endereço aparece na mesma tela: `https://SEU-USUARIO.github.io/renascer/`

Se ainda aparecer 404: confira o nome `index.html` (minúsculas), se está na raiz (não dentro de uma pasta), se a pasta escolhida em *Pages* é `/ (root)`, se o deploy terminou (aba **Actions** verde) e use Ctrl+F5.

Sem fazer a Parte 2, o sistema funciona, mas **os dados ficam só no navegador de cada computador**.

---

## Parte 2 · Ligar ao banco gratuito (Supabase) · cerca de 10 minutos

Com isso, o login passa a ser feito pelo **Supabase (autenticação de servidor)** e os dados ficam num banco **compartilhado** entre todos os computadores.

1. Crie a conta em **supabase.com** e um **New project** (plano gratuito). Guarde a senha do banco e espere o projeto ficar pronto.
2. **SQL Editor › New query**: cole o conteúdo de `supabase-setup.sql` e clique em **Run**.
3. **Authentication › Sign In / Providers › Email**: desligue **Allow new users to sign up** (assim só entra quem você cadastrar).
4. **Authentication › Users › Add user › Create new user**: informe e-mail e senha e marque **Auto Confirm User**. Crie uma conta para cada pessoa que vai usar o sistema.
5. **Project Settings › API** (ou *API Keys*): copie a **Project URL** e a chave **anon / public** (ou *publishable*).
   **Nunca** use a chave `service_role` ou `secret`: o sistema recusa e avisa se você colocar.
6. Edite o `config.js` (no próprio GitHub: abra o arquivo e clique no lápis) e preencha:
   ```js
   window.RENASCER_CFG = { supabaseUrl: "https://SEU-PROJETO.supabase.co", supabaseKey: "SUA_CHAVE_ANON" };
   ```
   Faça o commit e aguarde o GitHub atualizar o site.
7. Abra o site. A tela de entrada mostra **"Conexão com o Supabase: OK"**. Entre com a primeira conta:
   **a primeira pessoa que entrar vira Administradora**.
8. Em **Configurações › Usuários e acessos**, cadastre o **perfil** de cada pessoa (use o mesmo e-mail da conta criada no Supabase).
   Quem tem conta no Supabase mas não tem perfil no sistema é barrado com uma mensagem.

### Mensagens da tela de entrada
- *"a tabela app_state não existe"* → rode o `supabase-setup.sql` (passo 2).
- *"O Supabase recusou a chave"* → confira a URL e a chave no `config.js`.
- *"Não foi possível falar com o Supabase"* → internet ou endereço do `config.js` incorreto.
- *"E-mail ou senha inválidos"* → a conta não existe no Supabase, a senha está errada ou o e-mail não foi confirmado (use *Auto Confirm User*).

---

## Avisos de segurança (leia)

- O site do GitHub Pages é **público**. A chave `anon/public` pode aparecer no código sem problema, **desde que** o passo 2 tenha sido feito:
  ele impede que visitantes sem login leiam ou gravem qualquer coisa.
- **Qualquer pessoa com conta no Supabase consegue ler e alterar todos os dados** pela API: os perfis (Operador, Gerente...) são aplicados pela página, não pelo banco.
  Cadastre contas só para pessoas de confiança. Para ter permissões aplicadas pelo servidor, use o backend NestJS (pasta `erp-distribuidora`, com Neon ou Supabase).
- As senhas de autorização do gerente (cancelamentos no PDV) ficam, como hash, nos mesmos dados.
- O código da página contém os dados cadastrais da empresa e da conta bancária de exemplo (CNPJ, endereço, banco, agência, conta, chave PIX).
- O estado do **caixa aberto e da venda em andamento** fica só no computador do caixa (cada terminal tem o seu).
- Os dados são lidos ao entrar na página. Para ver o que outra pessoa alterou, atualize (F5). Se duas pessoas salvarem ao mesmo tempo, vale a última gravação.
- Os limites do plano gratuito (espaço, projetos pausados por inatividade) mudam: confira no site do Supabase e ative backups quando houver dados reais.
- **Esta ligação foi testada contra um simulador do Supabase, não contra um projeto real.** Se algo falhar, a tela de entrada indica o que conferir.
