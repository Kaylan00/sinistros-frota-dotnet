// Painel da central: carrega o estado pela API REST e depois só escuta o SignalR.
"use strict";

const NOMES_STATUS = { Disponivel: "Disponível", EmEntrega: "Em entrega", EmPausa: "Em pausa", Ocorrencia: "Ocorrência" };
const NOMES_SITUACAO = { Aberto: "Aberto", EmAnalise: "Em análise", Aprovado: "Aprovado", Negado: "Negado", Pago: "Pago" };
const NOMES_TIPO = { Acidente: "Acidente", Roubo: "Roubo", AvariaMoto: "Avaria da moto", AvariaBau: "Avaria do baú" };
const EM_ANDAMENTO = ["Aberto", "EmAnalise", "Aprovado"];

const motoristas = new Map(); // motoristaId -> linha da vw_MotoristasStatusAtual
const fila = new Map();       // sinistroId  -> sinistro

const $ = (id) => document.getElementById(id);
const dinheiro = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dataCurta = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function haQuanto(iso) {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)} d`;
}

// ---------- API ----------

async function api(caminho, opcoes = {}) {
  const resp = await fetch(caminho, {
    ...opcoes,
    headers: { "content-type": "application/json", "X-Usuario": "central.painel", ...(opcoes.headers || {}) }
  });
  if (resp.ok) return resp.status === 204 ? null : resp.json();
  let mensagem = `Erro ${resp.status}`;
  try {
    const problema = await resp.json(); // ProblemDetails
    mensagem = problema.detail || Object.values(problema.errors || {}).flat()[0] || problema.title || mensagem;
  } catch { /* corpo vazio */ }
  throw new Error(mensagem);
}

function avisar(texto, erro = false) {
  const el = $("aviso");
  el.textContent = texto;
  el.className = erro ? "aviso erro" : "aviso";
  el.hidden = false;
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => (el.hidden = true), 4200);
}

// ---------- Frota ----------

function desenharFrota(destacarId) {
  const linhas = [...motoristas.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  $("frota").innerHTML = linhas.map((m) => `
    <tr data-id="${m.motoristaId}" class="${m.motoristaId === destacarId ? "mudou" : ""}">
      <td><span class="nome">${esc(m.nome)}</span><span class="menor">${esc(m.restaurante.replace("Sabor de Casa - ", ""))}</span></td>
      <td><span class="mono">${esc(m.placa)}</span><span class="menor">${esc(m.modelo)}</span></td>
      <td><span class="status s-${m.status}">${NOMES_STATUS[m.status]}</span>${m.observacao ? `<span class="menor">${esc(m.observacao)}</span>` : ""}</td>
      <td class="dir">${m.status === "Ocorrencia" ? `<button class="botao liberar" data-liberar="${m.motoristaId}">Liberar</button>` : ""}<span class="desde" data-desde="${m.statusDesde ?? ""}">${haQuanto(m.statusDesde)}</span></td>
    </tr>`).join("");

  const contagem = { Disponivel: 0, EmEntrega: 0, EmPausa: 0, Ocorrencia: 0 };
  linhas.forEach((m) => contagem[m.status]++);
  Object.entries(contagem).forEach(([s, n]) => ($(`n-${s}`).textContent = n));
  $("frota-total").textContent = `${linhas.length} motoboys ativos`;
  preencherSelectMotoristas(linhas);
}

function preencherSelectMotoristas(linhas) {
  const sel = $("sel-motorista");
  const atual = sel.value;
  sel.innerHTML = linhas.map((m) => `<option value="${m.motoristaId}">${esc(m.nome)} (${esc(m.placa)})</option>`).join("");
  if (atual) sel.value = atual;
}

// ---------- Fila de sinistros ----------

function botoes(s) {
  switch (s.status) {
    case "Aberto": return `<button class="botao" data-acao="EmAnalise" data-id="${s.id}">Iniciar análise</button>`;
    case "EmAnalise": return `<button class="botao" data-acao="Aprovado" data-id="${s.id}">Aprovar</button>
                              <button class="botao perigo" data-acao="Negado" data-id="${s.id}">Negar</button>`;
    case "Aprovado": return `<button class="botao primario" data-acao="Pagar" data-id="${s.id}">Pagar</button>`;
    default: return "";
  }
}

function desenharFila(destacarId) {
  const itens = [...fila.values()].sort((a, b) => new Date(b.abertoEm) - new Date(a.abertoEm));
  $("fila").innerHTML = itens.map((s) => {
    const valor = s.valorIndenizado != null
      ? `${dinheiro.format(s.valorIndenizado)}<span class="menor">estimado ${dinheiro.format(s.valorEstimado)}</span>`
      : `${dinheiro.format(s.valorEstimado)}<span class="menor">estimado</span>`;
    return `
      <tr class="${s.id === destacarId ? "mudou" : ""}">
        <td class="mono">${s.id}</td>
        <td><span class="nome">${NOMES_TIPO[s.tipo]} · ${esc(s.motorista)}</span>
            <span class="menor"><span class="mono">${esc(s.placa)}</span> · ${dataCurta.format(new Date(s.dataOcorrencia))} · aberto há ${haQuanto(s.abertoEm)}</span></td>
        <td class="dir mono">${valor}</td>
        <td><span class="situacao x-${s.status}">${NOMES_SITUACAO[s.status]}</span></td>
        <td><div class="acoes">${botoes(s)}</div></td>
      </tr>`;
  }).join("");

  const andamento = itens.filter((s) => s.status === "Aberto" || s.status === "EmAnalise").length;
  const aPagar = itens.filter((s) => s.status === "Aprovado").reduce((t, s) => t + (s.valorIndenizado || 0), 0);
  $("n-abertos").textContent = andamento;
  $("n-apagar").textContent = dinheiro.format(aPagar);
  $("fila-vazia").hidden = itens.length > 0;
}

// a view vw_SinistrosEmAberto usa "sinistroId"; os eventos usam "id"
const normalizar = (s) => ({ ...s, id: s.id ?? s.sinistroId });

function receberSinistro(s) {
  fila.set(s.id, s);
  desenharFila(s.id);
  if (!EM_ANDAMENTO.includes(s.status)) {
    // pago ou negado: mostra o resultado por alguns segundos e tira da fila
    setTimeout(() => { fila.delete(s.id); desenharFila(); }, 5000);
  }
}

// ---------- Eventos ----------

function registrarEvento(texto) {
  const li = document.createElement("li");
  li.innerHTML = `<time>${hora.format(new Date())}</time><span>${texto}</span>`;
  const lista = $("eventos");
  lista.prepend(li);
  while (lista.children.length > 30) lista.lastChild.remove();
}

function textoSinistro(evento, s) {
  const base = `Sinistro <span class="mono">#${s.id}</span> (${esc(s.motorista)})`;
  if (evento === "Aberto") return `${base} aberto: ${NOMES_TIPO[s.tipo].toLowerCase()}, ${dinheiro.format(s.valorEstimado)}`;
  if (s.status === "Aprovado") return `${base} aprovado: indenização de ${dinheiro.format(s.valorIndenizado)}`;
  if (s.status === "Pago") return `${base} pago`;
  return `${base} agora está <span class="situacao x-${s.status}">${NOMES_SITUACAO[s.status].toLowerCase()}</span>`;
}

// ---------- Ações ----------

let sinistroParaAprovar = null;

$("fila").addEventListener("click", async (ev) => {
  const botao = ev.target.closest("button[data-acao]");
  if (!botao) return;
  const id = Number(botao.dataset.id);
  const acao = botao.dataset.acao;

  if (acao === "Aprovado") {
    sinistroParaAprovar = fila.get(id);
    $("aprovar-titulo").textContent = `Aprovar sinistro #${id}`;
    $("form-aprovar").valorApurado.value = sinistroParaAprovar.valorEstimado;
    $("dlg-aprovar").showModal();
    return;
  }

  botao.disabled = true;
  try {
    const r = acao === "Pagar"
      ? await api(`/api/sinistros/${id}/pagamento`, { method: "POST", body: "{}" })
      : await api(`/api/sinistros/${id}/transicoes`, { method: "POST", body: JSON.stringify({ novoStatus: acao }) });
    receberSinistro(r.sinistro);
  } catch (e) {
    avisar(e.message, true);
    botao.disabled = false;
  }
});

$("dlg-aprovar").addEventListener("close", async () => {
  if ($("dlg-aprovar").returnValue !== "ok" || !sinistroParaAprovar) return;
  const valorApurado = Number($("form-aprovar").valorApurado.value);
  try {
    const r = await api(`/api/sinistros/${sinistroParaAprovar.id}/transicoes`, {
      method: "POST", body: JSON.stringify({ novoStatus: "Aprovado", valorApurado })
    });
    receberSinistro(r.sinistro);
  } catch (e) {
    avisar(e.message, true);
  }
});

$("frota").addEventListener("click", async (ev) => {
  const botao = ev.target.closest("button[data-liberar]");
  if (!botao) return;
  botao.disabled = true;
  try {
    await api(`/api/motoristas/${botao.dataset.liberar}/status`, {
      method: "PUT", body: JSON.stringify({ status: "Disponivel", observacao: "Liberado pela central" })
    });
  } catch (e) {
    avisar(e.message, true);
    botao.disabled = false;
  }
});

$("abrir-novo").addEventListener("click", () => $("dlg-novo").showModal());

$("dlg-novo").addEventListener("close", async () => {
  if ($("dlg-novo").returnValue !== "ok") return;
  const f = $("form-novo");
  const corpo = {
    motoristaId: Number(f.motoristaId.value),
    tipo: f.tipo.value,
    valorEstimado: Number(f.valorEstimado.value),
    descricao: f.descricao.value,
    dataOcorrencia: new Date(Date.now() - 20 * 60000).toISOString()
  };
  try {
    const r = await api("/api/sinistros", { method: "POST", body: JSON.stringify(corpo) });
    receberSinistro(r.sinistro);
    avisar(`Sinistro #${r.sinistro.id} aberto.`);
  } catch (e) {
    avisar(e.message, true);
  }
});

// ---------- Inicialização e SignalR ----------

async function carregar() {
  const [frota, abertos] = await Promise.all([api("/api/motoristas"), api("/api/sinistros/em-aberto")]);
  motoristas.clear();
  frota.forEach((m) => motoristas.set(m.motoristaId, m));
  fila.clear();
  abertos.map(normalizar).forEach((s) => fila.set(s.id, s));
  desenharFrota();
  desenharFila();
}

function estadoConexao(estado, texto) {
  $("conexao").dataset.estado = estado;
  $("conexao-texto").textContent = texto;
}

const conexao = new signalR.HubConnectionBuilder()
  .withUrl("/hubs/frota")
  .withAutomaticReconnect()
  .build();

conexao.on("StatusMotoristaAlterado", (m) => {
  const anterior = motoristas.get(m.motoristaId);
  motoristas.set(m.motoristaId, m);
  desenharFrota(m.motoristaId);
  if (!anterior || anterior.status !== m.status) {
    registrarEvento(`${esc(m.nome)}: <span class="status s-${m.status}">${NOMES_STATUS[m.status]}</span>${m.observacao ? ` · ${esc(m.observacao)}` : ""}`);
  }
});

conexao.on("SinistroAtualizado", ({ evento, sinistro }) => {
  receberSinistro(sinistro);
  registrarEvento(textoSinistro(evento, sinistro));
});

conexao.onreconnecting(() => estadoConexao("caiu", "Reconectando"));
conexao.onreconnected(async () => { estadoConexao("ok", "Ao vivo"); await carregar(); });
conexao.onclose(() => estadoConexao("caiu", "Desconectado"));

(async function iniciar() {
  try {
    await carregar();
    await conexao.start();
    estadoConexao("ok", "Ao vivo");
  } catch (e) {
    estadoConexao("caiu", "Sem conexão");
    avisar(e.message, true);
  }
  // atualiza os "há X min" sem esperar evento
  setInterval(() => {
    document.querySelectorAll("[data-desde]").forEach((td) => (td.textContent = haQuanto(td.dataset.desde)));
  }, 15000);
})();
