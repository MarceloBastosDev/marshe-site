/* Configurações da loja · edite aqui sem mexer no resto do código. */
window.MARSHE = {
  // WhatsApp com código do país + DDD, só números
  whatsapp: "5551981231848",
  whatsappExibicao: "(51) 98123-1848",
  instagram: "marshe_studio3d",
  email: "marshe3d@gmail.com",
  cidade: "Terra de Areia/RS",

  // Desconto do primeiro pedido (em %)
  descontoPrimeiroPedido: 10,

  // Prazo de produção mostrado nos produtos (cada produto pode ter "prazo" próprio no produtos.json)
  prazoPadrao: "[A CONFIRMAR] dias úteis",

  // Se este arquivo existir, o destaque do topo vira a peça girando em 3D
  modelo3d: "assets/3d/destaque.glb",
  // Produto ligado ao destaque do topo
  produtoDestaque: "mascara-obito",

  // false = animações rodam sempre, mesmo com "movimento reduzido" ligado no aparelho.
  // true  = quem pediu menos movimento no aparelho vê só fades curtos (recomendado para acessibilidade).
  respeitarMovimentoReduzido: false,

  // ---------- Vendas ----------
  // Fim da Black Friday (a contagem regressiva some sozinha depois dessa data)
  blackFridayFim: "2026-11-30T23:59:59-03:00",
  // Embalagem de presente (com cartão e mensagem) e meta para ela sair grátis
  embalagemPreco: 5,
  embalagemGratisAcima: 100,
  // Indique e ganhe: pontos para quem indicou e para o indicado (mude também em regras_pontos)
  bonusIndicacao: 1000,

  // ---------- Pontos Marshê (cashback) ----------
  // Veja o passo a passo em supabase/LEIA-ME.md. Enquanto os dois campos abaixo
  // estiverem vazios, o programa fica escondido no site.
  supabaseUrl: "https://cwtmcmxcjqxtisseyluq.supabase.co",
  supabaseAnonKey: "sb_publishable_5ofqkTbPNRCMy8Zlagfv2Q_PEeTHXS9", // chave "publishable" (sb_publishable_...) ou "anon public" do projeto (pode ficar no site)
  loginGoogle: true,      // true depois de ativar o Google no Supabase (passo a passo em supabase/LEIA-ME.md)
  cashbackPct: 5,         // % de volta em pontos (mude também em regras_pontos no Supabase)
  validadePontosMeses: 3, // validade dos pontos (idem)
  pontosDemo: false       // true = mostra as telas em modo demonstração, sem banco
};
