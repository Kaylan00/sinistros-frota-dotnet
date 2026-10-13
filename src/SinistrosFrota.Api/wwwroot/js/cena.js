// Cena 3D: renderizador, câmera de "jogo de estratégia", motos, marcadores e rótulos.
import * as THREE from "three";
import {
  CORES, UNIDADES, OFICINA, COZINHA, SEGURADORA, COLS, LINHAS, S, MEIO_FIO,
  montarCidade, vagasDoBloco, centroBloco, posNo, direita
} from "./cidade.js";
import { criarMotoMalha, criarCarro, Piloto } from "./moto.js";

export const COR_STATUS = { Disponivel: 0x1f9d63, EmEntrega: 0x2f5bea, EmPausa: 0xd48a0c, Ocorrencia: 0xe0453a };
const COR_SINISTRO = { Aberto: 0xe0453a, EmAnalise: 0xd48a0c, Aprovado: 0x2f5bea };
const EM_ANDAMENTO = ["Aberto", "EmAnalise", "Aprovado"];

const ELEVACAO = THREE.MathUtils.degToRad(36);

export class Cena {
  constructor(container, { reduzido = false, celular = false } = {}) {
    this.container = container;
    this.reduzido = reduzido;
    this.motos = new Map();      // motoristaId -> { malha, piloto, dados, rotulo }
    this.marcadores = new Map(); // sinistroId  -> { grupo, dados, rotulo, cones }
    this.selecionado = null;     // { tipo: 'moto' | 'sinistro', id }
    this.aoSelecionar = () => {};
    this.relogio = new THREE.Clock();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.cena = new THREE.Scene();
    this.cena.background = new THREE.Color(CORES.fundo);
    this.cena.fog = new THREE.Fog(CORES.fundo, 260, 560);

    this.cena.add(new THREE.HemisphereLight(0xffffff, 0xc7cbe2, 1.35));
    const sol = new THREE.DirectionalLight(0xffffff, 1.9);
    sol.position.set(-60, 110, 50);
    sol.castShadow = true;
    sol.shadow.mapSize.set(celular ? 2048 : 4096, celular ? 2048 : 4096);
    const sc = sol.shadow.camera;
    sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120; sc.near = 10; sc.far = 300;
    sol.shadow.bias = -0.0004;
    sol.shadow.normalBias = 0.04;
    sol.shadow.radius = 4;
    this.cena.add(sol);

    montarCidade(this.cena);
    this.cena.updateMatrixWorld(true);
    for (const c of this.cena.userData.construcoes) c.userData.caixa = new THREE.Box3().setFromObject(c);

    this.vagasUnidade = new Map(UNIDADES.map((u) => [u.nome, vagasDoBloco(u.bloco, 6)]));
    this.vagasOficina = vagasDoBloco(OFICINA.bloco, 6);
    this.unidadePorNome = new Map(UNIDADES.map((u) => [u.nome, u]));

    // câmera: perspectiva com campo de visão fechado, que dá o ar isométrico
    this.camera = new THREE.PerspectiveCamera(26, 1, 1, 2000);
    this.margens = { topo: 0, direita: 0, baixo: 0, esquerda: 0 };
    this.margensDesejadas = { ...this.margens };
    this.vista = { alvo: new THREE.Vector3(0, 0, 4), dist: 300, azimute: Math.PI / 4 };
    this.vistaDesejada = { alvo: this.vista.alvo.clone(), dist: this.vista.dist, azimute: this.vista.azimute };
    // o alvo fica um pouco "para baixo" porque os painéis de baixo cobrem parte do mapa
    this.casa = { alvo: new THREE.Vector3(2, 0, 4), dist: celular ? 300 : 215, azimute: Math.PI / 4 };
    this.irPara(this.casa, true);
    this.seguindo = null;

    this.camadaRotulos = document.createElement("div");
    this.camadaRotulos.className = "rotulos";
    container.appendChild(this.camadaRotulos);

    this.carros = [];
    this.criarTransito(reduzido ? 0 : (celular ? 4 : 7));
    this.raycaster = new THREE.Raycaster();
    this.ligarControles();
    new ResizeObserver(() => this.redimensionar()).observe(container);
    this.redimensionar();
    this.renderer.setAnimationLoop(() => this.quadro());
  }

  // ---------- câmera ----------

  irPara({ alvo, dist, azimute }, instantaneo = false) {
    if (alvo) this.vistaDesejada.alvo.copy(alvo);
    if (dist) this.vistaDesejada.dist = THREE.MathUtils.clamp(dist, 40, 520);
    if (azimute !== undefined) this.vistaDesejada.azimute = azimute;
    if (instantaneo || this.reduzido) {
      this.vista.alvo.copy(this.vistaDesejada.alvo);
      this.vista.dist = this.vistaDesejada.dist;
      this.vista.azimute = this.vistaDesejada.azimute;
    }
  }

  zoom(fator) { this.irPara({ dist: this.vistaDesejada.dist * fator }); }
  girar(sentido) { this.irPara({ azimute: this.vistaDesejada.azimute + sentido * Math.PI / 4 }); }
  inicio() { this.seguindo = null; this.irPara(this.casa); }

  voarParaUnidade(nome) {
    this.seguindo = null;
    const u = this.unidadePorNome.get(nome);
    if (!u) return this.inicio();
    const c = centroBloco(u.bloco);
    this.irPara({ alvo: new THREE.Vector3(c.x, 0, c.z + 8), dist: 120 });
  }

  // área do mapa coberta pelos painéis: a câmera centraliza no pedaço que sobra visível
  definirMargens(m) { this.margensDesejadas = { ...this.margensDesejadas, ...m }; }

  // perto do chão a câmera sobe um pouco, para os prédios não taparem tanto
  elevacao() {
    const k = THREE.MathUtils.clamp((this.vista.dist - 60) / 160, 0, 1);
    return THREE.MathUtils.lerp(THREE.MathUtils.degToRad(52), ELEVACAO, k);
  }

  // prédio entre a câmera e o objeto selecionado fica translúcido
  esmaecerOclusores(dt) {
    const lista = this.cena.userData.construcoes;
    let alvo = null;
    if (this.selecionado?.tipo === "moto") alvo = this.motos.get(this.selecionado.id)?.malha.raiz.position;
    if (this.selecionado?.tipo === "sinistro") alvo = this.marcadores.get(this.selecionado.id)?.grupo.position;
    const tapando = new Set();
    if (alvo) {
      // testa raios até três alturas do alvo contra a caixa de cada construção
      // (caixa é mais generosa que a malha: pega também telhado, placa e caixa d'água)
      const raio = new THREE.Ray();
      const ponto = new THREE.Vector3();
      for (const altura of [0.4, 2, 4.5]) {
        const destino = alvo.clone().add(new THREE.Vector3(0, altura, 0));
        const dist = destino.distanceTo(this.camera.position);
        raio.set(this.camera.position, destino.sub(this.camera.position).normalize());
        for (const c of lista) {
          if (tapando.has(c)) continue;
          const caixa = c.userData.caixa;
          if (caixa.containsPoint(alvo)) continue;
          if (raio.intersectBox(caixa, ponto) && ponto.distanceTo(this.camera.position) < dist - 0.5) tapando.add(c);
        }
      }
    }
    for (const c of lista) {
      const desejada = tapando.has(c) ? 0.16 : 1;
      if (Math.abs(c.userData.opacidade - desejada) < 0.01 && !(desejada < 1 && c.userData.opacidade === 1)) continue;
      c.userData.opacidade += (desejada - c.userData.opacidade) * (this.reduzido ? 1 : Math.min(1, dt * 8));
      if (Math.abs(c.userData.opacidade - desejada) < 0.02) c.userData.opacidade = desejada;
      const op = c.userData.opacidade;
      c.traverse((m) => {
        if (!m.isMesh) return;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          mat.transparent = op < 1;
          mat.opacity = op;
          mat.depthWrite = op >= 1;
        }
        m.castShadow = op >= 1 ? m.userData.sombraOriginal ?? true : m.castShadow;
      });
    }
  }

  aplicarCamera() {
    const v = this.vista;
    const md = this.margensDesejadas, ma = this.margens;
    const k = this.reduzido ? 1 : 0.12;
    for (const lado of ["topo", "direita", "baixo", "esquerda"]) ma[lado] += (md[lado] - ma[lado]) * k;
    if (this.largura) this.camera.setViewOffset(this.largura, this.altura, (ma.direita - ma.esquerda) / 2, (ma.baixo - ma.topo) / 2, this.largura, this.altura);
    const el = this.elevacao();
    const h = Math.cos(el) * v.dist;
    this.camera.position.set(
      v.alvo.x + Math.sin(v.azimute) * h,
      v.alvo.y + Math.sin(el) * v.dist,
      v.alvo.z + Math.cos(v.azimute) * h);
    this.camera.lookAt(v.alvo);
  }

  pontoNoChao(x, y) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }

  ligarControles() {
    const el = this.renderer.domElement;
    const ponteiros = new Map();
    let arrastou = false, inicioPinca = 0, distInicio = 0, ancora = null;

    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
      arrastou = false;
      if (ponteiros.size === 1) ancora = this.pontoNoChao(e.clientX, e.clientY);
      if (ponteiros.size === 2) {
        const [a, b] = [...ponteiros.values()];
        inicioPinca = Math.hypot(a.x - b.x, a.y - b.y);
        distInicio = this.vistaDesejada.dist;
      }
    });

    el.addEventListener("pointermove", (e) => {
      const p = ponteiros.get(e.pointerId);
      if (!p) {
        this.passarPor(e.clientX, e.clientY);
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > 5) arrastou = true;
      if (ponteiros.size === 2) {
        const [a, b] = [...ponteiros.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (inicioPinca > 0) this.irPara({ dist: distInicio * inicioPinca / d }, true);
        return;
      }
      if (arrastou && ancora) {
        // arrasta o chão: o ponto agarrado continua embaixo do dedo
        this.seguindo = null;
        const agora = this.pontoNoChao(e.clientX, e.clientY);
        if (agora) {
          const delta = ancora.clone().sub(agora);
          this.vista.alvo.add(delta);
          this.vistaDesejada.alvo.copy(this.vista.alvo);
          this.aplicarCamera();
        }
      }
    });

    const soltar = (e) => {
      const p = ponteiros.get(e.pointerId);
      ponteiros.delete(e.pointerId);
      if (p && !arrastou && ponteiros.size === 0 && e.type === "pointerup") this.clicar(e.clientX, e.clientY);
      if (ponteiros.size === 1) ancora = this.pontoNoChao([...ponteiros.values()][0].x, [...ponteiros.values()][0].y);
    };
    el.addEventListener("pointerup", soltar);
    el.addEventListener("pointercancel", soltar);

    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.irPara({ dist: this.vistaDesejada.dist * Math.exp(e.deltaY * 0.0012) });
    }, { passive: false });
  }

  objetoEm(x, y) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const alvos = [...[...this.motos.values()].map((m) => m.malha.raiz), ...[...this.marcadores.values()].map((m) => m.grupo)];
    for (const hit of this.raycaster.intersectObjects(alvos, true)) {
      for (let o = hit.object; o; o = o.parent) if (o.userData.tipo) return o.userData;
    }
    return null;
  }

  passarPor(x, y) {
    this.renderer.domElement.style.cursor = this.objetoEm(x, y) ? "pointer" : "grab";
  }

  clicar(x, y) {
    const alvo = this.objetoEm(x, y);
    if (alvo) this.aoSelecionar(alvo);
  }

  selecionar(sel) {
    this.selecionado = sel;
    if (!sel) { this.seguindo = null; return; }
    if (sel.tipo === "moto" && this.motos.has(sel.id)) {
      this.seguindo = sel.id;
      this.irPara({ dist: Math.min(this.vistaDesejada.dist, 95) });
    } else if (sel.tipo === "sinistro" && this.marcadores.has(sel.id)) {
      this.seguindo = null;
      this.irPara({ alvo: this.marcadores.get(sel.id).grupo.position.clone(), dist: Math.min(this.vistaDesejada.dist, 85) });
    }
  }

  // ---------- motos ----------

  definirMotoristas(lista, sinistrosAbertos = []) {
    lista.forEach((m, indice) => {
      if (this.motos.has(m.motoristaId)) return this.atualizarMotorista(m);
      const unidade = this.unidadePorNome.get(m.restaurante) || UNIDADES[0];
      const malha = criarMotoMalha(unidade.cor);
      malha.raiz.userData = { tipo: "moto", id: m.motoristaId };
      malha.raiz.scale.setScalar(1.4); // um pouco maior que o real, como em jogo, para ler de longe
      this.cena.add(malha.raiz);
      const piloto = new Piloto(malha, this.reduzido);
      const rotulo = this.criarRotulo("rotulo-moto");
      const moto = { malha, piloto, dados: m, rotulo, unidade, indice, oficinaAte: 0 };
      this.motos.set(m.motoristaId, moto);
      this.posicaoInicial(moto, sinistrosAbertos);
      this.aplicarStatus(moto, true);
    });
  }

  vagaDaUnidade(moto) {
    const vagas = this.vagasUnidade.get(moto.unidade.nome);
    const colegas = [...this.motos.values()].filter((o) => o.unidade === moto.unidade).sort((a, b) => a.dados.motoristaId - b.dados.motoristaId);
    return vagas[Math.max(0, colegas.indexOf(moto)) % vagas.length];
  }

  posicaoInicial(moto, sinistrosAbertos) {
    const { piloto, dados } = moto;
    const s = sinistrosAbertos.filter((x) => x.motoristaId === dados.motoristaId && x.status !== "Aprovado").sort((a, b) => b.id - a.id)[0];
    if (dados.status === "Ocorrencia" && s) {
      const p = this.localDoSinistro(s.id);
      piloto.posicionarNaRua(p.noA, p.noB, p.t);
      return;
    }
    if (dados.status === "Disponivel") return piloto.posicionarNaVaga(this.vagaDaUnidade(moto));
    // espalha os demais pelas ruas de forma estável
    const h = hash(dados.motoristaId * 7919);
    const { noA, noB, t } = arestaPorHash(h);
    piloto.posicionarNaRua(noA, noB, t);
  }

  atualizarMotorista(m) {
    const moto = this.motos.get(m.motoristaId);
    if (!moto) return;
    const mudou = moto.dados.status !== m.status;
    moto.dados = m;
    if (mudou) this.aplicarStatus(moto, false);
  }

  aplicarStatus(moto, inicial) {
    const { piloto, malha, dados } = moto;
    const status = dados.status;
    malha.anel.material.color.setHex(COR_STATUS[status]);
    const ocorrencia = status === "Ocorrencia";

    // moto levada para a oficina fica lá até a central liberar o motoboy
    if (moto.naOficina) {
      if (ocorrencia) return;
      moto.naOficina = false;
    }

    piloto.tombada = ocorrencia;
    malha.piloto.visible = !ocorrencia;
    malha.emPe.visible = ocorrencia;
    malha.alerta.visible = ocorrencia;
    if (ocorrencia && this.reduzido) piloto.inclinacao = 1.35;

    piloto.modo = status;
    if (ocorrencia) {
      piloto.parar();
    } else if (status === "EmEntrega") {
      piloto.modo = "passeio";
      piloto.velMax = 7 + (dados.motoristaId % 3) * 0.6;
      piloto.passear();
    } else if (status === "Disponivel") {
      piloto.velMax = 6.5;
      const vaga = this.vagaDaUnidade(moto);
      if (inicial) piloto.posicionarNaVaga(vaga);
      else piloto.rotaParaVaga(vaga);
    } else if (status === "EmPausa") {
      if (!inicial) piloto.encostar();
    }
  }

  levarParaOficina(motoristaId) {
    const moto = this.motos.get(motoristaId);
    if (!moto) return;
    const vaga = this.vagasOficina[motoristaId % this.vagasOficina.length];
    const { piloto, malha } = moto;
    moto.naOficina = true;
    piloto.tombada = false;
    piloto.inclinacao = 0;
    malha.piloto.visible = true;
    malha.emPe.visible = false;
    malha.alerta.visible = false;
    piloto.modo = "oficina";
    piloto.velMax = 6;
    piloto.rotaParaVaga(vaga, () => {
      // chegou: desce da moto e espera o reparo
      if (!moto.naOficina) return;
      malha.piloto.visible = false;
      malha.emPe.visible = true;
    });
  }

  // ---------- trânsito de fundo (carros que só passeiam) ----------

  criarTransito(quantidade) {
    const cores = [0xffffff, 0xdfe6fb, 0xc9d0e2, 0xffffff, 0x9fb4f2, 0xe9e3d8];
    this.carros = [];
    for (let k = 0; k < quantidade; k++) {
      const malha = criarCarro(cores[k % cores.length]);
      this.cena.add(malha.raiz);
      const piloto = new Piloto(malha, false);
      const { noA, noB, t } = arestaPorHash(hash(5000 + k * 31));
      piloto.posicionarNaRua(noA, noB, t);
      piloto.velMax = 5 + (k % 3);
      piloto.modo = "passeio";
      piloto.passear();
      this.carros.push(piloto);
    }
  }

  // ---------- sinistros no mapa ----------

  localDoSinistro(id) {
    const salvo = this.locais?.get(id);
    if (salvo) return salvo;
    return arestaPorHash(hash(id * 104729 + 17));
  }

  definirSinistros(lista) {
    this.locais ??= new Map();
    const ids = new Set();
    for (const s of lista.filter((x) => EM_ANDAMENTO.includes(x.status))) {
      ids.add(s.id);
      this.colocarMarcador(s);
    }
    for (const id of [...this.marcadores.keys()]) if (!ids.has(id)) this.removerMarcador(id);
  }

  sinistroAtualizado(evento, s) {
    this.locais ??= new Map();
    if (evento === "Aberto") {
      // o marcador nasce onde a moto está agora
      const moto = this.motos.get(s.motoristaId);
      if (moto) {
        const ar = moto.piloto.arestaAtual();
        const a = posNo(ar.de), b = posNo(ar.para);
        const t = THREE.MathUtils.clamp(moto.piloto.pos.clone().sub(a).dot(b.clone().sub(a)) / a.distanceToSquared(b), 0.15, 0.85);
        this.locais.set(s.id, { noA: ar.de, noB: ar.para, t });
      }
    }
    if (EM_ANDAMENTO.includes(s.status)) this.colocarMarcador(s);
    else setTimeout(() => this.removerMarcador(s.id), 2500);
    if (s.status === "Aprovado" && evento !== "Aberto") this.levarParaOficina(s.motoristaId);
  }

  colocarMarcador(s) {
    let m = this.marcadores.get(s.id);
    const cor = COR_SINISTRO[s.status] ?? 0x8a93a8;
    if (!m) {
      const grupo = new THREE.Group();
      grupo.userData = { tipo: "sinistro", id: s.id };
      const corpoMat = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.45 });
      const pino = new THREE.Group();
      const bola = new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 16), corpoMat);
      bola.position.y = 1.6;
      const ponta = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.5, 20), corpoMat);
      ponta.rotation.x = Math.PI;
      ponta.position.y = 0.75;
      // miolo branco do pino: um disco que sempre olha para a câmera
      const miolo = new THREE.Mesh(new THREE.CircleGeometry(0.36, 24), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      [bola, ponta].forEach((x) => (x.castShadow = true));
      pino.add(bola, ponta, miolo);
      pino.position.y = 2.2;
      // halo no chão que pulsa
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.6, 40),
        new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: 0.45, depthWrite: false }));
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.34;
      grupo.add(pino, halo);
      // cones de sinalização em volta
      const cones = new THREE.Group();
      const coneMat = new THREE.MeshStandardMaterial({ color: 0xf28a3a, roughness: 0.6 });
      const faixaMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
      for (const [x, z] of [[1.9, 0.9], [-1.7, 1.2], [0.3, -1.9]]) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.75, 12), coneMat);
        cone.position.set(x, 0.375, z);
        cone.castShadow = true;
        const anel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.12, 12), faixaMat);
        anel.position.set(x, 0.45, z);
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.6), coneMat);
        base.position.set(x, 0.03, z);
        cones.add(cone, anel, base);
      }
      grupo.add(cones);
      // o pino fica uns metros à frente da moto, para os dois não se sobreporem
      const p = this.localDoSinistro(s.id);
      const a = posNo(p.noA), b = posNo(p.noB);
      const d = b.clone().sub(a).normalize();
      grupo.position.copy(a.lerp(b, Math.min(0.9, p.t + 0.11))).add(direita(d).multiplyScalar(MEIO_FIO + 0.4));
      this.cena.add(grupo);
      m = { grupo, pino, miolo, halo, cones, corpoMat, rotulo: this.criarRotulo("rotulo-pino"), fase: Math.random() * 6 };
      this.marcadores.set(s.id, m);
      // a seleção pode ter chegado antes do marcador (evento do SignalR atrasado)
      if (this.selecionado?.tipo === "sinistro" && this.selecionado.id === s.id) this.selecionar(this.selecionado);
    }
    m.dados = s;
    m.corpoMat.color.setHex(cor);
    m.halo.material.color.setHex(cor);
    m.cones.visible = s.status !== "Aprovado";
    m.rotulo.textContent = `#${s.id}`;
  }

  removerMarcador(id) {
    const m = this.marcadores.get(id);
    if (!m) return;
    this.cena.remove(m.grupo);
    m.rotulo.remove();
    this.marcadores.delete(id);
  }

  // ---------- rótulos HTML que acompanham os objetos ----------

  criarRotulo(classe) {
    const el = document.createElement("div");
    el.className = classe;
    this.camadaRotulos.appendChild(el);
    return el;
  }

  posicionarRotulo(el, ponto, visivel = true) {
    const v = ponto.clone().project(this.camera);
    if (!visivel || v.z > 1) { el.style.display = "none"; return; }
    el.style.display = "";
    const w = this.largura, h = this.altura;
    el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
  }

  // ---------- laço principal ----------

  redimensionar() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.largura = w; this.altura = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Para gravar vídeo/GIF quadro a quadro com passo de tempo fixo (usado nos prints do README)
  gravar() {
    this.renderer.setAnimationLoop(null);
    this.tempoGravacao = this.relogio.elapsedTime;
  }

  avancar(segundos, passos = 1) {
    for (let k = 0; k < passos; k++) {
      this.tempoGravacao += segundos / passos;
      this.quadro(segundos / passos);
    }
  }

  quadro(dtFixo) {
    const dt = dtFixo ?? Math.min(this.relogio.getDelta(), 0.1);
    const t = dtFixo !== undefined ? this.tempoGravacao : this.relogio.elapsedTime;

    if (!this.reduzido) for (const carro of this.carros) carro.atualizar(dt);
    for (const moto of this.motos.values()) {
      moto.piloto.atualizar(dt);
      const status = moto.dados.status;
      if (moto.malha.alerta.visible) {
        const aceso = this.reduzido ? true : Math.sin(t * 9) > 0;
        moto.malha.alerta.material.emissiveIntensity = aceso ? 1.6 : 0.1;
      }
      const sel = this.selecionado?.tipo === "moto" && this.selecionado.id === moto.dados.motoristaId;
      const pulso = sel && !this.reduzido ? 1.15 + Math.sin(t * 4) * 0.12 : sel ? 1.25 : 1;
      moto.malha.anel.scale.setScalar(pulso);
      moto.malha.anel.material.opacity = sel ? 0.9 : 0.5;
      const zoomPerto = this.vista.dist < 270 || sel;
      moto.rotulo.classList.toggle("sel", sel);
      const texto = `<i style="background:#${COR_STATUS[status].toString(16).padStart(6, "0")}"></i>${moto.dados.nome.split(" ")[0]}`;
      if (moto.rotuloTexto !== texto) { moto.rotulo.innerHTML = texto; moto.rotuloTexto = texto; }
      this.posicionarRotulo(moto.rotulo, moto.malha.raiz.position.clone().add(new THREE.Vector3(0, 3.7, 0)), zoomPerto);
    }

    for (const m of this.marcadores.values()) {
      const sobe = this.reduzido ? 0 : Math.sin(t * 2.2 + m.fase) * 0.35;
      m.pino.position.y = 2.2 + sobe;
      if (!this.reduzido) {
        const k = (t * 0.8 + m.fase) % 1;
        m.halo.scale.setScalar(0.8 + k * 1.3);
        m.halo.material.opacity = 0.55 * (1 - k);
      }
      const olhar = this.camera.position.clone().sub(m.grupo.position).normalize();
      m.miolo.position.set(0, 1.6, 0).addScaledVector(olhar, 0.86);
      m.miolo.quaternion.copy(this.camera.quaternion);
      const sel = this.selecionado?.tipo === "sinistro" && this.selecionado.id === m.dados.id;
      m.rotulo.classList.toggle("sel", sel);
      this.posicionarRotulo(m.rotulo, m.grupo.position.clone().add(new THREE.Vector3(0, 5.2 + sobe, 0)));
    }

    if (this.seguindo && this.motos.has(this.seguindo)) {
      this.vistaDesejada.alvo.copy(this.motos.get(this.seguindo).piloto.pos);
    }

    // a câmera persegue o desejado com suavidade (voo até o objeto)
    const k = this.reduzido ? 1 : 1 - Math.exp(-dt * 3.2);
    // seguindo uma moto, o alvo gruda mais rápido para ela não fugir do quadro
    this.vista.alvo.lerp(this.vistaDesejada.alvo, this.seguindo && !this.reduzido ? 1 - Math.exp(-dt * 6) : k);
    this.vista.dist += (this.vistaDesejada.dist - this.vista.dist) * k;
    let da = this.vistaDesejada.azimute - this.vista.azimute;
    this.vista.azimute += da * k;
    this.aplicarCamera();
    this.camera.updateMatrixWorld();
    this.esmaecerOclusores(dt);

    this.renderer.render(this.cena, this.camera);
  }

  // usado pelo painel para posicionar o resumo da unidade
  motosDaUnidade(nome) {
    return [...this.motos.values()].filter((m) => !nome || m.unidade.nome === nome);
  }
}

// ---------- utilidades ----------

function hash(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967295;
}

function arestaPorHash(h) {
  const horizontais = LINHAS * (COLS - 1);
  const total = horizontais + COLS * (LINHAS - 1);
  let k = Math.floor(h * total) % total;
  const t = 0.3 + ((h * 997) % 1) * 0.4;
  if (k < horizontais) {
    const j = Math.floor(k / (COLS - 1)), i = k % (COLS - 1);
    return (h * 31) % 1 < 0.5 ? { noA: [i, j], noB: [i + 1, j], t } : { noA: [i + 1, j], noB: [i, j], t };
  }
  k -= horizontais;
  const i = Math.floor(k / (LINHAS - 1)), j = k % (LINHAS - 1);
  return (h * 31) % 1 < 0.5 ? { noA: [i, j], noB: [i, j + 1], t } : { noA: [i, j + 1], noB: [i, j], t };
}

export { UNIDADES, COZINHA, SEGURADORA, S };
