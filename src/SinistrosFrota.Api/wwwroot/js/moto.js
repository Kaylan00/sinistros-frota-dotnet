// Moto de entrega com baú e motoboy (capacete, sem rosto), e o "piloto automático" pelas ruas.
import * as THREE from "three";
import { COLS, LINHAS, S, FAIXA, MEIO_FIO, posNo, direita } from "./cidade.js";

const mat = (cor, extra = {}) => new THREE.MeshStandardMaterial({ color: cor, roughness: 0.85, ...extra });
const M = {
  pneu: mat(0x2b2f3a),
  aro: mat(0xc9cedd),
  quadro: mat(0xf4f5fa),
  banco: mat(0x2f3443),
  jaqueta: mat(0x2c3a5c),
  calca: mat(0x3a4152),
  capacete: mat(0xffffff, { roughness: 0.4 }),
  viseira: mat(0x1d2433, { roughness: 0.2, metalness: 0.3 }),
  farol: new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff1c2, emissiveIntensity: 0.8 })
};

function peca(geo, material, x, y, z) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// Motoboy sentado (pilotando) ou em pé (depois de um acidente)
function motoboy(emPe) {
  const g = new THREE.Group();
  const tronco = peca(new THREE.CapsuleGeometry(0.2, 0.42, 4, 8), M.jaqueta, 0, 0, 0);
  const capacete = peca(new THREE.SphereGeometry(0.21, 14, 10), M.capacete, 0, 0, 0);
  const viseira = peca(new THREE.SphereGeometry(0.19, 12, 8, -0.9, 1.8, 0.9, 0.9), M.viseira, 0, 0, 0);
  if (emPe) {
    tronco.position.set(0, 1.12, 0);
    capacete.position.set(0, 1.62, 0);
    viseira.position.set(0.035, 1.6, 0);
    const pernaE = peca(new THREE.CapsuleGeometry(0.09, 0.62, 3, 6), M.calca, 0, 0.42, 0.11);
    const pernaD = peca(new THREE.CapsuleGeometry(0.09, 0.62, 3, 6), M.calca, 0, 0.42, -0.11);
    const bracoE = peca(new THREE.CapsuleGeometry(0.07, 0.5, 3, 6), M.jaqueta, 0.05, 1.08, 0.27);
    const bracoD = peca(new THREE.CapsuleGeometry(0.07, 0.5, 3, 6), M.jaqueta, 0.05, 1.08, -0.27);
    g.add(pernaE, pernaD, bracoE, bracoD);
  } else {
    tronco.position.set(-0.12, 1.22, 0);
    tronco.rotation.z = -0.35;
    capacete.position.set(0.05, 1.68, 0);
    viseira.position.set(0.09, 1.66, 0);
    const coxa = new THREE.CapsuleGeometry(0.09, 0.42, 3, 6);
    for (const z of [0.15, -0.15]) {
      const c = peca(coxa, M.calca, 0.1, 0.92, z);
      c.rotation.z = Math.PI / 2 - 0.25;
      const canela = peca(new THREE.CapsuleGeometry(0.08, 0.4, 3, 6), M.calca, 0.3, 0.6, z * 1.2);
      canela.rotation.z = 0.25;
      const braco = peca(new THREE.CapsuleGeometry(0.07, 0.5, 3, 6), M.jaqueta, 0.22, 1.3, z * 1.55);
      braco.rotation.z = Math.PI / 2 - 0.55;
      g.add(c, canela, braco);
    }
  }
  g.add(tronco, capacete, viseira);
  return g;
}

export function criarMotoMalha(corBau) {
  const raiz = new THREE.Group();         // posição e direção no mapa
  const inclinacao = new THREE.Group();   // inclina nas curvas / tomba no acidente
  raiz.add(inclinacao);

  const moto = new THREE.Group();
  const roda = new THREE.CylinderGeometry(0.34, 0.34, 0.17, 16);
  roda.rotateX(Math.PI / 2);
  const cubo = new THREE.CylinderGeometry(0.15, 0.15, 0.19, 10);
  cubo.rotateX(Math.PI / 2);
  for (const x of [0.78, -0.72]) moto.add(peca(roda, M.pneu, x, 0.34, 0), peca(cubo, M.aro, x, 0.34, 0));
  moto.add(peca(new THREE.BoxGeometry(1.05, 0.34, 0.3), M.quadro, 0.02, 0.66, 0));    // tanque e carenagem
  moto.add(peca(new THREE.BoxGeometry(0.7, 0.13, 0.32), M.banco, -0.3, 0.88, 0));    // banco
  const garfo = peca(new THREE.BoxGeometry(0.08, 0.72, 0.22), M.aro, 0.66, 0.68, 0);
  garfo.rotation.z = -0.38;
  moto.add(garfo);
  moto.add(peca(new THREE.BoxGeometry(0.08, 0.06, 0.74), M.banco, 0.48, 1.08, 0));   // guidão
  moto.add(peca(new THREE.SphereGeometry(0.11, 10, 8), M.farol, 0.62, 0.9, 0));     // farol
  moto.add(peca(new THREE.BoxGeometry(0.42, 0.08, 0.34), M.quadro, -0.72, 0.62, 0)); // paralama traseiro

  const corpoBau = mat(corBau);
  const bau = peca(new THREE.BoxGeometry(0.62, 0.58, 0.62), corpoBau, -0.78, 1.18, 0);
  const tampa = peca(new THREE.BoxGeometry(0.66, 0.08, 0.66), mat(0xffffff), -0.78, 1.5, 0);
  moto.add(bau, tampa);
  inclinacao.add(moto);

  const piloto = motoboy(false);
  inclinacao.add(piloto);
  const emPe = motoboy(true);
  emPe.position.set(0.2, 0, 1.5);
  emPe.rotation.y = -0.9;
  emPe.visible = false;
  raiz.add(emPe);

  // giroflex vermelho que pisca na ocorrência
  const alerta = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xff4d42, emissive: 0xff2a1f, emissiveIntensity: 1.2 }));
  alerta.position.set(0, 2.25, 0);
  alerta.visible = false;
  raiz.add(alerta);

  // anel no chão com a cor do status
  const anel = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.32, 40),
    new THREE.MeshBasicMaterial({ color: 0x2f5bea, transparent: true, opacity: 0.55, depthWrite: false }));
  anel.rotation.x = -Math.PI / 2;
  anel.position.y = 0.04;
  raiz.add(anel);

  return { raiz, inclinacao, piloto, emPe, alerta, anel };
}

// Carro do trânsito: carroceria, cabine de vidro e rodas. Mesmo esquema raiz/inclinação da moto.
export function criarCarro(cor) {
  const raiz = new THREE.Group();
  const inclinacao = new THREE.Group();
  raiz.add(inclinacao);
  const corpo = mat(cor, { roughness: 0.55 });
  inclinacao.add(peca(new THREE.BoxGeometry(3.6, 0.75, 1.7), corpo, 0, 0.72, 0));
  const cabine = peca(new THREE.BoxGeometry(1.9, 0.62, 1.5), mat(0xb9c6e8, { roughness: 0.25, metalness: 0.2 }), -0.2, 1.4, 0);
  inclinacao.add(cabine);
  inclinacao.add(peca(new THREE.BoxGeometry(1.95, 0.08, 1.55), corpo, -0.2, 1.74, 0));
  const roda = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14);
  roda.rotateX(Math.PI / 2);
  for (const x of [1.15, -1.15]) for (const z of [0.78, -0.78]) inclinacao.add(peca(roda, M.pneu, x, 0.36, z));
  for (const z of [0.55, -0.55]) inclinacao.add(peca(new THREE.BoxGeometry(0.06, 0.16, 0.34), M.farol, 1.81, 0.82, z));
  return { raiz, inclinacao };
}

// ---------- rotas ----------

const vizinhos = (n) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
  .map(([dx, dz]) => [n[0] + dx, n[1] + dz])
  .filter(([i, j]) => i >= 0 && i < COLS && j >= 0 && j < LINHAS);

const chave = (n) => n.join(",");

function caminhoNos(de, para) {
  const anterior = new Map([[chave(de), null]]);
  const fila = [de];
  while (fila.length) {
    const n = fila.shift();
    if (chave(n) === chave(para)) break;
    const viz = vizinhos(n).sort(() => Math.random() - 0.5);
    for (const v of viz) {
      if (anterior.has(chave(v))) continue;
      anterior.set(chave(v), n);
      fila.push(v);
    }
  }
  const lista = [];
  for (let n = para; n; n = anterior.get(chave(n))) lista.unshift(n);
  return lista;
}

function passeioAleatorio(inicio, vindoDe, passos) {
  const nos = [inicio];
  let atual = inicio, antes = vindoDe;
  for (let k = 0; k < passos; k++) {
    let opcoes = vizinhos(atual).filter((v) => !antes || chave(v) !== chave(antes));
    if (!opcoes.length) opcoes = vizinhos(atual);
    // preferência leve por seguir reto, para não parecer barata tonta
    const reto = antes && opcoes.find((v) => v[0] - atual[0] === atual[0] - antes[0] && v[1] - atual[1] === atual[1] - antes[1]);
    const prox = reto && Math.random() < 0.45 ? reto : opcoes[Math.floor(Math.random() * opcoes.length)];
    nos.push(prox);
    antes = atual;
    atual = prox;
  }
  return nos;
}

// Linha central -> faixa da direita, com esquinas arredondadas (Bézier)
function tracarFaixa(centros) {
  const pts = [];
  const dirs = [];
  for (let k = 0; k < centros.length - 1; k++) {
    const d = centros[k + 1].clone().sub(centros[k]);
    dirs.push(d.lengthSq() > 1e-6 ? d.normalize() : (dirs[dirs.length - 1] || new THREE.Vector3(1, 0, 0)).clone());
  }
  if (!dirs.length) return centros.map((c) => c.clone());
  pts.push(centros[0].clone().add(direita(dirs[0]).multiplyScalar(FAIXA)));
  for (let k = 1; k < centros.length - 1; k++) {
    const din = dirs[k - 1], dout = dirs[k], c = centros[k];
    const dot = din.dot(dout);
    if (dot > 0.99) { pts.push(c.clone().add(direita(din).multiplyScalar(FAIXA))); continue; }
    if (dot < -0.99) {
      pts.push(c.clone().add(direita(din).multiplyScalar(FAIXA)));
      pts.push(c.clone().add(din.clone().multiplyScalar(2)));
      pts.push(c.clone().add(direita(dout).multiplyScalar(FAIXA)));
      continue;
    }
    const canto = c.clone().add(direita(din).add(direita(dout)).multiplyScalar(FAIXA));
    const r = 3.4;
    const a = canto.clone().sub(din.clone().multiplyScalar(r));
    const b = canto.clone().add(dout.clone().multiplyScalar(r));
    for (let t = 0; t <= 1.0001; t += 1 / 6) {
      const u = 1 - t;
      pts.push(new THREE.Vector3(
        u * u * a.x + 2 * u * t * canto.x + t * t * b.x, 0,
        u * u * a.z + 2 * u * t * canto.z + t * t * b.z));
    }
  }
  const ult = centros[centros.length - 1];
  pts.push(ult.clone().add(direita(dirs[dirs.length - 1]).multiplyScalar(FAIXA)));
  return pts;
}

// ---------- piloto automático ----------

export class Piloto {
  constructor(malha, reduzido) {
    this.m = malha;
    this.reduzido = reduzido;
    this.pos = new THREE.Vector3();
    this.rumo = 0;          // ângulo em Y
    this.inclinacao = 0;
    this.pontos = [];       // waypoints restantes
    this.velocidade = 0;
    this.velMax = 7;
    this.aoChegar = null;
    this.modo = "parado";
    this.tombada = false;
  }

  // em que rua a moto está e para que lado anda, deduzido da posição e do rumo
  arestaAtual() {
    const fi = this.pos.x / S + (COLS - 1) / 2;
    const fj = this.pos.z / S + (LINHAS - 1) / 2;
    const dx = Math.cos(this.rumo), dz = -Math.sin(this.rumo);
    const distV = Math.abs(fi - Math.round(fi));
    const distH = Math.abs(fj - Math.round(fj));
    const lim = (v, max) => Math.min(max, Math.max(0, v));
    if (distH <= distV) {
      // rua horizontal (z constante)
      const j = lim(Math.round(fj), LINHAS - 1);
      let a = lim(Math.floor(fi), COLS - 2), b = a + 1;
      return dx >= 0 ? { de: [a, j], para: [b, j] } : { de: [b, j], para: [a, j] };
    }
    const i = lim(Math.round(fi), COLS - 1);
    let a = lim(Math.floor(fj), LINHAS - 2), b = a + 1;
    return dz >= 0 ? { de: [i, a], para: [i, b] } : { de: [i, b], para: [i, a] };
  }

  noDePartida() { return this.arestaAtual().para; }

  posicionarNaVaga(vaga) {
    this.pos.copy(vaga.pos);
    this.rumo = Math.atan2(-vaga.dir.z, vaga.dir.x);
    this.pontos = [];
    this.velocidade = 0;
  }

  posicionarNaRua(noA, noB, t) {
    const a = posNo(noA), b = posNo(noB);
    const d = b.clone().sub(a).normalize();
    this.pos.copy(a.lerp(b, t)).add(direita(d).multiplyScalar(MEIO_FIO));
    this.rumo = Math.atan2(-d.z, d.x);
    this.pontos = [];
    this.velocidade = 0;
  }

  // segue uma lista de nós e opcionalmente termina numa vaga
  seguir(nos, vaga = null, aoChegar = null) {
    const centros = [this.projecaoCentro(), ...nos.map(posNo)];
    if (vaga) centros.push(vaga.centro.clone());
    let pts = tracarFaixa(centros);
    if (vaga) {
      // encosta no meio-fio no final
      pts[pts.length - 1] = vaga.pos.clone();
    }
    pts = pts.filter((p, k) => k === 0 || p.distanceToSquared(pts[k - 1]) > 0.01);
    pts.shift(); // o primeiro é a posição atual
    this.pontos = pts;
    this.aoChegar = aoChegar;
    if (this.reduzido) this.saltarParaOFim();
  }

  saltarParaOFim() {
    if (!this.pontos.length) return;
    const ult = this.pontos[this.pontos.length - 1];
    const pen = this.pontos.length > 1 ? this.pontos[this.pontos.length - 2] : this.pos;
    const d = ult.clone().sub(pen);
    if (d.lengthSq() > 1e-6) this.rumo = Math.atan2(-d.z, d.x);
    this.pos.copy(ult);
    this.pontos = [];
    const cb = this.aoChegar; this.aoChegar = null;
    cb && cb();
  }

  projecaoCentro() {
    // ponto na linha central da rua mais próxima (para emendar a rota sem pulo)
    const ar = this.arestaAtual();
    const a = posNo(ar.de), b = posNo(ar.para);
    const ab = b.clone().sub(a);
    const t = THREE.MathUtils.clamp(this.pos.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
    return a.add(ab.multiplyScalar(t));
  }

  rotaParaVaga(vaga, aoChegar) {
    const nos = caminhoNos(this.noDePartida(), vaga.noAtras);
    this.seguir(nos, vaga, aoChegar);
  }

  passear() {
    const ar = this.arestaAtual();
    const nos = passeioAleatorio(ar.para, ar.de, 10);
    // sem animação (prefers-reduced-motion) a moto só aparece no destino e espera o próximo status
    if (this.reduzido) return this.seguir(nos.slice(0, 4), null, null);
    this.seguir(nos, null, () => this.modo === "passeio" && this.passear());
  }

  // encosta logo à frente, onde estiver
  encostar(aoChegar) {
    const ar = this.arestaAtual();
    const a = posNo(ar.de), b = posNo(ar.para);
    const d = b.clone().sub(a).normalize();
    const atual = this.projecaoCentro();
    const restante = b.distanceTo(atual);
    const avanco = Math.min(4, Math.max(0, restante - 5));
    const centro = atual.clone().add(d.clone().multiplyScalar(avanco));
    const vaga = { centro, pos: centro.clone().add(direita(d).multiplyScalar(MEIO_FIO)) };
    this.pontos = [vaga.pos];
    this.aoChegar = aoChegar;
    if (this.reduzido) this.saltarParaOFim();
  }

  parar() {
    this.pontos = [];
    this.aoChegar = null;
  }

  atualizar(dt) {
    let alvoVel = this.pontos.length ? this.velMax : 0;
    if (this.pontos.length) {
      // freia perto do fim
      let resta = this.pos.distanceTo(this.pontos[0]);
      for (let k = 1; k < this.pontos.length && resta < 6; k++) resta += this.pontos[k].distanceTo(this.pontos[k - 1]);
      if (resta < 6) alvoVel = Math.max(1.2, this.velMax * resta / 6);
    }
    this.velocidade += (alvoVel - this.velocidade) * Math.min(1, dt * 2.5);

    let passo = this.velocidade * dt;
    let rumoAlvo = this.rumo;
    while (this.pontos.length && passo > 0) {
      const alvo = this.pontos[0];
      const d = alvo.clone().sub(this.pos);
      const dist = d.length();
      if (dist > 1e-4) rumoAlvo = Math.atan2(-d.z, d.x);
      if (dist <= passo) {
        this.pos.copy(alvo);
        passo -= dist;
        this.pontos.shift();
        if (!this.pontos.length) {
          this.velocidade = 0;
          const cb = this.aoChegar; this.aoChegar = null;
          cb && cb();
        }
      } else {
        this.pos.add(d.multiplyScalar(passo / dist));
        passo = 0;
      }
    }

    // vira suave e inclina na curva, como moto de verdade
    let delta = rumoAlvo - this.rumo;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const giro = THREE.MathUtils.clamp(delta, -dt * 6, dt * 6);
    this.rumo += giro;
    const alvoInc = this.tombada ? 1.35 : THREE.MathUtils.clamp(-(giro / Math.max(dt, 1e-3)) * 0.09, -0.4, 0.4);
    this.inclinacao += (alvoInc - this.inclinacao) * Math.min(1, dt * (this.tombada ? 3 : 6));

    this.m.raiz.position.copy(this.pos);
    this.m.raiz.rotation.y = this.rumo;
    this.m.inclinacao.rotation.x = this.m.anel ? this.inclinacao : this.inclinacao * 0.12;
  }
}
