/* =========================================================================
   TIEMPO DE ESTUDIO — Competencias · capa visual (rediseño 2026-09-21)
   -------------------------------------------------------------------------
   Todo lo que se DIBUJA del rediseño (prototipo-competencias-v2.html) vive
   acá: avatares con foto de Google, filas, podio, tarjeta de competencia,
   hoja modal, historial por semana y aviso de posición. No hace ninguna
   llamada de red ni lee `estado`: recibe datos ya listos y devuelve HTML o
   elementos DOM. Los archivos con lógica (competencias, gestion,
   celebracion) lo importan; este NO importa a ninguno de ellos, así que no
   crea ciclos.

   ESTILOS: se inyectan solos desde acá (un <style id="te-estilos-
   competencias-visual">), mismo patrón que `asegurarEstilosGestion()`. NO
   se toca design-system.css. Todo va prefijado para no chocar con el resto
   de la app:
     - clases   → `cp-…`      (ej. .cp-row, .cp-podium)
     - variables → `--cp-…`   (definidas en .cp-scope / .cp-overlay, nunca
                               en :root, así que no pisan los tokens de la app)
     - keyframes → `cp-…`
   La tarjeta y las hojas usan su propia paleta oscura (igual que el
   prototipo), independiente del tema de la app: son piezas "de marca".
   La tipografía se hereda (`font: inherit`), no se carga ninguna fuente.

   FOTOS: `avatarHTML` acepta la URL https de la foto de Google; si no hay,
   o si la imagen falla al cargar (URLs de Google que vencen), cae a la
   inicial con un color estable derivado del apodo. Tras insertar HTML con
   avatares hay que llamar `activarFallbackAvatares(raiz)` (los handlers de
   error no se ponen inline para no depender de la CSP).

   UNIDADES: las horas llegan como el Worker las guarda
   (`horas_semana_actual`, en HORAS con decimales); acá se muestran con
   `fmtHoras`, igual que `formatearHoras` de tiempo-estudio-competencias.js.
   ========================================================================= */

import { CSS_COMPETENCIAS_VISUAL } from "./tiempo-estudio-competencias-visual-estilos.js";

const ID_ESTILOS = "te-estilos-competencias-visual";
const CLAVE_VISTA = "te_comp_vista";

/* ===================== Utilidades ===================== */

function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Horas (decimales) → "1 h 20 min" / "45 min" / "3 h". */
function fmtHoras(horas) {
  const total = Math.max(0, Math.round((Number(horas) || 0) * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Solo https y de largo razonable — se va a poner en un <img src>. */
function normalizarFotoUrl(valor) {
  if (typeof valor !== "string") return null;
  const v = valor.trim();
  if (!v || v.length > 2048) return null;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch (e) {
    return null;
  }
}

function tonoDeApodo(apodo) {
  let h = 0;
  for (const c of String(apodo || "?")) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

function inicialDe(apodo) {
  const primero = Array.from(String(apodo || "").trim())[0];
  return (primero || "?").toUpperCase();
}

function fondoIniciales(h) {
  return `linear-gradient(135deg,hsl(${h} 88% 62%),hsl(${(h + 28) % 360} 80% 48%))`;
}

function leerVistaPreferida() {
  try {
    return localStorage.getItem(CLAVE_VISTA) === "filas" ? "filas" : "podio";
  } catch (e) {
    return "podio";
  }
}

function guardarVistaPreferida(vista) {
  try {
    localStorage.setItem(CLAVE_VISTA, vista === "filas" ? "filas" : "podio");
  } catch (e) {
    // no crítico: solo se pierde la preferencia entre visitas
  }
}

/** Formato corto de la fecha en que cerró la semana: "21 sept". */
function fechaSemana(ms) {
  return new Date(ms).toLocaleDateString("es", { day: "numeric", month: "short" });
}

/* ===================== Iconos ===================== */

const ICONO = {
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  trophy: '<svg viewBox="0 0 24 24"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  podium: '<svg viewBox="0 0 24 24"><path d="M3 21v-7h5v7M9.5 21V5h5v16M16 21v-10h5v10"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
};

const CORONA = '<svg class="cp-crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.6 4.2L12 4.5l4.4 7.7L21 8l-1.9 11H4.9L3 8z" fill="#ffc94d" stroke="#b97b12" stroke-width="1.2" stroke-linejoin="round"/><circle cx="3" cy="8" r="1.6" fill="#ffe28f"/><circle cx="12" cy="4.2" r="1.6" fill="#ffe28f"/><circle cx="21" cy="8" r="1.6" fill="#ffe28f"/></svg>';

/* ===================== Avatares ===================== */

/**
 * `persona` = { apodo, foto_url }. `tam` = diámetro en px (opcional; el CSS
 * trae 40 por defecto y el podio lo escala solo).
 */
function avatarHTML(persona, tam) {
  const st = tam ? ` style="--cp-s:${tam}px"` : "";
  const apodo = persona && persona.apodo;
  const h = tonoDeApodo(apodo);
  const inicial = esc(inicialDe(apodo));
  const url = normalizarFotoUrl(persona && persona.foto_url);
  if (!url) {
    return `<span class="cp-av"${st}><span class="cp-ini" style="background:${fondoIniciales(h)}">${inicial}</span></span>`;
  }
  return `<span class="cp-av"${st}><img class="cp-av-img" src="${esc(url)}" alt="" referrerpolicy="no-referrer" decoding="async" data-cp-ini="${inicial}" data-cp-h="${h}"></span>`;
}

/** Cambia por la inicial cualquier foto que no cargue. Llamar después de
 * meter HTML con avatares en el DOM. */
function activarFallbackAvatares(raiz) {
  if (!raiz) return;
  raiz.querySelectorAll("img.cp-av-img").forEach((img) => {
    if (img.dataset.cpListo) return;
    img.dataset.cpListo = "1";
    const caer = () => {
      if (!img.isConnected) return;
      const ini = document.createElement("span");
      ini.className = "cp-ini";
      ini.style.background = fondoIniciales(Number(img.dataset.cpH) || 0);
      ini.textContent = img.dataset.cpIni || "?";
      img.replaceWith(ini);
    };
    img.addEventListener("error", caer, { once: true });
    if (img.complete && img.naturalWidth === 0) caer();
  });
}

/* ===================== Filas y podio ===================== */

const seg = (n) => `${Number(n).toFixed(2)}s`;

/** Ordena por horas de mayor a menor sin mutar (estable: empate = orden recibido). */
function ordenarPorHoras(participantes) {
  return participantes
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (b.p.horas || 0) - (a.p.horas || 0) || a.i - b.i)
    .map((x) => x.p);
}

function filaHTML(p, i, ordenados, d, yoId) {
  const rank = i + 1;
  const lider = i === 0;
  const yo = p.id === yoId;
  const tope = ordenados[0].horas || 0;
  const pct = tope ? Math.round(((p.horas || 0) / tope) * 100) : 0;
  const cls = ["cp-row", lider ? "cp-lead" : "", yo ? "cp-me-halo" : "", !p.horas ? "cp-zero" : ""].filter(Boolean).join(" ");
  const rk = `<span class="cp-rk ${rank <= 3 ? "cp-r" + rank : ""}">${rank}</span>`;
  return `<div class="${cls}" style="--cp-d:${seg(d)};--cp-bd:${seg(d + 0.25)};--cp-dc:${seg(d + 0.6)}">
    ${rk}
    <span class="cp-avw">${lider ? CORONA : ""}${avatarHTML(p, lider ? 48 : 40)}</span>
    <div class="cp-who"><div class="cp-name">${esc(p.apodo)}</div>
      <div class="cp-sub"><div class="cp-bar"><i style="--cp-w:${pct}%"></i></div></div></div>
    <div class="cp-time">${fmtHoras(p.horas)}</div>
  </div>`;
}

/**
 * Podio de 3. `ordenados` ya viene ordenado. `modo`: "card" (tarjeta, con
 * animación escalonada según T y la marca de "vos") o "modal" (historial).
 */
function podioHTML(ordenados, modo, T, yoId) {
  const card = modo === "card";
  const t = card
    ? { ped: [T + 0.44, T + 0.22, T], jump: [T + 1.05, T + 0.67, T + 0.45] }
    : { ped: [0.38, 0.2, 0.05], jump: [0.7, 0.5, 0.35] };
  const slot = (i, cls) => {
    const p = ordenados[i];
    if (!p) return `<div class="cp-pc ${cls} cp-empty"></div>`;
    const dj = t.jump[i];
    const yo = card && p.id === yoId;
    const dn = dj + (i === 0 ? 0.6 : 0.55);
    const vars = `--cp-dp:${seg(t.ped[i])};--cp-dj:${seg(dj)};--cp-dn:${seg(dn)};--cp-dc:${seg(dj + 0.95)};--cp-ds:${card && i === 0 ? seg(dj + 1) : "0s"}`;
    const chispas =
      i === 0
        ? `<i class="cp-sp" style="left:-30px;top:6px;--cp-d:.2s"></i><i class="cp-sp" style="right:-28px;top:26px;--cp-d:1s"></i><i class="cp-sp" style="left:-16px;top:52px;--cp-d:1.7s;width:6px;height:6px"></i><i class="cp-sp" style="right:-12px;top:-4px;--cp-d:2.2s;width:6px;height:6px"></i>`
        : "";
    const ondas = card && i === 0 ? `<i class="cp-rip" style="--cp-r:${seg(dj + 0.58)}"></i><i class="cp-rip" style="--cp-r:${seg(dj + 0.93)}"></i>` : "";
    return `<div class="cp-pc ${cls}${yo ? " cp-me-halo" : ""}" style="${vars}">
      ${ondas}
      <span class="cp-avw">${i === 0 ? CORONA : ""}${chispas}${avatarHTML(p)}</span>
      <div class="cp-pn">${esc(p.apodo)}</div>
      <div class="cp-pt">${fmtHoras(p.horas)}</div>
      <div class="cp-ped"><b>${i + 1}</b></div>
    </div>`;
  };
  const k = card ? `--cp-k1:${seg(t.jump[0] + 0.58)};--cp-k2:${seg(t.jump[0] + 0.93)}` : "";
  return `<div class="cp-podium ${card ? "cp-card" : ""}" style="${k}">${slot(1, "cp-p2")}${slot(0, "cp-p1")}${slot(2, "cp-p3")}</div>`;
}

/* ===================== Tarjeta de competencia ===================== */

function cuerpoTarjetaHTML(participantes, vista, yoId) {
  const ord = ordenarPorHoras(participantes);
  const n = ord.length;
  if (vista === "podio") {
    const resto = Math.max(0, n - 3);
    const T = 0.35 + resto * 0.1;
    const filas = ord
      .slice(3)
      .map((p, k) => {
        const rank = k + 4; // los de abajo entran primero
        return filaHTML(p, rank - 1, ord, 0.25 + (n - rank) * 0.1, yoId);
      })
      .join("");
    return podioHTML(ord, "card", T, yoId) + (resto ? `<div class="cp-list">${filas}</div>` : "");
  }
  return `<div class="cp-list">${ord.map((p, i) => filaHTML(p, i, ord, 0.25 + (n - (i + 1)) * 0.16, yoId)).join("")}</div>`;
}

/**
 * Dibuja (o redibuja) la tarjeta completa dentro de `tarjeta`.
 *
 * o = {
 *   nombre, esCreador, apodo,              // cabecera
 *   participantes: [{id, apodo, foto_url, horas}] | null,
 *   estadoCuerpo: "cargando" | "error" | "ok",
 *   vista: "podio" | "filas", animar: boolean, yoId
 * }
 * cb = { alHistorial(), alGestionar(), alCambiarVista(vista) }
 */
function pintarTarjeta(tarjeta, o, cb) {
  asegurarEstilosCompetenciasVisual();
  tarjeta.className = "cp-comp cp-scope" + (o.animar ? " cp-anim" : "");
  tarjeta.dataset.layout = o.vista;

  let cuerpo;
  if (o.estadoCuerpo === "cargando") cuerpo = `<p class="cp-msg">Cargando marcador…</p>`;
  else if (o.estadoCuerpo === "error") cuerpo = `<p class="cp-msg">No se pudo cargar el marcador. Revisá tu conexión.</p>`;
  else if (!o.participantes || o.participantes.length === 0) cuerpo = `<p class="cp-msg">Todavía no hay nadie en el marcador.</p>`;
  else cuerpo = cuerpoTarjetaHTML(o.participantes, o.vista, o.yoId);

  const coronaTitulo = o.esCreador
    ? `<svg viewBox="0 0 24 24" role="img" aria-label="Sos el creador"><path d="M3 8l4.6 4.2L12 4.5l4.4 7.7L21 8l-1.9 11H4.9L3 8z" fill="#ffc94d" stroke="#b97b12" stroke-width="1.2" stroke-linejoin="round"/></svg>`
    : "";

  tarjeta.innerHTML = `
    <div class="cp-c-head">
      <div>
        <div class="cp-c-title">${esc(o.nombre)}${coronaTitulo}</div>
        <div class="cp-c-sub">Tu apodo ahí: ${esc(o.apodo)}</div>
      </div>
      <div class="cp-c-icons">
        <button type="button" class="cp-ico cp-gold" data-cp="historial" aria-label="Historial" title="Historial">${ICONO.trophy}</button>
        <button type="button" class="cp-ico" data-cp="gestionar" aria-label="Gestionar" title="Gestionar">${ICONO.gear}</button>
      </div>
      <div class="cp-vt" role="group" aria-label="Vista de la competencia">
        <button type="button" data-val="podio" aria-label="Vista podio" aria-pressed="${o.vista === "podio"}">${ICONO.podium}</button>
        <button type="button" data-val="filas" aria-label="Vista lista" aria-pressed="${o.vista === "filas"}">${ICONO.list}</button>
      </div>
    </div>
    ${cuerpo}`;

  activarFallbackAvatares(tarjeta);
  tarjeta.querySelector('[data-cp="historial"]').addEventListener("click", () => cb.alHistorial && cb.alHistorial());
  tarjeta.querySelector('[data-cp="gestionar"]').addEventListener("click", () => cb.alGestionar && cb.alGestionar());
  tarjeta.querySelectorAll(".cp-vt button").forEach((b) =>
    b.addEventListener("click", () => {
      if (o.vista === b.dataset.val) return;
      if (cb.alCambiarVista) cb.alCambiarVista(b.dataset.val);
    })
  );
}

/* ===================== Hoja modal ===================== */

let contadorHojas = 0;

/**
 * Hoja modal con el diseño del prototipo. tono: "" (dorado) | "acc" (violeta).
 * Devuelve { overlay, sheet, cuerpo, cerrar }. Clic afuera, ✕ y Escape cierran.
 */
function abrirHoja({ icono, tono, titulo, subtitulo, cuerpoHTML }) {
  asegurarEstilosCompetenciasVisual();
  const idTitulo = `cp-sh-titulo-${++contadorHojas}`;
  const overlay = document.createElement("div");
  overlay.className = "cp-overlay cp-scope";
  overlay.innerHTML = `
    <div class="cp-sheet" role="dialog" aria-modal="true" aria-labelledby="${idTitulo}">
      <div class="cp-sh-head">
        <div class="cp-tchip ${tono || ""}">${ICONO[icono] || ""}</div>
        <div><h2 id="${idTitulo}">${esc(titulo)}</h2><p>${esc(subtitulo || "")}</p></div>
        <button type="button" class="cp-x" data-cp="cerrar" aria-label="Cerrar">${ICONO.x}</button>
      </div>
      <div class="cp-sh-body">${cuerpoHTML || ""}</div>
    </div>`;
  const sheet = overlay.querySelector(".cp-sheet");
  const cuerpo = overlay.querySelector(".cp-sh-body");
  const overflowPrevio = document.body.style.overflow;
  let cerrada = false;

  function alTeclear(e) {
    if (e.key === "Escape") cerrar();
  }
  function cerrar() {
    if (cerrada) return;
    cerrada = true;
    document.removeEventListener("keydown", alTeclear);
    document.body.style.overflow = overflowPrevio;
    overlay.classList.remove("cp-show");
    setTimeout(() => overlay.remove(), 250);
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });
  overlay.querySelector('[data-cp="cerrar"]').addEventListener("click", cerrar);
  document.addEventListener("keydown", alTeclear);
  document.body.style.overflow = "hidden";
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("cp-show"));
  overlay.querySelector('[data-cp="cerrar"]').focus();
  activarFallbackAvatares(overlay);
  return { overlay, sheet, cuerpo, cerrar };
}

/* ===================== Historial por semanas ===================== */

/** Normaliza un podio del Worker (`/podios`) al formato interno. */
function normalizarResultados(podio) {
  return (podio.resultados || []).map((r) => ({ id: r.participante_id, apodo: r.apodo, foto_url: r.foto_url, horas: r.horas }));
}

function semanaHTML(podio, idx, abierta, yoId) {
  const res = normalizarResultados(podio);
  const ganador = res[0];
  if (!ganador) return "";
  const resto = res.slice(3);
  const restoHTML = resto.length
    ? `<div class="cp-rest">${resto
        .map(
          (r, k) => `
    <div class="cp-rrow${!r.horas ? " cp-zero" : ""}">
      <span class="cp-rk">${k + 4}</span>${avatarHTML(r, 28)}
      <div class="cp-name">${esc(r.apodo)}</div><div class="cp-time">${fmtHoras(r.horas)}</div>
    </div>`
        )
        .join("")}</div>`
    : "";
  const nota = podio.completa === false ? `<p class="cp-nota">Semana anterior a los podios completos: solo se guardó quién ganó.</p>` : "";
  return `<div class="cp-wk ${abierta ? "cp-open" : ""} ${idx === 0 ? "cp-hero" : ""}" data-semana="${esc(podio.semana_cerrada_en)}">
    <button type="button" class="cp-wk-head" aria-expanded="${abierta}">
      <span class="cp-w-who">${avatarHTML(ganador, 30)}<span class="cp-name">${esc(ganador.apodo)}</span></span>
      <span class="cp-w-time">${fmtHoras(ganador.horas)}</span>
      <span class="cp-w-date">${fechaSemana(podio.semana_cerrada_en)}${ICONO.chev}</span>
    </button>
    <div class="cp-wk-body"><div class="cp-wk-inner"><div class="cp-wk-pad">${podioHTML(res, "modal", 0, yoId)}${restoHTML}${nota}</div></div></div>
  </div>`;
}

/**
 * Rellena `hoja.cuerpo` con las semanas. `abrirEn` = semana_cerrada_en de la
 * semana a desplegar (por defecto la última). Solo una semana abierta a la vez.
 */
function pintarHistorial(hoja, podios, yoId, abrirEn) {
  if (!podios || podios.length === 0) {
    hoja.cuerpo.innerHTML = `<p class="cp-msg">Todavía no se cerró ninguna semana.</p>`;
    return;
  }
  const abrirSem = abrirEn && podios.some((p) => p.semana_cerrada_en === abrirEn) ? abrirEn : podios[0].semana_cerrada_en;
  hoja.cuerpo.innerHTML = `
    <div class="cp-grp">Última semana</div>
    ${semanaHTML(podios[0], 0, podios[0].semana_cerrada_en === abrirSem, yoId)}
    ${podios.length > 1 ? `<div class="cp-grp">Semanas anteriores</div>` : ""}
    ${podios
      .slice(1)
      .map((p, i) => semanaHTML(p, i + 1, p.semana_cerrada_en === abrirSem, yoId))
      .join("")}`;
  activarFallbackAvatares(hoja.cuerpo);

  hoja.cuerpo.addEventListener("click", (e) => {
    const cab = e.target.closest(".cp-wk-head");
    if (!cab) return;
    const wk = cab.parentElement;
    const abrir = !wk.classList.contains("cp-open");
    hoja.cuerpo.querySelectorAll(".cp-wk.cp-open").forEach((x) => {
      x.classList.remove("cp-open");
      x.querySelector(".cp-wk-head").setAttribute("aria-expanded", "false");
    });
    if (abrir) {
      wk.classList.add("cp-open");
      cab.setAttribute("aria-expanded", "true");
    }
  });

  if (abrirSem !== podios[0].semana_cerrada_en) {
    setTimeout(() => {
      const el = hoja.cuerpo.querySelector(`.cp-wk[data-semana="${CSS.escape(String(abrirSem))}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 350);
  }
}

/* ===================== Aviso de posición (banner) ===================== */

/**
 * Datos del aviso a partir del podio de una semana. Devuelve null si `yoId`
 * no estuvo en esa semana (se unió después) — quien llama decide qué hacer.
 * { pos, tier, titulo, sub, horasMias, ganadorApodo }
 */
function resumenPosicion(podio, yoId) {
  const res = normalizarResultados(podio);
  const idx = res.findIndex((r) => r.id === yoId);
  if (idx === -1) return null;
  const pos = idx + 1;
  const mio = res[idx].horas || 0;
  const gan = res[0];
  const seg2 = res[1];
  let titulo;
  let sub;
  if (pos === 1) {
    titulo = "¡Ganaste la semana!";
    sub = seg2 ? `+${fmtHoras(mio - (seg2.horas || 0))} sobre ${seg2.apodo}` : "Nadie más sumó horas";
  } else if (pos <= 3) {
    const brecha = (gan.horas || 0) - mio;
    titulo = `Quedaste ${pos}.º`;
    sub = brecha > 0 ? `a ${fmtHoras(brecha)} de ${gan.apodo}` : `empatado en horas con ${gan.apodo}`;
  } else {
    titulo = "Cerró la semana";
    sub = `Quedaste ${pos}.º · ${gan.apodo} ganó con ${fmtHoras(gan.horas)}`;
  }
  return { pos, tier: pos >= 4 ? 4 : pos, titulo, sub, horasMias: mio, yo: res[idx] };
}

/**
 * Aviso de resultado (prototipo `renderBanner`). Devuelve el elemento
 * `.cp-res-wrap`. `datos` = { podio, yoId, nombreCompetencia, cta? }.
 * cb = { alAbrir(), alDescartar() } — al descartar se anima el cierre y se
 * quita solo del DOM.
 */
function construirAvisoPodio(datos, cb) {
  asegurarEstilosCompetenciasVisual();
  const r = resumenPosicion(datos.podio, datos.yoId);
  if (!r) return null;

  let fx = "";
  if (r.pos === 1) {
    const cols = ["#ffd45c", "#ff7ab8", "#8f83ff", "#63e6be", "#ffffff"];
    for (let i = 0; i < 22; i++) {
      const x = Math.round(-30 + Math.random() * 330);
      const y = Math.round(-40 + Math.random() * 130);
      const rot = Math.round(-360 + Math.random() * 720);
      fx += `<i class="cp-cf" style="--cp-x:${x}px;--cp-y:${y}px;--cp-r:${rot}deg;--cp-c:${cols[i % cols.length]};--cp-dl:${(0.55 + Math.random() * 0.25).toFixed(2)}s"></i>`;
    }
  }
  if (r.pos <= 3) {
    fx += `<i class="cp-sp" style="left:8px;top:14px;--cp-d:.9s"></i><i class="cp-sp" style="left:76px;top:22px;--cp-d:1.6s;width:6px;height:6px"></i><i class="cp-sp" style="left:70px;top:70px;--cp-d:2.1s"></i>`;
  }

  const wrap = document.createElement("div");
  wrap.className = "cp-res-wrap cp-scope";
  wrap.innerHTML = `<div class="cp-res-clip">
      <div class="cp-res cp-res-${r.tier}" role="status">
        ${fx}
        <button type="button" class="cp-res-main" data-cp="abrir" aria-label="${esc(datos.cta || "Ver podio")} de ${esc(datos.nombreCompetencia)}">
          <span class="cp-res-av">${r.pos === 1 ? CORONA : ""}${avatarHTML(r.yo, 54)}<span class="cp-rk ${r.pos <= 3 ? "cp-r" + r.pos : ""}">${r.pos}</span></span>
          <span>
            <div class="cp-res-week">${esc(datos.nombreCompetencia)} · ${fechaSemana(datos.podio.semana_cerrada_en)}</div>
            <div class="cp-res-title">${esc(r.titulo)}</div>
            <div class="cp-res-sub">${esc(r.sub)}</div>
          </span>
          <span class="cp-res-end"><span class="cp-res-time">${fmtHoras(r.horasMias)}</span><span class="cp-res-cta">${esc(datos.cta || "Ver podio")}${ICONO.right}</span></span>
        </button>
        <button type="button" class="cp-res-x" data-cp="descartar" aria-label="Descartar aviso">${ICONO.x}</button>
      </div>
    </div>`;
  activarFallbackAvatares(wrap);
  wrap.querySelector('[data-cp="abrir"]').addEventListener("click", () => cb.alAbrir && cb.alAbrir());
  wrap.querySelector('[data-cp="descartar"]').addEventListener("click", () => {
    wrap.classList.add("cp-gone");
    setTimeout(() => wrap.remove(), 460);
    if (cb.alDescartar) cb.alDescartar();
  });
  return wrap;
}

/* ===================== Estilos ===================== */

function asegurarEstilosCompetenciasVisual() {
  if (document.getElementById(ID_ESTILOS)) return;
  const estilo = document.createElement("style");
  estilo.id = ID_ESTILOS;
  estilo.textContent = CSS_COMPETENCIAS_VISUAL;
  document.head.appendChild(estilo);
}

export {
  ICONO,
  esc,
  fmtHoras,
  normalizarFotoUrl,
  leerVistaPreferida,
  guardarVistaPreferida,
  avatarHTML,
  activarFallbackAvatares,
  pintarTarjeta,
  abrirHoja,
  pintarHistorial,
  resumenPosicion,
  construirAvisoPodio,
};
