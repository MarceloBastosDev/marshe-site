/* Marshê Studio 3D · loja estática com pedido pelo WhatsApp */
(() => {
  "use strict";

  const CFG = window.MARSHE || {};
  const SCRIPT_BASE = document.currentScript ? document.currentScript.src : location.href;
  // Pontos Marshê (cashback): liga quando o Supabase está configurado (ou em modo demonstração)
  const PONTOS_ON = !!(CFG.supabaseUrl && CFG.supabaseAnonKey) || !!CFG.pontosDemo;
  const PCT_PONTOS = CFG.cashbackPct ?? 5;
  const pontosDe = (reais) => Math.floor(reais * PCT_PONTOS); // 1 ponto = R$ 0,01
  const conta = () => window.MarsheConta;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  // Por padrão as animações rodam sempre; veja respeitarMovimentoReduzido em js/config.js
  const reduceMotion = !!CFG.respeitarMovimentoReduzido && matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.toggle("reduz-movimento", reduceMotion);
  const canHover = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const brlShort = (v) => (Number.isInteger(v) ? "R$ " + v : brl(v));
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s = "") => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  let PRODUCTS = [];

  // Link de indicação (?indica=CODIGO): guarda o convite para usar quando a pessoa criar a conta
  const conviteNovo = (() => {
    const cod = new URLSearchParams(location.search).get("indica");
    if (!cod || !/^[A-Za-z0-9]{4,12}$/.test(cod)) return false;
    try { localStorage.setItem("marshe:indicacao", cod.toUpperCase()); } catch {}
    history.replaceState(null, "", location.pathname + location.hash);
    return true;
  })();
  const byId = (id) => PRODUCTS.find((p) => p.id === id);

  /* ---------- WhatsApp ---------- */
  const waUrl = (text) => {
    const num = String(CFG.whatsapp || "").replace(/\D/g, "");
    return (num ? `https://wa.me/${num}` : "https://wa.me/") + "?text=" + encodeURIComponent(text);
  };
  const openWa = (text) => window.open(waUrl(text), "_blank", "noopener");

  /* ---------- Imagens ---------- */
  const srcset = (src) => (/-960\.webp$/.test(src) ? `${src.replace(/-960\.webp$/, "-480.webp")} 480w, ${src} 960w` : "");
  const small = (src) => src.replace(/-960\.webp$/, "-480.webp");
  const imgTag = (src, alt, { cls = "", sizes = "(max-width: 600px) 50vw, 300px", eager = false } = {}) => {
    const ss = srcset(src);
    return `<img class="${cls}" src="${esc(ss ? small(src) : src)}" ${ss ? `srcset="${ss}" sizes="${sizes}"` : ""} width="480" height="600" alt="${esc(alt)}" ${eager ? "" : 'loading="lazy"'} decoding="async">`;
  };
  const placeholder = (label = "Foto em breve") => `<div class="ph" aria-hidden="true"><span class="ph__tag">${esc(label)}</span></div>`;

  /* ---------- Preços ---------- */
  const opts = (p) => p.variacoes?.opcoes || [];
  const minPrice = (p) => (opts(p).length ? Math.min(...opts(p).map((o) => o.preco ?? p.preco)) : p.preco);
  const hasRange = (p) => opts(p).length && new Set(opts(p).map((o) => o.preco ?? p.preco)).size > 1;
  // Oferta: no produtos.json, "precoDe" é o preço antigo (riscado). Ex.: "preco": 30, "precoDe": 39
  // Sob consulta: produto sem preço ("sobConsulta": true) → botão "Pedir orçamento" no WhatsApp
  const consulta = (p) => !!p.sobConsulta || !(minPrice(p) > 0);
  const precoTxt = (p) => (consulta(p) ? "Sob consulta" : brl(minPrice(p)));
  const isOffer = (p) => !consulta(p) && p.precoDe > minPrice(p);
  const offPct = (p) => Math.round((1 - minPrice(p) / p.precoDe) * 100);
  const priceHtml = (p) => consulta(p) ? "Sob consulta" : (hasRange(p) ? `<small>a partir de</small>` : "")
    + (isOffer(p) ? `<s class="price__old">${brlShort(p.precoDe)}</s> ` : "") + brlShort(minPrice(p));
  const needsChoice = (p) => consulta(p) || opts(p).length > 0 || !!p.personalizavel;

  const badgeHtml = (p) => {
    const selos = [...(isOffer(p) ? [`-${offPct(p)}% Black Marshê`] : []), ...(p.selos || [])];
    if (!selos.length) return "";
    const cls = (s) => (/black (friday|marsh)/i.test(s) ? "badge badge--bf" : /mais pedido/i.test(s) ? "badge badge--hot" : /novo/i.test(s) ? "badge badge--new" : "badge");
    return `<div class="badges">${selos.map((s) => `<span class="${cls(s)}">${esc(s)}</span>`).join("")}</div>`;
  };

  /* ==========================================================
     Catálogo: filtros laterais (categoria, preço, destaques),
     ordenação, busca e cards de loja
     ========================================================== */
  const grid = $("[data-grid]");
  const state = { cats: new Set(), prices: new Set(), flags: new Set(), q: "", sort: "destaque" };
  let favs = new Set(store.get("marshe:favs", []));
  const desconto = CFG.descontoPrimeiroPedido || 10;

  const CAT_ORDER = ["Kits", "Religiosos", "Estatuetas", "Personalizados", "Chaveiros", "Luminárias", "Decoração", "Lembrancinhas", "Utilitários", "Colecionáveis"];
  const faixa = (lo, hi) => (p) => !consulta(p) && minPrice(p) > lo && minPrice(p) <= hi;
  const PRICE_RANGES = [
    { id: "ate20", label: "Até R$ 20", test: faixa(0, 20) },
    { id: "21a40", label: "R$ 21 a R$ 40", test: faixa(20, 40) },
    { id: "41a100", label: "R$ 41 a R$ 100", test: faixa(40, 100) },
    { id: "100mais", label: "Acima de R$ 100", test: faixa(100, Infinity) },
    { id: "consulta", label: "Sob consulta", test: (p) => consulta(p) }
  ];
  const FLAGS = [
    { id: "ofertas", label: "Ofertas Black Marshê", test: isOffer },
    { id: "mais", label: "Mais pedidos", test: (p) => p.selos.some((s) => /mais pedido/i.test(s)) },
    { id: "novo", label: "Novidades", test: (p) => p.selos.some((s) => /novo/i.test(s)) },
    { id: "fav", label: "Meus favoritos", test: (p) => favs.has(p.id) }
  ];
  const allCats = () => [...new Set(PRODUCTS.flatMap((p) => p.categorias))]
    .sort((a, b) => (CAT_ORDER.indexOf(a) + 1 || 99) - (CAT_ORDER.indexOf(b) + 1 || 99));

  const matchQ = (p, q) => norm([p.nome, p.descricao, ...p.categorias, ...p.selos].join(" ")).includes(q);
  // Cada grupo é "ou" por dentro e "e" entre grupos; skip ignora um grupo (para as contagens)
  function matches(p, skip) {
    const q = norm(state.q.trim());
    if (q && !matchQ(p, q)) return false;
    if (skip !== "cats" && state.cats.size && !p.categorias.some((c) => state.cats.has(c))) return false;
    if (skip !== "prices" && state.prices.size && !PRICE_RANGES.some((r) => state.prices.has(r.id) && r.test(p))) return false;
    if (skip !== "flags" && state.flags.size && !FLAGS.some((f) => state.flags.has(f.id) && f.test(p))) return false;
    return true;
  }
  const SORTS = {
    destaque: (a, b) => (a.destaque ?? 99) - (b.destaque ?? 99),
    novidade: (a, b) => String(b.adicionado || "").localeCompare(String(a.adicionado || "")),
    menor: (a, b) => (consulta(a) ? Infinity : minPrice(a)) - (consulta(b) ? Infinity : minPrice(b)) || 0,
    maior: (a, b) => (consulta(b) ? -1 : minPrice(b)) - (consulta(a) ? -1 : minPrice(a))
  };
  const filtered = () => PRODUCTS.filter((p) => matches(p)).sort(SORTS[state.sort]);
  const activeCount = () => state.cats.size + state.prices.size + state.flags.size;

  const catalog = $("#catalogo");
  const goToCatalog = () => {
    const top = catalog.getBoundingClientRect().top;
    if (top > 140 || top < -catalog.offsetHeight + 300) catalog.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  };

  /* ---------- Barra de categorias do topo (atalho para os filtros) ---------- */
  function setCat(cat, { scroll = true } = {}) {
    // Atalhos (barra do topo, fita, rodapé) mostram só a categoria escolhida, sem filtros anteriores
    state.cats.clear(); state.prices.clear(); state.flags.clear();
    if (cat === "Ofertas") { if (PRODUCTS.some(isOffer)) state.flags.add("ofertas"); }
    else if (cat !== "Todos") state.cats.add(cat);
    update();
    if (scroll) goToCatalog();
  }
  function syncCatbar() {
    const onlyOffers = state.flags.has("ofertas") && !state.cats.size;
    $$("[data-catbar] [data-cat]").forEach((b) => {
      const c = b.dataset.cat;
      const on = c === "Ofertas" ? onlyOffers
        : c === "Todos" ? !state.cats.size && !state.flags.has("ofertas")
        : state.cats.size === 1 && state.cats.has(c);
      b.setAttribute("aria-pressed", on);
    });
  }
  function renderChips() {
    const offers = PRODUCTS.filter(isOffer).length;
    const chip = (cat, label, extra = "") => `<button type="button" class="chip${extra}" data-cat="${esc(cat)}" aria-pressed="false">${label}</button>`;
    const bar = $("[data-catbar]");
    bar.innerHTML = (offers ? chip("Ofertas", "Ofertas Black Marshê", " chip--bf") : "") + chip("Todos", "Todos")
      + allCats().map((c) => chip(c, esc(c))).join("")
      + `<span class="catbar__sep" aria-hidden="true"></span>
         <a class="catbar__link" href="#personalizados">Criar sob medida</a>
         <a class="catbar__link" href="#quantidade">Lembrancinhas</a>`;
    bar.addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b) setCat(b.dataset.cat); });
    syncCatbar();
    setupCatArrows(bar);
  }
  // Setas da barra de categorias: aparecem só quando há mais opções escondidas para aquele lado
  function setupCatArrows(bar) {
    const wrapEl = $("[data-catwrap]");
    if (!wrapEl || wrapEl.dataset.ready) return;
    wrapEl.dataset.ready = "1";
    const prev = $('[data-catscroll="-1"]', wrapEl), next = $('[data-catscroll="1"]', wrapEl);
    const sync = () => {
      const max = bar.scrollWidth - bar.clientWidth;
      const start = bar.scrollLeft > 4, end = bar.scrollLeft < max - 4;
      prev.hidden = !start; next.hidden = !end;
      wrapEl.classList.toggle("has-prev", start);
      wrapEl.classList.toggle("has-next", end);
    };
    $$("[data-catscroll]", wrapEl).forEach((b) => b.addEventListener("click", () => {
      bar.scrollBy({ left: Number(b.dataset.catscroll) * bar.clientWidth * 0.7, behavior: reduceMotion ? "auto" : "smooth" });
    }));
    bar.addEventListener("scroll", sync, { passive: true });
    addEventListener("resize", sync, { passive: true });
    if ("ResizeObserver" in window) new ResizeObserver(sync).observe(bar);
    sync();
  }
  // Rodapé: atalhos para destaques (Mais pedidos, Novidades) e para uma pergunta do FAQ
  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-flag-link]");
    if (f) { e.preventDefault(); state.cats.clear(); state.prices.clear(); state.flags.clear(); state.flags.add(f.dataset.flagLink); update(); goToCatalog(); return; }
    const q = e.target.closest("[data-faq]");
    if (q) {
      const d = $$("#duvidas details")[+q.dataset.faq];
      if (d) { e.preventDefault(); d.open = true; d.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" }); d.querySelector("summary").focus({ preventScroll: true }); }
    }
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-cat-link]");
    if (!a) return;
    e.preventDefault();
    setCat(a.dataset.catLink);
  });

  /* ---------- Filtros laterais ---------- */
  const fpanel = $("[data-filters]");
  function renderFilters() {
    const group = (key, title, items) => {
      const rows = items.map(({ id, label, n }) => `<label class="fopt${n ? "" : " is-off"}">
          <input type="checkbox" data-f="${key}" value="${esc(id)}" ${state[key].has(id) ? "checked" : ""} ${n || state[key].has(id) ? "" : "disabled"}>
          <span>${esc(label)}</span><span class="fopt__n">${n}</span></label>`).join("");
      return rows ? `<details class="fgroup" open><summary>${title}</summary><div class="fgroup__body">${rows}</div></details>` : "";
    };
    const count = (skip, test) => PRODUCTS.filter((p) => matches(p, skip) && test(p)).length;
    const flags = FLAGS.filter((f) => f.id !== "fav" || favs.size).filter((f) => f.id !== "ofertas" || PRODUCTS.some(isOffer))
      .map((f) => ({ id: f.id, label: f.label, n: count("flags", f.test) }))
      .filter((f) => PRODUCTS.some(FLAGS.find((x) => x.id === f.id).test));
    $("[data-fgroups]").innerHTML =
      group("flags", "Destaques", flags) +
      group("cats", "Categorias", allCats().map((c) => ({ id: c, label: c, n: count("cats", (p) => p.categorias.includes(c)) }))) +
      group("prices", "Preço", PRICE_RANGES.filter((r) => PRODUCTS.some((p) => r.test(p)))
        .map((r) => ({ id: r.id, label: r.label, n: count("prices", (p) => r.test(p)) })));
  }
  fpanel.addEventListener("change", (e) => {
    const cb = e.target.closest("[data-f]");
    if (!cb) return;
    const set = state[cb.dataset.f];
    cb.checked ? set.add(cb.value) : set.delete(cb.value);
    update();
  });

  /* ---------- Filtros ativos, contagem e lista ---------- */
  const labelOf = (key, id) => key === "cats" ? id : (key === "prices" ? PRICE_RANGES : FLAGS).find((x) => x.id === id)?.label || id;
  function renderActive(n) {
    const chips = [];
    ["flags", "cats", "prices"].forEach((key) => state[key].forEach((id) =>
      chips.push(`<button type="button" class="afilter" data-remove-f="${key}" data-v="${esc(id)}" aria-label="Remover filtro ${esc(labelOf(key, id))}">${esc(labelOf(key, id))}<svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button>`)));
    if (state.q.trim()) chips.push(`<button type="button" class="afilter" data-remove-q aria-label="Remover busca">“${esc(state.q.trim())}”<svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button>`);
    $("[data-active]").innerHTML = chips.length ? chips.join("") + `<button type="button" class="link-btn" data-clear>Limpar tudo</button>` : "";
    $("[data-info]").innerHTML = `<strong>${n}</strong> ${n === 1 ? "produto" : "produtos"}`;
    const a = activeCount();
    $$("[data-fcount]").forEach((el) => { el.textContent = a ? a : ""; el.hidden = !a; });
    $$("[data-fapply]").forEach((b) => (b.textContent = `Ver ${n} ${n === 1 ? "produto" : "produtos"}`));
  }
  document.addEventListener("click", (e) => {
    const r = e.target.closest("[data-remove-f]");
    if (r) { state[r.dataset.removeF].delete(r.dataset.v); update(); return; }
    if (e.target.closest("[data-remove-q]")) { state.q = ""; searchInput.value = ""; update(); return; }
    if (e.target.closest("[data-clear]")) { state.cats.clear(); state.prices.clear(); state.flags.clear(); state.q = ""; searchInput.value = ""; update(); }
  });

  function update() {
    shown = PAGE;
    renderGrid();
    renderFilters();
    syncCatbar();
  }

  /* ---------- Cards ---------- */
  const firstOrder = (v) => brl(Math.round(v * (100 - desconto)) / 100);
  function cardHtml(p, i) {
    const [f1, f2] = p.fotos || [];
    const media = f1 ? imgTag(f1, p.nome) + (f2 ? imgTag(f2, "", { cls: "alt" }) : "") : placeholder();
    const selo = p.selos.find((s) => /mais pedido|novo/i.test(s));
    const tag = isOffer(p) ? `<span class="card__tag card__tag--off">-${offPct(p)}%</span>`
      : selo ? `<span class="card__tag${/novo/i.test(selo) ? " card__tag--new" : ""}">${esc(selo)}</span>` : "";
    const fav = favs.has(p.id);
    const v = minPrice(p);
    return `<article class="card" style="--i:${i}" data-id="${esc(p.id)}">
      <div class="card__media">
        ${tag}
        <button type="button" class="card__fav" data-fav="${esc(p.id)}" aria-pressed="${fav}" aria-label="${fav ? "Remover dos" : "Adicionar aos"} favoritos: ${esc(p.nome)}"><svg aria-hidden="true"><use href="#i-heart"/></svg></button>
        ${media}
        ${isOffer(p) ? `<span class="card__band">Black Marshê</span>` : ""}
      </div>
      <div class="card__body">
        ${p.itensKit?.length ? `<span class="card__kit">Kit</span>` : ""}
        <h3 class="card__title"><a href="#produto/${esc(p.id)}">${esc(p.nome)}</a></h3>
        ${consulta(p) ? `<div class="card__prices"><span class="card__old card__old--empty" aria-hidden="true">&nbsp;</span><span class="card__price card__price--quote">Sob consulta</span><span class="card__first">Orçamento rápido no WhatsApp</span></div>
        <span class="card__qtd"><svg class="ico" aria-hidden="true"><use href="#i-gift"/></svg>Desconto em quantidade</span>
        <button type="button" class="card__buy" data-add="${esc(p.id)}" aria-label="Pedir orçamento: ${esc(p.nome)}">Pedir orçamento</button>` : `<div class="card__prices">
          ${isOffer(p) ? `<s class="card__old">${brl(p.precoDe)}</s>` : hasRange(p) ? `<span class="card__from">A partir de:</span>` : `<span class="card__old card__old--empty" aria-hidden="true">&nbsp;</span>`}
          <span class="card__price">${brl(v)}</span>
          <span class="card__first" title="${desconto}% de desconto no primeiro pedido">${firstOrder(v)} no 1º pedido</span>
        </div>
        <span class="card__qtd"><svg class="ico" aria-hidden="true"><use href="#i-gift"/></svg>Desconto em quantidade</span>
        <button type="button" class="card__buy" data-add="${esc(p.id)}" aria-label="Comprar ${esc(p.nome)}">Comprar</button>`}
      </div>
    </article>`;
  }

  // No celular a loja mostra 12 peças por vez, com "Ver mais" (a página fica bem mais curta)
  const PAGE = 12;
  const mqMobile = matchMedia("(max-width: 899px)");
  let shown = PAGE;
  const moreBox = document.createElement("div");
  moreBox.className = "more";
  moreBox.hidden = true;
  grid.after(moreBox);
  moreBox.addEventListener("click", (e) => {
    if (!e.target.closest("[data-more]")) return;
    const from = shown;
    shown += PAGE;
    renderGrid();
    grid.children[from]?.querySelector("a")?.focus({ preventScroll: true });
  });
  mqMobile.addEventListener("change", () => renderGrid());
  function renderGrid() {
    const all = filtered();
    const list = mqMobile.matches ? all.slice(0, shown) : all;
    grid.innerHTML = list.map(cardHtml).join("");
    const rest = all.length - list.length;
    moreBox.hidden = rest <= 0;
    moreBox.innerHTML = rest > 0 ? `<p class="more__count">Mostrando ${list.length} de ${all.length} peças</p><span class="more__bar" style="--p:${(list.length / all.length) * 100}%"></span><button type="button" class="btn btn--ghost more__btn" data-more>Ver mais ${Math.min(rest, PAGE)} ${Math.min(rest, PAGE) === 1 ? "peça" : "peças"}</button>` : "";
    $("[data-empty]").hidden = all.length > 0;
    renderActive(all.length);
    if (canHover && !reduceMotion) $$(".card", grid).forEach(tilt);
  }

  function tilt(card) {
    let raf = 0;
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { card.style.transform = `rotateY(${x * 5}deg) rotateX(${-y * 5}deg) translateY(-3px)`; });
    });
    card.addEventListener("pointerleave", () => { cancelAnimationFrame(raf); card.style.transform = ""; });
  }

  grid.addEventListener("click", (e) => {
    const fav = e.target.closest("[data-fav]");
    if (fav) {
      e.preventDefault();
      const id = fav.dataset.fav;
      favs.has(id) ? favs.delete(id) : favs.add(id);
      store.set("marshe:favs", [...favs]);
      const on = favs.has(id);
      fav.setAttribute("aria-pressed", on);
      fav.setAttribute("aria-label", `${on ? "Remover dos" : "Adicionar aos"} favoritos: ${byId(id).nome}`);
      fav.classList.remove("pop"); void fav.offsetWidth; fav.classList.add("pop");
      if (state.flags.has("fav") && !on) update(); else renderFilters();
      toast(on ? "Salvo nos seus favoritos" : "Removido dos favoritos");
      return;
    }
    const add = e.target.closest("[data-add]");
    if (!add) return;
    e.preventDefault();
    const p = byId(add.dataset.add);
    if (needsChoice(p)) return openProduct(p.id);
    addToCart({ id: p.id, qtd: 1 }, add.closest(".card").querySelector(".card__media img, .card__media .ph"));
    add.classList.remove("is-done"); void add.offsetWidth;
    add.classList.add("is-done");
    add.textContent = "Adicionado ✓";
    clearTimeout(add._t);
    add._t = setTimeout(() => { add.classList.remove("is-done"); add.textContent = "Comprar"; }, 1600);
  });

  /* ---------- Filtros no celular: gaveta ---------- */
  const fscrim = $("[data-fscrim]");
  let fLastFocus = null;
  const filtersOpen = () => fpanel.classList.contains("is-open");
  function openFilters() {
    fLastFocus = document.activeElement;
    fscrim.hidden = false;
    requestAnimationFrame(() => { fscrim.classList.add("is-on"); fpanel.classList.add("is-open"); });
    lockScroll(true);
    setTimeout(() => fpanel.querySelector("summary, input, button")?.focus(), 60);
  }
  function closeFilters() {
    if (!filtersOpen()) return;
    fpanel.classList.remove("is-open"); fscrim.classList.remove("is-on");
    setTimeout(() => (fscrim.hidden = true), 260);
    lockScroll(false);
    fLastFocus?.focus?.();
  }
  $$("[data-open-filters]").forEach((b) => b.addEventListener("click", openFilters));
  $$("[data-close-filters], [data-fapply]").forEach((b) => b.addEventListener("click", () => { closeFilters(); goToCatalog(); }));
  fscrim.addEventListener("click", closeFilters);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && filtersOpen()) closeFilters(); });

  /* ---------- Busca do cabeçalho ---------- */
  const searchInput = $("[data-search]");
  const results = $("[data-results]");
  const searchForm = $("[data-hsearch]");
  const showResults = (on) => { results.hidden = !on; searchInput.setAttribute("aria-expanded", on); };
  function renderResults() {
    const q = norm(state.q.trim());
    if (!q) return showResults(false);
    const list = PRODUCTS.filter((p) => matchQ(p, q)).sort(SORTS.destaque);
    results.innerHTML = list.length
      ? list.slice(0, 5).map((p) => `<a class="sr-item" href="#produto/${esc(p.id)}" role="option">
          <span class="sr-item__img">${p.fotos[0] ? imgTag(p.fotos[0], "", { sizes: "48px", eager: true }) : placeholder("")}</span>
          <span class="sr-item__txt"><strong>${esc(p.nome)}</strong><small>${esc(p.categorias[0])}</small></span>
          <span class="sr-item__price">${precoTxt(p)}</span></a>`).join("")
        + `<button type="submit" class="sr-all">Ver ${list.length === 1 ? "o resultado" : `os ${list.length} resultados`} na loja</button>`
      : `<p class="sr-empty">Nada encontrado para “${esc(state.q.trim())}”. <a href="#personalizados">Que tal uma peça personalizada?</a></p>`;
    showResults(true);
  }
  let searchT;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchT);
    searchT = setTimeout(() => { state.q = searchInput.value; update(); renderResults(); }, 100);
  });
  searchInput.addEventListener("focus", () => state.q.trim() && renderResults());
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    state.q = searchInput.value; update(); showResults(false); searchInput.blur(); goToCatalog();
  });
  results.addEventListener("click", (e) => { if (e.target.closest(".sr-item, .sr-empty a")) showResults(false); });
  document.addEventListener("click", (e) => { if (!searchForm.contains(e.target)) showResults(false); });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") showResults(false);
    if (e.key === "ArrowDown" && !results.hidden) { e.preventDefault(); results.querySelector("a, button")?.focus(); }
  });
  results.addEventListener("keydown", (e) => {
    const items = $$("a, button", results);
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); (i <= 0 ? searchInput : items[i - 1]).focus(); }
    if (e.key === "Escape") { showResults(false); searchInput.focus(); }
  });
  $("[data-sort]").addEventListener("change", (e) => { state.sort = e.target.value; renderGrid(); });

  /* ==========================================================
     Carrinho
     ========================================================== */
  let cart = store.get("marshe:cart", []);
  const drawer = $("#carrinho");
  const scrim = $("[data-scrim]");
  const keyOf = (it) => [it.id, it.variacao || "", it.custom || ""].join("|");
  const itemPrice = (it) => {
    const p = byId(it.id);
    const o = opts(p).find((o) => o.nome === it.variacao);
    return o?.preco ?? p.preco;
  };

  function addToCart(item, fromEl) {
    const k = keyOf(item);
    const found = cart.find((c) => keyOf(c) === k);
    if (found) found.qtd += item.qtd;
    else cart.push(item);
    saveCart();
    fly(fromEl);
    const p = byId(item.id);
    toast(`${p.nome} no carrinho`, "Ver carrinho", openCart);
  }

  function saveCart() {
    cart = cart.filter((c) => byId(c.id) && c.qtd > 0);
    store.set("marshe:cart", cart);
    renderCart();
  }

  function totals() {
    const sub = cart.reduce((s, it) => s + itemPrice(it) * it.qtd, 0);
    const first = $("[data-checkout] [name=primeiro]").checked;
    const disc = first ? Math.round(sub * (CFG.descontoPrimeiroPedido || 10)) / 100 : 0;
    // Pontos: só com conta logada, saldo e a opção marcada; nunca passa do valor restante
    const c = conta();
    const usar = !!(c?.user && c.saldo > 0 && $("[data-usar-pontos]")?.checked);
    const ptsUsados = usar ? Math.min(c.saldo, Math.round((sub - disc) * 100)) : 0;
    const ptsDesc = ptsUsados / 100;
    // Embalagem de presente: grátis a partir da meta (sobre o valor das peças)
    const presente = !!$("[data-presente]")?.checked;
    const giftGratis = sub >= GIFT_META;
    const gift = presente && !giftGratis ? GIFT_PRECO : 0;
    const total = Math.max(0, Math.round((sub - disc - ptsDesc + gift) * 100) / 100);
    return { sub, disc, ptsUsados, ptsDesc, presente, gift, giftGratis, total, ptsGanhos: pontosDe(total) };
  }
  const GIFT_PRECO = CFG.embalagemPreco ?? 5;
  const GIFT_META = CFG.embalagemGratisAcima ?? 100;

  // Barra de meta + embalagem de presente
  function renderGift(t) {
    const goal = $("[data-goal]");
    if (goal) {
      goal.hidden = !cart.length;
      const falta = Math.max(0, GIFT_META - t.sub);
      goal.classList.toggle("is-done", !falta);
      goal.style.setProperty("--g", Math.min(1, t.sub / GIFT_META).toFixed(3));
      goal.innerHTML = `<p><svg class="ico" aria-hidden="true"><use href="#i-gift"/></svg><span>${falta
        ? `Faltam <strong>${brl(falta)}</strong> para ganhar a <strong>embalagem de presente grátis</strong>.`
        : `<strong>Embalagem de presente grátis liberada!</strong> Marque abaixo, se for presente.`}</span></p>
        <div class="goal__bar" role="progressbar" aria-label="Meta da embalagem grátis" aria-valuemin="0" aria-valuemax="${GIFT_META}" aria-valuenow="${Math.min(GIFT_META, t.sub).toFixed(2)}"><div class="goal__fill"></div></div>`;
    }
    const preco = $("[data-presente-preco]");
    if (preco) { preco.textContent = t.giftGratis ? "grátis" : `+ ${brl(GIFT_PRECO)}`; preco.classList.toggle("gift__free", t.giftGratis); }
    const msg = $("[data-presente-msg]");
    if (msg) msg.hidden = !t.presente;
    const row = $("[data-gift-row]");
    if (row) { row.hidden = !t.presente; $("[data-gift-val]").textContent = t.gift ? brl(t.gift) : "Grátis"; }
  }

  // "Combine com" no carrinho: sugestões das peças que já estão nele
  function renderCombo() {
    const box = $("[data-combo]");
    if (!box) return;
    const noCarrinho = new Set(cart.map((it) => it.id));
    const ids = [...new Set(cart.flatMap((it) => byId(it.id)?.combina || []))].filter((id) => !noCarrinho.has(id));
    if (ids.length < 3) PRODUCTS.filter((p) => p.itensKit && !noCarrinho.has(p.id) && !ids.includes(p.id)).forEach((p) => ids.push(p.id));
    const sug = ids.map(byId).filter(Boolean).slice(0, 3);
    box.hidden = !cart.length || !sug.length;
    if (box.hidden) return;
    box.innerHTML = `<p class="combo__title">Combine com</p><div class="combo__list">${sug.map((p) => `
      <div class="combo__item">
        <div class="combo__img">${p.fotos[0] ? imgTag(p.fotos[0], "", { sizes: "52px" }) : placeholder("")}</div>
        <div><p class="combo__name">${esc(p.nome)}</p><span class="combo__price">${isOffer(p) ? `<s>${brl(p.precoDe)}</s> ` : ""}${precoTxt(p)}</span></div>
        <button type="button" class="combo__add" data-combo-add="${esc(p.id)}">${needsChoice(p) ? "Ver" : "+ Adicionar"}</button>
      </div>`).join("")}</div>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-combo-add]");
    if (!b) return;
    const p = byId(b.dataset.comboAdd);
    if (needsChoice(p)) { closeCart(); return openProduct(p.id); }
    addToCart({ id: p.id, qtd: 1 }, b.closest(".combo__item").querySelector("img, .ph"));
  });

  // Bloco dos pontos no carrinho
  function renderPontos(t) {
    const box = $("[data-pontos]");
    if (!box) return;
    const c = conta();
    box.hidden = !PONTOS_ON || !c;
    if (box.hidden) return;
    const marcado = $("[data-usar-pontos]")?.checked ?? true;
    if (!c.user || !c.perfil?.aceite_em) {
      box.innerHTML = `<p><svg class="ico" aria-hidden="true"><use href="#i-gift"/></svg><span>Entre na sua conta e ganhe <strong>${t.ptsGanhos.toLocaleString("pt-BR")} pontos</strong> (${brl(t.ptsGanhos / 100)}) com esta compra.</span></p>
        <button type="button" class="link-btn" data-account>Entrar ou criar conta</button>`;
      return;
    }
    box.innerHTML = `<p><svg class="ico" aria-hidden="true"><use href="#i-gift"/></svg><span>Você ganha <strong>${t.ptsGanhos.toLocaleString("pt-BR")} pontos</strong> (${brl(t.ptsGanhos / 100)}) quando o pedido for entregue.</span></p>
      ${c.saldo > 0 ? `<label class="check check--pts"><input type="checkbox" data-usar-pontos ${marcado ? "checked" : ""}> <span>Usar meus pontos: <strong>${c.saldo.toLocaleString("pt-BR")}</strong> disponíveis (até ${brl(c.saldo / 100)})</span></label>` : ""}`;
  }

  function renderCart() {
    if (!PRODUCTS.length) return; // a conta pode avisar antes de o catálogo carregar
    const count = cart.reduce((s, it) => s + it.qtd, 0);
    const badge = $("[data-cart-count]");
    if (count > (renderCart.last ?? count)) { badge.classList.remove("pop"); void badge.offsetWidth; badge.classList.add("pop"); }
    renderCart.last = count;
    badge.textContent = count;
    badge.hidden = !count;
    $("[data-open-cart]").setAttribute("aria-label", `Abrir carrinho (${count} ${count === 1 ? "item" : "itens"})`);

    const empty = !cart.length;
    $("[data-cart-empty]").hidden = !empty;
    $("[data-checkout]").hidden = empty;
    $("[data-cart-foot]").hidden = empty;

    $("[data-cart-list]").innerHTML = cart.map((it) => {
      const p = byId(it.id);
      const extra = [it.variacao, it.custom && `“${it.custom}”`].filter(Boolean).join(" · ");
      return `<li class="cart-item" data-key="${esc(keyOf(it))}">
        <div class="cart-item__img">${p.fotos?.[0] ? imgTag(p.fotos[0], "", { sizes: "72px" }) : placeholder("")}</div>
        <div>
          <p class="cart-item__name">${esc(p.nome)}</p>
          ${extra ? `<p class="cart-item__var">${esc(extra)}</p>` : `<p class="cart-item__var">${brl(itemPrice(it))} cada</p>`}
          <div class="qty" role="group" aria-label="Quantidade de ${esc(p.nome)}">
            <button type="button" data-q="-1" aria-label="Diminuir"><svg class="ico" aria-hidden="true"><use href="#i-minus"/></svg></button>
            <input type="number" inputmode="numeric" min="1" max="999" value="${it.qtd}" aria-label="Quantidade" data-qinput>
            <button type="button" data-q="1" aria-label="Aumentar"><svg class="ico" aria-hidden="true"><use href="#i-plus"/></svg></button>
          </div>
        </div>
        <div class="cart-item__side">
          <button type="button" class="remove" data-remove aria-label="Remover ${esc(p.nome)}"><svg class="ico" aria-hidden="true"><use href="#i-trash"/></svg></button>
          <span class="cart-item__price">${brl(itemPrice(it) * it.qtd)}</span>
        </div>
      </li>`;
    }).join("");

    let t = totals();
    renderPontos(t);
    t = totals(); // a caixa de pontos pode ter acabado de aparecer
    renderGift(t);
    renderCombo();
    $("[data-subtotal]").textContent = brl(t.sub);
    $("[data-disc]").textContent = "− " + brl(t.disc);
    $("[data-disc-row]").hidden = !t.disc;
    const ptsRow = $("[data-pts-row]");
    if (ptsRow) { ptsRow.hidden = !t.ptsUsados; $("[data-pts-disc]").textContent = "− " + brl(t.ptsDesc); }
    $("[data-total]").textContent = brl(t.total);
  }
  document.addEventListener("change", (e) => { if (e.target.matches("[data-usar-pontos]")) renderCart(); });
  document.addEventListener("conta:mudou", () => { renderCart(); syncConta(); });

  // Botão "Entrar / Meus pontos" no cabeçalho
  function syncConta() {
    const b = $("[data-account]");
    if (!b) return;
    const c = conta();
    b.hidden = !PONTOS_ON || !c;
    if (b.hidden) return;
    const logado = c.user && c.perfil?.aceite_em;
    b.querySelector("[data-account-label]").textContent = logado ? `${c.saldo.toLocaleString("pt-BR")} pts` : "Entrar";
    b.setAttribute("aria-label", logado ? `Minha conta: ${c.saldo} pontos` : "Entrar no Pontos Marshê");
  }

  $("[data-cart-list]").addEventListener("click", (e) => {
    const li = e.target.closest(".cart-item");
    if (!li) return;
    const it = cart.find((c) => keyOf(c) === li.dataset.key);
    const q = e.target.closest("[data-q]");
    if (q) {
      it.qtd = Math.max(1, it.qtd + Number(q.dataset.q));
      saveCart();
      $(`.cart-item[data-key="${CSS.escape(li.dataset.key)}"] [data-qinput]`)?.focus();
    }
    if (e.target.closest("[data-remove]")) {
      li.classList.add("is-leaving");
      setTimeout(() => { cart = cart.filter((c) => c !== it); saveCart(); }, reduceMotion ? 0 : 200);
    }
  });
  $("[data-cart-list]").addEventListener("change", (e) => {
    if (!e.target.matches("[data-qinput]")) return;
    const li = e.target.closest(".cart-item");
    const it = cart.find((c) => keyOf(c) === li.dataset.key);
    it.qtd = Math.min(999, Math.max(1, parseInt(e.target.value, 10) || 1));
    saveCart();
  });

  // Dados do cliente salvos
  const checkout = $("[data-checkout]");
  const cliente = store.get("marshe:cliente", {});
  ["nome", "cidade"].forEach((n) => { if (cliente[n]) checkout.elements[n].value = cliente[n]; });
  if (cliente.entrega) $$(`[name=entrega]`, checkout).forEach((r) => (r.checked = r.value === cliente.entrega));
  if (cliente.primeiro !== undefined) checkout.elements.primeiro.checked = cliente.primeiro;
  checkout.addEventListener("input", () => {
    store.set("marshe:cliente", {
      nome: checkout.elements.nome.value, cidade: checkout.elements.cidade.value,
      entrega: checkout.elements.entrega.value, primeiro: checkout.elements.primeiro.checked
    });
    renderCart();
  });
  checkout.addEventListener("submit", (e) => e.preventDefault());

  $("[data-finish]").addEventListener("click", () => {
    const f = checkout.elements;
    const missing = ["nome", "cidade"].filter((n) => !f[n].value.trim());
    if (missing.length) {
      missing.forEach((n) => { f[n].classList.remove("is-invalid"); void f[n].offsetWidth; f[n].classList.add("is-invalid"); });
      f[missing[0]].focus();
      f[missing[0]].scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      toast("Falta só o seu nome e a cidade 😉");
      return;
    }
    const t = totals();
    const lines = cart.map((it) => {
      const p = byId(it.id);
      const extra = [it.variacao, it.custom && `"${it.custom}"`].filter(Boolean).join(", ");
      return `• ${it.qtd}x ${p.nome}${extra ? ` (${extra})` : ""} : ${brl(itemPrice(it) * it.qtd)}`;
    });
    const montar = (pedidoId) => [
      pedidoId ? `Olá, Marshê! Quero fazer o pedido *M${pedidoId}*:` : "Olá, Marshê! Quero fazer este pedido:",
      "",
      ...lines,
      "",
      `Subtotal: ${brl(t.sub)}`,
      ...(t.disc ? [`Desconto 1º pedido (${CFG.descontoPrimeiroPedido || 10}%): − ${brl(t.disc)}`] : []),
      ...(t.presente ? [`Embalagem de presente: ${t.gift ? brl(t.gift) : "grátis"}`] : []),
      ...(t.ptsUsados ? [`Pontos Marshê (${t.ptsUsados.toLocaleString("pt-BR")} pontos): − ${brl(t.ptsDesc)}${pedidoId ? "" : " (a loja confirma o saldo)"}`] : []),
      `*Total: ${brl(t.total)}*`,
      "",
      `Nome: ${f.nome.value.trim()}`,
      `Cidade: ${f.cidade.value.trim()}`,
      `Recebimento: ${f.entrega.value}`,
      ...(t.presente && f.mensagem.value.trim() ? ["", `Mensagem do cartão: "${f.mensagem.value.trim()}"`] : []),
      ...(pedidoId ? ["", `Conta Pontos Marshê: ${conta().user.email}`] : [])
    ].join("\n");

    const c = conta();
    if (!(c?.user && c.perfil?.aceite_em)) return openWa(montar(null));

    // Com conta: registra o pedido (para os pontos) e abre o WhatsApp com o número dele.
    // A janela abre já no clique, para o navegador não bloquear.
    const win = window.open("", "_blank");
    const btn = $("[data-finish]");
    btn.disabled = true;
    c.criarPedido({
      itens: [...cart.map((it) => ({ id: it.id, nome: byId(it.id).nome, variacao: it.variacao || null, custom: it.custom || null, qtd: it.qtd, preco: itemPrice(it) })),
        ...(t.presente ? [{ id: "embalagem", nome: "Embalagem de presente", custom: f.mensagem.value.trim() || null, qtd: 1, preco: t.gift }] : [])],
      subtotal: t.sub, desconto: t.disc, pontos_usados: t.ptsUsados, total: t.total,
      nome: f.nome.value.trim(), cidade: f.cidade.value.trim(), recebimento: f.entrega.value
    })
      .then((id) => {
        const texto = montar(id);
        // pedido registrado: esvazia o carrinho para não duplicar e avisa onde acompanhar
        cart = []; saveCart(); closeCart();
        setTimeout(() => toast(`Pedido M${id} enviado! Acompanhe em Minha conta.`, "Ver pedido", () => conta()?.abrir()), 400);
        return texto;
      })
      .catch((err) => { console.warn("Pedido não registrado:", err); toast("Não deu para registrar os pontos agora; o pedido segue pelo WhatsApp."); return montar(null); })
      .then((texto) => { if (win) win.location.href = waUrl(texto); else openWa(texto); })
      .finally(() => (btn.disabled = false));
  });

  /* ---------- Gaveta ---------- */
  let lastFocus = null;
  function lockScroll(on) { document.body.classList.toggle("lock", on); }
  function openCart() {
    closeProduct(true);
    toastEl.classList.remove("is-on");
    lastFocus = document.activeElement;
    scrim.hidden = false;
    requestAnimationFrame(() => { scrim.classList.add("is-on"); drawer.classList.add("is-open"); });
    drawer.setAttribute("aria-hidden", "false");
    lockScroll(true);
    setTimeout(() => drawer.focus(), 50);
  }
  function closeCart() {
    if (!drawer.classList.contains("is-open")) return;
    drawer.classList.remove("is-open");
    scrim.classList.remove("is-on");
    drawer.setAttribute("aria-hidden", "true");
    setTimeout(() => (scrim.hidden = true), 260);
    lockScroll(false);
    lastFocus?.focus?.();
  }
  $$("[data-open-cart]").forEach((b) => b.addEventListener("click", openCart));
  drawer.addEventListener("click", (e) => {
    const c = e.target.closest("[data-close]");
    if (!c) return;
    closeCart();
    if (c.dataset.goto) $(c.dataset.goto)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  });
  scrim.addEventListener("click", closeCart);

  /* ---------- Voo até o carrinho ---------- */
  function fly(fromEl) {
    const btn = $("[data-open-cart]");
    const bump = () => { btn.classList.remove("bump"); void btn.offsetWidth; btn.classList.add("bump"); };
    if (!fromEl || reduceMotion) return bump();
    const a = fromEl.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "fly";
    const size = Math.min(a.width, 160);
    Object.assign(el.style, { width: size + "px", height: size * 1.25 + "px", left: a.left + (a.width - size) / 2 + "px", top: a.top + (a.height - size * 1.25) / 2 + "px" });
    if (fromEl.tagName === "IMG") el.innerHTML = `<img src="${fromEl.currentSrc || fromEl.src}" alt="">`;
    document.body.appendChild(el);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const dist = Math.hypot(dx, dy);
    const mobile = innerWidth < 900 ? 0.8 : 1;
    const duration = Math.round(Math.min(720, Math.max(480, 380 + dist * 0.35)) * mobile);
    const lift = Math.min(110, 40 + dist * 0.12);
    el.animate(
      [
        { transform: "translate(0,0) scale(1) rotate(0)", opacity: 1, easing: "cubic-bezier(.2,0,0,1)" },
        { transform: "translate(0,-6px) scale(1.06) rotate(0)", opacity: 1, offset: 0.12, easing: "cubic-bezier(.2,0,0,1)" }, // antecipação
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(.6) rotate(-6deg)`, opacity: 1, offset: 0.5, easing: "cubic-bezier(.3,0,1,1)" }, // arco
        { transform: `translate(${dx}px, ${dy}px) scale(.14) rotate(0)`, opacity: 0.5 }
      ],
      { duration, easing: "linear" }
    ).finished.then(() => { el.remove(); bump(); });
  }

  /* ---------- Toast ---------- */
  const toastEl = $("[data-toast]");
  let toastT;
  function toast(text, action, fn) {
    toastEl.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action)}</button>` : ""}`;
    if (action) toastEl.querySelector("button").onclick = () => { toastEl.classList.remove("is-on"); fn(); };
    toastEl.classList.add("is-on");
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove("is-on"), 3600);
  }

  /* ==========================================================
     Modal de produto  (#produto/id)
     ========================================================== */
  const modal = $("[data-modal]");
  const panel = $("[data-modal-panel]");
  let modalOpen = false, pushed = false, modalFocus = null;

  function openProduct(id) {
    if (location.hash !== `#produto/${id}`) { pushed = true; location.hash = `produto/${id}`; }
    else showProduct(id);
  }

  function showProduct(id) {
    const p = byId(id);
    if (!p) return;
    if (!modalOpen) modalFocus = document.activeElement;
    const fotos = p.fotos || [];
    const o = opts(p);
    const prazo = p.prazo || CFG.prazoPadrao;
    // "Combine com" primeiro (campo "combina" do produtos.json), depois peças da mesma categoria
    const combina = (p.combina || []).map(byId).filter(Boolean);
    const related = [...combina, ...PRODUCTS.filter((x) => x.id !== p.id && !combina.includes(x))
      .map((x) => ({ x, score: x.categorias.filter((c) => p.categorias.includes(c)).length * 10 - (x.destaque ?? 50) / 10 }))
      .sort((a, b) => b.score - a.score).map((r) => r.x)].slice(0, 4);
    const kitItens = (p.itensKit || []).map(byId).filter(Boolean);

    panel.innerHTML = `
      <button class="icon-btn modal__close" type="button" data-mclose aria-label="Fechar"><svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button>
      <div class="pm">
        <div class="pm__left"><div class="pm__gallery">
          <div class="pm__main" data-zoom>${fotos[0] ? `<img src="${esc(fotos[0])}" alt="${esc(p.nome)}" width="960" height="1200">` + `<span class="pm__zoomhint">${canHover ? "Clique para ampliar" : "Toque para ampliar"}</span>` : placeholder()}</div>
          ${fotos.length > 1 ? `<div class="pm__thumbs">${fotos.map((f, i) => `<button type="button" data-thumb="${esc(f)}" aria-label="Foto ${i + 1}" aria-current="${i === 0}">${imgTag(f, "", { sizes: "64px" })}</button>`).join("")}</div>` : ""}
        </div></div>
        <div class="pm__right">
          <form class="pm__info" data-pform>
            ${badgeHtml(p)}
            <p class="pm__cat">${esc(p.categorias.join(" · "))}</p>
            <h2 class="pm__title" id="pm-title">${esc(p.nome)}</h2>
            <p class="pm__price" data-pprice>${priceHtml(p)}</p>
            <p class="pm__desc">${esc(p.descricao)}</p>
            ${kitItens.length ? `<div class="pm__kit"><strong>Este kit tem ${kitItens.length} peças:</strong><ul>${kitItens.map((x) => `<li>${esc(x.nome)} <s>${brl(minPrice(x))}</s></li>`).join("")}</ul></div>` : ""}
            ${o.length ? `<fieldset class="pm__opt"><legend>${esc(p.variacoes.nome || "Opção")}</legend><div class="pills">
              ${o.map((op, i) => `<label><input type="radio" name="var" value="${esc(op.nome)}" ${i === 0 ? "checked" : ""}><span>${esc(op.nome)}${hasRange(p) ? ` <small>${brlShort(op.preco ?? p.preco)}</small>` : ""}</span></label>`).join("")}
            </div></fieldset>` : ""}
            ${p.personalizavel ? `<label class="pm__custom">${esc(p.personalizavel)}<input name="custom" type="text" maxlength="60" placeholder="Ex.: Maria Clara"></label>` : ""}
            <div class="pm__qtyrow"><span id="pm-qty">Quantidade</span>
              <div class="qty qty--lg" role="group" aria-labelledby="pm-qty">
                <button type="button" data-pq="-1" aria-label="Diminuir"><svg class="ico" aria-hidden="true"><use href="#i-minus"/></svg></button>
                <input type="number" name="qtd" inputmode="numeric" min="1" max="999" value="1" aria-label="Quantidade">
                <button type="button" data-pq="1" aria-label="Aumentar"><svg class="ico" aria-hidden="true"><use href="#i-plus"/></svg></button>
              </div>
            </div>
            <p class="pm__meta"><svg class="ico" aria-hidden="true"><use href="#i-clock"/></svg><span><strong>Prazo de produção:</strong> ${esc(prazo)}</span></p>
            <p class="pm__meta pm__meta--qtd"><svg class="ico" aria-hidden="true"><use href="#i-gift"/></svg><span><strong>Vai precisar de mais unidades?</strong> Para quantidades maiores fazemos um valor especial. <button type="button" class="link-btn" data-pqtd>Consultar valor para quantidade</button></span></p>
            ${PONTOS_ON && !consulta(p) ? `<p class="pm__meta pm__meta--pts"><svg class="ico" aria-hidden="true"><use href="#i-gift"/></svg><span>Ganhe <strong data-pm-pts>${pontosDe(minPrice(p)).toLocaleString("pt-BR")} pontos</strong> no <a href="#pontos" data-mclose>Pontos Marshê</a> (${PCT_PONTOS}% de volta)</span></p>` : ""}
          </form>
          ${consulta(p) ? `<div class="pm__buy">
            <div class="pm__buy-total"><small>Valor</small><strong>Sob consulta</strong></div>
            <button class="btn btn--wa btn--lg" type="button" data-pquote><svg class="ico" aria-hidden="true"><use href="#i-wa"/></svg> Pedir orçamento</button>
          </div>` : `<div class="pm__buy">
            <div class="pm__buy-total"><small>Total</small><strong data-ptotal></strong></div>
            <button class="btn btn--primary btn--lg" type="button" data-padd><svg class="ico" aria-hidden="true"><use href="#i-cart"/></svg> Adicionar ao carrinho</button>
          </div>`}
        </div>
        ${related.length ? `<div class="pm__related"><h3>${combina.length ? "Combine com" : "Você também pode gostar"}</h3><div class="mini-grid">
          ${related.map((r) => `<a class="mini" href="#produto/${esc(r.id)}" data-related><div class="mini__img">${r.fotos?.[0] ? imgTag(r.fotos[0], "", { sizes: "(max-width: 600px) 44vw, 220px" }) : placeholder("")}</div><div class="mini__name">${esc(r.nome)}</div><div class="mini__price">${priceHtml(r).replace(/<small>.*?<\/small>/, "a partir de ")}</div></a>`).join("")}
        </div></div>` : ""}
      </div>`;

    const form = $("[data-pform]", panel);
    const qtyInput = form.elements.qtd;
    const current = () => {
      const v = form.elements.var?.value;
      const op = o.find((x) => x.nome === v);
      return { v, price: op?.preco ?? p.preco, q: Math.min(999, Math.max(1, parseInt(qtyInput.value, 10) || 1)) };
    };
    const update = () => {
      const c = current();
      const tot = $("[data-ptotal]", panel);
      if (tot) tot.textContent = brl(c.price * c.q);
      const pmPts = $("[data-pm-pts]", panel);
      if (pmPts) pmPts.textContent = `${pontosDe(c.price * c.q).toLocaleString("pt-BR")} pontos`;
      if (!consulta(p) && o.length && hasRange(p)) $("[data-pprice]", panel).textContent = brlShort(c.price);
    };
    form.addEventListener("change", update);
    form.addEventListener("input", update);
    form.addEventListener("submit", (e) => e.preventDefault());
    $$("[data-pq]", panel).forEach((b) => b.addEventListener("click", () => {
      qtyInput.value = Math.max(1, current().q + Number(b.dataset.pq));
      update();
    }));
    update();

    // Valor especial para quantidade: abre o WhatsApp com a peça, a opção e a quantidade
    $("[data-pqtd]", panel)?.addEventListener("click", () => {
      const c = current();
      const custom = form.elements.custom?.value.trim() || "";
      openWa([`Olá, Marshê! Quero um orçamento para *quantidade maior* de: *${p.nome}*`, c.v ? `${p.variacoes?.nome || "Opção"}: ${c.v}` : null, custom ? `Personalização: ${custom}` : null, `Quantidade: ${c.q > 1 ? c.q : "(informar)"} unidades`, "", "Qual o valor por unidade nessa quantidade?"].filter((x) => x !== null).join("\n"));
    });
    $("[data-pquote]", panel)?.addEventListener("click", () => {
      const c = current();
      const custom = form.elements.custom?.value.trim() || "";
      openWa([`Olá, Marshê! Quero um orçamento de: *${p.nome}*`, c.v ? `${p.variacoes?.nome || "Opção"}: ${c.v}` : null, custom ? `Personalização: ${custom}` : null, `Quantidade: ${c.q}`, "", "Pode me passar valor e prazo?"].filter((x) => x !== null).join("\n"));
    });
    $("[data-padd]", panel)?.addEventListener("click", () => {
      const c = current();
      const custom = form.elements.custom?.value.trim() || "";
      const img = $(".pm__main img, .pm__main .ph", panel);
      addToCart({ id: p.id, variacao: c.v || "", custom, qtd: c.q }, img);
      setTimeout(() => { closeProduct(); setTimeout(openCart, reduceMotion ? 0 : 180); }, reduceMotion ? 0 : 560);
    });

    // Galeria + zoom
    const main = $("[data-zoom]", panel);
    const mainImg = $("img", main);
    $$("[data-thumb]", panel).forEach((b) => b.addEventListener("click", () => {
      $$("[data-thumb]", panel).forEach((x) => x.setAttribute("aria-current", x === b));
      mainImg.classList.add("is-swapping");
      setTimeout(() => { mainImg.src = b.dataset.thumb; mainImg.decode?.().catch(() => {}).finally(() => mainImg.classList.remove("is-swapping")); }, reduceMotion ? 0 : 150);
    }));
    if (mainImg) {
      const setOrigin = (e) => {
        const r = main.getBoundingClientRect();
        main.style.setProperty("--zx", ((e.clientX - r.left) / r.width) * 100 + "%");
        main.style.setProperty("--zy", ((e.clientY - r.top) / r.height) * 100 + "%");
      };
      // Zoom só com clique (ou toque): um clique aproxima no ponto clicado, outro clique volta.
      // Com o zoom ligado, no computador a foto acompanha o mouse para explorar os detalhes.
      const hint = $(".pm__zoomhint", main);
      const setZoom = (on) => {
        main.classList.toggle("is-zoom", on);
        if (hint) hint.textContent = on ? (canHover ? "Clique para afastar" : "Toque para afastar") : (canHover ? "Clique para ampliar" : "Toque para ampliar");
      };
      main.addEventListener("click", (e) => { setOrigin(e); setZoom(!main.classList.contains("is-zoom")); });
      if (canHover) main.addEventListener("pointermove", (e) => { if (main.classList.contains("is-zoom")) setOrigin(e); });
      main.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") setZoom(false); });
      $$("[data-thumb]", panel).forEach((b) => b.addEventListener("click", () => setZoom(false)));
      // swipe entre fotos no celular
      if (fotos.length > 1) {
        let sx = null;
        main.addEventListener("touchstart", (e) => (sx = e.touches[0].clientX), { passive: true });
        main.addEventListener("touchend", (e) => {
          if (sx === null || main.classList.contains("is-zoom")) return;
          const dx = e.changedTouches[0].clientX - sx;
          sx = null;
          if (Math.abs(dx) < 40) return;
          const thumbs = $$("[data-thumb]", panel);
          const i = thumbs.findIndex((t) => t.getAttribute("aria-current") === "true");
          thumbs[(i + (dx < 0 ? 1 : -1) + thumbs.length) % thumbs.length].click();
        });
      }
    }

    panel.scrollTop = 0;
    if (!modalOpen) {
      modalOpen = true;
      modal.hidden = false;
      lockScroll(true);
      requestAnimationFrame(() => modal.classList.add("is-open"));
    }
    setTimeout(() => panel.focus({ preventScroll: true }), 30);
    document.title = `${p.nome} · Marshê Studio 3D`;
    // guarda nos "vistos recentemente" (no aparelho do cliente)
    vistos = [p.id, ...vistos.filter((x) => x !== p.id)].slice(0, 8);
    store.set("marshe:vistos", vistos);
  }

  let vistos = store.get("marshe:vistos", []);
  function renderRecent() {
    const box = $("[data-recent]");
    if (!box) return;
    const lista = vistos.map(byId).filter(Boolean).slice(0, 6);
    box.hidden = !lista.length;
    $("[data-recent-list]").innerHTML = lista.map((r) => `<a class="mini" href="#produto/${esc(r.id)}"><div class="mini__img">${r.fotos?.[0] ? imgTag(r.fotos[0], "", { sizes: "(max-width: 600px) 40vw, 180px" }) : placeholder("")}</div><div class="mini__name">${esc(r.nome)}</div><div class="mini__price">${precoTxt(r)}</div></a>`).join("");
  }

  function hideModal() {
    renderRecent();
    if (!modalOpen) return;
    modalOpen = false;
    modal.classList.remove("is-open");
    setTimeout(() => { if (!modalOpen) { modal.hidden = true; panel.innerHTML = ""; } }, 260);
    if (!drawer.classList.contains("is-open")) lockScroll(false);
    document.title = TITLE;
    modalFocus?.focus?.({ preventScroll: true });
  }

  function closeProduct(silent) {
    if (!modalOpen) return;
    if (location.hash.startsWith("#produto/")) {
      if (pushed) { pushed = false; history.back(); }
      else history.replaceState(null, "", location.pathname + location.search);
    }
    hideModal();
    if (silent) return;
  }

  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest("[data-mclose]")) closeProduct();
  });
  panel.addEventListener("click", (e) => {
    const rel = e.target.closest("[data-related]");
    if (rel) { e.preventDefault(); history.replaceState(null, "", rel.getAttribute("href")); showProduct(rel.getAttribute("href").split("/")[1]); }
  });

  function route() {
    const m = location.hash.match(/^#produto\/([\w-]+)/);
    if (m && byId(m[1])) showProduct(m[1]);
    else if (modalOpen) { pushed = false; hideModal(); }
  }
  addEventListener("hashchange", route);

  // Teclado: Esc fecha, Tab fica dentro da camada aberta
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (modalOpen) closeProduct(); else closeCart(); }
    if (e.key !== "Tab") return;
    const layer = modalOpen ? panel : drawer.classList.contains("is-open") ? drawer : null;
    if (!layer) return;
    const f = $$('a[href], button:not([disabled]), input:not([type=hidden]), select, textarea', layer).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && (document.activeElement === f[0] || document.activeElement === layer)) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
  });

  /* ==========================================================
     Formulários e links de WhatsApp
     ========================================================== */
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-wa]");
    if (!a) return;
    e.preventDefault();
    openWa(a.dataset.wa);
  });

  function validate(form) {
    const bad = $$("[required]", form).filter((el) => !String(el.value).trim());
    bad.forEach((el) => { el.classList.remove("is-invalid"); void el.offsetWidth; el.classList.add("is-invalid"); });
    if (bad.length) bad[0].focus();
    return !bad.length;
  }
  $$("[data-form]").forEach((form) => {
    form.addEventListener("input", (e) => e.target.classList.remove("is-invalid"));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!validate(form)) return;
      const v = (n) => form.elements[n]?.value.trim();
      const msg = form.dataset.form === "novidades"
        ? ["Olá, Marshê! Quero receber as ofertas e novidades aqui no WhatsApp.", `Meu nome: ${v("nome")}`]
        : form.dataset.form === "quantidade"
        ? ["Olá, Marshê! Quero um orçamento de pedido em quantidade:", "", `Ocasião: ${v("ocasiao")}`, `Quantidade: ${v("quantidade")} unidades`, v("data") ? `Para quando: ${v("data")}` : null, v("peca") ? `Peça: ${v("peca")}` : null]
        : ["Olá, Marshê! Tenho uma ideia para uma peça personalizada:", "", v("ideia"), "", v("tamanho") ? `Tamanho aproximado: ${v("tamanho")}` : null, `Meu nome: ${v("nome")}`, "", "Vou mandar fotos/referências aqui na conversa."];
      openWa(msg.filter((x) => x != null).join("\n").replace(/\n{3,}/g, "\n\n"));
    });
  });
  if (CFG.whatsappExibicao) $$("[data-wa-num]").forEach((el) => (el.textContent = CFG.whatsappExibicao));
  $$("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));

  /* ==========================================================
     Movimento: revelação, cabeçalho, parallax
     ========================================================== */
  // Títulos: cada palavra sobe de dentro de uma máscara (elementos internos, como o "3D.", viram uma palavra só)
  $$("[data-split]").forEach((el) => {
    el.setAttribute("aria-label", el.textContent.replace(/\s+/g, " ").trim());
    let i = 0;
    const wrap = (node) => `<span class="w" aria-hidden="true"><span style="--w:${i++}">${node}</span></span>`;
    el.innerHTML = [...el.childNodes].map((n) => n.nodeType === 3
      ? n.textContent.split(/(\s+)/).map((p) => (/^\s+$/.test(p) ? " " : p ? wrap(esc(p)) : "")).join("")
      : wrap(n.outerHTML)).join("");
  });
  $$(".steps__n").forEach((n, i) => n.style.setProperty("--s", i));

  if ("IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
    }), { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    $$(".reveal").forEach((el, i) => {
      // pequeno atraso em escada para itens irmãos
      const sib = [...el.parentElement.children].filter((c) => c.classList.contains("reveal"));
      el.style.transitionDelay = Math.min(sib.indexOf(el), 5) * 70 + "ms";
      io.observe(el);
    });
    $$('[data-split]:not([data-split="hero"]), .steps').forEach((el) => io.observe(el));
  } else $$('.reveal, [data-split], .steps').forEach((el) => el.classList.add("is-in"));

  const header = $(".header");
  const heroImg = $(".hero__img");
  let ticking = false;
  addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY;
      header.classList.toggle("is-scrolled", y > 10);
      const max = document.documentElement.scrollHeight - innerHeight;
      header.style.setProperty("--p", max > 0 ? (y / max).toFixed(4) : 0); // barra de progresso
      if (heroImg && !reduceMotion && y < 1000) heroImg.style.transform = `translate3d(0, ${-y * 0.08}px, 0)`;
      ticking = false;
    });
  }, { passive: true });

  // Peça 3D girando no topo, se houver o arquivo .glb
  async function hero3d() {
    if (!CFG.modelo3d) return;
    try {
      const r = await fetch(CFG.modelo3d, { method: "HEAD" });
      if (!r.ok || /text\/html/.test(r.headers.get("content-type") || "")) return;
    } catch { return; }
    const s = document.createElement("script");
    s.type = "module";
    s.src = "https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js";
    document.head.appendChild(s);
    const frame = $("[data-parallax]");
    const mv = document.createElement("model-viewer");
    mv.setAttribute("src", CFG.modelo3d);
    mv.setAttribute("alt", "Peça em destaque girando em 3D");
    mv.setAttribute("camera-controls", "");
    mv.setAttribute("disable-zoom", "");
    mv.setAttribute("touch-action", "pan-y");
    mv.setAttribute("shadow-intensity", "1");
    mv.setAttribute("exposure", "1.05");
    mv.setAttribute("poster", heroImg.currentSrc || heroImg.src);
    if (!reduceMotion) { mv.setAttribute("auto-rotate", ""); mv.setAttribute("rotation-per-second", "24deg"); mv.setAttribute("auto-rotate-delay", "0"); }
    frame.replaceChildren(mv);
  }

  /* ==========================================================
     Aba chamando o cliente de volta
     Quando a pessoa troca de aba, o título da aba alterna entre
     mensagens (com carrinho: lembra de finalizar a compra).
     ========================================================== */
  (() => {
    const MSG_CARRINHO = ["🛒 Seu carrinho te espera!", "🧡 Volte e finalize sua compra"];
    const MSG_VAZIO = ["🔥 Black Marshê!", "👀 Ei, volta aqui!"];
    let timer = 0, original = "";
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        original = document.title;
        const msgs = cart.length ? MSG_CARRINHO : MSG_VAZIO;
        let i = 0;
        document.title = msgs[0];
        timer = setInterval(() => { i = (i + 1) % msgs.length; document.title = msgs[i]; }, 1500);
      } else {
        clearInterval(timer);
        if (original) document.title = original;
      }
    });
  })();

  /* ==========================================================
     Início
     ========================================================== */
  const TITLE = document.title;

  function productLd() {
    const base = location.origin + location.pathname.replace(/index\.html$/, "");
    const ld = {
      "@context": "https://schema.org", "@type": "ItemList",
      itemListElement: PRODUCTS.map((p, i) => ({
        "@type": "ListItem", position: i + 1,
        item: {
          "@type": "Product", name: p.nome, description: p.descricao, category: p.categorias.join(", "),
          ...(p.fotos?.[0] ? { image: base + p.fotos[0] } : {}),
          brand: { "@type": "Brand", name: "Marshê Studio 3D" },
          offers: consulta(p) ? undefined : { "@type": "Offer", priceCurrency: "BRL", price: minPrice(p).toFixed(2), availability: "https://schema.org/MadeToOrder", url: `${base}#produto/${p.id}` }
        }
      }))
    };
    const s = document.createElement("script");
    s.type = "application/ld+json";
    s.textContent = JSON.stringify(ld);
    document.head.appendChild(s);
  }

  // Preços editados no painel da loja (Supabase) sobrescrevem os do produtos.json.
  // Se o banco não responder em 2,5 s, a loja abre com os preços do arquivo.
  const precosDoBanco = () => {
    if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) return Promise.resolve([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    return fetch(`${CFG.supabaseUrl}/rest/v1/precos?select=*`, {
      headers: { apikey: CFG.supabaseAnonKey, Authorization: `Bearer ${CFG.supabaseAnonKey}` }, signal: ctrl.signal
    }).then((r) => (r.ok ? r.json() : [])).catch(() => []).finally(() => clearTimeout(t));
  };
  const aplicarPrecos = (lista, linhas) => {
    const porId = new Map(linhas.map((l) => [l.produto_id, l]));
    return lista.filter((p) => {
      const l = porId.get(p.id);
      if (!l) return true;
      if (l.oculto) return false;
      p.sobConsulta = !!l.sob_consulta;
      if (l.preco != null) p.preco = +l.preco;
      if (l.preco_de != null && +l.preco_de > 0) p.precoDe = +l.preco_de; else delete p.precoDe;
      if (l.opcoes && p.variacoes?.opcoes) p.variacoes.opcoes.forEach((o) => { if (l.opcoes[o.nome] != null) o.preco = +l.opcoes[o.nome]; });
      // Detalhes editados no painel (null = segue o produtos.json)
      if (l.nome) p.nome = l.nome;
      if (l.descricao != null) p.descricao = l.descricao;
      if (Array.isArray(l.categorias) && l.categorias.length) p.categorias = l.categorias;
      if (Array.isArray(l.selos)) p.selos = [...(p.selos || []).filter((x) => !/^(novo|mais pedido)$/i.test(x)), ...l.selos];
      if (l.personalizavel != null) { if (l.personalizavel) p.personalizavel = l.personalizavel; else delete p.personalizavel; }
      if (l.ordem != null) p.destaque = +l.ordem - 0.5;   // ordem do painel ganha no empate com a do arquivo
      return true;
    });
  };

  Promise.all([fetch("produtos.json", { cache: "no-cache" }).then((r) => r.json()), precosDoBanco()])
    .then(([data, linhas]) => {
      data.produtos = aplicarPrecos(data.produtos || [], linhas);
      return data;
    })
    .then((data) => {
      PRODUCTS = (data.produtos || []).filter((p) => p && p.id && p.nome && (p.sobConsulta || p.preco > 0 || opts(p).some((o) => o.preco > 0)));
      PRODUCTS.forEach((p) => { p.categorias ||= ["Outros"]; p.fotos ||= []; p.selos ||= []; if (!(p.preco > 0) && !p.sobConsulta) p.preco = minPrice(p); });
      // Carrinhos salvos com nome antigo de opção (ex.: "7 cm · pintado à mão") passam para o nome atual ("7 cm")
      cart.forEach((it) => {
        const p = byId(it.id);
        if (!p || !it.variacao || opts(p).some((o) => o.nome === it.variacao)) return;
        const m = opts(p).find((o) => it.variacao.startsWith(o.nome));
        if (m) it.variacao = m.nome;
      });
      renderChips();
      update();
      renderRecent();
      if (conviteNovo && PONTOS_ON) setTimeout(() => toast(`🎁 Convite aceito! Crie sua conta e ganhe ${brl((CFG.bonusIndicacao ?? 1000) / 100)} em pontos na 1ª compra`, "Criar conta", () => conta()?.abrir()), 1200);
      renderCart();
      productLd();
      const d = byId(CFG.produtoDestaque);
      if (d) $("[data-hero-chip]").innerHTML = `<span class="hero__chip-name">${esc(d.nome)}</span><span class="hero__chip-price">${priceHtml(d).replace(/<small>.*?<\/small>/, "a partir de ")}</span>`;
      route();
    })
    .catch((err) => {
      console.error("Não consegui carregar produtos.json", err);
      grid.innerHTML = `<p class="empty">Não foi possível carregar o catálogo agora. Fale com a gente pelo <a href="#" data-wa="Olá, Marshê! Quero ver o catálogo.">WhatsApp</a>.</p>`;
    });

  hero3d();

  /* ---------- Contagem regressiva da Black Friday ---------- */
  (() => {
    const fim = Date.parse(CFG.blackFridayFim || "");
    if (!fim) return;
    const pad = (n) => String(n).padStart(2, "0");
    const longos = $$("[data-cd-long]"), curtos = $$("[data-cd]"), caixas = $$("[data-countdown]");
    let timer = 0;
    const tick = () => {
      const d = fim - Date.now();
      if (d <= 0) { caixas.forEach((c) => (c.hidden = true)); curtos.forEach((c) => (c.textContent = "hoje")); clearInterval(timer); return; }
      const dd = Math.floor(d / 864e5), hh = Math.floor(d / 36e5) % 24, mm = Math.floor(d / 6e4) % 60, ss = Math.floor(d / 1e3) % 60;
      longos.forEach((el) => (el.textContent = `${dd}d ${pad(hh)}h ${pad(mm)}min ${pad(ss)}s`));
      curtos.forEach((el) => (el.textContent = dd ? `${dd}d ${hh}h` : `${hh}h ${pad(mm)}min`));
      caixas.forEach((c) => (c.hidden = false));
    };
    tick();
    timer = setInterval(tick, 1000);
  })();

  // Pontos Marshê: carrega a conta só se estiver configurado
  if (PONTOS_ON) {
    $$("[data-pontos-on]").forEach((el) => (el.hidden = false));
    import(new URL("conta.js", SCRIPT_BASE).href)
      .then((m) => m.iniciar({
        lockScroll, openCart, toast,
        // foto pequena do produto (para o histórico de pedidos)
        produto: (id) => { const p = byId(id); return p && { nome: p.nome, foto: p.fotos[0] ? small(p.fotos[0]) : "" }; },
        // "Comprar de novo": coloca no carrinho as peças que ainda existem, com as mesmas opções
        recomprar: (itens) => {
          let n = 0;
          itens.forEach((i) => {
            const p = byId(i.id);
            if (!p) return;
            const variacao = i.variacao && opts(p).some((o) => o.nome === i.variacao) ? i.variacao : (opts(p)[0]?.nome || "");
            const item = { id: p.id, variacao, custom: i.custom || "", qtd: i.qtd || 1 };
            const ex = cart.find((c) => keyOf(c) === keyOf(item));
            ex ? (ex.qtd += item.qtd) : cart.push(item);
            n++;
          });
          if (n) { saveCart(); toast(n === 1 ? "Peça adicionada ao carrinho" : n + " peças adicionadas ao carrinho"); }
          return n;
        }
      }))
      .catch((e) => console.warn("Não foi possível carregar os Pontos Marshê:", e));
  }
  /* ---------- Ajustes do celular ---------- */
  // Regulamento dos pontos: aberto no computador, recolhido no celular; abre ao seguir o link #regulamento
  const regras = document.querySelector("[data-open-desktop]");
  if (regras) {
    const mqCel = matchMedia("(max-width: 599px)");
    const syncRegras = () => { regras.open = !mqCel.matches; };
    syncRegras(); mqCel.addEventListener("change", syncRegras);
    const abrirRegras = () => { if (location.hash === "#regulamento") regras.open = true; };
    addEventListener("hashchange", abrirRegras); abrirRegras();
    document.addEventListener("click", (e) => { if (e.target.closest("a[href=\"#regulamento\"]")) regras.open = true; });
  }
  // Rodapé: no celular, cada grupo de links vira uma sanfona
  document.querySelectorAll(".fcol h3").forEach((h) => {
    const ul = h.nextElementSibling;
    if (!ul || ul.tagName !== "UL" || ul.classList.contains("fcontact")) return;
    h.classList.add("facc");
    const b = document.createElement("button");
    b.type = "button"; b.className = "facc__btn"; b.setAttribute("aria-expanded", "false");
    b.innerHTML = h.innerHTML + "<svg class=\"ico\" aria-hidden=\"true\"><use href=\"#i-plus\"/></svg>";
    h.innerHTML = ""; h.append(b);
    b.addEventListener("click", () => { const on = b.getAttribute("aria-expanded") !== "true"; b.setAttribute("aria-expanded", on); h.classList.toggle("is-open", on); });
  });
  // Busca: texto de exemplo mais curto no celular, para não ficar cortado
  const busca = document.getElementById("busca");
  if (busca) {
    const longo = busca.placeholder;
    const syncBusca = () => { busca.placeholder = matchMedia("(max-width: 599px)").matches ? "Buscar peças…" : longo; };
    syncBusca(); addEventListener("resize", syncBusca, { passive: true });
  }
})();

