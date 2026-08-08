/* =========================================================================
   CONFIGURACIÓN — AJUSTES GENERALES
   Paletas, modo claro/oscuro, escala de notas, nota de aprobación por
   plan/universidad, formato de texto.
   ========================================================================= */

import { ESCALAS_DISPONIBLES, PALETAS_DISPONIBLES, calcularObjetivoPasarRaspando, sellarTimestamp } from "../core/schema.js";
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
 * Bug — duplicado en drag-and-drop de navegación (2026-08-07): reordena
 * `navegacion_orden` moviendo `idArrastrado` a la posición inmediatamente
 * ANTES de `idReferencia` (o al final, si `idReferencia` es null).
 *
 * Estructuralmente imposible que duplique un id: SIEMPRE parte del orden
 * canónico ya deduplicado (window.obtenerOrdenNavegacion(), que además se
 * autolimpia en cada llamada — ver obtenerOrdenNavegacionEfectivo en
 * main.js), le quita `idArrastrado` una única vez (filter) y lo vuelve a
 * insertar una única vez (splice/push). Nunca se lee ni se reconstruye el
 * arreglo final a partir de lo que hay pintado en el DOM.
 */
function reordenarSeccionNav(idArrastrado, idReferencia) {
  const ordenBase = typeof window.obtenerOrdenNavegacion === "function"
    ? window.obtenerOrdenNavegacion()
    : SECCIONES_TOGGLEABLES.map((s) => s.id);

  const sinArrastrado = ordenBase.filter((id) => id !== idArrastrado);
  const indiceDestino = idReferencia ? sinArrastrado.indexOf(idReferencia) : -1;

  const nuevoOrden = [...sinArrastrado];
  if (indiceDestino === -1) nuevoOrden.push(idArrastrado);
  else nuevoOrden.splice(indiceDestino, 0, idArrastrado);

  estado.datos.configuracion.navegacion_orden = nuevoOrden;
  sellarTimestamp(estado.datos.configuracion);
  marcarCambioPendiente();
  if (typeof window.aplicarVisibilidadNavegacion === "function") {
    window.aplicarVisibilidadNavegacion();
  }
  renderizarNavegacionOculta(); // reconstruye el DOM limpio desde el dato ya sano
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
 * Al soltar, delega en reordenarSeccionNav (ver arriba) — esa función es
 * la única que escribe estado.datos.configuracion.navegacion_orden.
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

      // Bug — duplicado en drag-and-drop de navegación (2026-08-07): se
      // captura el id ANTES de que `fila` se desprenda del DOM real. El
      // resultado final del drag nunca se arma leyendo `data-id` desde el
      // DOM (ver alSoltar/reordenarSeccionNav) — este id es el único dato
      // que el gesto necesita conservar del elemento arrastrado.
      const idArrastrado = fila.dataset.id;

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

        // Bug — duplicado en drag-and-drop de navegación (2026-08-07): única
        // lectura del DOM usada para decidir la posición final: qué fila
        // (por id) quedó inmediatamente DESPUÉS del placeholder, o null si
        // quedó al final. El arreglo persistido NUNCA se arma leyendo
        // querySelectorAll sobre el contenedor — eso era la causa raíz del
        // bug (nodo desprendido + re-render concurrente = doble data-id).
        const filaSiguiente = placeholder.nextElementSibling;
        const idReferencia =
          filaSiguiente && filaSiguiente.classList.contains("fila-nav-orden") ? filaSiguiente.dataset.id : null;

        // Se limpia el DOM temporal del drag ANTES de tocar los datos, así
        // `fila` nunca queda flotando fuera de #lista-nav-oculta mientras
        // se recalcula el orden. renderizarNavegacionOculta() (llamada
        // dentro de reordenarSeccionNav) reconstruye el DOM limpio desde
        // el dato ya sano.
        fila.remove();
        placeholder.remove();

        reordenarSeccionNav(idArrastrado, idReferencia);
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

  // Ajustes por Universidad (2026-08-08): el selector de escala global que
  // vivía acá (#pill-escala-notas, leyendo/escribiendo
  // configuracion.escala_notas_global) se elimina — ese campo ya no existe
  // en el schema (ver migrarDatosAntiguos). La escala ahora es 100% por
  // plan, y se edita dentro de cada tarjeta (ver renderizarNotasAprobacion
  // más abajo, junto a nota de aprobación y redondeo).
  //
  // NOTA para quien toque index.html: el contenedor viejo #pill-escala-notas
  // queda huérfano en el HTML — ya no se busca ni se usa desde acá, se
  // puede borrar del markup con seguridad.

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
 * Ajustes por Universidad (2026-08-08) — una tarjeta por CADA plan que el
 * usuario tenga creado (no solo los activos de Modo Hardcore: si mañana
 * reactiva uno, ya tiene todo configurado). Cada tarjeta edita 3 cosas del
 * plan, las 3 con efecto inmediato (sellarTimestamp + marcarCambioPendiente
 * al toque, mismo patrón que el resto de Ajustes):
 *
 *  - Escala de notas (`parametros_universidad.escala_notas`): selector
 *    desplegable con TODAS las opciones de ESCALAS_DISPONIBLES (schema.js).
 *    Reemplaza al viejo pill de escala GLOBAL — ver nota en renderizarAjustes.
 *    Cambiar de escala acá NUNCA reescribe notas ya cargadas: las
 *    asignaciones siguen guardando su nota cruda tal cual se tipeó, y el
 *    motor de cálculo simplemente la reinterpreta contra la escala vigente
 *    en el momento de calcular (ver obtenerEscalaNotasMateria) — por eso el
 *    cambio de escala es reversible infinitas veces sin perder ni corromper
 *    ningún dato ya registrado.
 *  - Nota de aprobación (`parametros_universidad.nota_aprobacion`): sigue
 *    siendo un número 0-100 SIEMPRE, sin importar la escala elegida al
 *    lado — no está desalineado a propósito: nota_final de una materia ya
 *    es internamente 0-100 pase lo que pase por la escala de captura (el
 *    peso de cada criterio/asignación siempre suma 100%, ver
 *    calcularPuntosAsignacion en schema.js), así que 0-100 es la unidad
 *    real y estable en la que vale la pena comparar/guardar esto.
 *  - Redondeo al 5 más cercano (`parametros_universidad.redondeo_activo`):
 *    switch — existía en el schema desde Fase 6.2 pero nunca tuvo control
 *    en la UI a pesar del comentario "editable en Ajustes". El bloque
 *    informativo "Pasás raspando con" (calcularObjetivoPasarRaspando) solo
 *    tiene sentido si el redondeo está activo — se oculta si no.
 *
 * Decisión de diseño (2026-08-03, sigue vigente): NO existe un
 * umbral_redondeo separado editable — "pasar raspando" se calcula al vuelo
 * desde nota_aprobacion, nunca se guarda como número aparte. Reintroducir
 * un número independiente ahí reabriría la inconsistencia de dos fuentes
 * de verdad que esa decisión cerró.
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

    // Bloque 1: escala de notas (selector desplegable — NO switch de 2
    // opciones, tiene que caber cualquier cantidad de escalas)
    const bloqueEscala = document.createElement("div");
    bloqueEscala.style.cssText = "flex:1 1 140px;";
    const labelEscala = document.createElement("label");
    labelEscala.className = "muted";
    labelEscala.style.cssText = "display:block; font-size:0.75rem; margin-bottom:4px;";
    labelEscala.textContent = "Escala de notas";
    const selectEscala = document.createElement("select");
    selectEscala.className = "form-input";
    selectEscala.style.width = "100%";
    ESCALAS_DISPONIBLES.forEach((escala) => {
      const opt = document.createElement("option");
      opt.value = String(escala.id);
      opt.textContent = escala.etiqueta;
      selectEscala.appendChild(opt);
    });
    selectEscala.value = String(plan.parametros_universidad.escala_notas ?? 100);
    selectEscala.addEventListener("change", () => {
      // Los ids numéricos (7,10,12,...,100) viajan como string en
      // selectEscala.value — hay que volver a Number salvo para "letras"
      // y las escalas gpa*, que son ids de texto. Number("letras") da NaN,
      // así que el chequeo isNaN decide cuál de las dos ramas corresponde.
      const crudo = selectEscala.value;
      const comoNumero = Number(crudo);
      plan.parametros_universidad.escala_notas = Number.isNaN(comoNumero) ? crudo : comoNumero;
      sellarTimestamp(plan);
      marcarCambioPendiente();
      // Nunca toca ninguna nota ya cargada — solo cambia con qué escala se
      // reinterpretan de acá en adelante (ver obtenerEscalaNotasMateria),
      // por eso no hace falta re-renderizar nada de Plan de Estudios/
      // Semestres desde acá: la próxima vez que se calcule algo, ya toma
      // la escala nueva sola.
    });
    bloqueEscala.appendChild(labelEscala);
    bloqueEscala.appendChild(selectEscala);
    fila.appendChild(bloqueEscala);

    // Bloque 2: nota de aprobación real (editable) — SIEMPRE 0-100, ver
    // docblock de arriba sobre por qué no depende de la escala elegida.
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

    tarjeta.appendChild(fila);

    // Segunda fila: switch de redondeo + "pasás raspando" (solo si el
    // redondeo está activo — con redondeo apagado ese número no aplica).
    const filaRedondeo = document.createElement("div");
    filaRedondeo.style.cssText = "display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; margin-top:10px;";

    const bloqueSwitch = document.createElement("div");
    bloqueSwitch.style.cssText = "flex:1 1 140px; display:flex; align-items:center; justify-content:space-between; gap:8px;";
    const labelSwitch = document.createElement("span");
    labelSwitch.style.cssText = "font-size:0.8rem;";
    labelSwitch.textContent = "Redondear al 5 más cercano";
    const labelToggle = document.createElement("label");
    labelToggle.className = "switch switch-tema";
    const chkRedondeo = document.createElement("input");
    chkRedondeo.type = "checkbox";
    chkRedondeo.checked = plan.parametros_universidad.redondeo_activo !== false;
    const trackRedondeo = document.createElement("span");
    trackRedondeo.className = "track";
    trackRedondeo.innerHTML = '<span class="thumb"></span>';
    labelToggle.appendChild(chkRedondeo);
    labelToggle.appendChild(trackRedondeo);
    bloqueSwitch.appendChild(labelSwitch);
    bloqueSwitch.appendChild(labelToggle);
    filaRedondeo.appendChild(bloqueSwitch);

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
    filaRedondeo.appendChild(bloqueRaspando);

    function actualizarRaspando() {
      const activo = plan.parametros_universidad.redondeo_activo !== false;
      bloqueRaspando.style.display = activo ? "" : "none";
      if (!activo) return;
      const notaActual = Number(plan.parametros_universidad.nota_aprobacion) || 70;
      valorRaspando.textContent = formatearNumeroCorto(calcularObjetivoPasarRaspando(notaActual));
    }
    actualizarRaspando();

    chkRedondeo.addEventListener("change", () => {
      plan.parametros_universidad.redondeo_activo = chkRedondeo.checked;
      sellarTimestamp(plan);
      marcarCambioPendiente();
      actualizarRaspando();
    });

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

    tarjeta.appendChild(filaRedondeo);
    contenedor.appendChild(tarjeta);
  });
}

export {
  renderizarAjustes,
  aplicarModoRendimiento,
};
