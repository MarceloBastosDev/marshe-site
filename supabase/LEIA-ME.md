# Pontos Marshê: como ligar o programa de pontos

O site continua estático. O login dos clientes e o saldo de pontos ficam no
**Supabase**, um banco de dados com plano gratuito. Enquanto ele não estiver
configurado, o programa fica escondido no site, e a loja funciona normalmente.

**Regras atuais:** 5% do valor pago volta em pontos (1 ponto = R$ 0,01). Os
pontos entram quando o pedido é marcado como **entregue**, valem **3 meses** e
são usados como desconto no próximo pedido.

---

## 1. Criar o projeto (uma vez, uns 10 minutos)

1. Crie uma conta em <https://supabase.com> e clique em **New project**.
   - Região: **South America (São Paulo)**.
   - Anote a senha do banco num lugar seguro (você quase não vai usar).
2. No menu, abra **SQL Editor → New query**, cole o conteúdo inteiro de
   `supabase/schema.sql` e clique em **Run**. Deve aparecer "Success".
3. **Authentication → URL Configuration**
   - Site URL: `https://www.marshe3d.com.br`
   - Redirect URLs: adicione `https://www.marshe3d.com.br/**` e `http://localhost:5173/**`
4. **(Opcional, depois de configurar o SMTP, item "Envio de e-mails" abaixo)**
   O Supabase só deixa editar os e-mails com um SMTP próprio. Sem ele, o e-mail
   padrão chega em inglês com um **link de acesso**, e o site já funciona assim:
   o cliente toca no link e volta logado. Com o SMTP configurado, em
   **Authentication → Emails → Templates → Magic link or OTP**, troque o texto
   para português e para mostrar também o código de 6 dígitos:

   Assunto: `Seu código de acesso Marshê`

   ```html
   <h2>Seu código Marshê</h2>
   <p>Use este código para entrar no Pontos Marshê:</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
   <p>Ou toque aqui para entrar direto: <a href="{{ .ConfirmationURL }}">entrar na minha conta</a></p>
   <p>Se não foi você, ignore este e-mail.</p>
   ```

   Faça o mesmo em **Confirm signup**, que é o e-mail do primeiro acesso.
5. **Project Settings → API**: copie **Project URL** e a chave **anon public**
   para `js/config.js`:

   ```js
   supabaseUrl: "https://SEU-PROJETO.supabase.co",
   supabaseAnonKey: "eyJ...",
   ```

   > A chave *anon* pode ficar no site; quem protege os dados são as regras do banco.
   > **Nunca** coloque a chave *service_role* no site.

6. **Torne a loja administradora:** entre uma vez no site com o e-mail da loja
   (botão "Entrar" no topo). Depois rode no SQL Editor:

   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'marshe3d@gmail.com'
   on conflict do nothing;
   ```

   Repita para outro e-mail, se a Sheila também for usar o painel.

### Importante: envio de e-mails

O Supabase gratuito envia **poucos e-mails por hora** com o servidor dele. Para
uso real, ligue um envio de e-mail próprio (gratuito) em
**Authentication → SMTP Settings**. Brevo ou Resend funcionam bem: crie a conta,
copie os dados de SMTP e cole lá. Sem isso, em dias de movimento, alguns
clientes podem não receber o código.

---

## Formas de entrar (Google, senha e link)

O cliente pode entrar de três jeitos: **Google**, **e-mail e senha** ou **link no
e-mail** (sem senha). Os três caem na mesma conta, se o e-mail for o mesmo.

### Deixar o cadastro com senha instantâneo (recomendado)

Por padrão o Supabase pede que o cliente confirme o e-mail antes de entrar.
Para entrar na hora: **Authentication → Sign In / Providers → Email** e desligue
**Confirm email**. (Contrapartida: alguém pode criar conta com e-mail de outra
pessoa; como a conta só dá pontos de compras confirmadas por vocês, o risco é baixo.)

### Ativar o login com Google (uns 15 minutos)

1. Acesse <https://console.cloud.google.com> e crie um projeto (ex.: `Marshe`).
2. **APIs e serviços → Tela de consentimento OAuth**: tipo **Externo**, nome
   `Marshê Studio 3D`, e-mail de suporte, logo (opcional) e domínio
   `marshe3d.com.br`. Salve e **publique** o app (botão "Publicar app").
3. **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**:
   - Tipo: **Aplicativo da Web**
   - Origens JavaScript autorizadas: `https://www.marshe3d.com.br` e `http://localhost:5173`
   - URIs de redirecionamento autorizados:
     `https://cwtmcmxcjqxtisseyluq.supabase.co/auth/v1/callback`
   - Copie o **ID do cliente** e a **Chave secreta do cliente**.
4. No Supabase: **Authentication → Sign In / Providers → Google**, ligue,
   cole o ID e a chave secreta e salve.
5. Em `js/config.js`, troque `loginGoogle: false` por `loginGoogle: true`.
   (Até lá o botão do Google fica escondido no site e no painel.)

> A chave secreta do Google fica **só no Supabase**, nunca no site.

## Atualizações do banco

Sempre que o `schema.sql` mudar (ex.: a chegada do **Indique e ganhe**), rode o
arquivo inteiro de novo no **SQL Editor**. Ele atualiza o banco sem apagar
clientes, pedidos nem pontos.

**Indique e ganhe:** cada cliente tem um link (`?indica=CODIGO`) dentro da conta.
Quando a 1ª compra de quem chegou pelo link é marcada como entregue, os dois
ganham `bonus_indicacao` pontos (padrão 1.000 = R$ 10), automaticamente.

## 2. No dia a dia (painel da loja)

Abra `https://www.marshe3d.com.br/admin.html` e entre com o e-mail da loja.

- **Pedidos → Aguardando:** pedidos feitos no site por clientes logados. O
  número (ex.: **M12**) também vem na mensagem do WhatsApp.
  - **Confirmar pedido:** depois de combinar na conversa. Se o cliente usou
    pontos, eles saem do saldo agora.
  - **Cancelar:** pontos já descontados voltam para o cliente.
- **Pedidos → Confirmados → Marcar como entregue:** informe o valor final pago
  (pode corrigir, se mudou na conversa). O cashback de 5% entra na hora no saldo
  do cliente.
- **Clientes e pontos:** busque por nome, e-mail ou WhatsApp, veja o extrato e
  faça **ajustes** (ex.: +200 de brinde, ou -150 para corrigir). Todo ajuste
  pede um motivo, que aparece no extrato do cliente.

- **Produtos e preços:** altere preço, preço antigo (oferta), "Sob consulta" e
  "Esconder da loja" de cada produto e clique em **Salvar**. A loja atualiza na
  hora (basta o cliente recarregar). Preço antigo maior que o preço vira oferta
  (riscado, com % e no filtro Black Marshê). Produtos com opções (tamanho, cor)
  têm um preço por opção.

- **Editar detalhes do produto** (no mesmo cartão, logo abaixo dos preços):
  nome, descrição, categorias (pode criar uma nova), selos "Novo" e
  "Mais pedido", texto do campo de personalização (vazio = sem personalização)
  e ordem na vitrine (1 = primeiro). **Voltar aos dados originais do arquivo**
  desfaz só esses detalhes; os preços continuam.
  Antes de usar pela primeira vez, rode **uma vez** o arquivo
  `supabase/produtos-detalhes.sql` no SQL Editor (New query → colar → Run).

Pontos vencidos deixam de contar sozinhos, sem precisar fazer nada.

---

## 3. Mudar as regras

1. No SQL Editor:
   `update public.regras_pontos set cashback_pct = 5, validade_meses = 3 where id = 1;`
2. Em `js/config.js`: `cashbackPct` e `validadePontosMeses`.
3. No `index.html`: os textos da seção "Pontos Marshê" (regulamento) e da
   pergunta do FAQ.

## 4. Testar sem banco

Em `js/config.js`, `pontosDemo: true` mostra as telas em modo demonstração:
qualquer e-mail e qualquer código de 6 dígitos funcionam, e nada é salvo no
servidor. Volte para `false` antes de publicar.

## 5. Dados dos clientes (LGPD)

O programa guarda e-mail, nome, WhatsApp, pedidos e pontos. Se um cliente pedir
para sair, apague em **Authentication → Users → (cliente) → Delete user**. O
perfil, os pedidos e os pontos dele são apagados juntos.
