// Painel da central: carrega o estado pela API REST, desenha a interface por cima do mapa 3D
// e depois só escuta o SignalR. JavaScript puro, sem etapa de build.
import { Cena, UNIDADES } from "./cena.js";

const NOME_STATUS = { Disponivel: "Disponível", EmEntrega: "Em entrega", EmPausa: "Em pausa", Ocorrencia: "Ocorrência" };
const NOME_SITUACAO = { Aberto: "Aberto", EmAnalise: "Em análise", Aprovado: "Aprovado", Negado: "Negado", Pago: "Pago" };
const NOME_TIPO = { Acidente: "Acidente", Roubo: "Roubo", AvariaMoto: "Avaria da moto", AvariaBau: "Avaria do baú" };
const EM_ANDAMENTO = ["Aberto", "EmAnalise", "Aprovado"];
const COR_AVATAR = {
  Disponivel: ["#e3f5ec", "#1f9d63"], EmEntrega: ["#e8edfd", "#2f5bea"],
  EmPausa: ["#fbf0dc", "#c27c06"], Ocorrencia: ["#fde8e6", "#e0453a"]
};

const ICONES = {
  mira: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>',
  fechar: '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>',
  seta: '<svg viewBox="0 0 24 24"><path d="m10 7 5 5-5 5"/></svg>',
  escudo: '<svg viewBox="0 0 24 24"><path d="M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/></svg>',
  aberto: '<svg viewBox="0 0 24 24"><path d="M12 4 3 19.5h18z"/><path d="M12 10v4.5M12 17v.1"/></svg>',
  analise: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>',
  aprovado: '<svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9"/></svg>',
  negado: '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>',
  pago: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/></svg>',
  moto: '<svg viewBox="0 0 24 24"><circle cx="6" cy="17" r="2.6"/><circle cx="18" cy="17" r="2.6"/><path d="M8.6 17h6.8M14 7h3l2.4 6M9.5 11h5L13 7"/></svg>'
};

const $ = (id) => document.getElementById(id);
const dinheiro = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dinheiroCurto = (v) => v >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : String(Math.round(v));
const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dataHora = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const data = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const reduzido = matchMedia("(prefers-reduced-motion: reduce)").matches;
const celular = matchMedia("(max-width: 760px)").matches;

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iniciais = (nome) => nome.split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
const chip = (status, nome) => `<span class="chip c-${status}">${nome}</span>`;

function haQuanto(iso) {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)} d`;
}

// ---------- estado ----------

const estado = {
  motoristas: new Map(),  // id -> linha da vw_MotoristasStatusAtual
  sinistros: new Map(),   // id -> SinistroItem
  apolices: [],
  eventos: [],
  unidade: null,          // nome do restaurante ou null (toda a rede)
  selecao: null,          // { tipo, id }
  foco: null,             // sinistro mostrado no acompanhamento
  historicos: new Map(),  // sinistroId -> histórico
  aba: "motoboys"
};

const daUnidade = (m) => !estado.unidade || m.restaurante === estado.unidade;
const motoristasVisiveis = () => [...estado.motoristas.values()].filter(daUnidade).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
const sinistrosVisiveis = () => [...estado.sinistros.values()]
  .filter((s) => !estado.unidade || s.restaurante === estado.unidade)
  .sort((a, b) => new Date(b.abertoEm) - new Date(a.abertoEm));

// ---------- API ----------

async function api(caminho, opcoes = {}) {
  const resp = await fetch(caminho, {
    ...opcoes,
    headers: { "content-type": "application/json", "X-Usuario": "ana.nogueira", ...(opcoes.headers || {}) }
  });
  if (resp.ok) return resp.status === 204 ? null : resp.json();
  let msg = `Erro ${resp.status}`;
  try {
    const p = await resp.json(); // ProblemDetails
    msg = p.detail || Object.values(p.errors || {}).flat()[0] || p.title || msg;
  } catch { /* sem corpo */ }
  throw new Error(msg);
}

function avisar(texto, erro = false) {
  const el = $("aviso");
  el.textContent = texto;
  el.className = erro ? "aviso erro" : "aviso";
  el.hidden = false;
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => (el.hidden = true), 4200);
}

// ---------- cena ----------

// as placas da cidade são desenhadas em canvas: espera a fonte para não sair com a fonte reserva
try { await Promise.race([document.fonts.load('600 54px "IBM Plex Sans"'), new Promise((r) => setTimeout(r, 2500))]); } catch { /* segue com a fonte do sistema */ }
const cena = new Cena($("mapa"), { reduzido, celular });
cena.aoSelecionar = (sel) => selecionar(sel);

function selecionar(sel, { voar = true } = {}) {
  estado.selecao = sel;
  if (sel?.tipo === "sinistro") definirFoco(sel.id);
  if (sel?.tipo === "moto") {
    const ativo = sinistrosVisiveis().find((s) => s.motoristaId === sel.id && EM_ANDAMENTO.includes(s.status));
    if (ativo) definirFoco(ativo.id);
  }
  if (voar) cena.selecionar(sel);
  else cena.selecionado = sel;
  redesenhar();
  if (celular && sel) $("gaveta").scrollTo({ top: 0, behavior: reduzido ? "auto" : "smooth" });
}

// ---------- KPIs e unidade ----------

function desenharKpis() {
  const ms = motoristasVisiveis();
  const cont = { Disponivel: 0, EmEntrega: 0, EmPausa: 0, Ocorrencia: 0 };
  ms.forEach((m) => cont[m.status]++);
  const ss = sinistrosVisiveis();
  const andamento = ss.filter((s) => s.status === "Aberto" || s.status === "EmAnalise");
  const aprovados = ss.filter((s) => s.status === "Aprovado");
  const aPagar = aprovados.reduce((t, s) => t + (s.valorIndenizado || 0), 0);

  $("k-disp").textContent = cont.Disponivel;
  $("k-disp-sub").textContent = `de ${ms.length} motoboys`;
  $("k-entrega").textContent = cont.EmEntrega;
  $("k-entrega-sub").textContent = cont.EmPausa ? `${cont.EmPausa} em pausa` : "nenhum em pausa";
  $("k-ocorr").textContent = cont.Ocorrencia;
  $("k-ocorr-sub").textContent = cont.Ocorrencia ? "aguardando a central" : "tudo tranquilo";
  $("k-andamento").textContent = andamento.length;
  $("k-andamento-sub").textContent = `${andamento.filter((s) => s.status === "EmAnalise").length} em análise`;
  $("k-apagar").textContent = celular ? dinheiroCurto(aPagar) : dinheiro.format(aPagar);
  $("k-apagar-sub").textContent = `${aprovados.length} aprovado${aprovados.length === 1 ? "" : "s"}`;

  const u = UNIDADES.find((x) => x.nome === estado.unidade);
  $("unidade-sigla").textContent = u ? u.sigla : "REDE";
  $("unidade-nome").textContent = u ? u.curto : "Toda a rede";
  $("unidade-info").textContent = `${ms.length} motoboys · ${cont.EmEntrega} na rua`;
  $("abas-unidade").textContent = u ? `Sabor de Casa · ${u.curto}` : "Toda a rede";
}

function desenharMenuUnidades() {
  const todos = [...estado.motoristas.values()];
  const linha = (nome, sigla, titulo) => {
    const ms = todos.filter((m) => !nome || m.restaurante === nome);
    const ocorr = ms.filter((m) => m.status === "Ocorrencia").length;
    return `<li role="option" data-unidade="${esc(nome ?? "")}" aria-selected="${(estado.unidade ?? "") === (nome ?? "")}">
      <span class="sigla">${sigla}</span><span><b>${esc(titulo)}</b><small>${ms.length} motoboys${ocorr ? ` · ${ocorr} em ocorrência` : ""}</small></span></li>`;
  };
  $("unidade-menu").innerHTML = linha(null, "REDE", "Toda a rede") + UNIDADES.map((u) => linha(u.nome, u.sigla, u.curto)).join("");
}

$("unidade-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  desenharMenuUnidades();
  $("unidade-menu").hidden = !$("unidade-menu").hidden;
});
$("unidade-menu").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-unidade]");
  if (!li) return;
  trocarUnidade(li.dataset.unidade || null);
  $("unidade-menu").hidden = true;
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".unidade")) $("unidade-menu").hidden = true;
  if (!e.target.closest(".busca")) $("resultados").hidden = true;
});

function trocarUnidade(nome) {
  estado.unidade = nome;
  if (nome) cena.voarParaUnidade(nome); else cena.inicio();
  estado.foco = null;
  escolherFocoPadrao();
  redesenhar();
}

// ---------- detalhe à direita ----------

function apoliceDe(motoristaId) {
  const hoje = new Date().toISOString().slice(0, 10);
  const minhas = estado.apolices.filter((a) => a.motoristaId === motoristaId);
  return minhas.find((a) => a.inicioVigencia <= hoje && a.fimVigencia >= hoje) || minhas.sort((a, b) => b.fimVigencia.localeCompare(a.fimVigencia))[0];
}

const linhas = (pares) => `<dl class="linhas">${pares.filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;

function botoesDoSinistro(s) {
  switch (s.status) {
    case "Aberto": return `<button class="botao primario cheio" data-acao="EmAnalise" data-id="${s.id}">Iniciar análise</button>`;
    case "EmAnalise": return `<button class="botao primario cheio" data-acao="Aprovado" data-id="${s.id}">Aprovar</button>
                              <button class="botao perigo cheio" data-acao="Negado" data-id="${s.id}">Negar</button>`;
    case "Aprovado": return `<button class="botao primario cheio" data-acao="Pagar" data-id="${s.id}">Pagar ${dinheiro.format(s.valorIndenizado)}</button>`;
    default: return "";
  }
}

function desenharDetalhe() {
  const el = $("detalhe");
  const sel = estado.selecao;
  document.body.classList.toggle("com-detalhe", !!sel);
  if (!sel) { el.hidden = true; return; }
  el.hidden = false;

  if (sel.tipo === "moto") {
    const m = estado.motoristas.get(sel.id);
    if (!m) { el.hidden = true; return; }
    const ap = apoliceDe(m.motoristaId);
    const [fundo, cor] = COR_AVATAR[m.status];
    const ativos = sinistrosVisiveis().filter((s) => s.motoristaId === m.motoristaId && EM_ANDAMENTO.includes(s.status));
    const vigente = ap && ap.vigenteHoje;
    el.innerHTML = `
      <div class="det-topo">
        <span class="det-avatar" style="background:${fundo};color:${cor}">${iniciais(m.nome)}</span>
        <div class="det-titulo"><small>Motoboy · ${esc(m.restaurante.replace("Sabor de Casa - ", ""))}</small>
          <h2>${esc(m.nome)}</h2><p>${esc(m.modelo)} · <span class="mono">${esc(m.placa)}</span></p></div>
        <button class="icone-btn" data-cmd="centralizar" title="Centralizar no mapa">${ICONES.mira}</button>
        <button class="icone-btn" data-cmd="fechar" title="Fechar">${ICONES.fechar}</button>
      </div>
      <div class="det-estado">${chip(m.status, NOME_STATUS[m.status])}<span>há ${haQuanto(m.statusDesde)}${m.observacao ? ` · ${esc(m.observacao)}` : ""}</span></div>
      ${linhas([
        ["Unidade", esc(m.restaurante.replace("Sabor de Casa - ", ""))],
        ["Moto", `${esc(m.modelo)}`],
        ap && ["Apólice", `<span class="mono">${esc(ap.numero)}</span>`],
        ap && ["Vigência", `${vigente ? "até" : "venceu em"} ${data.format(new Date(ap.fimVigencia + "T12:00:00"))}`],
        ap && ["Cobertura", dinheiro.format(ap.valorCobertura)],
        ap && ["Franquia", `${ap.franquiaPercentual.toLocaleString("pt-BR")}% (mín. ${dinheiro.format(ap.franquiaMinima)})`],
        ["Sinistros ativos", m.sinistrosAtivos]
      ])}
      ${ativos.length ? `<div class="det-secao">Sinistros em andamento</div><ul class="lista-mini">${ativos.map((s) =>
        `<li data-sinistro="${s.id}"><span><span class="mono">#${s.id}</span> ${NOME_TIPO[s.tipo]}</span>${chip(s.status, NOME_SITUACAO[s.status])}</li>`).join("")}</ul>` : ""}
      <div class="acoes">
        ${m.status === "Ocorrencia" ? `<button class="botao primario cheio" data-cmd="liberar">Liberar motoboy</button>` : ""}
        <button class="botao cheio" data-cmd="abrir"${vigente ? "" : ' title="A apólice não está vigente: a API vai recusar"'}>Abrir sinistro</button>
      </div>`;
    return;
  }

  const s = estado.sinistros.get(sel.id);
  if (!s) { el.hidden = true; return; }
  const ap = estado.apolices.find((a) => a.numero === s.numeroApolice);
  const [fundo, cor] = s.status === "Aberto" ? COR_AVATAR.Ocorrencia : s.status === "EmAnalise" ? COR_AVATAR.EmPausa : s.status === "Pago" ? COR_AVATAR.Disponivel : COR_AVATAR.EmEntrega;
  el.innerHTML = `
    <div class="det-topo">
      <span class="det-avatar mono" style="background:${fundo};color:${cor}">#${s.id}</span>
      <div class="det-titulo"><small>Sinistro · ${NOME_TIPO[s.tipo]}</small>
        <h2>${esc(s.motorista)}</h2><p><span class="mono">${esc(s.placa)}</span> · ocorreu em ${dataHora.format(new Date(s.dataOcorrencia))}</p></div>
      <button class="icone-btn" data-cmd="centralizar" title="Centralizar no mapa">${ICONES.mira}</button>
      <button class="icone-btn" data-cmd="fechar" title="Fechar">${ICONES.fechar}</button>
    </div>
    <div class="det-estado">${chip(s.status, NOME_SITUACAO[s.status])}<span>atualizado há ${haQuanto(s.atualizadoEm)}</span></div>
    ${linhas([
      ["Valor estimado", dinheiro.format(s.valorEstimado)],
      ["Indenização", s.valorIndenizado != null ? dinheiro.format(s.valorIndenizado) : "a calcular"],
      ["Apólice", `<span class="mono">${esc(s.numeroApolice)}</span>`],
      ap && ["Franquia", `${ap.franquiaPercentual.toLocaleString("pt-BR")}% (mín. ${dinheiro.format(ap.franquiaMinima)})`],
      ["Unidade", esc(s.restaurante.replace("Sabor de Casa - ", ""))],
      ["Aberto há", haQuanto(s.abertoEm)],
      s.pagoEm && ["Pago em", dataHora.format(new Date(s.pagoEm))]
    ])}
    <div class="acoes">${botoesDoSinistro(s)}<button class="botao" data-cmd="ver-moto" data-id="${s.motoristaId}">Ver motoboy</button></div>`;
}

$("detalhe").addEventListener("click", async (e) => {
  const sinistro = e.target.closest("[data-sinistro]");
  if (sinistro) return selecionar({ tipo: "sinistro", id: Number(sinistro.dataset.sinistro) });
  const acao = e.target.closest("[data-acao]");
  if (acao) return executarAcao(acao);
  const cmd = e.target.closest("[data-cmd]")?.dataset.cmd;
  if (!cmd) return;
  const sel = estado.selecao;
  if (cmd === "fechar") { estado.selecao = null; cena.selecionar(null); redesenhar(); }
  if (cmd === "centralizar") cena.selecionar(sel);
  if (cmd === "ver-moto") selecionar({ tipo: "moto", id: Number(e.target.closest("[data-cmd]").dataset.id) });
  if (cmd === "abrir") abrirDialogoNovo(sel.id);
  if (cmd === "liberar") {
    try {
      await api(`/api/motoristas/${sel.id}/status`, { method: "PUT", body: JSON.stringify({ status: "Disponivel", observacao: "Liberado pela central" }) });
    } catch (err) { avisar(err.message, true); }
  }
});

// ---------- ações do fluxo do sinistro ----------

let aprovando = null;

async function executarAcao(botao) {
  const id = Number(botao.dataset.id);
  const acao = botao.dataset.acao;
  if (acao === "Aprovado") {
    aprovando = estado.sinistros.get(id);
    $("aprovar-titulo").textContent = `Aprovar sinistro #${id}`;
    $("form-aprovar").valorApurado.value = aprovando.valorEstimado;
    $("dlg-aprovar").showModal();
    return;
  }
  botao.disabled = true;
  try {
    const r = acao === "Pagar"
      ? await api(`/api/sinistros/${id}/pagamento`, { method: "POST", body: "{}" })
      : await api(`/api/sinistros/${id}/transicoes`, { method: "POST", body: JSON.stringify({ novoStatus: acao }) });
    receberSinistro("StatusAlterado", r.sinistro, r.historico);
  } catch (err) {
    avisar(err.message, true);
    botao.disabled = false;
  }
}

$("dlg-aprovar").addEventListener("close", async () => {
  if ($("dlg-aprovar").returnValue !== "ok" || !aprovando) return;
  try {
    const r = await api(`/api/sinistros/${aprovando.id}/transicoes`, {
      method: "POST", body: JSON.stringify({ novoStatus: "Aprovado", valorApurado: Number($("form-aprovar").valorApurado.value) })
    });
    receberSinistro("StatusAlterado", r.sinistro, r.historico);
  } catch (err) { avisar(err.message, true); }
});

function abrirDialogoNovo(motoristaId) {
  const sel = $("sel-motorista");
  sel.innerHTML = [...estado.motoristas.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((m) => `<option value="${m.motoristaId}">${esc(m.nome)} (${esc(m.placa)})</option>`).join("");
  if (motoristaId) sel.value = motoristaId;
  $("dlg-novo").showModal();
}

$("dlg-novo").addEventListener("close", async () => {
  if ($("dlg-novo").returnValue !== "ok") return;
  const f = $("form-novo");
  try {
    const r = await api("/api/sinistros", {
      method: "POST",
      body: JSON.stringify({
        motoristaId: Number(f.motoristaId.value), tipo: f.tipo.value, valorEstimado: Number(f.valorEstimado.value),
        descricao: f.descricao.value, dataOcorrencia: new Date(Date.now() - 10 * 60000).toISOString()
      })
    });
    receberSinistro("Aberto", r.sinistro, r.historico);
    selecionar({ tipo: "sinistro", id: r.sinistro.id });
    avisar(`Sinistro #${r.sinistro.id} aberto.`);
  } catch (err) { avisar(err.message, true); }
});

// ---------- acompanhamento (linha do tempo) ----------

function escolherFocoPadrao() {
  if (estado.foco && estado.sinistros.has(estado.foco)) return;
  const s = sinistrosVisiveis().find((x) => EM_ANDAMENTO.includes(x.status)) || sinistrosVisiveis()[0];
  estado.foco = s?.id ?? null;
  if (s) carregarHistorico(s.id);
}

function definirFoco(id) {
  estado.foco = id;
  carregarHistorico(id);
  desenharAcompanhamento();
}

async function carregarHistorico(id, forcar = false) {
  if (estado.historicos.has(id) && !forcar) return;
  try {
    const d = await api(`/api/sinistros/${id}`);
    estado.historicos.set(id, d.historico);
    estado.sinistros.set(id, d.sinistro);
    if (estado.foco === id) desenharAcompanhamento();
  } catch { /* o painel segue sem a linha do tempo */ }
}

function desenharAcompanhamento() {
  const el = $("acompanhamento");
  const s = estado.sinistros.get(estado.foco);
  const cab = (sub) => `<div class="acp-cab"><h2><span>${ICONES.escudo}</span>Acompanhamento do sinistro</h2><small>${sub}</small></div>`;
  if (!s) {
    el.innerHTML = `<div class="acp-esq">${cab("")}<p class="acp-vazio">Nenhum sinistro nesta unidade.</p></div>`;
    return;
  }
  const hist = estado.historicos.get(s.id) || [];
  const quando = (st) => {
    const h = [...hist].reverse().find((x) => x.para === st);
    return h ? hora.format(new Date(h.alteradoEm)) + (Date.now() - new Date(h.alteradoEm) > 86400000 ? ` · ${data.format(new Date(h.alteradoEm)).slice(0, 5)}` : "") : "";
  };
  const negado = s.status === "Negado";
  const ordem = ["Aberto", "EmAnalise", negado ? "Negado" : "Aprovado", "Pago"];
  const atual = ordem.indexOf(s.status);
  const icones = [ICONES.aberto, ICONES.analise, negado ? ICONES.negado : ICONES.aprovado, ICONES.pago];
  const nomes = ["Aberto", "Em análise", negado ? "Negado" : "Aprovado", "Pago"];
  const etapas = ordem.map((st, k) => {
    let classe = k < atual ? "feita" : k === atual ? "atual" : "";
    if (negado && k === 2) classe = "negada";
    if (negado && k === 3) classe = "";
    const legenda = quando(st) || (k === atual + 1 && !negado ? "próxima etapa" : negado && k === 3 ? "não se aplica" : "");
    return `<li class="etapa ${classe}"><span class="bolinha">${icones[k]}</span><b>${nomes[k]}</b><small>${legenda}</small></li>`;
  }).join("");
  const progresso = negado ? 100 : [12, 45, 78, 100][Math.max(0, atual)];
  const [fundo, cor] = COR_AVATAR[{ Aberto: "Ocorrencia", EmAnalise: "EmPausa", Aprovado: "EmEntrega", Pago: "Disponivel", Negado: "EmPausa" }[s.status]];
  el.innerHTML = `
    <div class="acp-esq">
      ${cab(esc(s.numeroApolice))}
      <p class="acp-sub"><b>#${s.id}</b> ${esc(s.motorista)} · <span class="mono">${esc(s.placa)}</span> · ${proximoPasso(s)}</p>
      <ol class="linha-tempo">${etapas}</ol>
    </div>
    <div class="cartao-sinistro" data-sinistro="${s.id}" role="button" tabindex="0">
      <div class="cs-topo">
        <span class="cs-icone" style="background:${fundo};color:${cor}">${ICONES.moto}</span>
        <div style="min-width:0;flex:1"><b>#${s.id} · ${NOME_TIPO[s.tipo]}</b><small>${esc(s.motorista)} · ${esc(s.restaurante.replace("Sabor de Casa - ", ""))}</small></div>
        ${ICONES.seta}
      </div>
      <div>${chip(s.status, NOME_SITUACAO[s.status])}</div>
      <div class="cs-valores">
        <span>Estimado<b>${dinheiro.format(s.valorEstimado)}</b></span>
        <span style="text-align:right">Indenização<b>${s.valorIndenizado != null ? dinheiro.format(s.valorIndenizado) : "a calcular"}</b></span>
      </div>
      <div class="barra"><i style="width:${progresso}%"></i></div>
      <small style="color:var(--tinta-2);font-size:12px">${s.status === "Pago" ? "Indenização paga" : negado ? "Encerrado sem indenização" : `Aberto há ${haQuanto(s.abertoEm)} · ${s.placa}`}</small>
    </div>`;
}

function proximoPasso(s) {
  return {
    Aberto: "aguardando a análise da seguradora",
    EmAnalise: "vistoria em andamento, falta aprovar ou negar",
    Aprovado: `indenização de ${dinheiro.format(s.valorIndenizado)} aguardando pagamento`,
    Pago: `pago em ${s.pagoEm ? dataHora.format(new Date(s.pagoEm)) : "-"}`,
    Negado: "encerrado sem indenização"
  }[s.status];
}

$("acompanhamento").addEventListener("click", (e) => {
  const c = e.target.closest("[data-sinistro]");
  if (c) selecionar({ tipo: "sinistro", id: Number(c.dataset.sinistro) });
});

// ---------- abas ----------

function desenharAbas() {
  const ms = motoristasVisiveis();
  const ss = sinistrosVisiveis();
  $("n-motoboys").textContent = ms.length;
  $("n-sinistros").textContent = ss.filter((s) => EM_ANDAMENTO.includes(s.status)).length;
  document.querySelectorAll(".abas-botoes button").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === estado.aba));
  const sel = estado.selecao;
  let html = "";
  if (estado.aba === "motoboys") {
    html = `<table class="tab"><tbody>${ms.map((m) => `
      <tr data-moto="${m.motoristaId}" class="${sel?.tipo === "moto" && sel.id === m.motoristaId ? "sel" : ""}">
        <td><b>${esc(m.nome)}</b><small>${esc(m.restaurante.replace("Sabor de Casa - ", ""))}</small></td>
        <td class="mono ocultar-cel">${esc(m.placa)}</td>
        <td>${chip(m.status, NOME_STATUS[m.status])}</td>
        <td class="dir"><small>${haQuanto(m.statusDesde)}</small></td>
      </tr>`).join("")}</tbody></table>`;
  } else if (estado.aba === "sinistros") {
    html = ss.length ? `<table class="tab"><tbody>${ss.map((s) => `
      <tr data-sinistro="${s.id}" class="${sel?.tipo === "sinistro" && sel.id === s.id ? "sel" : ""}">
        <td class="mono">#${s.id}</td>
        <td><b>${NOME_TIPO[s.tipo]}</b><small>${esc(s.motorista)}</small></td>
        <td class="dir mono ocultar-cel">${dinheiro.format(s.valorIndenizado ?? s.valorEstimado)}</td>
        <td class="dir">${chip(s.status, NOME_SITUACAO[s.status])}</td>
      </tr>`).join("")}</tbody></table>` : `<p class="vazio-lista">Nenhum sinistro.</p>`;
  } else {
    html = estado.eventos.length
      ? `<ul class="eventos">${estado.eventos.map((e) => `<li><time>${hora.format(e.quando)}</time><span>${e.texto}</span></li>`).join("")}</ul>`
      : `<p class="vazio-lista">Os eventos ao vivo aparecem aqui.</p>`;
  }
  $("abas-corpo").innerHTML = html;
}

document.querySelector(".abas-botoes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-aba]");
  if (!b) return;
  estado.aba = b.dataset.aba;
  desenharAbas();
});
$("abas-corpo").addEventListener("click", (e) => {
  const m = e.target.closest("[data-moto]");
  if (m) return selecionar({ tipo: "moto", id: Number(m.dataset.moto) });
  const s = e.target.closest("[data-sinistro]");
  if (s) selecionar({ tipo: "sinistro", id: Number(s.dataset.sinistro) });
});

// ---------- busca ----------

let resultados = [];
let ativo = 0;

function buscar(texto) {
  const t = texto.trim().toLowerCase().replace(/^#/, "");
  if (!t) { $("resultados").hidden = true; return; }
  const ms = [...estado.motoristas.values()].filter((m) => m.nome.toLowerCase().includes(t) || m.placa.toLowerCase().includes(t))
    .map((m) => ({ sel: { tipo: "moto", id: m.motoristaId }, html: `${chip(m.status, NOME_STATUS[m.status])}<span><b>${esc(m.nome)}</b><small>${esc(m.placa)} · ${esc(m.restaurante.replace("Sabor de Casa - ", ""))}</small></span>` }));
  const ss = [...estado.sinistros.values()].filter((s) => String(s.id).startsWith(t) || s.motorista.toLowerCase().includes(t))
    .slice(0, 5)
    .map((s) => ({ sel: { tipo: "sinistro", id: s.id }, html: `${chip(s.status, NOME_SITUACAO[s.status])}<span><b>#${s.id} · ${NOME_TIPO[s.tipo]}</b><small>${esc(s.motorista)}</small></span>` }));
  resultados = [...ms, ...ss].slice(0, 8);
  ativo = 0;
  $("resultados").innerHTML = resultados.length
    ? resultados.map((r, k) => `<li data-k="${k}" class="${k === 0 ? "ativo" : ""}">${r.html}</li>`).join("")
    : `<li class="vazio">Nada encontrado</li>`;
  $("resultados").hidden = false;
}

function escolherResultado(k) {
  const r = resultados[k];
  if (!r) return;
  $("resultados").hidden = true;
  $("busca").value = "";
  $("busca").blur();
  selecionar(r.sel);
}

$("busca").addEventListener("input", (e) => buscar(e.target.value));
$("busca").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); escolherResultado(ativo); }
  if (e.key === "Escape") { $("resultados").hidden = true; e.target.blur(); }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    ativo = (ativo + (e.key === "ArrowDown" ? 1 : -1) + resultados.length) % Math.max(1, resultados.length);
    document.querySelectorAll("#resultados li").forEach((li, k) => li.classList.toggle("ativo", k === ativo));
  }
});
$("resultados").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-k]");
  if (li) escolherResultado(Number(li.dataset.k));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
    e.preventDefault();
    $("busca").focus();
  }
});

// ---------- câmera e gaveta ----------

document.querySelector(".controles").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cam]");
  if (!b) return;
  ({ mais: () => cena.zoom(0.72), menos: () => cena.zoom(1.38), esq: () => cena.girar(-1), dir: () => cena.girar(1), casa: () => trocarUnidade(estado.unidade) })[b.dataset.cam]();
});
$("alca").addEventListener("click", () => {
  const g = $("gaveta");
  g.classList.toggle("aberta");
  setTimeout(atualizarMargens, 320);
  $("alca").setAttribute("aria-label", g.classList.contains("aberta") ? "Recolher painel" : "Expandir painel");
});

// ---------- eventos ao vivo ----------

function registrarEvento(texto) {
  estado.eventos.unshift({ quando: new Date(), texto });
  estado.eventos.length = Math.min(estado.eventos.length, 40);
  if (estado.aba === "eventos") desenharAbas();
}

function receberSinistro(evento, s, historico) {
  const anterior = estado.sinistros.get(s.id);
  estado.sinistros.set(s.id, s);
  if (historico) estado.historicos.set(s.id, historico);
  else carregarHistorico(s.id, true);
  if (!anterior || anterior.status !== s.status) {
    cena.sinistroAtualizado(anterior ? evento : "Aberto", s);
    const base = `Sinistro <span class="mono">#${s.id}</span> · ${esc(s.motorista)}`;
    registrarEvento(evento === "Aberto" && !anterior ? `${base}: aberto (${NOME_TIPO[s.tipo].toLowerCase()})`
      : s.status === "Aprovado" ? `${base}: aprovado, ${dinheiro.format(s.valorIndenizado)}. Moto a caminho da oficina`
      : `${base}: ${NOME_SITUACAO[s.status].toLowerCase()}`);
  }
  if (estado.foco === s.id || !anterior) estado.foco = s.id;
  redesenhar();
}

function receberMotorista(m) {
  const anterior = estado.motoristas.get(m.motoristaId);
  estado.motoristas.set(m.motoristaId, m);
  cena.atualizarMotorista(m);
  if (!anterior || anterior.status !== m.status) {
    registrarEvento(`${esc(m.nome)}: ${NOME_STATUS[m.status].toLowerCase()}${m.observacao ? ` · ${esc(m.observacao)}` : ""}`);
  }
  redesenhar();
}

function atualizarMargens() {
  const altura = innerHeight;
  // ?so-mapa: esconde os painéis (usado para gravar o GIF do README)
  if (document.body.classList.contains("so-mapa")) return cena.definirMargens({ topo: 0, baixo: 0, direita: 0, esquerda: 0 });
  if (celular) {
    const gaveta = $("gaveta").getBoundingClientRect();
    const kpis = document.querySelector(".kpis").getBoundingClientRect();
    cena.definirMargens({ topo: kpis.bottom, baixo: altura - gaveta.top, direita: 0, esquerda: 0 });
    return;
  }
  const baixo = altura - document.querySelector(".abas").getBoundingClientRect().top;
  const det = $("detalhe");
  const direita = det.hidden ? 70 : innerWidth - det.getBoundingClientRect().left + 60;
  cena.definirMargens({ topo: 175, baixo, direita, esquerda: 0 });
}
addEventListener("resize", atualizarMargens);

let agendado = false;
function redesenhar() {
  // junta várias mudanças seguidas num desenho só
  if (agendado) return;
  agendado = true;
  requestAnimationFrame(() => {
    agendado = false;
    desenharKpis();
    desenharDetalhe();
    desenharAcompanhamento();
    desenharAbas();
    atualizarMargens();
  });
}

function estadoConexao(est, texto) {
  $("conexao").dataset.estado = est;
  $("conexao-texto").textContent = texto;
}

function relogio() { $("relogio").textContent = hora.format(new Date()); }

async function carregar() {
  const [frota, sinistros, apolices] = await Promise.all([
    api("/api/motoristas"),
    api("/api/sinistros?tamanho=60"),
    api("/api/apolices")
  ]);
  estado.motoristas = new Map(frota.map((m) => [m.motoristaId, m]));
  estado.sinistros = new Map(sinistros.map((s) => [s.id, s]));
  estado.apolices = apolices;
  const andamento = sinistros.filter((s) => EM_ANDAMENTO.includes(s.status));
  cena.definirSinistros(andamento);
  cena.definirMotoristas(frota, andamento);
  frota.forEach((m) => cena.atualizarMotorista(m));
  escolherFocoPadrao();
  redesenhar();
}

const conexao = new signalR.HubConnectionBuilder().withUrl("/hubs/frota").withAutomaticReconnect().build();
conexao.on("StatusMotoristaAlterado", receberMotorista);
conexao.on("SinistroAtualizado", ({ evento, sinistro }) => receberSinistro(evento, sinistro));
conexao.onreconnecting(() => estadoConexao("caiu", "Reconectando"));
conexao.onreconnected(async () => { estadoConexao("ok", "Ao vivo"); await carregar(); });
conexao.onclose(() => estadoConexao("caiu", "Desconectado"));

(async function iniciar() {
  if (new URLSearchParams(location.search).has("so-mapa")) document.body.classList.add("so-mapa");
  relogio();
  setInterval(relogio, 10000);
  try {
    await carregar();
    await conexao.start();
    estadoConexao("ok", "Ao vivo");
    registrarEvento("Painel conectado à central");
  } catch (e) {
    estadoConexao("caiu", "Sem conexão");
    avisar(e.message, true);
  }
  $("carregando").classList.add("saiu");
  setInterval(redesenhar, 30000); // atualiza os "há X min"
})();

// atalho para os prints e para depurar no console
window.central = { cena, estado, selecionar, trocarUnidade };
