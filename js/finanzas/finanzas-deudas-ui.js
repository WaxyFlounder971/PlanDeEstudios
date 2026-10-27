/* =========================================================================
   FINANZAS 2.0: pantallas de Me deben y debo (sesión 7A). Sin innerHTML.
   Pestaña "Deudas" (quién te debe y a quién le debes), detalle de una persona (abonar, prestar más, ver movimientos),
   persona nueva y dividir un gasto. Toda la lógica vive en core/finanzas-deudas.js; aquí solo se pinta y se confirma.
   Se carga solo con el módulo encendido (import dinámico desde finanzas.js, finanzas-registro-rapido.js).
   ========================================================================= */

import { estado } from "../core/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { mostrarToast } from "../ui/componentes.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { hoyIso } from "../core/finanzas-modelo.js";
import { quitarMovimiento } from "../core/finanzas-registro.js";
import { parsearMontoTexto as parsearMonto } from "../core/finanzas-texto.js"; // "5.000" son cinco mil, como se escribe en español
import { listarCategorias } from "../core/finanzas-categorias.js";
import {
  archivarPrestamo, buscarPrestamo, calcularSaldoPrestamo, crearPrestamo, deshacerDivision, dividirGasto, editarPrestamo, eliminarPrestamo,
  listarPrestamos, movimientosDePrestamo, personasConocidas, registrarAbono, registrarPrestamoAdicional, resumirDeudas,
} from "../core/finanzas-deudas.js";
import { formatearFechaLarga, formatearMonto, renderizarFinanzas } from "./finanzas.js";
import { mostrarBarraDeshacer } from "./finanzas-registro-rapido.js";
import { abrirCapaNombrada, areaTexto, boton, campo, entrada, filaBotones, insignia, lineaError, mostrar, parrafo, selector } from "./finanzas-ui-basico.js";

const MOTIVOS = {
  persona: "Escribe el nombre de la persona.", direccion: "Elige si prestaste o te prestaron.", monto: "Escribe un monto mayor que cero.",
  monto_grande: "Ese monto es demasiado grande.", fecha: "La fecha no es válida.", repetida: "Ya tienes a esa persona. Ábrela y registra ahí.",
  excede: "Es más de lo que queda pendiente.", nombre: "Escribe qué fue el gasto.", sin_partes: "Añade al menos una persona con su parte.",
  persona_repetida: "Una persona aparece dos veces.", monto_parte: "Cada persona necesita una parte mayor que cero.", partes_exceden: "Las partes suman más que el total.",
  pagador: "Escribe quién pagó.", muchas_partes: "Son demasiadas personas.", modulo_apagado: "Enciende Me deben y debo en Ajustes.", tiene_movimientos: "Tiene movimientos: quítalos primero o archívala.",
};
const textoMotivo = (r) => t(MOTIVOS[r.motivo] || "No se pudo guardar.");

const refrescar = () => { renderizarFinanzas(); };
const guardado = () => { marcarCambioPendiente(); };

/* ===================== Pestaña ===================== */

function tarjetaPersona(p, s, alCambiar) {
  const tarjeta = document.createElement("div"); tarjeta.className = "glass-card row-between"; tarjeta.style.cssText = "gap:10px; align-items:center; flex-wrap:nowrap;";
  const izq = document.createElement("div"); izq.style.minWidth = "0";
  const nombre = document.createElement("p"); nombre.style.cssText = "margin:0; font-weight:600; word-break:break-word;"; nombre.textContent = p.persona;
  izq.appendChild(nombre);
  if (p.nota) { const n = document.createElement("p"); n.className = "muted"; n.style.cssText = "margin:2px 0 0; font-size:0.8rem; word-break:break-word;"; n.textContent = p.nota; izq.appendChild(n); }
  const der = document.createElement("div"); der.className = "row"; der.style.cssText = "gap:8px; align-items:center; flex-shrink:0; flex-wrap:nowrap;";
  der.append(insignia(s.saldado ? t("Saldado") : formatearMonto(s.pendiente), s.saldado ? "success" : p.direccion === "preste" ? "info" : "warning"),
    boton(t("Abrir"), "btn btn-secondary", () => abrirDetallePrestamo(p.id, { alCambiar })));
  tarjeta.append(izq, der);
  return tarjeta;
}

function grupo(titulo, lista, alCambiar, vacio) {
  const g = document.createElement("section"); g.className = "stack"; g.style.gap = "8px";
  const h = document.createElement("h3"); h.style.cssText = "margin:0; font-size:1rem;"; h.textContent = titulo; g.appendChild(h);
  if (!lista.length) g.appendChild(parrafo(vacio));
  lista.forEach(({ p, s }) => g.appendChild(tarjetaPersona(p, s, alCambiar)));
  return g;
}

function renderizarPestanaDeudas(contenedor) {
  const alCambiar = () => { refrescar(); };
  const resumen = resumirDeudas(estado.datos);
  const todas = listarPrestamos(estado.datos).map((p) => ({ p, s: calcularSaldoPrestamo(p, estado.datos) })).filter((x) => x.s);
  const pendientes = (dir) => todas.filter((x) => x.p.direccion === dir && !x.s.saldado).sort((a, b) => b.s.pendiente - a.s.pendiente);
  const saldadas = todas.filter((x) => x.s.saldado);

  const cab = document.createElement("div"); cab.className = "glass-card stack"; cab.style.gap = "6px";
  const fila = (texto, valor) => { const f = document.createElement("div"); f.className = "row-between"; const a = document.createElement("span"); a.textContent = t(texto); const b = document.createElement("strong"); b.textContent = formatearMonto(valor); f.append(a, b); return f; };
  cab.append(fila("Te deben", resumen.meDeben), fila("Debes", resumen.debo));
  cab.appendChild(parrafo(resumen.neto === 0 ? "Estás a mano." : resumen.neto > 0 ? "En total, te deben más de lo que debes." : "En total, debes más de lo que te deben.", { tamano: "0.8rem" }));
  cab.appendChild(parrafo("Esto no cambia tus gastos ni tus ingresos. Solo Mi dinero se mueve cuando prestas o devuelves.", { tamano: "0.78rem" }));

  const acciones = filaBotones(
    boton("＋ " + t("Persona nueva"), "btn btn-primary", () => abrirNuevoPrestamo({ alGuardar: alCambiar })),
    boton(t("Dividir un gasto"), "btn btn-secondary", () => abrirDividirGasto({ alGuardar: alCambiar })),
  );

  contenedor.append(cab, acciones, grupo(t("Te deben"), pendientes("preste"), alCambiar, "Nadie te debe nada ahora."), grupo(t("Debes"), pendientes("me_prestaron"), alCambiar, "No le debes nada a nadie."));
  if (saldadas.length) {
    const det = document.createElement("details"); det.className = "stack"; det.style.gap = "8px";
    const sum = document.createElement("summary"); sum.className = "muted"; sum.textContent = `${t("Saldadas")} (${saldadas.length})`; det.appendChild(sum);
    saldadas.forEach(({ p, s }) => det.appendChild(tarjetaPersona(p, s, alCambiar)));
    contenedor.appendChild(det);
  }
  const arch = listarPrestamos(estado.datos, { incluirArchivados: true }).filter((p) => p.archivado);
  if (arch.length) {
    const det = document.createElement("details"); det.className = "stack"; det.style.gap = "8px";
    const sum = document.createElement("summary"); sum.className = "muted"; sum.textContent = `${t("Archivadas")} (${arch.length})`; det.appendChild(sum);
    arch.forEach((p) => det.appendChild(tarjetaPersona(p, calcularSaldoPrestamo(p, estado.datos), alCambiar)));
    contenedor.appendChild(det);
  }
}

/* ===================== Persona nueva ===================== */

function abrirNuevoPrestamo({ alGuardar } = {}) {
  const { caja, cerrar } = abrirCapaNombrada("finanzas-deudas-nuevo-overlay", "Persona nueva", { ancho: 460, z: 320 });
  const persona = entrada("", t("Nombre"), 40); persona.setAttribute("list", "finanzas-deudas-personas");
  const lista = document.createElement("datalist"); lista.id = "finanzas-deudas-personas"; personasConocidas(estado.datos).forEach((n) => { const o = document.createElement("option"); o.value = n; lista.appendChild(o); });
  const direccion = selector([["preste", "Le presté dinero"], ["me_prestaron", "Me prestaron dinero"]], "preste");
  const monto = entrada("", "0", 0, "text"); monto.inputMode = "decimal";
  const fecha = entrada(hoyIso(), "", 0, "date");
  const modo = selector([["ahora", "El dinero se mueve ahora"], ["previo", "Ya estaba prestado antes"]], "ahora");
  const nota = entrada("", t("Opcional"), 120);
  const ayuda = parrafo("", { tamano: "0.78rem" });
  const pintarAyuda = () => { ayuda.textContent = t(modo.value === "ahora" ? "Mi dinero cambia en la fecha elegida." : "Mi dinero no cambia: solo queda anotado lo que ya se debía."); };
  modo.addEventListener("change", pintarAyuda); pintarAyuda();
  const error = lineaError();
  const guardar = boton(t("Guardar"), "btn btn-primary", () => {
    const r = crearPrestamo(estado.datos, { persona: persona.value, direccion: direccion.value, monto: parsearMonto(monto.value), modo: modo.value, fecha: fecha.value, nota: nota.value });
    if (!r.ok) { mostrar(error, textoMotivo(r)); return; }
    guardado(); cerrar(); mostrarToast(t("Guardado")); (alGuardar || refrescar)();
  });
  caja.append(campo("Persona", persona), lista, campo("¿Qué pasó?", direccion), campo("Monto", monto), campo("Fecha", fecha), campo("¿Cuándo se movió el dinero?", modo), ayuda, campo("Nota", nota), error,
    filaBotones(boton(t("Cancelar"), "btn btn-secondary", cerrar), guardar));
  persona.focus();
}

/* ===================== Detalle de una persona ===================== */

function abrirDetallePrestamo(id, { alCambiar } = {}) {
  const { caja, cerrar } = abrirCapaNombrada("finanzas-deudas-detalle-overlay", "Detalle", { ancho: 520, z: 310 });
  const titulo = caja.querySelector("h2");
  const cuerpo = document.createElement("div"); cuerpo.className = "stack"; cuerpo.style.gap = "10px"; caja.appendChild(cuerpo);
  let confirmando = null, formulario = null;
  const cambio = () => { guardado(); if (alCambiar) alCambiar(); pintar(); };

  function formularioMonto(tipo) { // "abono" | "mas"
    const p = buscarPrestamo(estado.datos, id); const s = calcularSaldoPrestamo(p, estado.datos, "9999-12-31");
    const caja2 = document.createElement("div"); caja2.className = "glass-card stack"; caja2.style.cssText = "gap:8px; padding:12px;";
    const monto = entrada("", "0", 0, "text"); monto.inputMode = "decimal"; const fecha = entrada(hoyIso(), "", 0, "date"); const nota = entrada("", t("Opcional"), 120);
    const error = lineaError();
    const etiqueta = tipo === "abono" ? (p.direccion === "preste" ? "Me devolvió" : "Le devolví") : (p.direccion === "preste" ? "Le presté más" : "Me prestó más");
    const todo = tipo === "abono" ? boton(t("Todo lo pendiente"), "btn-discreto", () => { monto.value = String(s.pendiente); }) : null;
    const ok = boton(t("Guardar"), "btn btn-primary", () => {
      const args = { monto: parsearMonto(monto.value), fecha: fecha.value, nota: nota.value };
      const r = tipo === "abono" ? registrarAbono(estado.datos, id, args) : registrarPrestamoAdicional(estado.datos, id, args);
      if (!r.ok) { mostrar(error, r.motivo === "excede" ? `${t("Es más de lo que queda pendiente")}: ${formatearMonto(r.pendiente)}` : textoMotivo(r)); return; }
      formulario = null; cambio();
    });
    caja2.append(campo(etiqueta, monto), ...(todo ? [todo] : []), campo("Fecha", fecha), campo("Nota", nota), error, filaBotones(boton(t("Cancelar"), "btn btn-secondary", () => { formulario = null; pintar(); }), ok));
    return caja2;
  }

  function pintar() {
    cuerpo.replaceChildren();
    const p = buscarPrestamo(estado.datos, id); if (!p) { cerrar(); return; }
    const s = calcularSaldoPrestamo(p, estado.datos); if (!s) { cerrar(); return; }
    titulo.textContent = p.persona;
    const quien = p.direccion === "preste" ? "Te debe" : "Le debes";
    const g = document.createElement("div"); g.className = "glass-card stack"; g.style.gap = "4px";
    const linea = (txt, val, fuerte) => { const f = document.createElement("div"); f.className = "row-between"; const a = document.createElement("span"); a.textContent = t(txt); const b = document.createElement(fuerte ? "strong" : "span"); b.textContent = formatearMonto(val); f.append(a, b); return f; };
    g.append(linea(s.saldado ? "Saldado" : quien, s.pendiente, true));
    if (Number(p.saldo_inicial)) g.appendChild(linea("Ya estaba antes de usar la app", Number(p.saldo_inicial)));
    g.appendChild(linea(p.direccion === "preste" ? "Prestado desde que lo anotas" : "Recibido desde que lo anotas", s.prestado));
    if (s.pagadoPorMi) g.appendChild(linea("Gastos que pagó por ti", s.pagadoPorMi));
    g.appendChild(linea(p.direccion === "preste" ? "Devuelto" : "Pagado", s.devuelto));
    if (s.saldo < 0) g.appendChild(parrafo("Se devolvió más de lo debido. Revisa los movimientos.", { claseExtra: "badge badge-warning" }));
    cuerpo.appendChild(g);

    if (formulario) { cuerpo.appendChild(formularioMonto(formulario)); }
    else {
      cuerpo.appendChild(filaBotones(
        boton(t(p.direccion === "preste" ? "Me devolvió" : "Le devolví"), "btn btn-primary", () => { formulario = "abono"; pintar(); }),
        boton(t(p.direccion === "preste" ? "Le presté más" : "Me prestó más"), "btn btn-secondary", () => { formulario = "mas"; pintar(); }),
      ));
    }

    const movs = movimientosDePrestamo(estado.datos, id);
    const h = document.createElement("h3"); h.style.cssText = "margin:4px 0 0; font-size:1rem;"; h.textContent = t("Movimientos"); cuerpo.appendChild(h);
    if (!movs.length) cuerpo.appendChild(parrafo("Aún no hay movimientos."));
    movs.forEach((m) => {
      const f = document.createElement("div"); f.className = "row-between"; f.style.cssText = "gap:8px; align-items:center;";
      const info = document.createElement("div"); info.style.minWidth = "0";
      const a = document.createElement("div"); a.style.wordBreak = "break-word";
      const gasto = m.tipo === "gasto";
      const signo = gasto ? "" : m.sentido === "entra" ? "+" : "−";
      a.textContent = `${signo}${formatearMonto(m.monto)} · ${m.fecha_registro ? formatearFechaLarga(m.fecha_registro) : t("Sin fecha")}`;
      const b = document.createElement("div"); b.className = "muted"; b.style.cssText = "font-size:0.78rem; word-break:break-word;";
      b.textContent = gasto ? `${t("Gasto que pagó por ti")}: ${m.nombre}` : (m.nota || t(m.sentido === "entra" ? "Entró a Mi dinero" : "Salió de Mi dinero"));
      info.append(a, b);
      const q = boton(confirmando === m.id ? t("Confirmar: quitar") : t("Quitar"), "btn btn-secondary", () => {
        if (confirmando !== m.id) { confirmando = m.id; pintar(); return; }
        confirmando = null; if (quitarMovimiento(estado.datos, m.id)) cambio(); else pintar();
      });
      f.append(info, q); cuerpo.appendChild(f);
    });

    // Editar nombre y nota, archivar y eliminar.
    const det = document.createElement("details"); det.className = "stack"; det.style.gap = "8px";
    const sum = document.createElement("summary"); sum.className = "muted"; sum.textContent = t("Más opciones"); det.appendChild(sum);
    const nombre = entrada(p.persona, "", 40); const nota = entrada(p.nota || "", t("Opcional"), 120); const error = lineaError();
    det.append(campo("Persona", nombre), campo("Nota", nota), error);
    const guardarNombre = boton(t("Guardar cambios"), "btn btn-secondary", () => {
      const r = editarPrestamo(estado.datos, id, { persona: nombre.value, nota: nota.value }); if (!r.ok) { mostrar(error, textoMotivo(r)); return; } cambio();
    });
    const archivar = boton(t(p.archivado ? "Sacar de archivadas" : "Archivar"), "btn btn-secondary", () => {
      const r = archivarPrestamo(estado.datos, id, !p.archivado); if (!r.ok) { mostrar(error, textoMotivo(r)); return; } cambio();
    });
    const eliminar = boton(confirmando === "eliminar" ? t("Confirmar: eliminar") : t("Eliminar"), "btn btn-secondary", () => {
      if (confirmando !== "eliminar") { confirmando = "eliminar"; pintar(); det.open = true; return; }
      const r = eliminarPrestamo(estado.datos, id); confirmando = null;
      if (!r.ok) { pintar(); const d2 = cuerpo.querySelector("details"); if (d2) { d2.open = true; mostrar(d2.querySelector("[role=alert]"), textoMotivo(r)); } return; }
      guardado(); cerrar(); if (alCambiar) alCambiar();
    });
    det.append(filaBotones(guardarNombre, archivar), eliminar, parrafo("Archivar la oculta de la lista sin borrar nada. Eliminar solo se puede si no tiene movimientos.", { tamano: "0.78rem" }));
    cuerpo.append(det, filaBotones(boton(t("Cerrar"), "btn btn-secondary", cerrar)));
  }
  pintar();
}

/* ===================== Dividir un gasto ===================== */

function abrirDividirGasto({ alGuardar, nombre: nombreInicial = "", total: totalInicial = "" } = {}) {
  const { caja, cerrar } = abrirCapaNombrada("finanzas-deudas-dividir-overlay", "Dividir un gasto", { ancho: 520, z: 320 });
  const nombre = entrada(nombreInicial, t("Ej. Cena"), 60);
  const quien = selector([["yo", "Pagué yo"], ["otra", "Pagó otra persona"]], "yo");
  const total = entrada(String(totalInicial || ""), "0", 0, "text"); total.inputMode = "decimal";
  const fecha = entrada(hoyIso(), "", 0, "date");
  const categorias = listarCategorias(estado.datos, { tipo: "gasto" });
  const cat = selector([["", "Sin categoría"], ...categorias.map((c) => [c.id, `${c.emoji} ${c.nombre}`])], "");
  const pagador = entrada("", t("¿Quién pagó?"), 40);
  const filas = document.createElement("div"); filas.className = "stack"; filas.style.gap = "6px";
  const etiquetaTotal = document.createElement("span"); etiquetaTotal.className = "form-label";
  const miParte = parrafo("", { claseExtra: "badge badge-info", tamano: "0.85rem" });
  const error = lineaError();
  let partes = [{ persona: "", monto: "" }, { persona: "", monto: "" }];
  const conocidas = personasConocidas(estado.datos);

  const sumaPartes = () => partes.reduce((a, p) => a + parsearMonto(p.monto), 0);
  const pintarMia = () => {
    const otra = quien.value === "otra";
    const mia = otra ? parsearMonto(total.value) : parsearMonto(total.value) - sumaPartes();
    miParte.textContent = `${t(otra ? "Tu parte" : "Tu parte (lo que queda)")}: ${formatearMonto(Math.max(0, Math.round(mia * 100) / 100))}`;
    miParte.className = "badge " + (mia < 0 ? "badge-warning" : "badge-info");
    if (mia < 0) miParte.textContent += ` · ${t("Las partes suman más que el total")}`;
  };
  function pintarFilas() {
    const otra = quien.value === "otra";
    etiquetaTotal.textContent = t(otra ? "Cuánto te tocó a ti" : "Total que costó");
    pagadorCampo.style.display = otra ? "" : "none";
    filas.replaceChildren(); filas.style.display = otra ? "none" : "";
    partes.forEach((p, i) => {
      const f = document.createElement("div"); f.className = "row"; f.style.cssText = "display:grid; grid-template-columns:1fr 110px auto; gap:6px; align-items:center;";
      const n = entrada(p.persona, t("Persona"), 40); n.setAttribute("list", "finanzas-deudas-dividir-personas"); n.addEventListener("input", () => { p.persona = n.value; });
      const m = entrada(p.monto, "0", 0, "text"); m.inputMode = "decimal"; m.addEventListener("input", () => { p.monto = m.value; pintarMia(); });
      const q = boton("✕", "btn-discreto", () => { partes.splice(i, 1); pintarFilas(); }); q.setAttribute("aria-label", t("Quitar"));
      f.append(n, m, q); filas.appendChild(f);
    });
    const lista = document.createElement("datalist"); lista.id = "finanzas-deudas-dividir-personas"; conocidas.forEach((x) => { const o = document.createElement("option"); o.value = x; lista.appendChild(o); }); filas.appendChild(lista);
    filas.append(
      boton("＋ " + t("Añadir persona"), "btn-discreto", () => { if (partes.length < 20) { partes.push({ persona: "", monto: "" }); pintarFilas(); } }),
      boton(t("Partes iguales"), "btn-discreto", () => {
        const t0 = parsearMonto(total.value); if (!(t0 > 0) || !partes.length) return;
        const cada = Math.floor((t0 / (partes.length + 1)) * 100) / 100; partes.forEach((p) => { p.monto = String(cada); }); pintarFilas();
      }),
    );
    pintarMia();
  }
  quien.addEventListener("change", pintarFilas); total.addEventListener("input", pintarMia);

  const guardar = boton(t("Guardar"), "btn btn-primary", () => {
    const otra = quien.value === "otra";
    const r = dividirGasto(estado.datos, {
      nombre: nombre.value, total: parsearMonto(total.value), quienPago: quien.value, pagador: pagador.value, fecha: fecha.value, categoriaId: cat.value || null,
      partes: otra ? [] : partes.filter((p) => p.persona.trim() || parsearMonto(p.monto)).map((p) => ({ persona: p.persona, monto: parsearMonto(p.monto) })),
    });
    if (!r.ok) { mostrar(error, textoMotivo(r)); return; }
    guardado(); cerrar(); (alGuardar || refrescar)();
    mostrarBarraDeshacer({}, `${t("Gasto dividido")}: ${t("tu parte")} ${formatearMonto(r.miParte)}`, () => { const n = deshacerDivision(estado.datos, r); if (n) (alGuardar || refrescar)(); return n > 0; });
  });
  const etiquetaWrap = document.createElement("label"); etiquetaWrap.className = "stack"; etiquetaWrap.style.gap = "4px"; etiquetaWrap.append(etiquetaTotal, total);
  const pagadorCampo = campo("Nombre de quien pagó", pagador);
  caja.append(campo("¿Qué fue?", nombre), campo("¿Quién pagó?", quien), pagadorCampo, etiquetaWrap, campo("Fecha", fecha), campo("Categoría", cat),
    parrafo("Solo tu parte cuenta como gasto. Lo que adelantaste por los demás queda como lo que te deben.", { tamano: "0.8rem" }), filas, miParte, error,
    filaBotones(boton(t("Cancelar"), "btn btn-secondary", cerrar), guardar));
  pintarFilas();
  nombre.focus();
}

export { abrirDetallePrestamo, abrirDividirGasto, abrirNuevoPrestamo, renderizarPestanaDeudas };
