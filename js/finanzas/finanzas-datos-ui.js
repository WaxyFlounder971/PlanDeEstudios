/* =========================================================================
   FINANZAS 2.0: Datos, exportar e importar (sesión 6, F6). Solo pantalla; la lógica vive en core/finanzas/finanzas-importar.js.
   - Exportar: CSV para hojas de cálculo o respaldo JSON. Se descarga o, si el dispositivo lo permite, se comparte.
   - Importar: archivo o texto pegado → vista previa (qué es nuevo, qué ya está, qué falló) → importar → Deshacer.
   Nada se guarda hasta que la persona pulsa Importar. Sin innerHTML.
   ========================================================================= */

import {
  advertenciasImportacion, aplicarImportacion, candidatosDeCsv, clasificarCandidatos, deshacerImportacion, exportarMovimientosCsv,
  exportarRespaldoJson, mapeoSuficiente, prepararImportacion, resumirCandidatos,
} from "../core/finanzas/finanzas-importar.js";
import { decodificarBytes } from "../core/finanzas/finanzas-csv.js";
import { crearGuardReentrada } from "../core/finanzas/finanzas-registro.js";
import { marcarCambioPendiente } from "../core/storage/storage-sync.js";
import { estado } from "../core/storage/storage.js";
import { obtenerLocaleInterfaz, traducirTextoInterfaz as t } from "../core/i18n.js";
import { mostrarToast } from "../ui/componentes.js";
import { formatearMonto, renderizarFinanzas } from "./finanzas.js";
import { mostrarBarraDeshacer } from "./finanzas-registro-rapido.js";
import { abrirCapaNombrada, areaTexto, boton, campo, filaBotones, insignia, lineaError, mostrar, parrafo, selector } from "./finanzas-ui-basico.js";

const MAX_BYTES = 2 * 1024 * 1024;
const FILAS_VISIBLES = 100;

const MOTIVOS_ARCHIVO = {
  vacio: "No hay nada que leer. Elige un archivo o pega el texto.", muy_grande: "El archivo es muy grande (máximo 2 MB). Divídelo en partes.",
  json: "El archivo parece JSON pero está dañado.", sin_filas: "No encontré filas: la primera línea debe ser el encabezado y debe haber al menos un movimiento debajo.",
  formato: "No reconozco el formato. Usa un CSV o un respaldo de Finanzas.",
};
const MOTIVOS_FILA = { fecha: "Falta una fecha válida", monto: "Falta un monto mayor que cero", tipo: "No pude saber si es gasto o ingreso", meta: "La meta no existe o está archivada", id: "Falta su identificador" };
const AVISOS = {
  modulo_gastos: "Gastos e ingresos está apagado: se importan, pero no se verán hasta que lo enciendas en Ajustes.",
  modulo_ahorros: "Ahorros está apagado: lo de metas se importa, pero no se verá hasta que lo enciendas.",
  modulo_matricula: "Matrícula está apagado: se importan, pero no se verán hasta que lo enciendas.", modulo_beca: "Beca está apagado: se importan, pero no se verán hasta que lo enciendas.",
  modulo_ajuste: "Los ajustes de saldo se ocultan con Gastos, Matrícula y Beca apagados.",
  moneda: "Algunos montos parecen estar en otra moneda. Finanzas no convierte: se guardan tal cual.",
};
const CAMPOS_MAPEO = [["fecha", "Fecha"], ["nombre", "Nombre o descripción"], ["monto", "Monto"], ["debito", "Débito (salidas)"], ["credito", "Crédito (entradas)"], ["tipo", "Tipo"], ["categoria", "Categoría"], ["nota", "Nota"], ["referencia", "Referencia"]];

/* ===================== Entregar un archivo ===================== */

function puedeCompartirArchivos() {
  try { return typeof File === "function" && !!navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.csv", { type: "text/csv" })] }); } catch (e) { return false; }
}

/** Comparte el archivo (menú de compartir del sistema) o lo descarga. Devuelve "compartido" | "descargado" | "cancelado". */
async function entregarArchivo(nombre, texto, mime, { compartir = false } = {}) {
  const blob = new Blob([texto], { type: `${mime};charset=utf-8` });
  if (compartir && puedeCompartirArchivos()) {
    try { await navigator.share({ files: [new File([blob], nombre, { type: mime })], title: nombre }); return "compartido"; }
    catch (e) { if (e && e.name === "AbortError") return "cancelado"; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = nombre; a.style.display = "none";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "descargado";
}

/* ===================== Exportar ===================== */

function abrirExportar() {
  const { caja, cerrar } = abrirCapaNombrada("finanzas-exportar-overlay", "Exportar movimientos");
  let formato = "csv";
  const separadorPorDefecto = (1.5).toLocaleString(obtenerLocaleInterfaz()).includes(",") ? ";" : ","; // en español, Excel espera ; y coma decimal
  const separador = selector([[",", "Coma (,)"], [";", "Punto y coma (;)"]], separadorPorDefecto);
  const campoSeparador = campo("Separador de columnas", separador, "Si al abrir el archivo en tu hoja de cálculo todo queda en una columna, prueba el otro.");
  const info = parrafo("", { tamano: "0.85rem" });
  const error = lineaError();

  const grupo = document.createElement("div"); grupo.className = "rr-tipos"; grupo.setAttribute("role", "group"); grupo.setAttribute("aria-label", t("Formato"));
  grupo.style.gridTemplateColumns = "1fr 1fr";
  const botonesFormato = new Map();
  [["csv", "Hoja de cálculo (CSV)"], ["json", "Respaldo completo (JSON)"]].forEach(([v, x]) => {
    const b = boton(t(x), "pill-item", () => elegir(v)); botonesFormato.set(v, b); grupo.appendChild(b);
  });

  const generar = () => (formato === "csv" ? exportarMovimientosCsv(estado.datos, { separador: separador.value }) : exportarRespaldoJson(estado.datos));
  function elegir(v) {
    formato = v;
    botonesFormato.forEach((b, k) => { b.classList.toggle("active", k === v); b.setAttribute("aria-pressed", k === v ? "true" : "false"); });
    campoSeparador.classList.toggle("oculto", v !== "csv");
    const g = generar();
    let texto = t("{n} movimientos.").replace("{n}", String(g.total));
    if (v === "csv" && g.recurrentesOmitidos) texto += " " + t("{n} recurrentes solo van en el respaldo JSON.").replace("{n}", String(g.recurrentesOmitidos));
    if (v === "json") texto += " " + t("Incluye metas, categorías, sobres y compromisos. Sirve para guardar una copia o pasarla a otra cuenta.");
    info.textContent = texto;
  }

  const entregar = (compartir) => async () => {
    const g = generar();
    if (!g.total) { mostrar(error, "Todavía no hay movimientos para exportar."); return; }
    const r = await entregarArchivo(g.nombreArchivo, g.texto, formato === "csv" ? "text/csv" : "application/json", { compartir });
    if (r !== "cancelado") { mostrarToast(t(r === "compartido" ? "Archivo compartido" : "Archivo descargado")); cerrar(); }
  };
  separador.addEventListener("change", () => elegir(formato));

  const acciones = [boton(t("Cerrar"), "btn btn-secondary", cerrar), boton(t("Descargar"), "btn btn-primary", entregar(false))];
  if (puedeCompartirArchivos()) acciones.splice(1, 0, boton(t("Compartir…"), "btn btn-secondary", entregar(true)));
  caja.append(parrafo("Guarda tus movimientos fuera de la app: para una hoja de cálculo o como copia de seguridad."), grupo, campoSeparador, info, error, filaBotones(...acciones));
  elegir("csv");
}

/* ===================== Importar ===================== */

/** Etiqueta de una fila según su estado: glifo y texto, nunca solo color. */
function etiquetaEstado(c) {
  switch (c.estado) {
    case "nuevo": return insignia("✓ " + t("Nuevo"), "success");
    case "parecido": return insignia("≈ " + t("Parecido a uno que ya registraste"), "warning");
    case "repetido": return insignia("= " + t("Ya lo tienes"), "info");
    case "eliminado": return insignia("↺ " + t("Lo borraste antes"), "info");
    default: return insignia("⚠ " + t(MOTIVOS_FILA[c.motivo] || "No se puede importar"), "danger");
  }
}

function filaCandidato(c, alCambiar) {
  const fila = document.createElement("label"); fila.className = "row-between"; fila.style.cssText = "align-items:flex-start; gap:10px; padding:6px 0; border-top:1px solid rgba(128,128,128,0.2);";
  const chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = !!c.incluir;
  chk.disabled = !["nuevo", "parecido", "eliminado"].includes(c.estado);
  chk.setAttribute("aria-label", t("Importar esta fila"));
  chk.addEventListener("change", () => { c.incluir = chk.checked; alCambiar(); });
  const cuerpo = document.createElement("div"); cuerpo.style.cssText = "flex:1; min-width:0;";
  const t1 = document.createElement("div"); t1.style.cssText = "font-weight:600; overflow-wrap:anywhere;"; t1.textContent = c.nombre || t(c.tipo ? ({ gasto: "Gasto", ingreso: "Ingreso", ahorro: "Ahorro", transferencia: "Transferencia", ajuste: "Ajuste de saldo" })[c.tipo] : "Sin nombre");
  const t2 = document.createElement("div"); t2.className = "muted"; t2.style.fontSize = "0.8rem";
  const signo = c.tipo === "gasto" ? "−" : c.tipo === "ingreso" ? "+" : "";
  t2.textContent = `${c.fecha || t("Sin fecha")} · ${signo}${formatearMonto(c.monto)}${c.categoriaNombre ? " · " + c.categoriaNombre : ""}`;
  cuerpo.append(t1, t2, etiquetaEstado(c));
  fila.append(chk, cuerpo);
  return fila;
}

function abrirImportar({ alTerminar } = {}) {
  const { caja, cerrar } = abrirCapaNombrada("finanzas-importar-overlay", "Importar movimientos", { ancho: 560 });
  const st = { prep: null, cands: [], opc: { mapeo: {}, orden: "dmy", signoPositivo: "ingreso", crearCategorias: true, incluirBorrados: false } };
  const cuerpo = document.createElement("div"); cuerpo.className = "stack"; caja.appendChild(cuerpo);

  /* ---- Paso 1: elegir ---- */
  function pintarEleccion(mensajeError) {
    cuerpo.replaceChildren();
    const archivo = document.createElement("input"); archivo.type = "file"; archivo.className = "form-input"; archivo.accept = ".csv,.json,.txt,.tsv,text/csv,application/json,text/plain";
    const pegado = areaTexto("", t("O pega aquí las filas copiadas de una hoja de cálculo"), 5);
    const error = lineaError(); if (mensajeError) mostrar(error, mensajeError);
    archivo.addEventListener("change", async () => {
      const f = archivo.files && archivo.files[0]; if (!f) return;
      if (f.size > MAX_BYTES) { mostrar(error, MOTIVOS_ARCHIVO.muy_grande); return; }
      try { empezar(decodificarBytes(new Uint8Array(await f.arrayBuffer()))); } catch (e) { mostrar(error, "No pude leer el archivo."); }
    });
    cuerpo.append(
      parrafo("Importa movimientos desde un CSV, desde filas copiadas de una hoja de cálculo o desde un respaldo de Finanzas. Lo que ya tienes no se duplica: antes de guardar ves qué es nuevo."),
      parrafo("La primera fila debe ser el encabezado (Fecha, Descripción, Monto…).", { tamano: "0.8rem" }),
      campo("Archivo", archivo), pegado, error,
      filaBotones(boton(t("Cancelar"), "btn btn-secondary", cerrar), boton(t("Leer"), "btn btn-primary", () => {
        if (!pegado.value.trim()) { mostrar(error, archivo.files && archivo.files[0] ? "Espera un momento: se está leyendo el archivo." : MOTIVOS_ARCHIVO.vacio); return; }
        empezar(pegado.value);
      })),
    );
  }

  function empezar(texto) {
    const prep = prepararImportacion(texto);
    if (!prep.ok) { pintarEleccion(MOTIVOS_ARCHIVO[prep.motivo] || MOTIVOS_ARCHIVO.formato); return; }
    st.prep = prep;
    if (prep.formato === "csv") { st.opc.mapeo = { ...prep.mapeo }; st.opc.orden = prep.orden; }
    recalcular();
    pintarVistaPrevia();
  }

  /** Recalcula los candidatos (cuando cambian las columnas u opciones; los marcados a mano se reinician). */
  function recalcular() {
    const base = st.prep.formato === "json" ? st.prep.candidatos : (mapeoSuficiente(st.opc.mapeo) ? candidatosDeCsv(st.prep, { mapeo: st.opc.mapeo, orden: st.opc.orden, signoPositivo: st.opc.signoPositivo }) : []);
    st.cands = clasificarCandidatos(estado.datos, base, { crearCategorias: st.opc.crearCategorias });
    if (st.opc.incluirBorrados) st.cands.forEach((c) => { if (c.estado === "eliminado") c.incluir = true; });
  }

  /* ---- Paso 2: vista previa ---- */
  function pintarVistaPrevia() {
    cuerpo.replaceChildren();
    const esCsv = st.prep.formato === "csv";
    if (st.prep.secciones > 1) cuerpo.appendChild(parrafo("El archivo trae varias tablas: se usó solo la de movimientos.", { claseExtra: "badge badge-info" }));
    if (st.prep.omitidas) cuerpo.appendChild(parrafo(t("Se dejaron fuera {n} filas marcadas como no pagadas.").replace("{n}", String(st.prep.omitidas)), { claseExtra: "badge badge-info" }));
    if (st.prep.truncado) cuerpo.appendChild(parrafo("El archivo tiene más de 5.000 filas: solo se leyeron las primeras.", { claseExtra: "badge badge-warning" }));

    if (esCsv) {
      const det = document.createElement("details"); det.open = !mapeoSuficiente(st.opc.mapeo);
      const sum = document.createElement("summary"); sum.className = "muted"; sum.textContent = t("Columnas y formato");
      const cont = document.createElement("div"); cont.className = "stack"; cont.style.marginTop = "8px";
      CAMPOS_MAPEO.forEach(([campoId, etiqueta]) => {
        const sel = document.createElement("select"); sel.className = "form-input";
        const ninguna = document.createElement("option"); ninguna.value = ""; ninguna.textContent = t("(ninguna)"); sel.appendChild(ninguna);
        st.prep.encabezados.forEach((h, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = h || `${t("Columna")} ${i + 1}`; sel.appendChild(o); });
        sel.value = st.opc.mapeo[campoId] === undefined ? "" : String(st.opc.mapeo[campoId]);
        sel.addEventListener("change", () => { if (sel.value === "") delete st.opc.mapeo[campoId]; else st.opc.mapeo[campoId] = Number(sel.value); recalcular(); pintarVistaPrevia(); });
        cont.appendChild(campo(etiqueta, sel));
      });
      const orden = selector([["dmy", "Día/mes/año"], ["mdy", "Mes/día/año"]], st.opc.orden);
      orden.addEventListener("change", () => { st.opc.orden = orden.value; recalcular(); pintarVistaPrevia(); });
      cont.appendChild(campo("Orden de las fechas con barras (03/04/2026)", orden));
      const m = st.opc.mapeo;
      if (m.tipo === undefined && m.debito === undefined && m.credito === undefined) {
        const signo = selector([["ingreso", "Ingresos (los negativos son gastos)"], ["gasto", "Gastos (los negativos también)"]], st.opc.signoPositivo);
        signo.addEventListener("change", () => { st.opc.signoPositivo = signo.value; recalcular(); pintarVistaPrevia(); });
        cont.appendChild(campo("Los montos positivos son…", signo));
      }
      det.append(sum, cont); cuerpo.appendChild(det);
    }

    if (!st.cands.length) {
      cuerpo.append(parrafo("Elige al menos la columna de fecha y la de monto (o débito y crédito) para ver la vista previa.", { claseExtra: "badge badge-warning" }), filaBotones(boton(t("Volver"), "btn btn-secondary", () => pintarEleccion()), boton(t("Cerrar"), "btn btn-secondary", cerrar)));
      return;
    }

    const resumen = document.createElement("div"); resumen.className = "row"; resumen.style.cssText = "display:flex; flex-wrap:wrap; gap:6px;";
    const avisos = document.createElement("div"); avisos.className = "stack"; avisos.style.gap = "4px";
    const lista = document.createElement("div"); lista.className = "stack"; lista.style.gap = "0";
    const importarBtn = boton("", "btn btn-primary", aplicar);

    function refrescarResumen() {
      const r = resumirCandidatos(st.cands);
      resumen.replaceChildren(insignia(`✓ ${r.nuevo} ${t("nuevos")}`, "success"));
      [["parecido", "parecidos", "warning"], ["repetido", "ya los tienes", "info"], ["eliminado", "borrados antes", "info"], ["invalido", "con problemas", "danger"]].forEach(([k, x, tipo]) => { if (r[k]) resumen.appendChild(insignia(`${r[k]} ${t(x)}`, tipo)); });
      avisos.replaceChildren(...advertenciasImportacion(estado.datos, st.cands).map((a) => parrafo(AVISOS[a] || a, { claseExtra: "muted", tamano: "0.8rem" })));
      importarBtn.textContent = r.aImportar ? `${t("Importar")} ${r.aImportar}` : t("Nada que importar");
      importarBtn.disabled = !r.aImportar;
    }
    st.cands.slice(0, FILAS_VISIBLES).forEach((c) => lista.appendChild(filaCandidato(c, refrescarResumen)));
    if (st.cands.length > FILAS_VISIBLES) lista.appendChild(parrafo(t("y {n} más (siguen la misma regla: se importa lo nuevo).").replace("{n}", String(st.cands.length - FILAS_VISIBLES)), { tamano: "0.8rem" }));

    const opciones = document.createElement("div"); opciones.className = "stack"; opciones.style.gap = "4px";
    const casilla = (texto, valor, alCambiar) => {
      const l = document.createElement("label"); l.className = "row"; l.style.cssText = "gap:8px; align-items:center; font-size:0.85rem;";
      const c = document.createElement("input"); c.type = "checkbox"; c.checked = valor; c.addEventListener("change", () => alCambiar(c.checked));
      l.append(c, document.createTextNode(t(texto))); return l;
    };
    if (st.cands.some((c) => c.categoriaNueva || (c.categoriaNombre && !c.categoriaId))) opciones.appendChild(casilla("Crear las categorías que no existan", st.opc.crearCategorias, (v) => { st.opc.crearCategorias = v; recalcular(); pintarVistaPrevia(); }));
    if (resumirCandidatos(st.cands).eliminado) opciones.appendChild(casilla("Incluir también lo que borré antes", st.opc.incluirBorrados, (v) => { st.opc.incluirBorrados = v; recalcular(); pintarVistaPrevia(); }));

    cuerpo.append(resumen, avisos, opciones, lista, filaBotones(boton(t("Volver"), "btn btn-secondary", () => pintarEleccion()), importarBtn));
    refrescarResumen();
  }

  const guard = crearGuardReentrada(900);
  function aplicar() {
    guard(() => {
      const r = aplicarImportacion(estado.datos, st.cands);
      cerrar();
      if (!r.creados.length) { mostrarToast(t("No se importó nada nuevo.")); return; }
      marcarCambioPendiente();
      (alTerminar || renderizarFinanzas)();
      mostrarBarraDeshacer({}, `${t("Importados")}: ${r.creados.length}`, () => {
        const quitados = deshacerImportacion(estado.datos, r.creados);
        return quitados > 0;
      });
    });
  }

  pintarEleccion();
}

/* ===================== Bloque de Ajustes ===================== */

/** Bloque "Datos de Finanzas" para Ajustes: exportar, importar y los mensajes del banco. */
function construirBloqueDatosFinanzas() {
  const sec = document.createElement("div"); sec.className = "stack"; sec.style.cssText = "gap:8px; margin-top:12px;";
  const h = document.createElement("span"); h.className = "form-label"; h.textContent = t("Datos de Finanzas");
  const nota = parrafo("Respaldo propio, migración desde una hoja de cálculo y mensajes del banco. Nada se guarda sin que lo confirmes.", { tamano: "0.8rem" });
  const abrirMensajes = (nombre) => () => import("./finanzas-mensajes-ui.js").then((m) => m[nombre]());
  sec.append(
    h, nota,
    boton(t("Exportar movimientos"), "btn btn-secondary btn-block", () => abrirExportar()),
    boton(t("Importar movimientos"), "btn btn-secondary btn-block", () => abrirImportar()),
    boton(t("Pegar mensaje del banco"), "btn btn-secondary btn-block", abrirMensajes("abrirPegarMensaje")),
    boton(t("Mis formatos de mensajes del banco"), "btn btn-secondary btn-block", abrirMensajes("abrirGestorPatrones")),
  );
  return sec;
}

export { abrirExportar, abrirImportar, construirBloqueDatosFinanzas, entregarArchivo, puedeCompartirArchivos };
