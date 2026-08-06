/* =========================================================================
   CONFIGURACIÓN — AJUSTES GENERALES
   Paletas, modo claro/oscuro, escala de notas, nota de aprobación por
   plan/universidad, formato de texto.
   ========================================================================= */

import { PALETAS_DISPONIBLES, calcularObjetivoPasarRaspando, sellarTimestamp } from "../core/schema.js";
import { actualizarIndicadorSync, marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { renderizarPlanEstudios } from "../plan/plan-vista-lista.js";
import { COLORES_PREVIEW_PALETA, FONDO_PREVIEW_AZUCARADO, TEXTO_PREVIEW_PALETA, aplicarPaleta } from "../ui/tema.js";
import { iniciarFlujoPaletaPersonalizada } from "../ui/paleta-personalizada.js";

/* ------------------------------ Ajustes ------------------------------ */

/**
 * v1.14.1: aplica (o quita) el atributo data-rendimiento en <html>, mismo
 * patrón que data-palette/data-mode. Se exporta para poder llamarla también
 * al iniciar la app (antes de que el usuario entre a Ajustes), leyendo
 * estado.datos.configuracion.modo_rendimiento ya cargado.
 */
function aplicarModoRendimiento(activo) {
  document.documentElement.setAttribute("data-rendimiento", activo ? "reducido" : "normal");
}

/**
 * Ajustes — ocultar botones de navegación principal (2026-08-06): una fila
 * con switch por cada sección togglable. "configuracion" NUNCA aparece acá
 * (no se puede ocultar) — mismo filtro que ya aplica aplicarVisibilidadNavegacion
 * en main.js por las dudas, pero acá directamente no se le ofrece la opción.
 * Los switches son la única fuente de verdad de UI: leen y escriben
 * directo sobre estado.datos.configuracion.navegacion_oculta (arreglo de
 * ids), y en cada cambio llaman a window.aplicarVisibilidadNavegacion()
 * (expuesta por main.js) para que el nav se actualice al toque.
 */
const SECCIONES_TOGGLEABLES = [
  { id: "plan-estudios", etiqueta: "Plan de Estudios" },
  { id: "semestres", etiqueta: "Semestres" },
  { id: "comunidad", etiqueta: "Comunidad" },
  { id: "finanzas", etiqueta: "Finanzas" },
];

function renderizarNavegacionOculta() {
  const cont = document.getElementById("lista-nav-oculta");
  if (!cont) return;
  cont.innerHTML = "";

  const ocultas = new Set(estado.datos.configuracion.navegacion_oculta || []);

  SECCIONES_TOGGLEABLES.forEach(({ id, etiqueta }) => {
    const fila = document.createElement("div");
    fila.className = "row-between";

    const texto = document.createElement("span");
    texto.textContent = etiqueta;
    fila.appendChild(texto);

    const label = document.createElement("label");
    label.className = "switch switch-tema";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    // El switch representa "visible" (encendido = se muestra en el nav),
    // así que va invertido respecto a `ocultas` (que guarda lo OCULTO).
    chk.checked = !ocultas.has(id);
    chk.addEventListener("change", () => {
      const actuales = new Set(estado.datos.configuracion.navegacion_oculta || []);
      if (chk.checked) actuales.delete(id);
      else actuales.add(id);
      estado.datos.configuracion.navegacion_oculta = Array.from(actuales);
      sellarTimestamp(estado.datos.configuracion);
      marcarCambioPendiente();
      if (typeof window.aplicarVisibilidadNavegacion === "function") {
        window.aplicarVisibilidadNavegacion();
      }
    });
    const track = document.createElement("span");
    track.className = "track";
    track.innerHTML = '<span class="thumb"></span>';
    label.appendChild(chk);
    label.appendChild(track);
    fila.appendChild(label);

    cont.appendChild(fila);
  });
}

function renderizarAjustes() {
  // Paletas — cada cuadro muestra su propio color real (punto 3)
  const grid = document.getElementById("grid-paletas");
  grid.innerHTML = "";
  PALETAS_DISPONIBLES.forEach((paleta) => {
    const sw = document.createElement("div");
    sw.className = "palette-swatch" + (paleta === estado.datos.configuracion.paleta ? " selected" : "");
    sw.style.background = paleta === "azucarado"
      ? FONDO_PREVIEW_AZUCARADO
      : `linear-gradient(135deg, ${COLORES_PREVIEW_PALETA[paleta].join(", ")})`;
    sw.style.color = TEXTO_PREVIEW_PALETA[paleta] || "#ffffff";
    sw.setAttribute("data-palette-preview", paleta);
    sw.textContent = paleta;
    sw.addEventListener("click", () => {
      estado.datos.configuracion.paleta = paleta;
      aplicarPaleta(paleta, estado.datos.configuracion.modo);
      sellarTimestamp(estado.datos.configuracion);
      marcarCambioPendiente();
      renderizarAjustes();
    });
    grid.appendChild(sw);
  });

  // v1.13: 15ª opción — "+ Crear mi paleta". Si el usuario ya tiene una
  // guardada, el cuadro muestra su propio degradado (accent1 → accent2) y
  // queda marcado como seleccionado igual que cualquier otra paleta; si
  // todavía no existe, muestra un degradado arcoíris invitando a crearla.
  const personalizada = estado.datos.configuracion.paleta_personalizada;
  const swPersonalizada = document.createElement("div");
  swPersonalizada.className = "palette-swatch ppz-swatch-crear"
    + (estado.datos.configuracion.paleta === "personalizada" ? " selected" : "");
  swPersonalizada.style.background = personalizada
    ? `linear-gradient(135deg, ${personalizada.colores.accent1}, ${personalizada.colores.accent2})`
    : "linear-gradient(135deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef)";
  swPersonalizada.textContent = personalizada ? "personalizada" : "+ Crear mi paleta";
  swPersonalizada.addEventListener("click", () => {
    if (personalizada) {
      // Ya existe una guardada: un clic la activa directamente, igual que
      // cualquier otro cuadro del grid — para editarla de nuevo desde cero
      // se vuelve a entrar por el flujo completo con el botón de abajo.
      estado.datos.configuracion.paleta = "personalizada";
      aplicarPaleta("personalizada", estado.datos.configuracion.modo, personalizada.colores);
      sellarTimestamp(estado.datos.configuracion);
      marcarCambioPendiente();
      renderizarAjustes();
    } else {
      iniciarFlujoPaletaPersonalizada({ alGuardar: renderizarAjustes });
    }
  });
  grid.appendChild(swPersonalizada);

  // Botón aparte para volver a editar una paleta personalizada ya guardada
  // (evita perder los ajustes anteriores solo por querer retocar un color).
  if (personalizada) {
    const btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.className = "btn btn-secondary ppz-btn-editar";
    btnEditar.textContent = "Editar mi paleta";
    btnEditar.addEventListener("click", () => {
      iniciarFlujoPaletaPersonalizada({ alGuardar: renderizarAjustes });
    });
    grid.appendChild(btnEditar);
  }

  // v1.14.1: Modo de rendimiento (reduce blur/sombras/animaciones)
  const chkRendimiento = document.getElementById("switch-rendimiento");
  if (chkRendimiento) {
    chkRendimiento.checked = !!estado.datos.configuracion.modo_rendimiento;
    chkRendimiento.onchange = () => {
      estado.datos.configuracion.modo_rendimiento = chkRendimiento.checked;
      aplicarModoRendimiento(chkRendimiento.checked);
      sellarTimestamp(estado.datos.configuracion);
      marcarCambioPendiente();
    };
  }

  // Modo claro/oscuro
  const chkModo = document.getElementById("switch-modo");
  chkModo.checked = estado.datos.configuracion.modo === "light";
  chkModo.onchange = () => {
    const nuevoModo = chkModo.checked ? "light" : "dark";
    estado.datos.configuracion.modo = nuevoModo;
    aplicarPaleta(
      estado.datos.configuracion.paleta,
      nuevoModo,
      estado.datos.configuracion.paleta === "personalizada" ? personalizada.colores : undefined
    );
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
  };

  // Escala de notas global
  const grupoEscala = document.getElementById("pill-escala-notas");
  grupoEscala.querySelectorAll(".pill-item").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.valor) === estado.datos.configuracion.escala_notas_global);
    btn.onclick = () => {
      estado.datos.configuracion.escala_notas_global = Number(btn.dataset.valor);
      sellarTimestamp(estado.datos.configuracion);
      marcarCambioPendiente();
      renderizarAjustes();
    };
  });

  // Fase 6, punto 5: nota de aprobación por universidad/plan — va justo
  // después de la escala de notas (mismo grupo "académico" dentro del
  // flujo de Ajustes: apariencia arriba, académico en el medio, formato
  // de texto al final).
  renderizarNotasAprobacion();

  // Formato de texto de nombres de materias/carrera (v5 #9)
  const grupoFormato = document.getElementById("pill-formato-texto");
  if (grupoFormato) {
    grupoFormato.querySelectorAll(".pill-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.valor === (estado.datos.configuracion.formato_texto_nombres || "titulo"));
      btn.onclick = () => {
        estado.datos.configuracion.formato_texto_nombres = btn.dataset.valor;
        sellarTimestamp(estado.datos.configuracion);
        marcarCambioPendiente();
        renderizarAjustes();
        if (typeof renderizarPlanEstudios === "function") renderizarPlanEstudios();
      };
    });
  }

  // Ajustes — ocultar botones de navegación principal
  renderizarNavegacionOculta();

  actualizarIndicadorSync();
}

/**
 * Fase 6, punto 5 — Nota de aprobación por universidad/plan. Una tarjeta
 * por CADA plan que el usuario tenga creado (no solo los activos de Modo
 * Hardcore: si mañana reactiva uno, el número ya lo tiene puesto).
 *
 * Decisión de diseño (2026-08-03): acá solo se edita `nota_aprobacion`.
 * El viejo `umbral_pasar_raspando` se eliminó del modelo por completo —
 * "pasar raspando" dejó de ser un número guardado aparte y pasó a ser el
 * mismo `nota_aprobacion` con el margen de redondeo ya aplicado (ver
 * calcularObjetivoPasarRaspando en schema.js, y redondearNotaFinalAlCinco-
 * MasCercano que usa terminarSemestre() para decidir aprobó/no aprobó).
 * Por eso acá al lado del input se muestra ese margen, pero SOLO como dato
 * informativo (no editable) — mostrarlo como si fuera un segundo ajuste
 * independiente reintroduciría la misma inconsistencia de dos números que
 * deberían ser uno solo.
 *
 * Layout pedido: universidad/carrera como título de la tarjeta, y debajo
 * los dos bloques uno al lado del otro ocupando todo el ancho disponible
 * si caben (flex:1 1 140px + flex-wrap) — si no entran, se apilan uno
 * arriba del otro ocupando el ancho completo. Ver #seccion-notas-aprobacion
 * en index.html (nuevo contenedor a agregar, ver nota al final).
 */
function formatearNumeroCorto(numero) {
  const n = Number(numero);
  if (!Number.isFinite(n)) return "—";
  return Number(n.toFixed(2)).toString();
}

function renderizarNotasAprobacion() {
  const contenedor = document.getElementById("seccion-notas-aprobacion");
  if (!contenedor) return;
  contenedor.innerHTML = "";

  const planes = estado.datos.planes_estudio || [];
  if (planes.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "font-size:0.85rem; margin:0;";
    vacio.textContent = "Todavía no tenés ningún plan de estudios creado.";
    contenedor.appendChild(vacio);
    return;
  }

  planes.forEach((plan) => {
    plan.parametros_universidad = plan.parametros_universidad || {};

    const tarjeta = document.createElement("div");
    tarjeta.className = "glass-panel";
    tarjeta.style.cssText = "padding:12px; margin-bottom:10px;";

    const titulo = document.createElement("p");
    titulo.style.cssText = "margin:0 0 8px; font-weight:700; font-size:0.9rem;";
    titulo.textContent = `${plan.universidad} · ${aplicarFormatoTexto(plan.nombre_carrera)}`;
    tarjeta.appendChild(titulo);

    const fila = document.createElement("div");
    fila.style.cssText = "display:flex; flex-wrap:wrap; gap:10px;";

    // Bloque 1: nota de aprobación real (editable)
    const bloqueAprobacion = document.createElement("div");
    bloqueAprobacion.style.cssText = "flex:1 1 140px;";
    const labelAprobacion = document.createElement("label");
    labelAprobacion.className = "muted";
    labelAprobacion.style.cssText = "display:block; font-size:0.75rem; margin-bottom:4px;";
    labelAprobacion.textContent = "Nota de aprobación";
    const inputAprobacion = document.createElement("input");
    inputAprobacion.type = "number";
    inputAprobacion.className = "form-input";
    inputAprobacion.style.width = "100%";
    inputAprobacion.min = "0";
    inputAprobacion.max = "100";
    inputAprobacion.step = "0.1";
    inputAprobacion.value = formatearNumeroCorto(plan.parametros_universidad.nota_aprobacion ?? 70);
    bloqueAprobacion.appendChild(labelAprobacion);
    bloqueAprobacion.appendChild(inputAprobacion);
    fila.appendChild(bloqueAprobacion);

    // Bloque 2: margen real para "pasar raspando" (informativo, no editable)
    const bloqueRaspando = document.createElement("div");
    bloqueRaspando.style.cssText = "flex:1 1 140px;";
    const labelRaspando = document.createElement("label");
    labelRaspando.className = "muted";
    labelRaspando.style.cssText = "display:block; font-size:0.75rem; margin-bottom:4px;";
    labelRaspando.textContent = "Pasás raspando con";
    const valorRaspando = document.createElement("div");
    valorRaspando.className = "form-input";
    valorRaspando.style.cssText = "width:100%; opacity:0.7; display:flex; align-items:center; cursor:default;";
    bloqueRaspando.appendChild(labelRaspando);
    bloqueRaspando.appendChild(valorRaspando);
    fila.appendChild(bloqueRaspando);

    function actualizarRaspando() {
      const notaActual = Number(plan.parametros_universidad.nota_aprobacion) || 70;
      valorRaspando.textContent = formatearNumeroCorto(calcularObjetivoPasarRaspando(notaActual));
    }
    actualizarRaspando();

    inputAprobacion.addEventListener("change", () => {
      let valor = Number(inputAprobacion.value);
      if (!Number.isFinite(valor)) valor = 70;
      valor = Math.min(Math.max(valor, 0), 100);
      inputAprobacion.value = formatearNumeroCorto(valor);
      plan.parametros_universidad.nota_aprobacion = valor;
      sellarTimestamp(plan);
      marcarCambioPendiente();
      actualizarRaspando();
    });

    tarjeta.appendChild(fila);
    contenedor.appendChild(tarjeta);
  });
}

export {
  renderizarAjustes,
  aplicarModoRendimiento,
};
