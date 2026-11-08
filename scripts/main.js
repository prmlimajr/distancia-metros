const MODULE_ID = "distancia-metros";

/** Quantos metros vale 1 unidade de cada tipo (comparado em minúsculas). */
const FATORES_UNIDADE = {
  m: 1, metro: 1, metros: 1, meter: 1, meters: 1, metre: 1, metres: 1,
  cm: 0.01,
  km: 1000,
  ft: 0.3048, "ft.": 0.3048, feet: 0.3048, foot: 0.3048, "pé": 0.3048, "pés": 0.3048, pe: 0.3048, pes: 0.3048,
  yd: 0.9144, yard: 0.9144, yards: 0.9144, jarda: 0.9144, jardas: 0.9144,
  mi: 1609.344, mile: 1609.344, miles: 1609.344, milha: 1609.344, milhas: 1609.344
};

const cfg = (chave) => game.settings.get(MODULE_ID, chave);

/* -------------------------------------------- */
/*  Conversão e medição                         */
/* -------------------------------------------- */

/** Fator para converter as unidades da cena em metros. */
export function fatorParaMetros(scene = canvas.scene) {
  const manual = cfg("fatorManual");
  if (cfg("modoConversao") === "manual") return manual;
  const unidade = (scene?.grid?.units ?? "").trim().toLowerCase();
  return FATORES_UNIDADE[unidade] ?? manual;
}

/** Aceita Token, TokenDocument ou id e devolve o Token do canvas. */
function resolverToken(t) {
  if (typeof t === "string") return canvas.tokens.get(t);
  if (t?.documentName === "Token") return t.object;
  return t;
}

/** Retângulo do token; em cenas com grade, recuado meia célula (centro das células da borda). */
function retangulo(token, recuo) {
  const { x, y } = token.document;
  const rx = Math.min(recuo, token.w / 2);
  const ry = Math.min(recuo, token.h / 2);
  return { x0: x + rx, x1: x + token.w - rx, y0: y + ry, y1: y + token.h - ry };
}

/** Par de pontos mais próximos entre dois tokens (retângulos alinhados aos eixos). */
function pontosMaisProximos(a, b) {
  const recuo = canvas.grid.isGridless ? 0 : canvas.grid.size / 2;
  const ra = retangulo(a, recuo);
  const rb = retangulo(b, recuo);
  const eixo = (a0, a1, b0, b1) => {
    if (a1 < b0) return [a1, b0];
    if (b1 < a0) return [a0, b1];
    const v = (Math.max(a0, b0) + Math.min(a1, b1)) / 2; // sobreposição no eixo
    return [v, v];
  };
  const [ax, bx] = eixo(ra.x0, ra.x1, rb.x0, rb.x1);
  const [ay, by] = eixo(ra.y0, ra.y1, rb.y0, rb.y1);
  return [{ x: ax, y: ay }, { x: bx, y: by }];
}

/**
 * Distância em metros entre dois tokens.
 * @param {Token|TokenDocument|string} origem
 * @param {Token|TokenDocument|string} alvo
 * @param {object} [opcoes]
 * @param {"centro"|"borda"} [opcoes.modo]   centro-a-centro ou borda-a-borda
 * @param {boolean} [opcoes.elevacao]         considerar diferença de elevação (3D)
 */
export function medirDistancia(origem, alvo, { modo = cfg("modoMedicao"), elevacao = cfg("incluirElevacao") } = {}) {
  const a = resolverToken(origem);
  const b = resolverToken(alvo);
  if (!a || !b) throw new Error(`${MODULE_ID} | Token não encontrado.`);

  const [p, q] = modo === "borda" ? pontosMaisProximos(a, b) : [a.center, b.center];
  // measurePath respeita o tipo de grade e a regra de diagonais configurada no sistema/cena.
  let d = canvas.grid.measurePath([p, q]).distance;

  if (elevacao) {
    const dz = (b.document.elevation ?? 0) - (a.document.elevation ?? 0);
    d = Math.hypot(d, dz);
  }
  return d * fatorParaMetros();
}

export function formatarMetros(valor) {
  const casas = cfg("casasDecimais");
  const n = valor.toLocaleString(game.i18n.lang, { maximumFractionDigits: casas, minimumFractionDigits: 0 });
  return `${n} m`;
}

/* -------------------------------------------- */
/*  Rótulo ao passar o mouse                    */
/* -------------------------------------------- */

let camada = null;
let alvoAtual = null;

function limparRotulo() {
  camada?.removeChildren().forEach((c) => c.destroy());
}

function mostrarRotulo(alvo) {
  limparRotulo();
  if (!camada || !alvo || !cfg("mostrarAoPassar")) return;

  const origens = canvas.tokens.controlled.filter((t) => t !== alvo);
  if (!origens.length) return;

  const linhas = origens.map((o) => {
    const texto = formatarMetros(medirDistancia(o, alvo));
    return origens.length > 1 ? `${o.name}: ${texto}` : texto;
  });

  const PreciseTextCls = foundry.canvas?.containers?.PreciseText ?? globalThis.PreciseText;
  const estilo = CONFIG.canvasTextStyle.clone();
  estilo.fontSize = Math.max(18, Math.round(canvas.grid.size / 3.5));
  estilo.align = "center";

  const texto = new PreciseTextCls(linhas.join("\n"), estilo);
  texto.anchor.set(0.5, 1);
  texto.position.set(alvo.center.x, alvo.document.y - 6);
  camada.addChild(texto);
}

function atualizarRotulo() {
  if (alvoAtual && !alvoAtual.destroyed) mostrarRotulo(alvoAtual);
  else limparRotulo();
}

/* -------------------------------------------- */
/*  Relatório no chat                           */
/* -------------------------------------------- */

const escaparHTML = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Envia (sussurrado para você) as distâncias do token controlado até os alvos marcados, ou até todos os tokens visíveis. */
export async function relatorio() {
  const origem = canvas.tokens.controlled[0];
  if (!origem) return ui.notifications.warn(game.i18n.localize("DISTM.Avisos.SemOrigem"));

  let alvos = [...game.user.targets].filter((t) => t !== origem);
  if (!alvos.length) alvos = canvas.tokens.placeables.filter((t) => t !== origem && t.visible);
  if (!alvos.length) return ui.notifications.info(game.i18n.localize("DISTM.Avisos.SemAlvos"));

  const linhas = alvos
    .map((t) => ({ nome: t.name, d: medirDistancia(origem, t) }))
    .sort((x, y) => x.d - y.d)
    .map(({ nome, d }) => `<tr><td>${escaparHTML(nome)}</td><td style="text-align:right">${formatarMetros(d)}</td></tr>`)
    .join("");

  const titulo = game.i18n.format("DISTM.Relatorio.Titulo", { nome: escaparHTML(origem.name) });
  return ChatMessage.create({
    content: `<h3>${titulo}</h3><table>${linhas}</table>`,
    whisper: [game.user.id]
  });
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  const registrar = (chave, dados) =>
    game.settings.register(MODULE_ID, chave, {
      name: `DISTM.Config.${chave}.Nome`,
      hint: `DISTM.Config.${chave}.Dica`,
      config: true,
      ...dados
    });

  registrar("modoConversao", {
    scope: "world", type: String, default: "auto",
    choices: { auto: "DISTM.Config.modoConversao.Auto", manual: "DISTM.Config.modoConversao.Manual" }
  });
  registrar("fatorManual", { scope: "world", type: Number, default: 1 });
  registrar("modoMedicao", {
    scope: "world", type: String, default: "centro",
    choices: { centro: "DISTM.Config.modoMedicao.Centro", borda: "DISTM.Config.modoMedicao.Borda" },
    onChange: atualizarRotulo
  });
  registrar("incluirElevacao", { scope: "world", type: Boolean, default: false, onChange: atualizarRotulo });
  registrar("mostrarAoPassar", { scope: "client", type: Boolean, default: true, onChange: atualizarRotulo });
  registrar("casasDecimais", {
    scope: "client", type: Number, default: 1,
    range: { min: 0, max: 3, step: 1 },
    onChange: atualizarRotulo
  });

  game.keybindings.register(MODULE_ID, "relatorio", {
    name: "DISTM.Atalho.Nome",
    hint: "DISTM.Atalho.Dica",
    editable: [{ key: "KeyD", modifiers: ["Alt"] }],
    onDown: () => {
      relatorio();
      return true;
    }
  });

  game.modules.get(MODULE_ID).api = { medirDistancia, fatorParaMetros, formatarMetros, relatorio };
});

Hooks.on("canvasReady", () => {
  camada = new PIXI.Container();
  camada.eventMode = "none";
  canvas.controls.addChild(camada);
  alvoAtual = null;
});

Hooks.on("canvasTearDown", () => {
  camada = null;
  alvoAtual = null;
});

Hooks.on("hoverToken", (token, emHover) => {
  alvoAtual = emHover ? token : null;
  atualizarRotulo();
});

Hooks.on("controlToken", atualizarRotulo);

// Dispara a cada quadro durante animações de movimento: mantém o rótulo atualizado.
Hooks.on("refreshToken", (token) => {
  if (!alvoAtual) return;
  if (token === alvoAtual || token.controlled) atualizarRotulo();
});

Hooks.on("deleteToken", (doc) => {
  if (doc.object === alvoAtual) alvoAtual = null;
  atualizarRotulo();
});
