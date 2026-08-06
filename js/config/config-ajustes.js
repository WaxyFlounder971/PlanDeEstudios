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
  { id: "agenda", etiqueta: "Agenda", icono: "📖" },
  { id: "horario", etiqueta: "Horario", icono: "🗓️" },
  { id: "semestres", etiqueta: "Semestres", icono: "📅" },
  { id: "comunidad", etiqueta: "Comunidad", icono: "👥" },
  { id: "finanzas", etiqueta: "Finanzas", icono: "💰" },
  { id: "plan-estudios", etiqueta: "Plan de Estudios", icono: "📚" },
];

function renderizarNavegacionOculta() {
  const cont = document.getElementById("lista-nav-oculta");
  if (!cont) return;
  cont.innerHTML = "";

  const ocultas = new Set(estado.datos.configuracion.navegacion_oculta || []);
  // window.obtenerOrdenNavegacion la expone main.js (mismo motivo que
  // aplicarVisibilidadNavegacion: evitar import circular, ya que
  // config-ajustes.js es importado POR main.js). Si por lo que sea no
  // está disponible todavía, se cae al orden fijo de SECCIONES_TOGGLEABLES
  // para no romper el render.
  const orden = typeof window.obtenerOrdenNavegacion === "function"
    ? window.obtenerOrdenNavegacion()
    : SECCIONES_TOGGLEABLES.map((s) => s.id);

  orden.forEach((id) => {
    const seccion = SECCIONES_TOGGLEABLES.find((s) => s.id === id);
    if (!seccion) return; // id huérfano (ej. una sección que ya no existe) — se ignora

    const fila = document.createElement("div");
    fila.className = "fila-nav-orden row-between";
    fila.dataset.id = id;

    const izquierda = document.createElement("div");
    izquierda.className = "row";
    izquierda.style.cssText = "align-items:center; gap:10px; min-width:0;";

    const handle = document.createElement("span");
    handle.className = "handle-mover";
    handle.textContent = "⋮⋮";
    handle.title = "Arrastrá para reordenar";
    izquierda.appendChild(handle);

    const icono = document.createElement("span");
    icono.textContent = seccion.icono;
    icono.style.cssText = "font-size:1.05rem; flex-shrink:0;";
    izquierda.appendChild(icono);

    const texto = document.createElement("span");
    texto.textContent = seccion.etiqueta;
    izquierda.appendChild(texto);

    fila.appendChild(izquierda);

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

  habilitarArrastreNavegacion(cont);
}

/**
 * Ajustes — arrastrar para reordenar los switches de navegación
 * (2026-08-06): mismo motor por Pointer Events que la Fase 8 de
 * semestres-tarjetas.js (mouse y touch con el mismo código, más fiable en
 * teléfono que el HTML5 Drag&Drop nativo) — reusa a propósito las mismas
 * clases CSS (.handle-mover / .arrastrando / .arrastre-placeholder) para
 * que el gesto se sienta igual en toda la app. A diferencia de
 * criterios/asignaciones, acá el ícono de agarre queda SIEMPRE visible
 * (pedido explícito: lista corta y fija, sin el "modo bajo demanda").
 * Al soltar, guarda el nuevo orden completo en
 * estado.datos.configuracion.navegacion_orden y dispara
 * aplicarVisibilidadNavegacion() para que el nav real se reordene igual.
 */
function habilitarArrastreNavegacion(contenedor) {
  contenedor.querySelectorAll(".fila-nav-orden").forEach((fila) => {
    const handle = fila.querySelector(".handle-mover");
    if (!handle) return;
    handle.style.touchAction = "none";
    handle.addEventListener("pointerdown", (evDown) => {
      if (evDown.button !== undefined && evDown.button !== 0) return; // solo click izq / touch
      evDown.preventDefault();
      evDown.stopPropagation();

      const rectInicial = fila.getBoundingClientRect();
      const anchoItem = rectInicial.width;
      const alturaItem = rectInicial.height;

      const placeholder = document.createElement("div");
      placeholder.className = "arrastre-placeholder";
      placeholder.style.height = alturaItem + "px";
      contenedor.insertBefore(placeholder, fila);

      fila.classList.add("arrastrando");
      fila.style.position = "fixed";
      fila.style.zIndex = "99998";
      fila.style.width = anchoItem + "px";
      fila.style.pointerEvents = "none";
      fila.style.left = rectInicial.left + "px";
      fila.style.top = rectInicial.top + "px";
      document.body.appendChild(fila);

      try {
        fila.setPointerCapture(evDown.pointerId);
      } catch (e) {
        // Si el navegador no puede capturar (raro), el arrastre sigue
        // funcionando igual — solo se pierde la garantía de recibir el
        // pointerup aunque el dedo salga del elemento.
      }

      const mover = (x, y) => {
        fila.style.left = x - anchoItem / 2 + "px";
        fila.style.top = y - alturaItem / 2 + "px";

        fila.style.display = "none";
        const elDebajo = document.elementFromPoint(x, y);
        fila.style.display = "";
        if (!elDebajo || !contenedor.contains(elDebajo)) return;

        const hijos = Array.from(contenedor.children).filter((h) => h !== placeholder && h !== fila);
        let referencia = null;
        for (const hijo of hijos) {
          const rect = hijo.getBoundingClientRect();
          if (y < rect.top + rect.height / 2) {
            referencia = hijo;
            break;
          }
        }
        if (referencia) contenedor.insertBefore(placeholder, referencia);
        else contenedor.appendChild(placeholder);
      };

      const alMover = (evMove) => mover(evMove.clientX, evMove.clientY);

      const alSoltar = () => {
        fila.removeEventListener("pointermove", alMover);
        fila.removeEventListener("pointerup", alSoltar);
        fila.removeEventListener("pointercancel", alSoltar);
        try {
          fila.releasePointerCapture(evDown.pointerId);
        } catch (e) {
          // nada que limpiar si nunca se pudo capturar
        }

        contenedor.insertBefore(fila, placeholder);
        placeholder.remove();

        fila.classList.remove("arrastrando");
        fila.style.position = "";
        fila.style.zIndex = "";
        fila.style.width = "";
        fila.style.left = "";
        fila.style.top = "";
        fila.style.pointerEvents = "";
        fila.style.display = "";

        const nuevoOrden = Array.from(contenedor.querySelectorAll(".fila-nav-orden")).map((f) => f.dataset.id);
        estado.datos.configuracion.navegacion_orden = nuevoOrden;
        sellarTimestamp(estado.datos.configuracion);
        marcarCambioPendiente();
        if (typeof window.aplicarVisibilidadNavegacion === "function") {
          window.aplicarVisibilidadNavegacion();
        }
      };

      fila.addEventListener("pointermove", alMover);
      fila.addEventListener("pointerup", alSoltar);
      fila.addEventListener("pointercancel", alSoltar);
    });
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
