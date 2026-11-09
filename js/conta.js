/* Pontos Marshê · conta do cliente
   Login por código enviado ao e-mail (sem senha), saldo de pontos, extrato e pedidos.
   Usa o Supabase (configure em js/config.js). Com "pontosDemo: true" roda uma
   demonstração local, sem banco, só para ver as telas. */

const CFG = window.MARSHE || {};
const PCT = CFG.cashbackPct ?? 5;
const MESES = CFG.validadePontosMeses ?? 3;
const $ = (s, el = document) => el.querySelector(s);
const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const data = (d) => new Date(d).toLocaleDateString("pt-BR");
const pts = (n) => `${(n || 0).toLocaleString("pt-BR")} ${n === 1 ? "ponto" : "pontos"}`;
const STATUS = { aguardando: "Aguardando confirmação", confirmado: "Confirmado", entregue: "Entregue", cancelado: "Cancelado" };

/* ---------------- Backend: Supabase ---------------- */
// Conta da loja: só ela vê o atalho para o painel de ajustes
const ADMIN_EMAIL = "marshe3d@gmail.com";
const ehContaDaLoja = (u) => (u?.email || "").toLowerCase() === ADMIN_EMAIL;

async function backendSupabase() {
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const sb = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    demo: false,
    async sessao() { return (await sb.auth.getSession()).data.session?.user || null; },
    onAuth(fn) { sb.auth.onAuthStateChange((ev, s) => fn(s?.user || null, ev)); },
    async google() { ok(await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: "select_account" } } })); },
    async entrarSenha(email, senha) { return ok(await sb.auth.signInWithPassword({ email, password: senha })).user; },
    async criarConta(email, senha) { const d = ok(await sb.auth.signUp({ email, password: senha, options: { emailRedirectTo: location.origin + location.pathname } })); return { user: d.session ? d.user : null, precisaConfirmar: !d.session }; },
    async recuperar(email) { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
    async novaSenha(senha) { ok(await sb.auth.updateUser({ password: senha })); },
    async enviarCodigo(email) { ok(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } })); },
    async verificar(email, token) { return ok(await sb.auth.verifyOtp({ email, token, type: "email" })).user; },
    async sair() { await sb.auth.signOut(); },
    async perfil(uid) { return ok(await sb.from("perfis").select("*").eq("id", uid).maybeSingle()); },
    async salvarPerfil(uid, p) { ok(await sb.from("perfis").upsert({ id: uid, ...p })); },
    async saldo() { return ok(await sb.rpc("meu_saldo")) || 0; },
    async aVencer() { const r = ok(await sb.rpc("meus_pontos_a_vencer")); return r?.[0]?.quantidade ? r[0] : null; },
    async extrato() { return ok(await sb.from("pontos").select("quantidade,descricao,criado_em,expira_em").order("criado_em", { ascending: false }).limit(30)); },
    async pedidos() { return ok(await sb.from("pedidos").select("id,criado_em,atualizado_em,status,itens,subtotal,desconto,total,pontos_usados,pontos_gerados,cidade,recebimento").order("criado_em", { ascending: false }).limit(20)); },
    async criarPedido(p) { return ok(await sb.from("pedidos").insert(p).select("id").single()).id; },
    async minhaIndicacao() { return ok(await sb.rpc("minha_indicacao"))?.[0] || null; },
    async registrarIndicacao(codigo) { return ok(await sb.rpc("registrar_indicacao", { p_codigo: codigo })); },
    // Quem é admin decide o banco (tabela "admins"); aqui só serve para mostrar o atalho
    async ehAdmin() { try { return !!ok(await sb.rpc("eh_admin")); } catch { return false; } }
  };
}

/* ---------------- Backend: demonstração local ---------------- */
function backendDemo() {
  const K = "marshe:demo-pontos";
  const get = () => JSON.parse(localStorage.getItem(K) || "null") || { user: null, perfil: null, extrato: [], pedidos: [], seq: 100 };
  const set = (d) => localStorage.setItem(K, JSON.stringify(d));
  let cb = () => {};
  return {
    demo: true,
    async sessao() { return get().user; },
    onAuth(fn) { cb = fn; },
    async google() { return this.verificar("cliente.google@gmail.com", "", "Cliente Google"); },
    async entrarSenha(email) { return this.verificar(email); },
    async criarConta(email) { return { user: await this.verificar(email), precisaConfirmar: false }; },
    async recuperar() {},
    async novaSenha() {},
    async enviarCodigo() { /* na demo qualquer código de 6 dígitos funciona */ },
    async verificar(email, _t, nome) {
      const d = get();
      d.user = { id: "demo", email, user_metadata: nome ? { full_name: nome } : {} };
      if (!d.extrato.length) d.extrato.push({ quantidade: 350, descricao: "Cashback do pedido M98 (demonstração)", criado_em: new Date(Date.now() - 864e5 * 20).toISOString(), expira_em: new Date(Date.now() + 864e5 * 70).toISOString() });
      set(d); cb(d.user); return d.user;
    },
    async sair() { localStorage.removeItem(K); cb(null); },
    async perfil() { return get().perfil; },
    async salvarPerfil(_uid, p) { const d = get(); d.perfil = p; set(d); },
    async saldo() { return get().extrato.reduce((s, x) => s + x.quantidade, 0); },
    async aVencer() { return null; },
    async extrato() { return get().extrato; },
    async pedidos() { return get().pedidos; },
    async minhaIndicacao() { return { codigo: "DEMO25", indicados: 0, premiados: 0 }; },
    async registrarIndicacao() { return true; },
    async ehAdmin() { return (get().user?.email || "").toLowerCase() === ADMIN_EMAIL; },
    async criarPedido(p) { const d = get(); d.seq++; d.pedidos.unshift({ ...p, id: d.seq, criado_em: new Date().toISOString(), status: "aguardando", pontos_gerados: 0 }); set(d); return d.seq; }
  };
}

/* ---------------- Interface ---------------- */
export async function iniciar(loja) {
  let api;
  try { api = CFG.pontosDemo ? backendDemo() : await backendSupabase(); }
  catch (e) { console.warn("Pontos Marshê indisponível:", e); return; }

  const conta = window.MarsheConta = { ativo: true, demo: api.demo, user: null, perfil: null, saldo: 0, abrir, criarPedido: (p) => api.criarPedido(p) };
  const avisar = () => document.dispatchEvent(new CustomEvent("conta:mudou"));

  // Gaveta da conta
  const el = document.createElement("aside");
  el.className = "drawer acct";
  el.id = "conta";
  el.setAttribute("aria-label", "Minha conta");
  el.setAttribute("aria-hidden", "true");
  el.tabIndex = -1;
  el.innerHTML = `<div class="drawer__head"><h2>Pontos Marshê</h2>
      <button class="icon-btn" type="button" data-acct-close aria-label="Fechar"><svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button></div>
    <div class="drawer__body" data-acct-body></div>`;
  document.body.appendChild(el);
  const body = $("[data-acct-body]", el);
  const scrim = document.createElement("div");
  scrim.className = "scrim"; scrim.hidden = true;
  document.body.appendChild(scrim);
  let lastFocus = null;

  function abrir() {
    lastFocus = document.activeElement;
    scrim.hidden = false;
    requestAnimationFrame(() => { scrim.classList.add("is-on"); el.classList.add("is-open"); });
    el.setAttribute("aria-hidden", "false");
    loja.lockScroll(true);
    render();
    setTimeout(() => (el.querySelector("input, button:not([data-acct-close])") || el).focus(), 60);
  }
  function fechar() {
    if (!el.classList.contains("is-open")) return;
    el.classList.remove("is-open"); scrim.classList.remove("is-on");
    el.setAttribute("aria-hidden", "true");
    setTimeout(() => (scrim.hidden = true), 260);
    loja.lockScroll(false);
    lastFocus?.focus?.();
  }
  el.addEventListener("click", (e) => { if (e.target.closest("[data-acct-close]")) fechar(); });
  scrim.addEventListener("click", fechar);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fechar(); });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-account]"); if (b) { e.preventDefault(); abrir(); } });

  const regras = `<ul class="acct__rules">
      <li><strong>${PCT}% de volta</strong> em pontos em cada compra (1 ponto = R$ 0,01).</li>
      <li>Os pontos entram quando o pedido é <strong>entregue</strong>.</li>
      <li>Use como desconto no <strong>próximo pedido</strong>, direto no carrinho.</li>
      <li>Valem por <strong>${MESES} meses</strong>.</li>
    </ul>`;
  const BONUS = CFG.bonusIndicacao ?? 1000;
  const convite = () => localStorage.getItem("marshe:indicacao");
  const conviteAviso = () => convite() && !conta.perfil?.indicado_por
    ? `<p class="ref-banner">🎁 Você recebeu um convite! Crie sua conta e ganhe <strong>${brl(BONUS / 100)} em pontos</strong> quando sua primeira compra for entregue.</p>` : "";
  async function usarConvite() {
    const cod = convite();
    if (!cod || !conta.user || !conta.perfil?.aceite_em) return;
    try { await api.registrarIndicacao(cod); } catch (e) { console.warn("Indicação:", e.message); }
    localStorage.removeItem("marshe:indicacao");
  }
  const demoAviso = api.demo ? `<p class="acct__demo">Modo demonstração: nada é salvo no servidor. Use qualquer e-mail, senha ou código.</p>` : "";
  const GOOGLE_ON = !!CFG.loginGoogle || api.demo;
  const GOOGLE = `<svg class="g-ico" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

  // etapas: entrar | criar | link | codigo | confirmar | recuperar | recuperar-ok | nova-senha
  let etapa = "entrar", emailDigitado = "";
  const olho = `<button type="button" class="acct__eye" data-acct-eye aria-label="Mostrar senha">👁</button>`;
  // Atalho para o painel (admin.html): só na conta marshe3d@gmail.com e só se o banco confirmar que é admin
  let adminOk = null, adminDe = null;
  async function atalhoAdmin() {
    const u = conta.user;
    if (!u || !ehContaDaLoja(u)) return "";
    if (adminDe !== u.id) { adminDe = u.id; adminOk = await api.ehAdmin(); }
    return adminOk ? `<a class="acct__admin" href="admin.html"><svg class="ico" aria-hidden="true"><use href="#i-gem"/></svg><span><strong>Painel da loja</strong><small>Pedidos, clientes, pontos e preços</small></span><svg class="ico" aria-hidden="true"><use href="#i-arrow"/></svg></a>` : "";
  }

  async function render() {
    if (etapa === "nova-senha" && conta.user) {
      body.innerHTML = `<form class="acct__form" data-acct-nova><p class="acct__big">Crie sua nova senha</p>
        <label>Nova senha<span class="acct__pass"><input name="senha" type="password" autocomplete="new-password" minlength="6" required placeholder="Mínimo de 6 caracteres">${olho}</span></label>
        <button class="btn btn--primary btn--block" type="submit">Salvar nova senha</button>
        <p class="acct__msg" data-acct-msg role="alert"></p></form>`;
      return;
    }
    if (!conta.user) {
      if (etapa === "entrar" || etapa === "criar") {
        const criar = etapa === "criar";
        body.innerHTML = `${demoAviso}${conviteAviso()}<div class="acct__intro"><p class="acct__big">Ganhe <strong>${PCT}% de volta</strong> em todas as compras.</p></div>
          ${GOOGLE_ON ? `<button class="g-btn" type="button" data-acct-google>${GOOGLE}<span>${criar ? "Criar conta" : "Entrar"} com Google</span></button>
          <p class="acct__or"><span>ou com e-mail e senha</span></p>` : ""}
          <div class="acct__tabs" role="tablist">
            <button type="button" role="tab" aria-selected="${!criar}" data-acct-tab="entrar">Entrar</button>
            <button type="button" role="tab" aria-selected="${criar}" data-acct-tab="criar">Criar conta</button>
          </div>
          <form class="acct__form" data-acct-senha="${criar ? "criar" : "entrar"}">
            <label>E-mail<input name="email" type="email" autocomplete="email" required placeholder="voce@email.com" value="${esc(emailDigitado)}"></label>
            <label>Senha<span class="acct__pass"><input name="senha" type="password" autocomplete="${criar ? "new-password" : "current-password"}" minlength="6" required placeholder="${criar ? "Crie uma senha (mínimo 6)" : "Sua senha"}">${olho}</span></label>
            <button class="btn btn--primary btn--block" type="submit">${criar ? "Criar minha conta" : "Entrar"}</button>
            ${criar ? "" : `<button class="link-btn" type="button" data-acct-go="recuperar">Esqueci minha senha</button>`}
            <p class="acct__msg" data-acct-msg role="alert"></p>
          </form>
          <button class="link-btn acct__alt" type="button" data-acct-go="link">Prefere sem senha? Receba um link de acesso no e-mail</button>
          ${regras}
          <p class="acct__fine">Usamos seus dados só para o programa de pontos e seus pedidos. Veja a <a href="privacidade.html">Política de Privacidade</a> e os <a href="termos.html">Termos</a>.</p>`;
        return;
      }
      if (etapa === "confirmar") {
        body.innerHTML = `${demoAviso}<div class="acct__form"><p class="acct__big">Confirme seu e-mail</p>
          <p>Enviamos um link para <strong>${esc(emailDigitado)}</strong>. Toque nele para ativar sua conta e você volta para a loja já conectado.</p>
          <p class="acct__fine">Não chegou? Veja o spam ou aguarde 1 minuto.</p>
          <button class="link-btn" type="button" data-acct-go="entrar">Voltar</button></div>`;
        return;
      }
      if (etapa === "recuperar" || etapa === "recuperar-ok") {
        body.innerHTML = etapa === "recuperar-ok"
          ? `<div class="acct__form"><p class="acct__big">Confira seu e-mail</p><p>Se existir uma conta com <strong>${esc(emailDigitado)}</strong>, enviamos um link para criar uma nova senha.</p><button class="link-btn" type="button" data-acct-go="entrar">Voltar para entrar</button></div>`
          : `<form class="acct__form" data-acct-recuperar><p class="acct__big">Recuperar senha</p>
            <p>Digite seu e-mail e enviaremos um link para criar uma nova senha.</p>
            <label>E-mail<input name="email" type="email" autocomplete="email" required value="${esc(emailDigitado)}"></label>
            <button class="btn btn--primary btn--block" type="submit">Enviar link</button>
            <button class="link-btn" type="button" data-acct-go="entrar">Voltar</button>
            <p class="acct__msg" data-acct-msg role="alert"></p></form>`;
        return;
      }
      if (etapa === "codigo") {
        body.innerHTML = `${demoAviso}<form class="acct__form" data-acct-code>
            <p>Enviamos um e-mail para <strong>${esc(emailDigitado)}</strong> (chega em até 1 minuto; veja também o spam).</p>
            <p><strong>Toque no link do e-mail</strong> para entrar: você volta para a loja já conectado. Se o e-mail trouxer um código de 6 dígitos, pode digitar aqui:</p>
            <label>Código (se houver)<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required placeholder="000000"></label>
            <button class="btn btn--primary btn--block" type="submit">Entrar</button>
            <button class="link-btn" type="button" data-acct-back>Usar outro e-mail</button>
            <p class="acct__msg" data-acct-msg role="alert"></p></form>`;
        return;
      }
      body.innerHTML = `${demoAviso}<form class="acct__form" data-acct-email>
          <p class="acct__big">Entrar sem senha</p>
          <label>Seu e-mail<input name="email" type="email" autocomplete="email" required placeholder="voce@email.com" value="${esc(emailDigitado)}"></label>
          <button class="btn btn--primary btn--block" type="submit">Receber link de acesso</button>
          <button class="link-btn" type="button" data-acct-go="entrar">Voltar</button>
          <p class="acct__msg" data-acct-msg role="alert"></p></form>`;
      return;
    }
    if (!conta.perfil?.aceite_em) {
      const admin = await atalhoAdmin();
      body.innerHTML = `${demoAviso}${admin}<form class="acct__form" data-acct-perfil>
          <p class="acct__big">Falta pouco! Complete seu cadastro.</p>
          <label>Nome<input name="nome" autocomplete="name" required value="${esc(conta.perfil?.nome || conta.user.user_metadata?.full_name || conta.user.user_metadata?.name || "")}"></label>
          <label>WhatsApp<input name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" required placeholder="(51) 99999-9999" value="${esc(conta.perfil?.whatsapp || "")}"></label>
          <label class="check"><input type="checkbox" name="aceite" required> <span>Li e aceito as <a href="#regulamento" data-acct-close>regras do Pontos Marshê</a> e o uso dos meus dados para o programa.</span></label>
          <button class="btn btn--primary btn--block" type="submit">Salvar e ver meus pontos</button>
          <p class="acct__msg" data-acct-msg role="alert"></p></form>`;
      return;
    }
    body.innerHTML = `<p class="acct__loading">Carregando seus pontos…</p>`;
    const admin = await atalhoAdmin();
    let [saldo, vencer, extrato, pedidos] = [0, null, [], []];
    try { [saldo, vencer, extrato, pedidos] = await Promise.all([api.saldo(), api.aVencer(), api.extrato(), api.pedidos()]); }
    catch (e) { body.innerHTML = `<p class="acct__msg">Não foi possível carregar seus pontos agora. Tente de novo em instantes.</p>`; return; }
    conta.saldo = saldo; avisar();
    ultimosPedidos = pedidos;
    body.innerHTML = `${demoAviso}${admin}
      <p class="acct__hello">Olá, <strong>${esc(conta.perfil.nome?.split(" ")[0] || "")}</strong></p>
      <div class="acct__balance"><span>Seu saldo</span><strong>${pts(saldo)}</strong><small>= ${brl(saldo / 100)} de desconto no próximo pedido</small></div>
      ${vencer ? `<p class="acct__warn">${pts(vencer.quantidade)} vencem em ${data(vencer.expira_em)}. Use antes!</p>` : ""}
      ${saldo ? `<button class="btn btn--primary btn--block" type="button" data-acct-shop>Usar meus pontos agora</button>` : ""}
      <div class="refer" data-refer><strong>Indique e ganhe ${brl(BONUS / 100)}</strong><p>Carregando seu link…</p></div>
      <h3 class="acct__h">Extrato</h3>
      ${extrato.length ? `<ul class="acct__list">${extrato.map((x) => `<li><span>${esc(x.descricao)}<small>${data(x.criado_em)}${x.quantidade > 0 && x.expira_em ? ` · vale até ${data(x.expira_em)}` : ""}</small></span><b class="${x.quantidade > 0 ? "is-plus" : "is-minus"}">${x.quantidade > 0 ? "+" : ""}${x.quantidade.toLocaleString("pt-BR")}</b></li>`).join("")}</ul>` : `<p class="acct__empty">Seus pontos aparecem aqui depois da primeira compra entregue.</p>`}
      <h3 class="acct__h">Meus pedidos</h3>
      ${pedidos.length ? `<div class="orders">${pedidos.map(pedidoHtml).join("")}</div>` : `<p class="acct__empty">Nenhum pedido feito com a conta ainda.</p>`}
      ${regras}
      <button class="link-btn" type="button" data-acct-logout>Sair da conta</button>`;
    renderIndicacao();
  }

  // Pedido com detalhes (abre ao tocar)
  const ETAPAS = ["aguardando", "confirmado", "entregue"];
  function pedidoHtml(p) {
    const itens = (p.itens || []).filter((i) => i.id !== "embalagem");
    const emb = (p.itens || []).find((i) => i.id === "embalagem");
    const qtd = itens.reduce((s, i) => s + (i.qtd || 1), 0);
    const passo = ETAPAS.indexOf(p.status);
    const linha = (rot, val, cls = "") => `<div class="${cls}"><dt>${rot}</dt><dd>${val}</dd></div>`;
    return `<details class="order">
      <summary>
        <span class="order__thumbs">${itens.slice(0, 3).map((i) => { const f = loja.produto?.(i.id)?.foto; return f ? `<img src="${esc(f)}" alt="" loading="lazy">` : `<span class="order__ph"></span>`; }).join("")}</span>
        <span class="order__head"><strong>Pedido M${p.id}</strong><small>${data(p.criado_em)} · ${qtd} ${qtd === 1 ? "item" : "itens"}</small></span>
        <span class="order__right"><b>${brl(+p.total)}</b><span class="order__st order__st--${p.status}">${STATUS[p.status] || p.status}</span></span>
      </summary>
      <div class="order__body">
        ${p.status === "cancelado" ? `<p class="order__cancel">Este pedido foi cancelado.</p>` : `<ol class="order__steps">${["Pedido feito", "Confirmado", "Entregue"].map((t, i) => `<li class="${i <= passo ? "is-on" : ""}">${t}</li>`).join("")}</ol>`}
        <ul class="order__items">${itens.map((i) => { const f = loja.produto?.(i.id)?.foto; return `<li>
          <span class="order__img">${f ? `<img src="${esc(f)}" alt="" loading="lazy">` : ""}</span>
          <span class="order__name">${esc(i.nome || i.id)}${i.variacao ? `<small>${esc(i.variacao)}</small>` : ""}${i.custom ? `<small>“${esc(i.custom)}”</small>` : ""}<small>${i.qtd}x ${brl(+i.preco)}</small></span>
          <b>${brl(i.preco * i.qtd)}</b></li>`; }).join("")}</ul>
        <dl class="order__sum">
          ${p.subtotal != null ? linha("Subtotal", brl(+p.subtotal)) : ""}
          ${+p.desconto ? linha("Desconto 1º pedido", "− " + brl(+p.desconto), "is-minus") : ""}
          ${emb ? linha("Embalagem de presente", +emb.preco ? brl(+emb.preco) : "Grátis") : ""}
          ${p.pontos_usados ? linha(`Pontos usados (${p.pontos_usados.toLocaleString("pt-BR")})`, "− " + brl(p.pontos_usados / 100), "is-minus") : ""}
          ${linha("Total", brl(+p.total), "order__total")}
          ${p.pontos_gerados ? linha("Pontos ganhos", "+" + p.pontos_gerados.toLocaleString("pt-BR"), "is-plus") : p.status !== "cancelado" && p.status !== "entregue" ? linha("Você vai ganhar", `+${Math.floor(p.total * PCT).toLocaleString("pt-BR")} pontos na entrega`, "is-plus") : ""}
        </dl>
        ${emb?.custom ? `<p class="order__note">Mensagem do cartão: “${esc(emb.custom)}”</p>` : ""}
        ${p.recebimento || p.cidade ? `<p class="order__note">${esc(p.recebimento || "")}${p.cidade ? " · " + esc(p.cidade) : ""}</p>` : ""}
        <div class="order__actions">
          ${itens.length ? `<button class="btn btn--primary" type="button" data-recomprar="${p.id}">Comprar de novo</button>` : ""}
          <a class="btn btn--ghost" href="https://wa.me/${String(CFG.whatsapp || "").replace(/D/g, "")}?text=${encodeURIComponent(`Olá, Marshê! Quero falar sobre o pedido M${p.id}.`)}" target="_blank" rel="noopener">Falar sobre este pedido</a>
        </div>
      </div>
    </details>`;
  }
  let ultimosPedidos = [];

  async function renderIndicacao() {
    const box = $("[data-refer]", body);
    if (!box) return;
    let ind = null;
    try { ind = await api.minhaIndicacao(); } catch { /* sem indicação agora */ }
    if (!ind?.codigo) { box.remove(); return; }
    const link = `${location.origin}${location.pathname}?indica=${ind.codigo}`;
    const texto = `Conhece a Marshê Studio 3D? Peças em impressão 3D lindas, feitas em Terra de Areia. Entra pelo meu link e ganha ${brl(BONUS / 100)} em pontos na sua primeira compra: ${link}`;
    box.innerHTML = `<strong>Indique e ganhe ${brl(BONUS / 100)}</strong>
      <p>Envie seu link. Quando a primeira compra do seu amigo for entregue, <strong>vocês dois</strong> ganham ${BONUS.toLocaleString("pt-BR")} pontos (${brl(BONUS / 100)}).</p>
      <div class="refer__link"><input readonly value="${esc(link)}" aria-label="Seu link de indicação" data-ref-link><button class="btn btn--primary" type="button" data-ref-copy>Copiar</button></div>
      <a class="btn btn--wa btn--block" href="https://wa.me/?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener"><svg class="ico" aria-hidden="true"><use href="#i-wa"/></svg> Enviar pelo WhatsApp</a>
      <p class="refer__stats">Seu código: <strong>${esc(ind.codigo)}</strong> · ${ind.indicados} ${ind.indicados === 1 ? "amigo indicado" : "amigos indicados"} · ${ind.premiados} com bônus</p>`;
  }

  const msg = (t) => { const m = $("[data-acct-msg]", body); if (m) m.textContent = t; };
  const ocupado = (form, on) => { const b = form.querySelector("[type=submit]"); if (b) { b.disabled = on; b.dataset.label ||= b.textContent; b.textContent = on ? "Aguarde…" : b.dataset.label; } };

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    ocupado(f, true);
    try {
      if (f.matches("[data-acct-senha]")) {
        emailDigitado = f.email.value.trim().toLowerCase();
        if (f.dataset.acctSenha === "criar") {
          const r = await api.criarConta(emailDigitado, f.senha.value);
          if (r.user) await entrar(r.user); else { etapa = "confirmar"; render(); }
        } else {
          await entrar(await api.entrarSenha(emailDigitado, f.senha.value));
        }
      } else if (f.matches("[data-acct-recuperar]")) {
        emailDigitado = f.email.value.trim().toLowerCase();
        await api.recuperar(emailDigitado);
        etapa = "recuperar-ok"; render();
      } else if (f.matches("[data-acct-nova]")) {
        await api.novaSenha(f.senha.value);
        etapa = "entrar"; render(); loja.toast?.("Senha alterada com sucesso!");
      } else if (f.matches("[data-acct-email]")) {
        emailDigitado = f.email.value.trim().toLowerCase();
        await api.enviarCodigo(emailDigitado);
        etapa = "codigo"; render();
        setTimeout(() => $("[name=code]", body)?.focus(), 30);
      } else if (f.matches("[data-acct-code]")) {
        const user = await api.verificar(emailDigitado, f.code.value.trim());
        await entrar(user);
      } else if (f.matches("[data-acct-perfil]")) {
        const p = { nome: f.nome.value.trim(), whatsapp: f.whatsapp.value.trim(), aceite_em: new Date().toISOString() };
        await api.salvarPerfil(conta.user.id, p);
        conta.perfil = { ...conta.perfil, ...p };
        await usarConvite();
        conta.perfil = { ...conta.perfil, ...p };
        render(); avisar();
      }
    } catch (err) {
      ocupado(f, false);
      msg(traduzErro(err.message));
    }
  });
  function traduzErro(m = "") {
    if (/invalid login credentials/i.test(m)) return "E-mail ou senha incorretos. Se você entrou antes pelo Google ou pelo link, use “Esqueci minha senha” para criar uma.";
    if (/already registered|already exists/i.test(m)) return "Este e-mail já tem conta. Entre com a sua senha, com o Google ou use “Esqueci minha senha”.";
    if (/password.*(at least|6)/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
    if (/weak|pwned|leaked/i.test(m)) return "Essa senha é fácil de adivinhar. Escolha outra.";
    if (/not confirmed/i.test(m)) return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
    if (/provider is not enabled|unsupported provider/i.test(m)) return "O login com Google ainda não foi ativado pela loja. Use e-mail e senha por enquanto.";
    if (/signups not allowed|signup is disabled/i.test(m)) return "Cadastro com senha desativado no momento.";
    if (/token|otp|expired/i.test(m)) return "Código inválido ou vencido. Confira ou peça um novo.";
    if (/rate|seconds|too many/i.test(m)) return "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.";
    if (/same.*password|different from the old/i.test(m)) return "A nova senha precisa ser diferente da anterior.";
    return "Algo deu errado: " + m;
  }
  body.addEventListener("click", async (e) => {
    if (e.target.closest("[data-acct-back]")) { etapa = "link"; render(); }
    const go = e.target.closest("[data-acct-go]");
    if (go) { const em = $("[name=email]", body)?.value; if (em) emailDigitado = em.trim().toLowerCase(); etapa = go.dataset.acctGo; render(); setTimeout(() => $("input", body)?.focus(), 30); }
    const tab = e.target.closest("[data-acct-tab]");
    if (tab) { const em = $("[name=email]", body)?.value; if (em) emailDigitado = em.trim().toLowerCase(); etapa = tab.dataset.acctTab; render(); setTimeout(() => $("[name=senha]", body)?.focus(), 30); }
    const eye = e.target.closest("[data-acct-eye]");
    if (eye) { const i = eye.previousElementSibling; i.type = i.type === "password" ? "text" : "password"; eye.setAttribute("aria-label", i.type === "password" ? "Mostrar senha" : "Esconder senha"); }
    if (e.target.closest("[data-acct-google]")) {
      const b = e.target.closest("[data-acct-google]");
      b.disabled = true;
      try { const u = await api.google(); if (u) await entrar(u); }
      catch (err) { b.disabled = false; const m = document.createElement("p"); m.className = "acct__msg"; m.setAttribute("role", "alert"); m.textContent = traduzErro(err.message); b.after(m); }
    }
    if (e.target.closest("[data-acct-logout]")) { await api.sair(); conta.user = null; conta.perfil = null; conta.saldo = 0; etapa = "entrar"; render(); avisar(); }
    if (e.target.closest("[data-acct-shop]")) { fechar(); loja.openCart(); }
    const rc = e.target.closest("[data-recomprar]");
    if (rc) {
      const p = ultimosPedidos.find((x) => String(x.id) === rc.dataset.recomprar);
      const n = loja.recomprar?.((p?.itens || []).filter((i) => i.id !== "embalagem")) || 0;
      if (n) { fechar(); setTimeout(() => loja.openCart(), 280); }
      else loja.toast?.("Essas peças não estão mais no catálogo.");
    }
    const cp = e.target.closest("[data-ref-copy]");
    if (cp) {
      const inp = $("[data-ref-link]", body);
      try { await navigator.clipboard.writeText(inp.value); } catch { inp.select(); document.execCommand("copy"); }
      cp.textContent = "Copiado!"; setTimeout(() => (cp.textContent = "Copiar"), 1800);
    }
  });

  async function entrar(user) {
    conta.user = user;
    conta.perfil = user ? await api.perfil(user.id).catch(() => null) : null;
    await usarConvite();
    conta.saldo = user && conta.perfil?.aceite_em ? await api.saldo().catch(() => 0) : 0;
    if (etapa !== "nova-senha") etapa = "entrar";
    if (el.classList.contains("is-open")) render();
    avisar();
  }

  const veioDeLink = /access_token|type=(magiclink|signup|recovery)|error_description/.test(location.hash) || /[?&]code=/.test(location.search);
  const recuperacao = /type=recovery/.test(location.hash);
  api.onAuth((u, ev) => {
    if (ev === "PASSWORD_RECOVERY") { etapa = "nova-senha"; conta.user = u; abrir(); return; }
    if ((u?.id || null) !== (conta.user?.id || null)) entrar(u);
  });
  await entrar(await api.sessao());
  // Voltando do Google, do link do e-mail ou da recuperação de senha: limpa a URL e mostra a conta
  if (veioDeLink) {
    const erro = decodeURIComponent((location.hash.match(/error_description=([^&]+)/) || [])[1] || "").replace(/\+/g, " ");
    history.replaceState(null, "", location.pathname);
    if (recuperacao && conta.user) etapa = "nova-senha";
    abrir();
    if (erro) setTimeout(() => { const m = document.createElement("p"); m.className = "acct__msg"; m.textContent = "Não foi possível entrar: " + erro; body.prepend(m); }, 80);
  }
}
