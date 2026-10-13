// Bairro low-poly: ruas em grade, quarteirões, prédios, unidades da rede, oficina e seguradora.
// Toda a geometria é feita aqui no código (Three.js), sem modelos baixados.
import * as THREE from "three";

export const COLS = 6;   // nós (cruzamentos) no eixo X
export const LINHAS = 5; // nós no eixo Z
export const S = 30;     // distância entre cruzamentos
export const RUA = 7;    // largura da rua
export const FAIXA = 1.55;   // deslocamento da faixa da direita
export const MEIO_FIO = 2.75; // onde a moto estaciona

export const CORES = {
  fundo: 0xeceef6,
  chao: 0xe4e6f0,
  asfalto: 0xd3d7e6,
  calcada: 0xf6f7fb,
  parede: 0xf9f9fc,
  telhado: 0xe9eaf3,
  azul: 0x2f5bea,
  azulClaro: 0xdbe3fd,
  arvore: 0x8dd5ad,
  arvore2: 0x74c79a,
  tronco: 0xb7a48f,
  grama: 0xd5ecd9
};

// Unidades da rede: o nome bate com o campo "restaurante" do banco
export const UNIDADES = [
  { nome: "Sabor de Casa - Centro", curto: "Centro", sigla: "CEN", bloco: [1, 1], cor: 0x2f5bea },
  { nome: "Sabor de Casa - Praia do Canto", curto: "Praia do Canto", sigla: "PRC", bloco: [4, 0], cor: 0x14a3a3 },
  { nome: "Sabor de Casa - Jardim da Penha", curto: "Jardim da Penha", sigla: "JDP", bloco: [3, 2], cor: 0xe0912b },
  { nome: "Sabor de Casa - Laranjeiras", curto: "Laranjeiras", sigla: "LAR", bloco: [0, 3], cor: 0xd8576b }
];

export const COZINHA = { bloco: [2, 1] };
export const OFICINA = { bloco: [4, 3] };
export const SEGURADORA = { bloco: [0, 0] };
const PARQUES = [[2, 3], [4, 2]];

export const noX = (i) => (i - (COLS - 1) / 2) * S;
export const noZ = (j) => (j - (LINHAS - 1) / 2) * S;
export const posNo = (n) => new THREE.Vector3(noX(n[0]), 0, noZ(n[1]));
export const centroBloco = (b) => new THREE.Vector3(noX(b[0]) + S / 2, 0, noZ(b[1]) + S / 2);
export const direita = (d) => new THREE.Vector3(-d.z, 0, d.x);

// ---------- texturas desenhadas em canvas ----------

function textura(largura, altura, desenhar) {
  const c = document.createElement("canvas");
  c.width = largura; c.height = altura;
  desenhar(c.getContext("2d"), largura, altura);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const texJanelas = textura(128, 128, (g, w, h) => {
  g.fillStyle = "#f9f9fc"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#d6def7";
  g.fillRect(22, 30, 84, 56);
  g.fillStyle = "#c3cff4";
  g.fillRect(22, 30, 84, 10);
  g.fillStyle = "#eef1fb"; g.fillRect(62, 30, 4, 56);
});
texJanelas.wrapS = texJanelas.wrapT = THREE.RepeatWrapping;

const texVidro = textura(128, 128, (g, w, h) => {
  g.fillStyle = "#cdd8fb"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#b5c5f7"; g.fillRect(0, 0, w, 54);
  g.fillStyle = "#eef2ff"; g.fillRect(0, 60, w, 6); g.fillRect(60, 0, 6, h);
});
texVidro.wrapS = texVidro.wrapT = THREE.RepeatWrapping;

export function texturaTexto(texto, { cor = "#1d2433", fundo = "#ffffff", destaque = null, largura = 512, altura = 128, tamanho = 54 } = {}) {
  return textura(largura, altura, (g, w, h) => {
    g.fillStyle = fundo;
    const r = 18;
    g.beginPath(); g.roundRect(0, 0, w, h, r); g.fill();
    if (destaque) { g.fillStyle = destaque; g.beginPath(); g.roundRect(18, 26, h - 52, h - 52, 12); g.fill(); }
    g.fillStyle = cor;
    const inicio = destaque ? h - 10 : 28;
    let t = tamanho;
    do { g.font = `600 ${t}px "IBM Plex Sans", system-ui, sans-serif`; t -= 2; } while (g.measureText(texto).width > w - inicio - 22 && t > 20);
    g.textBaseline = "middle";
    g.fillText(texto, inicio, h / 2 + 2);
  });
}

function texToldo(cor) {
  return textura(128, 32, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? "#ffffff" : cor;
      g.fillRect(i * 16, 0, 16, h);
    }
  });
}

// ---------- materiais e peças ----------

const mat = (cor, extra = {}) => new THREE.MeshStandardMaterial({ color: cor, roughness: 0.92, metalness: 0, ...extra });
const M = {
  parede: mat(CORES.parede),
  telhado: mat(CORES.telhado),
  calcada: mat(CORES.calcada),
  asfalto: mat(CORES.asfalto),
  faixa: mat(0xffffff),
  chao: mat(CORES.chao),
  grama: mat(CORES.grama),
  tronco: mat(CORES.tronco),
  arvore: mat(CORES.arvore),
  arvore2: mat(CORES.arvore2),
  escuro: mat(0x3a4152),
  porta: mat(0xc9cfe2),
  azul: mat(CORES.azul),
  cinza: mat(0xb9bfd3)
};

function malha(geo, material, { sombra = true, recebe = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = sombra;
  m.receiveShadow = recebe;
  return m;
}

function caixa(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = malha(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y + h / 2, z);
  return m;
}

function predio(w, h, d, { vidro = false, corTelhado = null } = {}) {
  const g = new THREE.Group();
  const tex = (vidro ? texVidro : texJanelas).clone();
  tex.needsUpdate = true;
  tex.repeat.set(Math.max(1, Math.round(w / 3.2)), Math.max(1, Math.round(h / 3.4)));
  const texLado = tex.clone(); texLado.needsUpdate = true;
  texLado.repeat.set(Math.max(1, Math.round(d / 3.2)), tex.repeat.y);
  const frente = mat(0xffffff, { map: tex });
  const lado = mat(0xffffff, { map: texLado });
  const topo = mat(corTelhado ?? CORES.telhado);
  const corpo = malha(new THREE.BoxGeometry(w, h, d), [lado, lado, topo, topo, frente, frente]);
  corpo.position.y = h / 2;
  g.add(corpo);
  // platibanda e caixa d'água deixam o telhado menos chapado
  g.add(caixa(w + 0.3, 0.35, d + 0.3, M.parede, 0, h, 0));
  if (h > 6) g.add(caixa(Math.min(3, w / 3), 1.2, Math.min(3, d / 3), M.cinza, w / 5, h + 0.35, -d / 6));
  return g;
}

export function arvore(escala = 1, variante = 0) {
  const g = new THREE.Group();
  const tronco = malha(new THREE.CylinderGeometry(0.16, 0.22, 1.5, 6), M.tronco);
  tronco.position.y = 0.75;
  const copa = malha(new THREE.SphereGeometry(1.15, 12, 9), variante ? M.arvore2 : M.arvore);
  copa.scale.set(1, 1.18, 1);
  copa.position.y = 2.5;
  g.add(tronco, copa);
  g.scale.setScalar(escala);
  return g;
}

function placa(texto, cor, w = 9) {
  const tex = texturaTexto(texto, { destaque: "#" + new THREE.Color(cor).getHexString() });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  return m;
}

// ---------- construções especiais ----------

function restaurante(unidade) {
  const g = new THREE.Group();
  const corpo = predio(13, 5, 9, { corTelhado: 0xf1f1f7 });
  g.add(corpo);
  // toldo listrado na fachada (lado +z, virado para a rua)
  const toldo = malha(new THREE.BoxGeometry(11, 0.25, 2.2), [M.parede, M.parede, mat(0xffffff, { map: texToldo("#" + new THREE.Color(unidade.cor).getHexString()) }), M.parede, M.parede, M.parede]);
  toldo.position.set(0, 3.2, 5.4);
  toldo.rotation.x = 0.18;
  g.add(toldo);
  g.add(caixa(3, 2.6, 0.2, M.porta, 0, 0, 4.55));
  const p = placa(unidade.curto, unidade.cor, 8.5);
  p.position.set(0, 6.4, 4.2);
  g.add(p);
  // mesinhas com guarda-sol na calçada
  for (const x of [-4.2, 4.2]) {
    const mesa = malha(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 10), M.parede);
    mesa.position.set(x, 0.75, 7.3);
    const pe = malha(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6), M.cinza);
    pe.position.set(x, 1.1, 7.3);
    const guarda = malha(new THREE.ConeGeometry(1.5, 0.6, 10), mat(unidade.cor));
    guarda.position.set(x, 2.4, 7.3);
    g.add(mesa, pe, guarda);
  }
  g.userData.unica = true;
  return g;
}

function cozinhaCentral() {
  const g = new THREE.Group();
  g.add(predio(17, 6.5, 12, { corTelhado: 0xe1e6fb }));
  // faixa azul e portas de carga, no estilo galpão
  g.add(caixa(17.2, 0.9, 12.2, M.azul, 0, 5.2, 0));
  for (const x of [-5, 0, 5]) g.add(caixa(3.2, 3.4, 0.25, M.porta, x, 0, 6.05));
  const p = placa("Cozinha Central", CORES.azul, 11);
  p.position.set(0, 8.1, 5.2);
  g.add(p);
  // dutos no telhado
  g.add(caixa(2, 1.4, 2, M.cinza, -5, 6.8, -2), caixa(2, 1.4, 2, M.cinza, -2, 6.8, -2));
  g.userData.unica = true;
  return g;
}

function oficina() {
  const g = new THREE.Group();
  g.add(predio(15, 6, 10, { corTelhado: 0xe6e8f0 }));
  const portaMat = mat(0xcbd1e3);
  for (const x of [-3.6, 3.6]) {
    const porta = caixa(5.4, 4, 0.25, portaMat, x, 0, 5.05);
    g.add(porta);
    for (let i = 1; i < 6; i++) g.add(caixa(5.4, 0.06, 0.3, M.cinza, x, i * 0.65, 5.1));
  }
  const p = placa("Oficina credenciada", 0x3a4152, 11);
  p.position.set(0, 7.6, 4.3);
  g.add(p);
  // pilha de pneus
  const pneu = new THREE.TorusGeometry(0.45, 0.2, 8, 14);
  for (let i = 0; i < 3; i++) {
    const t = malha(pneu, M.escuro);
    t.rotation.x = Math.PI / 2;
    t.position.set(7.4, 0.2 + i * 0.4, 6.6);
    g.add(t);
  }
  g.userData.unica = true;
  return g;
}

function seguradora() {
  const g = new THREE.Group();
  g.add(predio(10, 24, 10, { vidro: true, corTelhado: 0xdfe5fb }));
  g.add(caixa(14, 3.2, 12, M.parede, 0, 0, 1));
  const p = placa("Seguradora", CORES.azul, 9);
  p.position.set(0, 4.7, 7.05);
  g.add(p);
  g.userData.unica = true;
  return g;
}

function parque() {
  const g = new THREE.Group();
  const grama = malha(new THREE.BoxGeometry(S - RUA - 2, 0.12, S - RUA - 2), M.grama, { sombra: false });
  grama.position.y = 0.36;
  g.add(grama);
  const caminho = malha(new THREE.BoxGeometry(S - RUA - 2, 0.14, 2), M.calcada, { sombra: false });
  caminho.position.y = 0.37;
  g.add(caminho);
  const coreto = malha(new THREE.CylinderGeometry(2.4, 2.4, 0.3, 16), M.parede);
  coreto.position.y = 0.5;
  g.add(coreto);
  const cobertura = malha(new THREE.ConeGeometry(2.8, 1.4, 16), M.telhado);
  cobertura.position.y = 3.6;
  g.add(cobertura);
  for (const a of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    const col = malha(new THREE.CylinderGeometry(0.1, 0.1, 2.6, 6), M.parede);
    col.position.set(Math.cos(a) * 2, 1.9, Math.sin(a) * 2);
    g.add(col);
  }
  const r = (S - RUA) / 2 - 3;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    const t = arvore(0.9 + (i % 3) * 0.15, i % 2);
    t.position.set(Math.cos(a) * r, 0.3, Math.sin(a) * r * 0.85);
    g.add(t);
  }
  return g;
}

// gerador pseudoaleatório com semente: a cidade sai igual em todo carregamento
function sorteador(semente) {
  let s = semente;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

// sobrado com telhado de duas águas, em tons claros
const TONS_CASA = [0xf7f3ee, 0xeef1fb, 0xf3eef8, 0xeef6f2, 0xfaf6ef];
const TONS_TELHADO = [0xd9dcec, 0xe6d9d3, 0xd2dcef, 0xdde3dc];
function casa(w, d, rnd) {
  const g = new THREE.Group();
  const corParede = TONS_CASA[Math.floor(rnd() * TONS_CASA.length)];
  const tex = texJanelas.clone(); tex.needsUpdate = true;
  tex.repeat.set(Math.max(1, Math.round(w / 3.4)), 1);
  const parede = mat(corParede, { map: tex });
  const h = 3.4;
  const corpo = malha(new THREE.BoxGeometry(w, h, d), [parede, parede, mat(corParede), mat(corParede), parede, parede]);
  corpo.position.y = h / 2;
  g.add(corpo);
  // prisma triangular deitado = telhado
  const forma = new THREE.Shape();
  forma.moveTo(-d / 2 - 0.4, 0); forma.lineTo(0, 2.1); forma.lineTo(d / 2 + 0.4, 0); forma.lineTo(-d / 2 - 0.4, 0);
  const geo = new THREE.ExtrudeGeometry(forma, { depth: w + 0.6, bevelEnabled: false });
  geo.translate(0, 0, -(w + 0.6) / 2);
  geo.rotateY(Math.PI / 2);
  const telhado = malha(geo, mat(TONS_TELHADO[Math.floor(rnd() * TONS_TELHADO.length)]));
  telhado.position.y = h;
  g.add(telhado);
  g.add(caixa(1.4, 2.2, 0.15, M.porta, -w / 4, 0, d / 2 + 0.05));
  return g;
}

function quarteiraoComum(rnd) {
  const g = new THREE.Group();
  const lote = (S - RUA - 3) / 2;
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    if (rnd() < 0.18) {
      const t = arvore(1, rnd() < 0.5 ? 1 : 0);
      t.position.set(dx * lote / 2, 0.3, dz * lote / 2);
      g.add(t);
      continue;
    }
    const w = lote - 1 - rnd() * 2.5;
    const d = lote - 1 - rnd() * 2.5;
    let p;
    if (rnd() < 0.45) {
      p = casa(w - 1.5, d - 2, rnd);
      p.rotation.y = rnd() < 0.5 ? 0 : Math.PI / 2;
      // quintal com uma arvorezinha
      const t = arvore(0.7, 1);
      t.position.set(w / 2 - 1, 0, -d / 2 + 1);
      p.add(t);
    } else {
      const h = 4 + Math.floor(rnd() * 4) * 2.6;
      p = predio(w, h, d, { corTelhado: TONS_TELHADO[Math.floor(rnd() * TONS_TELHADO.length)] });
    }
    p.position.set(dx * lote / 2, 0.3, dz * lote / 2);
    g.add(p);
  }
  return g;
}

// ---------- montagem ----------

// Cada construção ganha materiais próprios, para poder ficar transparente sozinha
// quando estiver entre a câmera e a moto selecionada.
function marcarConstrucoes(conteudo, lista) {
  const alvos = conteudo.userData.unica ? [conteudo] : conteudo.children;
  for (const filho of alvos) {
    if (!filho.isGroup) continue;
    filho.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    });
    filho.userData.opacidade = 1;
    lista.push(filho);
  }
}

export function montarCidade(cena) {
  const construcoes = [];
  const larguraTotal = (COLS - 1) * S;
  const alturaTotal = (LINHAS - 1) * S;

  const chao = malha(new THREE.PlaneGeometry(900, 900), M.chao, { sombra: false });
  chao.rotation.x = -Math.PI / 2;
  chao.position.y = -0.02;
  cena.add(chao);

  // asfalto cobre a área da cidade; os quarteirões (calçadas elevadas) ficam por cima
  const asfalto = malha(new THREE.PlaneGeometry(larguraTotal + RUA, alturaTotal + RUA), M.asfalto, { sombra: false });
  asfalto.rotation.x = -Math.PI / 2;
  cena.add(asfalto);

  // faixas tracejadas no meio das ruas (uma InstancedMesh só)
  const traco = new THREE.PlaneGeometry(2.2, 0.22);
  traco.rotateX(-Math.PI / 2);
  const posicoes = [];
  for (let j = 0; j < LINHAS; j++)
    for (let i = 0; i < COLS - 1; i++)
      for (let k = 0; k < 5; k++) posicoes.push([noX(i) + RUA / 2 + 2.6 + k * 4.4, noZ(j), 0]);
  for (let i = 0; i < COLS; i++)
    for (let j = 0; j < LINHAS - 1; j++)
      for (let k = 0; k < 5; k++) posicoes.push([noX(i), noZ(j) + RUA / 2 + 2.6 + k * 4.4, Math.PI / 2]);
  const faixas = new THREE.InstancedMesh(traco, M.faixa, posicoes.length);
  const m4 = new THREE.Matrix4();
  posicoes.forEach(([x, z, r], i) => {
    m4.makeRotationY(r).setPosition(x, 0.02, z);
    faixas.setMatrixAt(i, m4);
  });
  faixas.receiveShadow = true;
  cena.add(faixas);

  // faixas de pedestre nos cruzamentos
  const zebra = new THREE.PlaneGeometry(0.6, 2.6);
  zebra.rotateX(-Math.PI / 2);
  const zPos = [];
  for (let i = 0; i < COLS; i++)
    for (let j = 0; j < LINHAS; j++)
      for (const [ox, oz, rot] of [[RUA / 2 + 1.6, 0, 0], [-(RUA / 2 + 1.6), 0, 0], [0, RUA / 2 + 1.6, 1], [0, -(RUA / 2 + 1.6), 1]])
        for (let k = -2; k <= 2; k++)
          zPos.push([noX(i) + ox + (rot ? k * 1.2 : 0), noZ(j) + oz + (rot ? 0 : k * 1.2), rot]);
  const zebras = new THREE.InstancedMesh(zebra, M.faixa, zPos.length);
  zPos.forEach(([x, z, r], i) => {
    m4.makeRotationY(r ? Math.PI / 2 : 0).setPosition(x, 0.015, z);
    zebras.setMatrixAt(i, m4);
  });
  cena.add(zebras);

  const rnd = sorteador(20261013);
  const especiais = new Map();
  UNIDADES.forEach((u) => especiais.set(u.bloco.join(","), () => restaurante(u)));
  especiais.set(COZINHA.bloco.join(","), cozinhaCentral);
  especiais.set(OFICINA.bloco.join(","), oficina);
  especiais.set(SEGURADORA.bloco.join(","), seguradora);
  PARQUES.forEach((p) => especiais.set(p.join(","), parque));

  for (let i = 0; i < COLS - 1; i++) {
    for (let j = 0; j < LINHAS - 1; j++) {
      const c = centroBloco([i, j]);
      const calcada = malha(new THREE.BoxGeometry(S - RUA, 0.3, S - RUA), M.calcada, { sombra: false });
      calcada.position.set(c.x, 0.15, c.z);
      cena.add(calcada);

      const fabrica = especiais.get(`${i},${j}`);
      const conteudo = fabrica ? fabrica() : quarteiraoComum(rnd);
      if (fabrica !== parque) marcarConstrucoes(conteudo, construcoes);
      conteudo.position.set(c.x, fabrica === parque ? 0 : 0.3, c.z);
      if (fabrica === parque) conteudo.position.y = 0;
      cena.add(conteudo);

      // árvores na calçada, nas bordas viradas para a rua
      if (fabrica !== parque) {
        const borda = (S - RUA) / 2 - 1.1;
        for (const [x, z] of [[-borda, -borda], [borda, -borda], [-borda, borda], [borda, borda]]) {
          if (rnd() < 0.55) continue;
          const t = arvore(0.75, rnd() < 0.5 ? 1 : 0);
          t.position.set(c.x + x, 0.3, c.z + z);
          cena.add(t);
        }
      }
    }
  }

  cena.userData.construcoes = construcoes;

  // bosque em volta para a cidade não terminar num corte seco
  const rndFora = sorteador(77);
  for (let k = 0; k < 140; k++) {
    const a = rndFora() * Math.PI * 2;
    const raio = 1 + rndFora() * 0.45;
    const x = Math.cos(a) * (larguraTotal / 2 + 14) * raio;
    const z = Math.sin(a) * (alturaTotal / 2 + 14) * raio;
    const t = arvore(0.9 + rndFora() * 0.6, k % 2);
    t.position.set(x, 0, z);
    cena.add(t);
  }
}

// ---------- vagas ----------

// Vaga na rua em frente a um quarteirão (lado +z), virada para a direção certa da mão.
export function vagasDoBloco(bloco, quantidade = 6) {
  const c = centroBloco(bloco);
  const zRua = c.z + S / 2;
  const dir = new THREE.Vector3(-1, 0, 0); // direita de (-1,0,0) é -z: o lado do quarteirão
  const vagas = [];
  for (let k = 0; k < quantidade; k++) {
    const x = c.x + 5.5 - k * 2.2;
    vagas.push({
      centro: new THREE.Vector3(x, 0, zRua),
      pos: new THREE.Vector3(x, 0, zRua - MEIO_FIO),
      dir: dir.clone(),
      // nó "de trás" (de onde a moto vem) e o nó da frente na mesma rua
      noAtras: [Math.round(c.x / S + (COLS - 1) / 2 + 0.5), Math.round(zRua / S + (LINHAS - 1) / 2)],
      noFrente: [Math.round(c.x / S + (COLS - 1) / 2 - 0.5), Math.round(zRua / S + (LINHAS - 1) / 2)]
    });
  }
  return vagas;
}
