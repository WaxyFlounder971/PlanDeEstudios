/* =========================================================================
   FINANZAS 2.0: Pegar mensaje del banco y mis formatos (sesión 6, F6). Solo pantalla; la lógica vive en
   core/finanzas-mensajes.js y core/finanzas-importar.js.
   - Pegar: uno o varios mensajes → se leen con tus formatos (o de forma aproximada) → los revisas y editas → Guardar.
   - Formatos: plantillas con huecos que cada persona crea y edita. Ningún banco ni país viene fijo en la app.
   El texto del mensaje solo se usa en pantalla: no se guarda. Sin innerHTML.
   ========================================================================= */

import { advertenciasImportacion, aplicarImportacion, clasificarCandidatos, deshacerImportacion } from "../core/finanzas-importar.js";
import { listarCategorias } from "../core/finanzas-categorias.js";
import { adoptarFormatoEjemplo, listarFormatosEjemplo } from "../core/finanzas-formatos-ejemplo.js";
import { crearPatron, editarPatron, eliminarPatron, leerConPlantilla, leerMensajes, listarPatrones, compilarPlantilla, sugerirPlantilla } from "../core/finanzas-mensajes.js";
import { parsearMontoTexto } from "../core/finanzas-texto.js";
import { hoyIso } from "../core/finanzas-modelo.js";
import { crearGuardReentrada } from "../core/finanzas-registro.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { mostrarToast } from "../ui/componentes.js";
import { formatearMonto, renderizarFinanzas } from "./finanzas.js";
import { mostrarBarraDeshacer } from "./finanzas-registro-rapido.js";
import { construirSelectorCategoria } from "./finanzas-categorias-ui.js";
import { abrirCapaNombrada, areaTexto, boton, campo, entrada, filaBotones, insignia, lineaError, mostrar, parrafo, selector } from "./finanzas-ui-basico.js";

const AVISOS = {
  fecha_inferida: "No vi la fecha: puse la de hoy.", tipo_incierto: "No pude saber si es gasto o ingreso: elígelo.",
  varios_montos: "Hay varios montos en el mensaje: revisa que el elegido sea el correcto.", moneda: "El mensaje parece estar en otra moneda. Finanzas no convierte: se guarda el número tal cual.",
};
const MOTIVOS_PLANTILLA = {
  vacia: "Escribe la plantilla.", larga: "La plantilla es muy larga (máximo 300 letras).", sin_monto: "Falta el hueco {monto}: ahí va el importe.",
  muy_general: "Casi no tiene texto fijo: coincidiría con cualquier mensaje. Deja algunas palabras del mensaje tal cual.", repetido: "Ese hueco solo puede ir una vez.",
  llaves: "Hay una llave suelta o un hueco que no existe. Los huecos son {monto}, {nombre}, {fecha}, {hora}, {ref} y {cualquiera}.", muchos: "Demasiados huecos flexibles ({nombre} y {cualquiera}): deja máximo tres.",
};
const MOTIVOS_PATRON = { nombre: "Ponle un nombre al formato.", tipo: "Elige si es de gastos o de ingresos.", repetida: "Ya tienes un formato con esa plantilla.", categoria: "Esa categoría no es del mismo tipo.", limite: "Llegaste al máximo de 50 formatos.", patron: "Ese formato ya no existe." };
const ESTADOS = { nuevo: ["✓", "Listo para guardar", "success"], parecido: ["≈", "Parecido a uno que ya registraste (no se guarda salvo que lo marques)", "warning"], repetido: ["=", "Ya lo tienes", "info"], eliminado: ["↺", "Lo borraste antes", "info"] };
const MOTIVOS_FILA = { tipo: "Elige si es gasto o ingreso", monto: "Escribe el monto", fecha: "Escribe una fecha válida" };

/* ===================== Pegar mensaje ===================== */

function abrirPegarMensaje({ alGuardar } = {}) {
  const { caja, cerrar } = abrirCapaNombrada("finanzas-mensajes-overlay", "Pegar mensaje del banco", { ancho: 560 });
  const cuerpo = document.createElement("div"); cuerpo.className = "stack"; caja.appendChild(cuerpo);
  const filas = []; // { base (editable), clas (clasificado), manual (null | boolean), nodos }

  function pintarEntrada() {
    cuerpo.replaceChildren();
    const texto = areaTexto("", t("Pega aquí el mensaje que te mandó el banco"), 6);
    const error = lineaError();
    cuerpo.append(
      parrafo("Copia el mensaje del banco o de la app de pagos y pégalo. Lo leo en tu dispositivo, lo revisas y recién ahí se guarda. El texto del mensaje no se guarda."),
      parrafo("Si pegas varios, deja una línea en blanco entre uno y otro.", { tamano: "0.8rem" }),
      texto, error,
      filaBotones(boton(t("Cancelar"), "btn btn-secondary", cerrar), boton(t("Leer"), "btn btn-primary", () => {
        if (!texto.value.trim()) { mostrar(error, "Pega primero el mensaje."); texto.focus(); return; }
        leer(texto.value);
      })),
    );
    setTimeout(() => texto.focus(), 0);
  }

  function leer(texto) {
    filas.length = 0;
    leerMensajes(estado.datos, texto).forEach((c) => filas.push({ base: c, clas: null, manual: null, nodos: null }));
    reclasificar();
    pintarRevision();
  }

  /** Vuelve a clasificar todos (repetidos, ids, categorías) respetando lo que la persona marcó a mano. */
  function reclasificar() {
    const res = clasificarCandidatos(estado.datos, filas.map((f) => ({ ...f.base })));
    res.forEach((c, i) => {
      const f = filas[i]; f.clas = c;
      if (f.manual !== null && (c.estado === "nuevo" || c.estado === "parecido")) c.incluir = f.manual;
    });
  }

  function pintarRevision() {
    cuerpo.replaceChildren();
    if (!filas.length) { cuerpo.append(parrafo("No encontré ningún mensaje."), filaBotones(boton(t("Volver"), "btn btn-secondary", pintarEntrada))); return; }
    const avisos = document.createElement("div"); avisos.className = "stack"; avisos.style.gap = "4px";
    const guardarBtn = boton("", "btn btn-primary", guardar);
    const tarjetas = document.createElement("div"); tarjetas.className = "stack";
    filas.forEach((f, i) => tarjetas.appendChild(construirTarjeta(f, i, refrescar)));

    function refrescar() {
      reclasificar();
      filas.forEach((f) => f.nodos.actualizar());
      const incluidos = filas.filter((f) => f.clas.incluir && ["nuevo", "parecido"].includes(f.clas.estado)).length;
      guardarBtn.textContent = incluidos ? `${t("Guardar")} ${incluidos}` : t("Nada que guardar"); guardarBtn.disabled = !incluidos;
      avisos.replaceChildren(...advertenciasImportacion(estado.datos, filas.map((f) => f.clas)).filter((a) => a !== "moneda").map((a) => parrafo(a === "modulo_ahorros" ? "Ahorros está apagado: no se verá hasta que lo enciendas." : "Gastos e ingresos está apagado: no se verá hasta que lo enciendas en Ajustes.", { tamano: "0.8rem" })));
    }
    cuerpo.append(tarjetas, avisos, filaBotones(boton(t("Volver"), "btn btn-secondary", pintarEntrada), guardarBtn));
    refrescar();
  }

  /** Una tarjeta editable por mensaje. Los campos escriben en `f.base` y piden repintar el estado. */
  function construirTarjeta(f, i, alCambiar) {
    const b = f.base;
    const tarjeta = document.createElement("div"); tarjeta.className = "glass-card stack"; tarjeta.style.cssText = "gap:8px; padding:12px;";
    const origen = document.createElement("div"); origen.className = "row"; origen.style.cssText = "display:flex; flex-wrap:wrap; gap:6px; align-items:center;";
    origen.appendChild(b.lectura === "patron" ? insignia(`✓ ${t("Leído con")} «${b.patronNombre}»`, "success") : b.lectura === "general" ? insignia("≈ " + t("Lectura aproximada: revisa los datos"), "warning") : insignia("⚠ " + t("No encontré un monto"), "danger"));

    const tipo = selector([["", "Elige…"], ["gasto", "Gasto"], ["ingreso", "Ingreso"]], b.tipo || "");
    const monto = entrada(b.monto ? String(b.monto) : "", "0", 0, "text"); monto.inputMode = "decimal"; monto.setAttribute("aria-label", t("Monto"));
    const nombre = entrada(b.nombre || "", t("Nombre (opcional)"), 80);
    const fecha = entrada(b.fecha || hoyIso(), "", 0, "date");
    let selCat = construirSelectorCategoria({ tipo: b.tipo === "ingreso" ? "ingreso" : "gasto", valor: b.categoriaId || "" });
    const campoCat = campo("Categoría", selCat);
    const hayCats = () => listarCategorias(estado.datos, { tipo: b.tipo === "ingreso" ? "ingreso" : "gasto" }).length > 0;

    const incluir = document.createElement("input"); incluir.type = "checkbox"; incluir.setAttribute("aria-label", t("Guardar este movimiento"));
    incluir.addEventListener("change", () => { f.manual = incluir.checked; alCambiar(); });

    tipo.addEventListener("change", () => {
      b.tipo = tipo.value || null; b.categoriaId = null;
      const nuevoSel = construirSelectorCategoria({ tipo: b.tipo === "ingreso" ? "ingreso" : "gasto" });
      nuevoSel.addEventListener("change", () => { b.categoriaId = nuevoSel.value || null; alCambiar(); });
      campoCat.replaceChild(nuevoSel, selCat); selCat = nuevoSel; alCambiar();
    });
    selCat.addEventListener("change", () => { b.categoriaId = selCat.value || null; alCambiar(); });
    monto.addEventListener("input", () => { b.monto = parsearMontoTexto(monto.value); alCambiar(); });
    nombre.addEventListener("input", () => { b.nombre = nombre.value.trim(); alCambiar(); });
    fecha.addEventListener("change", () => { b.fecha = fecha.value || null; b.advertencias = (b.advertencias || []).filter((a) => a !== "fecha_inferida"); alCambiar(); });

    const fila1 = document.createElement("div"); fila1.className = "row"; fila1.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px;";
    fila1.append(campo("Tipo", tipo), campo("Monto", monto));
    const fila2 = document.createElement("div"); fila2.className = "row"; fila2.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px;";
    fila2.append(campo("Nombre", nombre), campo("Fecha", fecha));

    const notasAviso = document.createElement("div"); notasAviso.className = "stack"; notasAviso.style.gap = "2px";
    const chipEstado = document.createElement("div");
    const montosVarios = document.createElement("div");
    const etiquetaIncluir = document.createElement("label"); etiquetaIncluir.className = "row"; etiquetaIncluir.style.cssText = "gap:8px; align-items:center; font-size:0.85rem;";
    etiquetaIncluir.append(incluir, document.createTextNode(t("Guardar este movimiento")));

    const extras = [];
    if (b.lectura !== "patron") {
      extras.push(boton(t("Guardar este formato para la próxima"), "btn-discreto", () => abrirEditorPatron({ mensaje: b.textoOriginal, tipo: b.tipo || "gasto", textoNombre: b.nombre })));
    }

    f.nodos = {
      actualizar() {
        const c = f.clas;
        incluir.checked = !!c.incluir; incluir.disabled = !["nuevo", "parecido"].includes(c.estado);
        campoCat.classList.toggle("oculto", !hayCats() || !b.tipo);
        const [glifo, texto, tonoE] = ESTADOS[c.estado] || ["⚠", MOTIVOS_FILA[c.motivo] || "No se puede guardar", "danger"];
        chipEstado.replaceChildren(insignia(`${glifo} ${t(texto)}`, tonoE));
        notasAviso.replaceChildren(...(b.advertencias || []).filter((a) => AVISOS[a] && !(a === "tipo_incierto" && b.tipo)).map((a) => parrafo(AVISOS[a], { tamano: "0.78rem" })));
        montosVarios.textContent = (b.advertencias || []).includes("varios_montos") && b.montosEncontrados ? `${t("Montos que vi")}: ${b.montosEncontrados.map((m) => formatearMonto(m)).join(" · ")}` : "";
        montosVarios.className = montosVarios.textContent ? "muted" : "oculto"; montosVarios.style.fontSize = "0.78rem";
      },
    };
    tarjeta.append(origen, fila1, fila2, campoCat, notasAviso, montosVarios, chipEstado, etiquetaIncluir, ...extras);
    return tarjeta;
  }

  const guard = crearGuardReentrada(900);
  function guardar() {
    guard(() => {
      const r = aplicarImportacion(estado.datos, filas.map((f) => f.clas));
      cerrar();
      if (!r.creados.length) { mostrarToast(t("No se guardó nada nuevo.")); return; }
      marcarCambioPendiente();
      (alGuardar || renderizarFinanzas)();
      mostrarBarraDeshacer({}, `${t("Guardados")}: ${r.creados.length}`, () => deshacerImportacion(estado.datos, r.creados) > 0);
    });
  }

  pintarEntrada();
}

/* ===================== Mis formatos ===================== */

function abrirGestorPatrones({ alCambiar } = {}) {
  const { caja, cerrar } = abrirCapaNombrada("finanzas-patrones-overlay", "Mis formatos de mensajes", { ancho: 540, z: 305 });
  const lista = document.createElement("div"); lista.className = "stack"; lista.style.gap = "8px";
  let confirmando = null;
  const cambio = () => { marcarCambioPendiente(); if (alCambiar) alCambiar(); pintar(); };

  const ejemplos = document.createElement("details"); ejemplos.className = "stack"; ejemplos.style.gap = "6px";
  const resumen = document.createElement("summary"); resumen.textContent = t("Ejemplos para empezar"); ejemplos.appendChild(resumen);

  function pintarEjemplos() {
    ejemplos.replaceChildren(resumen);
    ejemplos.appendChild(parrafo("Son solo ejemplos de cómo suelen escribir algunos mensajes. Añade el que se parezca al tuyo y ajústalo con Editar."));
    const tengo = new Set(listarPatrones(estado.datos).map((p) => p.plantilla));
    listarFormatosEjemplo().forEach((f) => {
      const fila = document.createElement("div"); fila.className = "row-between"; fila.style.cssText = "align-items:center; gap:8px;";
      const x = document.createElement("span"); x.textContent = t(f.nombre);
      const yaEsta = tengo.has(f.plantilla);
      const b = boton(t(yaEsta ? "Ya lo tienes" : "Añadir"), "btn btn-secondary", () => { adoptarFormatoEjemplo(estado.datos, f.clave); cambio(); pintarEjemplos(); });
      b.disabled = yaEsta; fila.append(x, b); ejemplos.appendChild(fila);
    });
  }

  function pintar() {
    pintarEjemplos();
    lista.replaceChildren();
    const patrones = listarPatrones(estado.datos);
    if (!patrones.length) lista.appendChild(parrafo("Aún no tienes formatos. Crea el primero a partir de un mensaje de ejemplo: así la app aprende cómo te escribe tu banco."));
    patrones.forEach((p) => {
      const tarjeta = document.createElement("div"); tarjeta.className = "glass-card stack"; tarjeta.style.cssText = "gap:6px; padding:12px;";
      const cab = document.createElement("div"); cab.className = "row-between"; cab.style.cssText = "align-items:center; gap:8px;";
      const nombre = document.createElement("strong"); nombre.textContent = p.nombre;
      cab.append(nombre, insignia(t(p.tipo === "ingreso" ? "Ingreso" : "Gasto"), p.tipo === "ingreso" ? "info" : "warning"));
      const plantilla = document.createElement("code"); plantilla.style.cssText = "font-size:0.8rem; overflow-wrap:anywhere; opacity:0.85;"; plantilla.textContent = p.plantilla;
      const activo = document.createElement("label"); activo.className = "row"; activo.style.cssText = "gap:8px; align-items:center; font-size:0.85rem;";
      const chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = p.activo !== false;
      chk.addEventListener("change", () => { editarPatron(estado.datos, p.id, { activo: chk.checked }); cambio(); });
      activo.append(chk, document.createTextNode(t("Usar este formato")));
      const acciones = document.createElement("div"); acciones.className = "row"; acciones.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px;";
      acciones.append(
        boton(t("Editar"), "btn btn-secondary", () => abrirEditorPatron({ patron: p, alGuardar: cambio })),
        boton(confirmando === p.id ? t("Confirmar: eliminar") : t("Eliminar"), "btn btn-secondary", () => {
          if (confirmando !== p.id) { confirmando = p.id; pintar(); return; }
          eliminarPatron(estado.datos, p.id); confirmando = null; cambio();
        }),
      );
      tarjeta.append(cab, plantilla, activo, acciones);
      lista.appendChild(tarjeta);
    });
  }

  caja.append(
    parrafo("Un formato le enseña a la app a leer los mensajes de tu banco o de tu app de pago. Los creas tú, a tu medida: la app no trae ningún banco incluido."),
    lista,
    ejemplos,
    filaBotones(boton(t("Cerrar"), "btn btn-secondary", cerrar), boton(t("Nuevo formato"), "btn btn-primary", () => abrirEditorPatron({ alGuardar: cambio }))),
  );
  pintar();
}

/**
 * Crear o editar un formato. Con `mensaje` (de "Pegar mensaje") o con uno que la persona pegue aquí, la app arma la
 * plantilla y muestra en vivo qué leería. `patron` = edición.
 */
function abrirEditorPatron({ patron = null, mensaje = "", tipo = "gasto", textoNombre = "", alGuardar } = {}) {
  const { caja, cerrar } = abrirCapaNombrada("finanzas-patron-editor-overlay", patron ? "Editar formato" : "Nuevo formato", { ancho: 540, z: 320 });
  const ejemplo = areaTexto(mensaje, t("Pega aquí un mensaje de ejemplo"), 4, 600);
  const parteNombre = entrada(textoNombre, t("Ej. el nombre del comercio tal como sale"), 60);
  const nombre = entrada(patron ? patron.nombre : "", t("Ej. Compra con tarjeta"), 40);
  const plantilla = areaTexto(patron ? patron.plantilla : "", t("Ej. Compra por {monto} en {nombre}"), 3, 300); plantilla.style.fontFamily = "monospace";
  const tipoSel = selector([["gasto", "Gasto"], ["ingreso", "Ingreso"]], patron ? patron.tipo : tipo);
  const nombreFijo = entrada(patron ? patron.nombre_fijo : "", t("Ej. Transferencia recibida"), 60);
  const orden = selector([["dmy", "Día/mes/año"], ["mdy", "Mes/día/año"]], patron ? patron.orden_fecha : "dmy");
  let selCat = construirSelectorCategoria({ tipo: tipoSel.value, valor: patron ? patron.categoria_id || "" : "" });
  const campoCat = campo("Categoría (opcional)", selCat);
  const vivo = document.createElement("div"); vivo.className = "stack"; vivo.style.cssText = "gap:4px;"; vivo.setAttribute("aria-live", "polite");
  const error = lineaError();

  function mostrarVivo() {
    vivo.replaceChildren();
    const c = compilarPlantilla(plantilla.value);
    if (plantilla.value.trim() && !c.ok) { vivo.appendChild(insignia("⚠ " + t(MOTIVOS_PLANTILLA[c.motivo] || "La plantilla no es válida"), "danger")); return; }
    if (!plantilla.value.trim() || !ejemplo.value.trim()) { vivo.appendChild(parrafo("Con un mensaje de ejemplo arriba, aquí ves qué leería la app.", { tamano: "0.8rem" })); return; }
    const r = leerConPlantilla(plantilla.value, ejemplo.value, { ordenFecha: orden.value, nombreFijo: nombreFijo.value });
    if (!r) { vivo.appendChild(insignia("⚠ " + t("No coincide con el ejemplo"), "warning")); return; }
    vivo.append(insignia("✓ " + t("Coincide con el ejemplo"), "success"), parrafo(`${t("Monto")}: ${formatearMonto(r.monto)} · ${t("Nombre")}: ${r.nombre || "—"} · ${t("Fecha")}: ${r.fechaInferida ? t("(hoy)") : r.fecha}${r.referencia ? " · Ref. " + r.referencia : ""}`, { tamano: "0.82rem" }));
  }
  const armar = () => {
    if (!ejemplo.value.trim()) { mostrar(error, "Pega primero un mensaje de ejemplo."); ejemplo.focus(); return; }
    error.classList.add("oculto");
    plantilla.value = sugerirPlantilla(ejemplo.value, { textoNombre: parteNombre.value }).plantilla; mostrarVivo();
  };
  [plantilla, ejemplo, nombreFijo].forEach((el) => el.addEventListener("input", mostrarVivo)); orden.addEventListener("change", mostrarVivo);
  tipoSel.addEventListener("change", () => {
    const nuevo = construirSelectorCategoria({ tipo: tipoSel.value }); campoCat.replaceChild(nuevo, selCat); selCat = nuevo;
  });

  const guardar = () => {
    const datos = { nombre: nombre.value, plantilla: plantilla.value, tipo: tipoSel.value, nombreFijo: nombreFijo.value, categoriaId: selCat.value || null, ordenFecha: orden.value };
    const r = patron ? editarPatron(estado.datos, patron.id, datos) : crearPatron(estado.datos, datos);
    if (!r.ok) { mostrar(error, r.motivo === "plantilla" ? (MOTIVOS_PLANTILLA[r.detalle] || "La plantilla no es válida") : (MOTIVOS_PATRON[r.motivo] || "No se pudo guardar.")); return; }
    marcarCambioPendiente(); cerrar(); mostrarToast(t("Formato guardado"));
    if (alGuardar) alGuardar();
  };

  caja.append(
    parrafo("Una plantilla es el mensaje con huecos: lo que cambia (monto, comercio, fecha) va entre llaves y el resto se deja igual. Mayúsculas y tildes no importan."),
    campo("Mensaje de ejemplo", ejemplo),
    campo("¿Cuál parte es el comercio o la persona?", parteNombre, "Cópiala tal como sale en el mensaje. Es opcional."),
    boton(t("Armar la plantilla desde el ejemplo"), "btn btn-secondary", armar),
    campo("Plantilla", plantilla, "Huecos: {monto} (obligatorio), {nombre}, {fecha}, {hora}, {ref}, {cualquiera}."),
    vivo,
    campo("Nombre del formato", nombre), campo("¿Qué es?", tipoSel), campo("Nombre si el mensaje no trae uno (opcional)", nombreFijo), campoCat,
    campo("Orden de las fechas con barras", orden), error,
    filaBotones(boton(t("Cancelar"), "btn btn-secondary", cerrar), boton(t("Guardar"), "btn btn-primary", guardar)),
  );
  if (mensaje && !patron) armar(); else mostrarVivo();
}

export { abrirEditorPatron, abrirGestorPatrones, abrirPegarMensaje };
