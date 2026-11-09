/* Painel da loja · Pontos Marshê
   Confirmar pedidos, marcar como entregue (credita o cashback), cancelar,
   buscar clientes, ver extrato e ajustar pontos. Só funciona para quem
   estiver na tabela "admins" do Supabase (veja supabase/LEIA-ME.md). */

const CFG = window.MARSHE || {};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $("[data-app]");
const brl = (v) => (+v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = (s = "") => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dataHora = (d) => new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const STATUS = { aguardando: "Aguardando", confirmado: "Confirmado", entregue: "Entregue", cancelado: "Cancelado" };
const waLink = (fone, texto = "") => { const n = String(fone || "").replace(/\D/g, ""); return n ? `https://wa.me/${n.length <= 11 ? "55" + n : n}${texto ? "?text=" + encodeURIComponent(texto) : ""}` : ""; };

if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) {
  app.innerHTML = `<div class="adm__card"><h1>Falta configurar</h1><p>Preencha <code>supabaseUrl</code> e <code>supabaseAnonKey</code> em <code>js/config.js</code>. O passo a passo está em <code>supabase/LEIA-ME.md</code>.</p></div>`;
  throw new Error("Supabase não configurado");
}

const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
const sb = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true } });
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

let aba = "pedidos", filtro = "aguardando", busca = "", email = "";

async function iniciar() {
  const user = (await sb.auth.getSession()).data.session?.user;
  $("[data-sair]").hidden = !user;
  if (!user) return telaLogin();
  let admin = false;
  try { admin = ok(await sb.rpc("eh_admin")); } catch { admin = false; }
  if (!admin) {
    app.innerHTML = `<div class="adm__card"><h1>Acesso restrito</h1><p>A conta <strong>${esc(user.email)}</strong> não é administradora da loja.</p>
      <p>Para liberar, rode no Supabase (SQL Editor):</p>
      <pre>insert into public.admins (user_id) select id from auth.users where email = '${esc(user.email)}' on conflict do nothing;</pre></div>`;
    return;
  }
  render();
}

function telaLogin(etapa = "email", aviso = "") {
  app.innerHTML = etapa === "email"
    ? `<div class="adm__card adm__login"><h1>Entrar no painel</h1>
        ${CFG.loginGoogle ? `        <button class="g-btn" type="button" data-login-google><svg class="g-ico" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg><span>Entrar com Google</span></button>` : ""}
        <form class="adm__login" data-login-senha>
          <label>E-mail da loja<input type="email" name="email" required autocomplete="email" value="${esc(email)}"></label>
          <label>Senha<input type="password" name="senha" required autocomplete="current-password"></label>
          <button class="btn btn--primary" type="submit">Entrar</button>
        </form>
        <button class="link-btn" type="button" data-login-link>Entrar com link no e-mail</button>
        <p class="adm__msg">${esc(aviso)}</p></div>`
    : etapa === "link"
    ? `<form class="adm__card adm__login" data-login-email><h1>Entrar com link</h1>
        <label>E-mail da loja<input type="email" name="email" required autocomplete="email" value="${esc(email)}"></label>
        <button class="btn btn--primary" type="submit">Receber link</button><p class="adm__msg">${esc(aviso)}</p></form>`
    : `<form class="adm__card adm__login" data-login-code><h1>Confira seu e-mail</h1><p>Enviamos um e-mail para <strong>${esc(email)}</strong>. <strong>Toque no link</strong> para entrar no painel. Se o e-mail trouxer um código de 6 dígitos, digite abaixo.</p>
        <label>Código (se houver)<input name="code" inputmode="numeric" maxlength="6" required autocomplete="one-time-code"></label>
        <button class="btn btn--primary" type="submit">Entrar</button><p class="adm__msg">${esc(aviso)}</p></form>`;
  app.querySelector("input")?.focus();
}

function render() {
  app.innerHTML = `
    <nav class="adm__tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${aba === "pedidos"}" data-aba="pedidos">Pedidos</button>
      <button type="button" role="tab" aria-selected="${aba === "clientes"}" data-aba="clientes">Clientes e pontos</button>
      <button type="button" role="tab" aria-selected="${aba === "precos"}" data-aba="precos">Produtos e preços</button>
    </nav>
    <section data-conteudo><p>Carregando…</p></section>`;
  aba === "pedidos" ? renderPedidos() : aba === "precos" ? renderPrecos() : renderClientes();
}

async function renderPedidos() {
  const box = $("[data-conteudo]");
  const filtros = [["aguardando", "Aguardando"], ["confirmado", "Confirmados"], ["entregue", "Entregues"], ["cancelado", "Cancelados"], ["", "Todos"]];
  let lista = [];
  try { lista = ok(await sb.rpc("admin_pedidos", { p_status: filtro || null })); }
  catch (e) { box.innerHTML = `<p class="adm__msg">Erro: ${esc(e.message)}</p>`; return; }
  box.innerHTML = `<div class="adm__filters">${filtros.map(([v, l]) => `<button type="button" class="chip" aria-pressed="${filtro === v}" data-filtro="${v}">${l}</button>`).join("")}</div>
    ${lista.length ? "" : `<p class="adm__empty">Nenhum pedido aqui.</p>`}
    <div class="adm__list">${lista.map((p) => `
      <article class="adm__order">
        <header><strong>Pedido M${p.id}</strong><span class="adm__st adm__st--${p.status}">${STATUS[p.status]}</span><time>${dataHora(p.criado_em)}</time></header>
        <p class="adm__who"><strong>${esc(p.nome || "Sem nome")}</strong> · ${esc(p.email)}${p.whatsapp ? ` · <a href="${waLink(p.whatsapp)}" target="_blank" rel="noopener">${esc(p.whatsapp)}</a>` : ""}<br>
          ${esc(p.cidade || "")}${p.recebimento ? " · " + esc(p.recebimento) : ""} · saldo atual: <strong>${(p.saldo || 0).toLocaleString("pt-BR")} pts</strong></p>
        <ul class="adm__items">${(p.itens || []).map((i) => `<li>${i.qtd}x ${esc(i.nome || i.id)}${i.variacao ? ` (${esc(i.variacao)})` : ""}${i.custom ? ` “${esc(i.custom)}”` : ""} <span>${brl(i.preco * i.qtd)}</span></li>`).join("")}</ul>
        <dl class="adm__sum">
          <div><dt>Subtotal</dt><dd>${brl(p.subtotal)}</dd></div>
          ${+p.desconto ? `<div><dt>Desconto 1º pedido</dt><dd>− ${brl(p.desconto)}</dd></div>` : ""}
          ${p.pontos_usados ? `<div><dt>Pontos usados (${p.pontos_usados})</dt><dd>− ${brl(p.pontos_usados / 100)}</dd></div>` : ""}
          <div class="adm__total"><dt>Total</dt><dd>${brl(p.total)}</dd></div>
          ${p.pontos_gerados ? `<div><dt>Cashback creditado</dt><dd>+${p.pontos_gerados} pts</dd></div>` : ""}
        </dl>
        <div class="adm__actions">
          ${p.status === "aguardando" ? `<button class="btn btn--primary" data-acao="confirmar" data-id="${p.id}">Confirmar pedido${p.pontos_usados ? " (desconta os pontos)" : ""}</button>` : ""}
          ${["aguardando", "confirmado"].includes(p.status) ? `<button class="btn btn--wa" data-acao="entregar" data-id="${p.id}" data-total="${p.total}">Marcar como entregue (+${Math.floor(p.total * (CFG.cashbackPct ?? 5))} pts)</button>
            <button class="btn btn--ghost" data-acao="cancelar" data-id="${p.id}">Cancelar</button>` : ""}
        </div>
      </article>`).join("")}</div>`;
}

/* ---------- Produtos e preços ---------- */
let catalogo = null, buscaProd = "";
const reais = (v) => (v == null || v === "" ? "" : String(v).replace(".", ","));
// aceita "12", "12,5", "12,50", "1.234,56" e "R$ 12,00"
const numero = (s) => { let t = String(s ?? "").trim().replace(/\s|R\$/g, ""); if (t.includes(",")) t = t.replace(/\./g, "").replace(",", "."); return t === "" ? null : Number(t); };
const CAMPOS = ["nome", "descricao", "categorias", "selos", "personalizavel", "ordem"];
const SELOS = ["Novo", "Mais pedido"];
const abertos = new Set();
let ajustes = new Map();
// valores atuais = banco (se editado) ou produtos.json
function atual(p, l) {
  return {
    nome: l?.nome ?? p.nome,
    descricao: l?.descricao ?? p.descricao ?? "",
    categorias: l?.categorias ?? p.categorias ?? [],
    selos: l?.selos ?? (p.selos || []).filter((x) => SELOS.includes(x)),
    personalizavel: l?.personalizavel ?? p.personalizavel ?? "",
    ordem: l?.ordem ?? null
  };
}
function todasCategorias() {
  const set = new Set();
  (catalogo || []).forEach((p) => p.categorias.forEach((c) => set.add(c)));
  ajustes.forEach((l) => (l.categorias || []).forEach((c) => set.add(c)));
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
const mesmaLista = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
async function renderPrecos() {
  const box = $("[data-conteudo]");
  try {
    if (!catalogo) catalogo = (await (await fetch("produtos.json", { cache: "no-cache" })).json()).produtos;
    const linhas = ok(await sb.from("precos").select("*"));
    const porId = new Map(linhas.map((l) => [l.produto_id, l]));
    ajustes = porId;
    const q = buscaProd.toLowerCase();
    const lista = catalogo.filter((p) => { const d = atual(p, porId.get(p.id)); return !q || (p.nome + " " + d.nome + " " + d.categorias.join(" ")).toLowerCase().includes(q); });
    box.innerHTML = `<p class="adm__hint">Altere e clique em <strong>Salvar</strong>: a loja atualiza na hora. Deixe <strong>Sob consulta</strong> marcado para mostrar “Pedir orçamento” em vez do preço. <strong>Preço antigo</strong> maior que o preço vira oferta (riscado, com % de desconto e no filtro Black Marshê). Em <strong>Editar detalhes do produto</strong> você muda nome, descrição, categorias, selos, personalização e a ordem na vitrine.</p>
      <form class="adm__search" data-busca-prod><input type="search" name="q" placeholder="Buscar produto" value="${esc(buscaProd)}"><button class="btn btn--primary" type="submit">Buscar</button></form>
      <div class="adm__list">${lista.map((p) => {
        const l = porId.get(p.id);
        const sob = l ? l.sob_consulta : !!p.sobConsulta;
        const preco = l?.preco ?? p.preco ?? null;
        const de = l ? l.preco_de : p.precoDe ?? null;
        const ops = p.variacoes?.opcoes || [];
        const foto = p.fotos?.[0] ? p.fotos[0].replace(/-960\.webp$/, "-480.webp") : "";
        const d = atual(p, l);
        const editado = l && CAMPOS.some((c) => l[c] != null);
        return `<form class="adm__prod${l?.oculto ? " is-hidden" : ""}" data-preco="${esc(p.id)}">
          <div class="adm__prod-head">${foto ? `<img src="${esc(foto)}" alt="" loading="lazy">` : "<span></span>"}
            <div><strong>${esc(d.nome)}</strong><small>${esc(d.categorias.join(" · "))}${l ? ` · alterado em ${dataHora(l.atualizado_em)}` : " · dados do arquivo"}${editado ? " · detalhes editados" : ""}</small></div></div>
          <div class="adm__prod-fields">
            <label class="adm__chk"><input type="checkbox" name="sob" ${sob ? "checked" : ""}> Sob consulta</label>
            ${ops.length ? ops.map((o) => `<label>${esc(p.variacoes.nome || "Opção")}: ${esc(o.nome)}<span class="adm__money">R$ <input name="op" data-op="${esc(o.nome)}" inputmode="decimal" value="${reais(l?.opcoes?.[o.nome] ?? o.preco)}"></span></label>`).join("")
              : `<label>Preço<span class="adm__money">R$ <input name="preco" inputmode="decimal" value="${reais(preco)}"></span></label>`}
            <label>Preço antigo (oferta)<span class="adm__money">R$ <input name="de" inputmode="decimal" placeholder="sem oferta" value="${reais(de)}"></span></label>
            <label class="adm__chk"><input type="checkbox" name="oculto" ${l?.oculto ? "checked" : ""}> Esconder da loja</label>
            <button class="btn btn--primary" type="submit">Salvar</button>
          </div>
          <details class="adm__more"${abertos.has(p.id) ? " open" : ""}>
            <summary>Editar detalhes do produto <small>nome, descrição, categorias, selos, personalização e ordem</small></summary>
            <div class="adm__det">
              <label class="adm__wide">Nome do produto<input name="nome" maxlength="80" required value="${esc(d.nome)}"></label>
              <label class="adm__wide">Descrição<textarea name="descricao" rows="3" maxlength="700">${esc(d.descricao)}</textarea><small class="adm__count" data-count>${d.descricao.length}/700</small></label>
              <fieldset class="adm__wide"><legend>Categorias</legend><div class="adm__checks">
                ${todasCategorias().map((c) => `<label class="adm__chk"><input type="checkbox" name="cat" value="${esc(c)}" ${d.categorias.includes(c) ? "checked" : ""}> ${esc(c)}</label>`).join("")}
                <label class="adm__newcat">Nova categoria<input name="novacat" maxlength="30" placeholder="Ex.: Infantil"></label>
              </div></fieldset>
              <fieldset><legend>Selos no card</legend><div class="adm__checks">
                ${SELOS.map((sl) => `<label class="adm__chk"><input type="checkbox" name="selo" value="${sl}" ${d.selos.includes(sl) ? "checked" : ""}> ${sl}</label>`).join("")}
              </div></fieldset>
              <label>Ordem na vitrine<input name="ordem" type="number" min="1" max="999" inputmode="numeric" placeholder="automática" value="${d.ordem ?? ""}"><small>1 aparece primeiro</small></label>
              <label class="adm__wide">Campo de personalização<input name="personalizavel" maxlength="120" placeholder="Deixe vazio se a peça não é personalizável" value="${esc(d.personalizavel)}"><small>Texto que aparece acima do campo, ex.: “Nome que vai na peça”</small></label>
              <div class="adm__det-foot">
                <button class="btn btn--primary" type="submit">Salvar alterações</button>
                ${editado ? `<button class="link-btn" type="button" data-restaurar="${esc(p.id)}">Voltar aos dados originais do arquivo</button>` : ""}
              </div>
            </div>
          </details>
          <p class="adm__msg"></p>
        </form>`;
      }).join("")}</div>`;
  } catch (e) { box.innerHTML = `<p class="adm__msg">Erro: ${esc(e.message)}. Rode o supabase/schema.sql atualizado no SQL Editor.</p>`; }
}
async function salvarPreco(f) {
  const p = catalogo.find((x) => x.id === f.dataset.preco);
  const sob = f.sob.checked;
  const ops = [...f.querySelectorAll("[data-op]")];
  let preco = null, opcoes = null;
  if (ops.length) {
    opcoes = {};
    for (const i of ops) { const v = numero(i.value); if (v != null) { if (!(v >= 0)) throw new Error("Valor inválido em " + i.dataset.op); opcoes[i.dataset.op] = v; } }
    const vals = Object.values(opcoes);
    preco = vals.length ? Math.min(...vals) : null;
    if (!sob && vals.length < ops.length) throw new Error("Preencha o preço de todas as opções (ou marque Sob consulta).");
  } else {
    preco = numero(f.preco.value);
    if (preco != null && !(preco >= 0)) throw new Error("Preço inválido.");
  }
  if (!sob && !(preco > 0)) throw new Error("Informe o preço (ou marque Sob consulta).");
  const de = numero(f.de.value);
  if (de != null && !(de > 0)) throw new Error("Preço antigo inválido.");
  if (de != null && preco != null && de <= preco) throw new Error("O preço antigo precisa ser maior que o preço, para virar oferta.");
  // Detalhes: só grava o que for diferente do produtos.json (o resto fica null = segue o arquivo)
  const nome = f.nome.value.trim().replace(/\s+/g, " ");
  if (nome.length < 2) throw new Error("O nome precisa ter pelo menos 2 letras.");
  const descricao = f.descricao.value.trim();
  const nova = f.novacat.value.trim().replace(/\s+/g, " ");
  const categorias = [...new Set([...[...f.querySelectorAll("[name=cat]:checked")].map((i) => i.value), ...(nova ? [nova.charAt(0).toUpperCase() + nova.slice(1)] : [])])];
  if (!categorias.length) throw new Error("Escolha pelo menos uma categoria.");
  if (categorias.length > 8) throw new Error("Use no máximo 8 categorias.");
  const selos = [...f.querySelectorAll("[name=selo]:checked")].map((i) => i.value);
  const personalizavel = f.personalizavel.value.trim();
  const ordem = f.ordem.value.trim() === "" ? null : parseInt(f.ordem.value, 10);
  if (ordem != null && !(ordem >= 1 && ordem <= 999)) throw new Error("A ordem vai de 1 a 999.");
  const orig = atual(p, null);
  const det = {
    nome: nome === orig.nome ? null : nome,
    descricao: descricao === orig.descricao ? null : descricao,
    categorias: mesmaLista(categorias, orig.categorias) ? null : categorias,
    selos: mesmaLista(selos, orig.selos) ? null : selos,
    personalizavel: personalizavel === orig.personalizavel ? null : personalizavel,
    ordem
  };
  // Se o banco ainda não tem as colunas novas, salvar só o preço continua funcionando
  const bancoTemDetalhes = [...ajustes.values()].some((l) => "nome" in l);
  const mudouDetalhe = Object.values(det).some((v) => v != null);
  ok(await sb.from("precos").upsert({ produto_id: p.id, preco, preco_de: de, sob_consulta: sob, opcoes, oculto: f.oculto.checked, ...(bancoTemDetalhes || mudouDetalhe ? det : {}) }));
  return nome;
}

async function renderClientes() {
  const box = $("[data-conteudo]");
  box.innerHTML = `<form class="adm__search" data-busca><input type="search" name="q" placeholder="Buscar por nome, e-mail ou WhatsApp" value="${esc(busca)}"><button class="btn btn--primary" type="submit">Buscar</button></form><div data-clientes><p>Carregando…</p></div>`;
  let lista = [];
  try { lista = ok(await sb.rpc("admin_clientes", { p_busca: busca })); }
  catch (e) { $("[data-clientes]").innerHTML = `<p class="adm__msg">Erro: ${esc(e.message)}</p>`; return; }
  $("[data-clientes]").innerHTML = lista.length ? `<div class="adm__list">${lista.map((c) => `
    <article class="adm__client" data-user="${c.user_id}">
      <header><strong>${esc(c.nome || "Cadastro incompleto")}</strong><span class="adm__bal">${(c.saldo || 0).toLocaleString("pt-BR")} pts <small>(${brl((c.saldo || 0) / 100)})</small></span></header>
      <p>${esc(c.email)}${c.whatsapp ? ` · <a href="${waLink(c.whatsapp)}" target="_blank" rel="noopener">${esc(c.whatsapp)}</a>` : ""} · desde ${new Date(c.criado_em).toLocaleDateString("pt-BR")}</p>
      <div class="adm__actions">
        <button class="btn btn--ghost" data-acao="extrato" data-id="${c.user_id}">Ver extrato</button>
        <button class="btn btn--ghost" data-acao="ajustar" data-id="${c.user_id}">Ajustar pontos</button>
      </div>
      <div class="adm__extra" data-extra></div>
    </article>`).join("")}</div>` : `<p class="adm__empty">Nenhum cliente encontrado.</p>`;
}

const aviso = (t) => { document.querySelectorAll(".toast").forEach((x) => x.remove()); const d = document.createElement("div"); d.className = "toast is-on"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3200); };

app.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("[type=submit]");
  if (btn) btn.disabled = true;
  try {
    if (f.matches("[data-preco]")) { if (f.querySelector("details[open]")) abertos.add(f.dataset.preco); const nome = await salvarPreco(f); aviso(`“${nome}” salvo. Já está no site.`); f.querySelector(".adm__msg").textContent = ""; renderPrecos(); return; }
    if (f.matches("[data-busca-prod]")) { buscaProd = f.q.value.trim(); renderPrecos(); return; }
    if (f.matches("[data-login-senha]")) { email = f.email.value.trim().toLowerCase(); ok(await sb.auth.signInWithPassword({ email, password: f.senha.value })); history.replaceState(null, "", location.pathname); await iniciar(); }
    else if (f.matches("[data-login-email]")) { email = f.email.value.trim().toLowerCase(); ok(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } })); telaLogin("codigo"); }
    else if (f.matches("[data-login-code]")) { ok(await sb.auth.verifyOtp({ email, token: f.code.value.trim(), type: "email" })); await iniciar(); }
    else if (f.matches("[data-busca]")) { busca = f.q.value.trim(); renderClientes(); }
    else if (f.matches("[data-ajuste]")) {
      const qtd = parseInt(f.qtd.value, 10);
      if (!qtd) throw new Error("Informe a quantidade (use negativo para retirar).");
      const saldo = ok(await sb.rpc("ajustar_pontos", { p_user: f.dataset.user, p_qtd: qtd, p_motivo: f.motivo.value.trim() }));
      aviso(`Pontos ajustados. Novo saldo: ${saldo} pts`);
      renderClientes();
    }
  } catch (err) {
    if (btn) btn.disabled = false;
    const m = f.querySelector(".adm__msg");
    if (m && f.matches("[data-preco]")) m.textContent = erroProduto(err.message);
    else if (m) m.textContent = /invalid login credentials/i.test(err.message) ? "E-mail ou senha incorretos. Se você usa o Google, entre pelo botão do Google." : /otp|token|expired|invalid/i.test(err.message) ? "Código inválido ou vencido." : /signups|not allowed|user not found/i.test(err.message) ? "Este e-mail ainda não tem conta. Entre uma vez pelo site primeiro." : err.message;
    else aviso(err.message);
  }
});

// Erros do banco ao salvar um produto, em português
function erroProduto(msg) {
  if (/column|schema cache/i.test(msg)) return "O banco ainda não tem os campos de detalhes. Rode o arquivo supabase/produtos-detalhes.sql no SQL Editor do Supabase (uma vez só).";
  if (/precos_nome_tam/.test(msg)) return "O nome precisa ter de 2 a 80 caracteres.";
  if (/precos_descricao_tam/.test(msg)) return "A descrição pode ter no máximo 700 caracteres.";
  if (/precos_personalizavel_tam/.test(msg)) return "O texto de personalização pode ter no máximo 120 caracteres.";
  if (/precos_categorias_tam/.test(msg)) return "Escolha de 1 a 8 categorias.";
  if (/precos_selos_validos/.test(msg)) return "Selo inválido.";
  if (/precos_ordem_faixa/.test(msg)) return "A ordem vai de 1 a 999.";
  if (/row-level security|permission/i.test(msg)) return "Esta conta não tem permissão para alterar produtos.";
  return msg;
}

// contador de caracteres da descrição
app.addEventListener("input", (e) => {
  const t = e.target.closest("textarea[name=descricao]");
  if (t) t.closest("label").querySelector("[data-count]").textContent = `${t.value.length}/700`;
});

app.addEventListener("click", async (e) => {
  if (e.target.closest("[data-login-link]")) return telaLogin("link");
  const rest = e.target.closest("[data-restaurar]");
  if (rest) {
    if (!confirm("Voltar nome, descrição, categorias, selos, personalização e ordem para os dados originais do arquivo? Os preços não mudam.")) return;
    try {
      ok(await sb.from("precos").update({ nome: null, descricao: null, categorias: null, selos: null, personalizavel: null, ordem: null }).eq("produto_id", rest.dataset.restaurar));
      abertos.add(rest.dataset.restaurar);
      aviso("Detalhes restaurados.");
      renderPrecos();
    } catch (err) { aviso(erroProduto(err.message)); }
    return;
  }
  if (e.target.closest("[data-login-google]")) {
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: "select_account" } } });
    if (error) return telaLogin("email", /not enabled|unsupported/i.test(error.message) ? "O login com Google ainda não foi ativado no Supabase." : error.message);
    return;
  }
  const tab = e.target.closest("[data-aba]");
  if (tab) { aba = tab.dataset.aba; return render(); }
  const fl = e.target.closest("[data-filtro]");
  if (fl) { filtro = fl.dataset.filtro; return renderPedidos(); }
  const b = e.target.closest("[data-acao]");
  if (!b) return;
  const id = b.dataset.id;
  try {
    if (b.dataset.acao === "confirmar") {
      ok(await sb.rpc("confirmar_pedido", { p_id: +id })); aviso(`Pedido M${id} confirmado.`); renderPedidos();
    } else if (b.dataset.acao === "entregar") {
      const valor = prompt(`Valor final pago no pedido M${id} (o cashback é calculado sobre ele):`, String(b.dataset.total).replace(".", ","));
      if (valor === null) return;
      const total = parseFloat(valor.replace(/\./g, "").replace(",", "."));
      if (!(total >= 0)) return aviso("Valor inválido.");
      const pts = ok(await sb.rpc("entregar_pedido", { p_id: +id, p_total: total }));
      aviso(`Pedido M${id} entregue: +${pts} pontos para o cliente.`); renderPedidos();
    } else if (b.dataset.acao === "cancelar") {
      if (!confirm(`Cancelar o pedido M${id}? Pontos já descontados voltam para o cliente.`)) return;
      ok(await sb.rpc("cancelar_pedido", { p_id: +id })); aviso(`Pedido M${id} cancelado.`); renderPedidos();
    } else if (b.dataset.acao === "extrato") {
      const box = b.closest("[data-user]").querySelector("[data-extra]");
      const ext = ok(await sb.rpc("admin_extrato", { p_user: id }));
      box.innerHTML = ext.length ? `<ul class="acct__list">${ext.map((x) => `<li><span>${esc(x.descricao)}<small>${dataHora(x.criado_em)}${x.quantidade > 0 && x.expira_em ? ` · vale até ${new Date(x.expira_em).toLocaleDateString("pt-BR")} · restam ${x.restante}` : ""}</small></span><b class="${x.quantidade > 0 ? "is-plus" : "is-minus"}">${x.quantidade > 0 ? "+" : ""}${x.quantidade}</b></li>`).join("")}</ul>` : "<p>Sem movimentações.</p>";
    } else if (b.dataset.acao === "ajustar") {
      const box = b.closest("[data-user]").querySelector("[data-extra]");
      box.innerHTML = `<form class="adm__adjust" data-ajuste data-user="${id}">
        <label>Pontos (negativo retira)<input name="qtd" type="number" step="1" required placeholder="ex.: 200 ou -150"></label>
        <label>Motivo<input name="motivo" required placeholder="ex.: brinde de aniversário"></label>
        <button class="btn btn--primary" type="submit">Salvar ajuste</button><p class="adm__msg"></p></form>`;
      box.querySelector("input").focus();
    }
  } catch (err) { aviso(err.message); }
});

$("[data-sair]").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });
iniciar();
