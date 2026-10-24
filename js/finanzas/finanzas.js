/* =========================================================================
   FINANZAS — Shell (2026-08-10)
   Nav principal → #seccion-finanzas. Contiene la vista de Resumen (default
   al entrar) + 3 pestañas internas (Semestres / Gastos / Beneficios),
   cada una delegada a su propio archivo por el límite de
   800 líneas. Este archivo solo arma el shell (pestañas + contenedor) y
   calcula los totales del Resumen — nada de CRUD acá.
   ========================================================================= */

import { MONEDAS_DISPONIBLES } from "../core/schema.js";
import { calcularTotalesMovimientos, obtenerModulosFinanzas } from "../core/finanzas-derivados.js";
import { aplicarPerfilFinanzas, debeMostrarOnboardingFinanzas, omitirOnboardingFinanzas, pestanasVisiblesFinanzas } from "../core/finanzas-perfiles.js";
import { puedeAjustarSaldo, tiposDisponiblesRegistroRapido } from "../core/finanzas-registro.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { obtenerIdiomaActual, obtenerLocaleInterfaz, traducirTextoInterfaz } from "../core/i18n.js";
import { construirGraficasResumenFinanzas } from "./finanzas-graficas.js";
import { renderizarPestanaBeneficios } from "./finanzas-gastos.js";
import { abrirModalMovimiento } from "./finanzas-movimiento-modal.js";
import { renderizarPestanaMovimientos } from "./finanzas-movimientos.js";
import { construirAnilloMeta, renderizarPestanaMetas } from "./finanzas-metas.js";
import { renderizarPestanaPlan } from "./finanzas-plan.js";
import { construirSelectorPerfil } from "./finanzas-modulos-ui.js";
import { construirBloquesInicio, hayProximos, montoVisible, privacidadActiva } from "./finanzas-inicio.js";
import { construirBloqueSobresEnRiesgo, pestanaPresupuestoVisible, renderizarPestanaPresupuesto } from "./finanzas-presupuesto.js";
import { abrirAjustarSaldo, abrirRegistroRapido, construirPasoSaldoInicial } from "./finanzas-registro-rapido.js";
import { renderizarPestanaSemestresFinanzas, abrirSelectorSemestreParaFinanzas, iniciarEdicionMovimientoFinanzas } from "./finanzas-semestres.js";

/**
 * FIX (mismo bug de arranque "Cannot access 'estado' before initialization"
 * visto en el resto de la app): este archivo YA tenía un guard
 * (`if (estado.finanzasVistaActiva === undefined) ...`) para no pisar el
 * valor en cada carga del módulo — pero ese guard seguía viviendo a nivel
 * de módulo, así que la LECTURA de `estado.finanzasVistaActiva` (la
 * condición del if) igual se ejecutaba apenas se cargaba el archivo. Evitar
 * la reasignación no evita el problema real: cualquier acceso a `estado.X`
 * — sea lectura o escritura — alcanza para el ReferenceError si `estado`
 * sigue en su zona muerta temporal en ese punto del grafo de imports. Se
 * mueve a una función lazy de verdad, llamada desde los 2 puntos de
 * entrada exportados que la usan.
 */
function inicializarEstadoFinanzasSiHaceFalta() {
  if (typeof estado.finanzasVistaActiva === "undefined") estado.finanzasVistaActiva = "resumen";
}

// v2.8.8: "Gastos estudiantiles" -> "Beneficios" (pedido explícito). El id
// interno ("gastos-estudiantiles") se deja igual a propósito — cambiarlo
// significaría migrar estado.finanzasVistaActiva para cuentas que hayan
// quedado con ese valor guardado en memoria/sesión, sin ninguna ganancia
// real ya que el id nunca se muestra, solo la etiqueta.
const PESTANAS_FINANZAS = [
  { id: "resumen", etiqueta: "Inicio" }, // antes "Resumen" (sesión 3); el id interno no cambia
  { id: "semestres", etiqueta: "Semestres" },
  { id: "plan", etiqueta: "Plan" },
  { id: "gastos-u", etiqueta: "Movimientos" },
  { id: "metas", etiqueta: "Metas" },
  { id: "presupuesto", etiqueta: "Presupuesto" }, // sesión 5: sobres y categorías (con Gastos e ingresos encendido)
  { id: "gastos-estudiantiles", etiqueta: "Beneficios" },
];

// v2.8.9: fechas NUNCA en bruto (nada de "2026-08-11" pelado) — en toda
// Finanzas se muestran como "11 de agosto de 2026". Vive acá porque
// finanzas-semestres.js y finanzas-gastos.js ya importan formatearMonto de
// este mismo archivo — mismo lugar central para formato de datos de la
// sección completa.
const MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "YYYY-MM-DD" -> "11 de agosto de 2026". Vacío/null -> "". */
function formatearFechaLarga(fechaIso) {
  if (!fechaIso) return "";
  const [anio, mes, dia] = fechaIso.split("-");
  const nombreMes = MESES_LARGOS[Number(mes) - 1];
  if (!nombreMes) return fechaIso; // formato inesperado — mejor mostrar algo que nada
  if (obtenerIdiomaActual() === "en") {
    return new Date(Number(anio), Number(mes) - 1, Number(dia)).toLocaleDateString(obtenerLocaleInterfaz(), {
      month: "long", day: "numeric", year: "numeric",
    });
  }
  return `${Number(dia)} de ${nombreMes} de ${anio}`;
}

/**
 * BUG (2026-08-26, reportado por Krys): "cambio de divisa en Ajustes no se
 * refleja en Finanzas, sigue mostrando colones". Causa confirmada: esta
 * función (y su equivalente compacta en finanzas-graficas.js) tenían el
 * símbolo "₡" hardcodeado y NUNCA leían configuracion.moneda_preferida ni
 * MONEDAS_DISPONIBLES (schema.js) — el selector de Ajustes (config-
 * ajustes.js/renderizarSelectorMoneda) sí guardaba bien el valor elegido,
 * el problema era 100% del lado de lectura acá. Se centraliza la
 * resolución del símbolo en esta única función para que formatearMonto y
 * formatearMontoCompacto (finanzas-graficas.js) queden sincronizados con
 * lo que sea que el usuario haya elegido.
 */
function obtenerSimboloMonedaActual() {
  const monedaId = (estado.datos.configuracion && estado.datos.configuracion.moneda_preferida) || "CRC";
  const moneda = MONEDAS_DISPONIBLES.find((m) => m.id === monedaId);
  return moneda ? moneda.simbolo : "₡"; // fallback defensivo si algún día se borra una moneda del catálogo
}

/**
 * Formato de monto consistente en toda la sección — sin decimales
 * sueltos raros, siempre 2 decimales, separador de miles local. El
 * símbolo ahora sale de obtenerSimboloMonedaActual() (ver fix del bug de
 * arriba) en vez de "₡" fijo.
 *
 * v2.8.8: para negativos (ej. el Balance del Resumen cuando hay más gasto
 * que ingreso) el signo "-" se pone A MANO, antes del símbolo de moneda
 * ("-₡100.00"), en vez de dejar que toLocaleString lo intercale donde el
 * locale decida ("₡-100.00" se leía raro/ambiguo) — pedido explícito de
 * que el signo quede explícito y claro antes del monto.
 */
function formatearMonto(numero) {
  const n = Number(numero) || 0;
  const signo = n < 0 ? "-" : "";
  return signo + obtenerSimboloMonedaActual() + Math.abs(n).toLocaleString(obtenerLocaleInterfaz(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Único punto que calcula los totales del Resumen.
 *
 * Finanzas 2.0 (0B): ya no suma gastos_u ni finanzas_semestre; todo sale del
 * modelo único (core/finanzas-derivados.js → calcularTotalesMovimientos), que
 * respeta módulos apagados, semestres borrados y pagos recurrentes "a la
 * fecha". La forma del resultado NO cambia (el Resumen y las gráficas siguen
 * igual hasta la etapa 0C):
 *   - totalGastado  = todos los gastos (matrícula incluida; un gasto pagado con
 *     una meta SÍ es gasto).
 *   - totalBecas    = ingresos con origen "beca".
 *   - totalIngresos = el resto de los ingresos (sin la beca).
 *   - balanceNeto   = becas + ingresos − gastado. Ahorros y transferencias
 *     nunca entran aquí.
 */
function calcularTotalesResumenFinanzas() {
  const r = calcularTotalesMovimientos(estado.datos);
  return { totalGastado: r.totalGastado, totalBecas: r.totalBecas, totalIngresos: r.totalIngresos, balanceNeto: r.balanceNeto, saldoLiquido: r.saldoLiquido, enMetas: r.enMetas };
}

/** Pestañas visibles: las de perfiles.js más Presupuesto cuando Gastos e ingresos está encendido (sesión 5). */
function pestanasVisiblesConPresupuesto(modulos) {
  const base = pestanasVisiblesFinanzas(modulos);
  return pestanaPresupuestoVisible(modulos) && !base.includes("presupuesto") ? [...base, "presupuesto"] : base;
}

function construirTabsFinanzas() {
  // v2.9.1: antes esto dependía de .finanzas-tabs-contenedor (container-type:
  // inline-size) + .pill-group-finanzas apilándose en columna cuando no
  // entraban las 4 en una fila — pedido explícito de sacar ese apilado: las
  // 4 pestañas se quedan SIEMPRE en una sola línea horizontal, y si el
  // ancho aprieta se encoge la letra/padding en vez de bajar de línea.
  const envoltorio = document.createElement("div");
  envoltorio.className = "finanzas-tabs-contenedor";

  const grupo = document.createElement("div");
  grupo.className = "pill-group-finanzas";
  grupo.style.cssText = "display:flex; flex-direction:row; flex-wrap:nowrap; gap:clamp(4px,1.5vw,8px); width:100%;";
  const visibles = pestanasVisiblesConPresupuesto(obtenerModulosFinanzas(estado.datos));
  PESTANAS_FINANZAS.filter((p) => visibles.includes(p.id)).forEach((pestana) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estado.finanzasVistaActiva === pestana.id ? " active" : "");
    btn.dataset.valor = pestana.id;
    btn.textContent = traducirTextoInterfaz(pestana.etiqueta);
    btn.style.cssText =
      "flex:1 1 0; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; " +
      "text-align:center; font-size:clamp(0.65rem,2.6vw,0.92rem); padding:clamp(6px,2vw,10px) clamp(4px,1.2vw,10px);";
    btn.addEventListener("click", () => {
      if (estado.finanzasVistaActiva === pestana.id) return;
      estado.finanzasVistaActiva = pestana.id;
      renderizarFinanzas();
    });
    grupo.appendChild(btn);
  });
  envoltorio.appendChild(grupo);
  return envoltorio;
}

/** Tarjeta principal del Resumen (0C): una cifra grande con texto y signo, y el desglose debajo. */
function construirTarjetaPrincipalResumen(totales, modulos) {
  const tarjeta = document.createElement("section");
  tarjeta.className = "glass-card stack resumen-hero";

  const usaPatrimonio = modulos.ahorros;
  const cifraValor = usaPatrimonio ? totales.saldoLiquido + totales.enMetas : totales.balanceNeto;

  const etiqueta = document.createElement("div");
  etiqueta.className = "resumen-hero-etiqueta";
  etiqueta.textContent = traducirTextoInterfaz(usaPatrimonio ? "Lo que tienes en total" : "Balance");
  const cifra = document.createElement("div");
  cifra.className = "resumen-hero-cifra" + (cifraValor < 0 ? " negativo" : "");
  cifra.textContent = montoVisible(cifraValor);
  tarjeta.append(etiqueta, cifra);

  // Mi dinero y En metas como en 0C (con Ahorros); sin Ahorros, Mi dinero aparece si hay Gastos, Matrícula o Beca.
  const verMiDinero = puedeAjustarSaldo(estado.datos);
  if (usaPatrimonio || verMiDinero) {
    const desglose = document.createElement("div");
    desglose.className = "resumen-hero-desglose";
    const chip = (clase, texto, monto) => {
      const c = document.createElement("span");
      c.className = "badge " + clase;
      c.textContent = `${texto}: ${montoVisible(monto)}`;
      return c;
    };
    desglose.appendChild(chip("badge-info", traducirTextoInterfaz("Mi dinero"), totales.saldoLiquido));
    if (usaPatrimonio) desglose.appendChild(chip("badge-success", traducirTextoInterfaz("En metas"), totales.enMetas));
    tarjeta.appendChild(desglose);
  }
  if (verMiDinero) {
    const ajustar = document.createElement("button");
    ajustar.type = "button";
    ajustar.className = "btn-discreto";
    ajustar.style.cssText = "align-self:center; font-size:0.85rem;";
    ajustar.textContent = traducirTextoInterfaz("Ajustar saldo");
    ajustar.addEventListener("click", () => abrirAjustarSaldo());
    tarjeta.appendChild(ajustar);
  }
  return tarjeta;
}

/** Tira de anillos pequeños con las metas activas (solo si Ahorros está encendido y hay metas). */
function construirTiraMetasResumen() {
  const activas = (estado.datos.metas || []).filter((m) => !m.archivada);
  if (!activas.length) return null;
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  const h = document.createElement("h3");
  h.className = "texto-encabezado-seccion";
  h.style.margin = "0";
  h.textContent = traducirTextoInterfaz("Metas");
  const tira = document.createElement("div");
  tira.className = "resumen-metas-tira";
  activas.slice(0, 6).forEach((meta) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "resumen-meta-mini";
    item.style.cssText = "background:none; border:0; color:inherit; cursor:pointer;";
    const nombre = document.createElement("span");
    nombre.textContent = `${meta.emoji || "🎯"} ${meta.nombre}`;
    item.append(construirAnilloMeta(meta, estado.datos, 64), nombre);
    item.addEventListener("click", () => { estado.finanzasVistaActiva = "metas"; renderizarFinanzas(); });
    tira.appendChild(item);
  });
  sec.append(h, tira);
  return sec;
}

/**
 * Resumen (0C): tarjeta principal (patrimonio o balance) + anillo de gastado
 * vs. disponible + tira de metas. Todo sale de calcularTotalesMovimientos.
 */
function construirResumenFinanzas() {
  const totales = calcularTotalesResumenFinanzas();
  const { totalGastado, totalBecas, totalIngresos } = totales;
  const modulos = obtenerModulosFinanzas(estado.datos);
  const sec = document.createElement("section");
  sec.className = "stack";

  const hayMetas = modulos.ahorros && (estado.datos.metas || []).some((m) => !m.archivada);
  if (totalBecas === 0 && totalGastado === 0 && totalIngresos === 0 && totales.saldoLiquido === 0 && !hayMetas && !hayProximos()) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.margin = "0";
    vacio.textContent = traducirTextoInterfaz(
      "Todavía no hay ningún registro financiero. Entra a la pestaña Movimientos o Semestres para empezar."
    );
    sec.appendChild(vacio);
    return sec;
  }

  // Inicio (sesión 3): privacidad, Disponible y Próximos van arriba; "Lo que tienes en total" y lo demás, debajo.
  construirBloquesInicio().forEach((bloque) => sec.appendChild(bloque));
  // Sesión 5: sobres por agotarse (solo ámbar y rojos; sin ninguno no ocupa lugar). Con Gastos apagado no hay sobres.
  const sobresRiesgo = construirBloqueSobresEnRiesgo();
  if (sobresRiesgo) sec.appendChild(sobresRiesgo);
  sec.appendChild(construirTarjetaPrincipalResumen(totales, modulos));
  // Con el modo privacidad las gráficas (que dibujan importes) se ocultan.
  if (!privacidadActiva() && (totalBecas !== 0 || totalGastado !== 0 || totalIngresos !== 0)) {
    sec.appendChild(construirGraficasResumenFinanzas(totalBecas, totalIngresos, totalGastado));
  }
  if (modulos.ahorros) {
    const tira = construirTiraMetasResumen();
    if (tira) sec.appendChild(tira);
  }
  return sec;
}

/** Onboarding por perfil: se muestra en lugar de Finanzas la primera vez (si no hay datos). */
function construirOnboardingFinanzas() {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  const h = document.createElement("h2");
  h.className = "texto-encabezado-seccion";
  h.style.margin = "0";
  h.textContent = traducirTextoInterfaz("¿Cómo quieres usar Finanzas?");
  const p = document.createElement("p");
  p.className = "muted";
  p.style.margin = "0";
  p.textContent = traducirTextoInterfaz("Elige lo que más se parece a ti. Puedes cambiarlo cuando quieras en Ajustes.");
  sec.append(h, p, construirSelectorPerfil(null, (id) => {
    aplicarPerfilFinanzas(estado.datos, id);
    marcarCambioPendiente();
    estado.finanzasVistaActiva = "resumen";
    // Segundo paso: saldo inicial, solo si el perfil tiene "Mi dinero" (Gastos, Matrícula o Beca).
    estado.finanzasPasoSaldoInicial = puedeAjustarSaldo(estado.datos);
    renderizarFinanzas();
  }));
  const omitir = document.createElement("button");
  omitir.type = "button";
  omitir.className = "btn btn-secondary";
  omitir.textContent = traducirTextoInterfaz("Ahora no, usar todo");
  omitir.addEventListener("click", () => {
    omitirOnboardingFinanzas(estado.datos);
    marcarCambioPendiente();
    renderizarFinanzas();
  });
  sec.appendChild(omitir);
  return sec;
}

/** Repinta solo el contenido de la pestaña activa, sin reconstruir el tab bar. */
function renderizarContenidoFinanzasActivo() {
  inicializarEstadoFinanzasSiHaceFalta();
  const contenido = document.getElementById("finanzas-contenido");
  if (!contenido) return;
  contenido.innerHTML = "";

  // Si la pestaña activa quedó oculta por un módulo apagado, se vuelve al Resumen.
  if (!pestanasVisiblesConPresupuesto(obtenerModulosFinanzas(estado.datos)).includes(estado.finanzasVistaActiva)) {
    estado.finanzasVistaActiva = "resumen";
  }

  if (estado.finanzasVistaActiva === "resumen") {
    contenido.appendChild(construirResumenFinanzas());
  } else if (estado.finanzasVistaActiva === "semestres") {
    renderizarPestanaSemestresFinanzas(contenido);
  } else if (estado.finanzasVistaActiva === "plan") {
    renderizarPestanaPlan(contenido);
  } else if (estado.finanzasVistaActiva === "gastos-u") {
    renderizarPestanaMovimientos(contenido);
  } else if (estado.finanzasVistaActiva === "metas") {
    renderizarPestanaMetas(contenido);
  } else if (estado.finanzasVistaActiva === "presupuesto") {
    renderizarPestanaPresupuesto(contenido);
  } else if (estado.finanzasVistaActiva === "gastos-estudiantiles") {
    renderizarPestanaBeneficios(contenido);
  }
}

/**
 * Punto de entrada de la sección — se llama desde main.js (al cargar/tras
 * login) y desde storage-sync.js (cada sondeo remoto y pull-to-refresh),
 * mismo patrón que renderizarSemestres/renderizarPlanEstudios. Se protege
 * sola si #seccion-finanzas todavía no está en el DOM.
 */
function renderizarFinanzas() {
  inicializarEstadoFinanzasSiHaceFalta();
  const cont = document.getElementById("seccion-finanzas");
  if (!cont) return;
  cont.innerHTML = "";

  if (estado.finanzasPasoSaldoInicial) {
    cont.appendChild(construirPasoSaldoInicial(() => {
      estado.finanzasPasoSaldoInicial = false;
      renderizarFinanzas();
    }));
    return;
  }

  if (debeMostrarOnboardingFinanzas(estado.datos)) {
    cont.appendChild(construirOnboardingFinanzas());
    return;
  }

  // Resolver la pestaña activa ANTES de pintar el tab bar (si quedó oculta, vuelve al Resumen).
  if (!pestanasVisiblesConPresupuesto(obtenerModulosFinanzas(estado.datos)).includes(estado.finanzasVistaActiva)) {
    estado.finanzasVistaActiva = "resumen";
  }
  cont.appendChild(construirTabsFinanzas());

  const modulosActuales = obtenerModulosFinanzas(estado.datos);
  const accesosRapidos = document.createElement("div");
  accesosRapidos.className = "row";
  accesosRapidos.style.cssText = "display:grid; grid-template-columns:repeat(auto-fit, minmax(0, 1fr)); gap:8px; width:100%;";
  if (tiposDisponiblesRegistroRapido(estado.datos).length) {
    const rapido = document.createElement("button");
    rapido.type = "button";
    rapido.className = "btn btn-primary";
    rapido.textContent = "＋ " + traducirTextoInterfaz("Añadir movimiento");
    rapido.addEventListener("click", () => abrirRegistroRapido({ abrirFormularioCompleto: () => abrirModalMovimiento({ alGuardar: renderizarFinanzas }) }));
    accesosRapidos.appendChild(rapido);
  }
  [
    { tipo: "matricula", texto: "Pago de matrícula" },
    { tipo: "beca", texto: "Ingreso de beca" },
  ].filter(({ tipo }) => modulosActuales[tipo]).forEach(({ tipo, texto }) => {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "btn btn-secondary";
    boton.textContent = traducirTextoInterfaz(texto);
    boton.addEventListener("click", () => abrirSelectorSemestreParaFinanzas(tipo, (semestreId) => {
      estado.finanzasVistaActiva = "semestres";
      renderizarFinanzas();
      iniciarEdicionMovimientoFinanzas(tipo, semestreId, document.getElementById("finanzas-contenido"));
    }));
    accesosRapidos.appendChild(boton);
  });
  if (accesosRapidos.childElementCount) cont.appendChild(accesosRapidos);

  const contenido = document.createElement("div");
  contenido.id = "finanzas-contenido";
  contenido.className = "stack";
  cont.appendChild(contenido);

  renderizarContenidoFinanzasActivo();
}

export { calcularTotalesResumenFinanzas, formatearFechaLarga, formatearMonto, obtenerSimboloMonedaActual, renderizarContenidoFinanzasActivo, renderizarFinanzas };
