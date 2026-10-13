// Modo demonstração: a mesma API REST e os mesmos eventos do SignalR, só que em memória,
// para o painel funcionar num site estático (Vercel) sem ASP.NET nem SQL Server.
//
// As regras abaixo espelham o back-end real e não substituem nada dele:
//   abertura  -> sp_AbrirSinistro      (apólice vigente na data, valor positivo, data no passado)
//   transição -> sp_AlterarStatusSinistro + tabela TransicoesSinistro
//   pagamento -> sp_PagarSinistro      (pagar duas vezes dá 409)
//   franquia  -> CalculadoraIndenizacao (domínio C#)
//   simulador -> SimuladorFrota        (BackgroundService)
// Os dados iniciais são os do database/04_seed.sql.

const TRANSICOES = { Aberto: ["EmAnalise"], EmAnalise: ["Aprovado", "Negado"], Aprovado: ["Pago"], Negado: [], Pago: [] };
const SEGURADORA = "Seguradora Exemplo";
const H = 3600e3, DIA = 24 * H, MIN = 60e3;

class ErroApi extends Error {}
const erro = (msg) => { throw new ErroApi(msg); };

const iso = (ms) => new Date(Math.round(ms / 1000) * 1000).toISOString();
const dia = (ms) => new Date(ms).toISOString().slice(0, 10);
const somarMeses = (ms, n) => { const d = new Date(ms); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime(); };
const arred = (v) => Math.round(v * 100) / 100;
const brl = (v) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = (ms) => new Date(ms).toLocaleDateString("pt-BR", { timeZone: "UTC" });

function semear() {
  const agora = Date.now();
  const motoristas = [
    ["Rafael Monteiro", "Centro", "RQB1A23", "Honda CG 160 Cargo"],
    ["Jéssica Andrade", "Centro", "RQC4D56", "Yamaha Factor 150"],
    ["Thiago Ribeiro", "Praia do Canto", "RQD7E89", "Honda CG 160 Cargo"],
    ["Patrícia Lopes", "Praia do Canto", "RQE2F34", "Honda Biz 125"],
    ["Diego Fernandes", "Jardim da Penha", "RQF5G67", "Yamaha Fazer 150"],
    ["Camila Barcelos", "Jardim da Penha", "RQG8H90", "Honda Pop 110i"],
    ["Bruno Teixeira", "Laranjeiras", "RQH3J12", "Honda CG 160 Fan"],
    ["Vanessa Coutinho", "Laranjeiras", "RQJ6K45", "Yamaha Factor 150"]
  ].map(([nome, unidade, placa, modelo], k) => ({ id: k + 1, nome, restaurante: `Sabor de Casa - ${unidade}`, placa, modelo }));

  const ano = new Date(agora).getUTCFullYear();
  // 7 apólices vigentes; a da Vanessa (8) venceu há 20 dias
  const apolices = motoristas.map((m) => {
    const vencida = m.id === 8;
    return {
      id: m.id, motoristaId: m.id, placa: m.placa, seguradora: SEGURADORA,
      numero: `MOTO-${ano}-${String(m.id).padStart(4, "0")}`,
      inicio: vencida ? somarMeses(agora - 20 * DIA, -12) : somarMeses(agora, -8),
      fim: vencida ? agora - 20 * DIA : somarMeses(agora, 4),
      valorCobertura: 12000, franquiaPercentual: 10, franquiaMinima: 400
    };
  });

  // [motorista, tipo, status, dias atrás, descrição, estimado, indenizado] (igual ao seed SQL)
  const linhas = [
    [1, "Acidente", "Pago", 170, "Colisão traseira em semáforo, para-lama e farol quebrados", 3200, 2800],
    [3, "AvariaBau", "Negado", 160, "Tampa do baú rachada (dano abaixo da franquia)", 350, null],
    [2, "Roubo", "Pago", 140, "Moto levada durante entrega, com boletim de ocorrência", 13500, 12000],
    [5, "Acidente", "Pago", 120, "Queda em pista molhada, carenagem e manete", 5400, 4860],
    [8, "AvariaMoto", "Pago", 110, "Retrovisor e pisca arrancados em manobra no estacionamento", 1900, 1500],
    [4, "Acidente", "Negado", 95, "Colisão lateral com carro em conversão", 2600, null],
    [6, "AvariaMoto", "Pago", 80, "Escapamento amassado por queda da moto parada", 2300, 1900],
    [1, "AvariaBau", "Pago", 62, "Baú arrancado em batida leve", 900, 500],
    [7, "Acidente", "Pago", 50, "Colisão com ônibus, roda e suspensão dianteira", 7800, 7020],
    [2, "Acidente", "Aprovado", 35, "Fechada de carro, queda e tanque amassado", 4100, 3690],
    [3, "AvariaMoto", "Aprovado", 21, "Painel quebrado após tentativa de furto", 1500, 1100],
    [5, "Acidente", "EmAnalise", 9, "Batida em buraco, aro empenado e pneu cortado", 6200, null],
    [6, "AvariaBau", "EmAnalise", 4, "Fechadura do baú forçada", 7500, null],
    [4, "Acidente", "Aberto", 1, "Colisão leve com bicicleta, guidão torto", 3000, null],
    [7, "AvariaMoto", "Aberto", 0, "Pneu traseiro furado por prego, câmara e pneu novos", 480, null]
  ];
  const sinistros = [], historico = [];
  linhas.forEach(([mid, tipo, status, dias, descricao, estimado, indenizado], k) => {
    const id = k + 1;
    const ocorr = agora - dias * DIA - (3 + (id % 5)) * H;
    const atualizado = { Aberto: ocorr + H, EmAnalise: ocorr + 20 * H, Pago: ocorr + 7 * DIA }[status] ?? ocorr + 3 * DIA;
    sinistros.push({
      id, apoliceId: mid, motoristaId: mid, tipo, status, descricao, valorEstimado: estimado, valorIndenizado: indenizado,
      dataOcorrencia: ocorr, abertoEm: ocorr + H, atualizadoEm: atualizado, pagoEm: status === "Pago" ? ocorr + 7 * DIA : null
    });
    historico.push([id, null, "Aberto", "Sinistro aberto", "central", ocorr + H]);
    if (status !== "Aberto") historico.push([id, "Aberto", "EmAnalise", "Vistoria agendada", "analista.ana", ocorr + 20 * H]);
    if (["Aprovado", "Negado", "Pago"].includes(status)) {
      const negado = status === "Negado";
      historico.push([id, "EmAnalise", negado ? "Negado" : "Aprovado", negado ? "Negado após vistoria" : "Aprovado conforme laudo da oficina", "analista.ana", ocorr + 3 * DIA]);
    }
    if (status === "Pago") historico.push([id, "Aprovado", "Pago", "Indenização paga", "financeiro", ocorr + 7 * DIA]);
  });

  const inicial = [["EmEntrega", null, 12], ["Disponivel", null, 4], ["EmEntrega", null, 7], ["Ocorrencia", "Colisão leve, aguardando guincho", 30],
    ["EmPausa", "Almoço", 18], ["Disponivel", null, 2], ["EmEntrega", null, 9], ["Disponivel", null, 25]];
  const statusMotorista = new Map(motoristas.map((m, k) => [m.id, { status: inicial[k][0], observacao: inicial[k][1], desde: agora - inicial[k][2] * MIN }]));

  return {
    motoristas, apolices, sinistros, statusMotorista, proximoId: sinistros.length + 1,
    historico: historico.map(([sinistroId, de, para, observacao, usuario, quando]) => ({ sinistroId, de, para, observacao, usuario, quando }))
  };
}

export function criarDemo({ intervaloSimulador = 3000 } = {}) {
  const db = semear();
  const ouvintes = new Map();
  const emitir = (evento, dado) => setTimeout(() => (ouvintes.get(evento) || []).forEach((f) => f(dado)), 0);

  const motorista = (id) => db.motoristas.find((m) => m.id === id) || erro(`Motorista ${id} não encontrado.`);
  const sinistro = (id) => db.sinistros.find((s) => s.id === id) || erro(`Sinistro ${id} não encontrado.`);
  const apolice = (id) => db.apolices.find((a) => a.id === id);
  const vigente = (a, ms) => dia(ms) >= dia(a.inicio) && dia(ms) <= dia(a.fim);

  // ---------- formato das respostas (igual aos DTOs da API) ----------

  function linhaFrota(m) {
    const st = db.statusMotorista.get(m.id);
    return {
      motoristaId: m.id, nome: m.nome, restaurante: m.restaurante, placa: m.placa, modelo: m.modelo,
      status: st.status, observacao: st.observacao, statusDesde: iso(st.desde),
      sinistrosAtivos: db.sinistros.filter((s) => s.motoristaId === m.id && ["Aberto", "EmAnalise", "Aprovado"].includes(s.status)).length
    };
  }

  function item(s) {
    const m = motorista(s.motoristaId), a = apolice(s.apoliceId);
    return {
      id: s.id, status: s.status, tipo: s.tipo, motoristaId: m.id, motorista: m.nome, restaurante: m.restaurante,
      placa: m.placa, numeroApolice: a.numero, valorEstimado: s.valorEstimado, valorIndenizado: s.valorIndenizado,
      dataOcorrencia: iso(s.dataOcorrencia), abertoEm: iso(s.abertoEm), atualizadoEm: iso(s.atualizadoEm),
      pagoEm: s.pagoEm ? iso(s.pagoEm) : null, proximosStatus: TRANSICOES[s.status]
    };
  }

  function detalhe(s) {
    return {
      sinistro: item(s), descricao: s.descricao, seguradora: SEGURADORA,
      historico: db.historico.filter((h) => h.sinistroId === s.id).sort((a, b) => a.quando - b.quando)
        .map((h) => ({ de: h.de, para: h.para, observacao: h.observacao, usuario: h.usuario, alteradoEm: iso(h.quando) }))
    };
  }

  function mudarStatusMotorista(id, status, observacao) {
    motorista(id);
    db.statusMotorista.set(id, { status, observacao: observacao ?? null, desde: Date.now() });
    const linha = linhaFrota(motorista(id));
    emitir("StatusMotoristaAlterado", linha);
    return linha;
  }

  // ---------- regras (espelho das procedures) ----------

  function abrir(corpo, usuario) {
    const m = motorista(Number(corpo.motoristaId));
    const valor = Number(corpo.valorEstimado);
    const quando = new Date(corpo.dataOcorrencia).getTime();
    if (!(valor > 0)) erro("O valor estimado do dano precisa ser positivo.");
    if (!(quando <= Date.now())) erro("A data da ocorrência não pode estar no futuro.");
    const a = db.apolices.filter((x) => x.motoristaId === m.id).sort((x, y) => y.fim - x.fim)[0];
    if (!vigente(a, quando)) erro(`A apólice ${a.numero} não estava vigente em ${dataBr(quando)}.`);
    const agora = Date.now();
    const s = {
      id: db.proximoId++, apoliceId: a.id, motoristaId: m.id, tipo: corpo.tipo, status: "Aberto", descricao: String(corpo.descricao).trim(),
      valorEstimado: valor, valorIndenizado: null, dataOcorrencia: quando, abertoEm: agora, atualizadoEm: agora, pagoEm: null
    };
    db.sinistros.push(s);
    db.historico.push({ sinistroId: s.id, de: null, para: "Aberto", observacao: "Sinistro aberto", usuario, quando: agora });
    const d = detalhe(s);
    emitir("SinistroAtualizado", { evento: "Aberto", sinistro: d.sinistro });
    mudarStatusMotorista(m.id, "Ocorrencia", `Sinistro #${s.id}`);
    return d;
  }

  function indenizacao(s, valorApurado) {
    const a = apolice(s.apoliceId);
    if (valorApurado < 0) erro("O valor apurado não pode ser negativo.");
    const base = Math.min(valorApurado, a.valorCobertura);
    if (s.tipo === "Roubo") return { base, franquia: 0, valor: arred(base) };
    const franquia = arred(Math.max(base * a.franquiaPercentual / 100, a.franquiaMinima));
    return { base, franquia, valor: Math.max(0, arred(base - franquia)) };
  }

  function transicionar(s, novo, observacao, usuario, valorIndenizado = null) {
    if (s.status === "Pago" && novo === "Pago") erro(`O sinistro ${s.id} já foi pago.`);
    if (!TRANSICOES[s.status].includes(novo)) erro(`Transição de ${s.status} para ${novo} não é permitida.`);
    const agora = Date.now();
    const anterior = s.status;
    s.status = novo;
    s.atualizadoEm = agora;
    if (valorIndenizado != null) s.valorIndenizado = valorIndenizado;
    if (novo === "Pago") s.pagoEm = agora;
    db.historico.push({ sinistroId: s.id, de: anterior, para: novo, observacao: observacao ?? (novo === "Pago" ? "Indenização paga" : null), usuario, quando: agora });
    const d = detalhe(s);
    emitir("SinistroAtualizado", { evento: novo === "Pago" ? "Pago" : "StatusAlterado", sinistro: d.sinistro });
    return d;
  }

  function alterarStatus(s, corpo, usuario) {
    const novo = corpo.novoStatus;
    if (novo === "Aprovado") {
      if (!TRANSICOES[s.status].includes(novo)) erro(`Transição de ${s.status} para ${novo} não é permitida.`);
      const c = indenizacao(s, Number(corpo.valorApurado ?? s.valorEstimado));
      if (c.valor <= 0) erro(`O dano (R$ ${brl(c.base)}) não passa da franquia (R$ ${brl(c.franquia)}). Negue o sinistro.`);
      return transicionar(s, novo, corpo.observacao, usuario, c.valor);
    }
    return transicionar(s, novo, corpo.observacao, usuario);
  }

  // ---------- roteador: mesmos caminhos da API REST ----------

  async function api(caminho, opcoes = {}) {
    await new Promise((r) => setTimeout(r, 90)); // um pouco de "rede" para a interface se comportar igual
    const metodo = (opcoes.method || "GET").toUpperCase();
    const url = new URL(caminho, location.origin);
    const p = url.pathname;
    const corpo = opcoes.body ? JSON.parse(opcoes.body) : {};
    const usuario = opcoes.headers?.["X-Usuario"] || "central";
    let r;
    try {
      if (metodo === "GET" && p === "/api/motoristas") r = db.motoristas.map(linhaFrota);
      else if (metodo === "GET" && (r = p.match(/^\/api\/motoristas\/(\d+)$/))) r = linhaFrota(motorista(Number(r[1])));
      else if (metodo === "PUT" && (r = p.match(/^\/api\/motoristas\/(\d+)\/status$/))) r = mudarStatusMotorista(Number(r[1]), corpo.status, corpo.observacao);
      else if (metodo === "GET" && p === "/api/apolices") {
        const hoje = dia(Date.now());
        r = db.apolices.map((a) => ({
          id: a.id, numero: a.numero, seguradora: a.seguradora, placa: a.placa, motoristaId: a.motoristaId,
          inicioVigencia: dia(a.inicio), fimVigencia: dia(a.fim), valorCobertura: a.valorCobertura,
          franquiaPercentual: a.franquiaPercentual, franquiaMinima: a.franquiaMinima, vigenteHoje: dia(a.inicio) <= hoje && dia(a.fim) >= hoje
        }));
      } else if (metodo === "GET" && p === "/api/sinistros") {
        const tamanho = Number(url.searchParams.get("tamanho") || 50);
        r = [...db.sinistros].sort((a, b) => b.abertoEm - a.abertoEm || b.id - a.id).slice(0, tamanho).map(item);
      } else if (metodo === "GET" && (r = p.match(/^\/api\/sinistros\/(\d+)$/))) r = detalhe(sinistro(Number(r[1])));
      else if (metodo === "POST" && p === "/api/sinistros") r = abrir(corpo, usuario);
      else if (metodo === "POST" && (r = p.match(/^\/api\/sinistros\/(\d+)\/transicoes$/))) r = alterarStatus(sinistro(Number(r[1])), corpo, usuario);
      else if (metodo === "POST" && (r = p.match(/^\/api\/sinistros\/(\d+)\/pagamento$/))) r = transicionar(sinistro(Number(r[1])), "Pago", corpo.observacao, usuario);
      else erro(`Rota ${metodo} ${p} não existe no modo demonstração.`);
    } catch (e) {
      throw e instanceof ErroApi ? new Error(e.message) : e;
    }
    return structuredClone(r);
  }

  // ---------- simulador (mesmas regras do SimuladorFrota) ----------

  function passo() {
    const m = db.motoristas[Math.floor(Math.random() * db.motoristas.length)];
    const st = db.statusMotorista.get(m.id);
    const seg = (Date.now() - st.desde) / 1000;
    if (st.status === "Disponivel") {
      if (Math.random() < 0.75) mudarStatusMotorista(m.id, "EmEntrega", `Pedido #${4000 + Math.floor(Math.random() * 6000)}`);
      else mudarStatusMotorista(m.id, "EmPausa", "Pausa");
    } else if (st.status === "EmEntrega" && seg > 8) {
      if (Math.random() < 0.85) mudarStatusMotorista(m.id, "Disponivel", "Entrega concluída");
      else mudarStatusMotorista(m.id, "EmPausa", "Abastecendo");
    } else if (st.status === "EmPausa" && seg > 15) {
      mudarStatusMotorista(m.id, "Disponivel", null);
    }
    // Ocorrência fica parada até a central liberar
  }

  // ---------- conexão no formato do HubConnection do SignalR ----------

  const conexao = {
    on(evento, f) { ouvintes.set(evento, [...(ouvintes.get(evento) || []), f]); },
    onreconnecting() {}, onreconnected() {}, onclose() {},
    async start() { setInterval(passo, intervaloSimulador); }
  };

  return { api, conexao };
}
