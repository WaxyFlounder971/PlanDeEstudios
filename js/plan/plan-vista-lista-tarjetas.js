/* =========================================================================
   PLAN DE ESTUDIOS — VISTA DE LISTA (bloques y tarjetas)
   Candado de disponibilidad, bloques colapsables y la tarjeta de materia
   completa (encabezado, requisitos, menú rápido de categoría).
   ========================================================================= */

import { arbolContieneCodigo, evaluarNodoRequisito, obtenerEstadoEfectivoMateria, sellarTimestamp } from "../core/schema.js";
import { resolverConflicto, sonValoresEquivalentes } from "../core/storage-merge.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { aplicarFormatoTexto, formatearHoras } from "../core/utils.js";
import { agregarLongPress, envolverConFlechasScroll } from "../ui/componentes.js";
import { abrirModalRequisito, construirBloqueCompletoRequisitos, construirCuerpoDetalleMateria, construirLinea2Materia } from "./plan-detalle.js";
import { abrirModalMateriaManual, abrirModalVincularOptativa, filasFiltradas, obtenerMateriasRevisar, obtenerMateriasVisibles, obtenerOptativasDisponibles } from "./plan-esquema.js";
import { renderizarPlanEstudios } from "./plan-vista-lista.js";

/* ===================== Sección 2 — Candado (lógica de grupos) ===================== */

/** v1.12 (Parte D): disponible si no tiene requisitos, o si el árbol Y/O
 *  completo evalúa a verdadero (ver evaluarNodoRequisito en core/schema.js —
 *  hoja "codigo" cumple si esa materia está "aprobado" en el plan; "Y"
 *  requiere todos sus hijos; "O" requiere al menos uno, sin importar la
 *  profundidad de anidamiento). */

function materiaDisponible(materia, materiasDelPlan) {
  return evaluarNodoRequisito(materia.requisitos, (codigo) => {
    const req = materiasDelPlan.find((m) => m.codigo === codigo);
    return !!req && req.estado === "aprobado";
  });
}

/** Sección 5 — búsqueda inversa (Parte F, v1.12): qué materias tienen a
 *  `materia` en CUALQUIER nivel de profundidad de su árbol de requisitos o
 *  correquisitos (antes solo miraba un arreglo plano de grupos). */

function obtenerMateriasQueDesbloquea(materia, plan) {
  return plan.materias.filter((m) =>
    arbolContieneCodigo(m.requisitos, materia.codigo) || arbolContieneCodigo(m.correquisitos, materia.codigo)
  );
}

function construirContenidoBloques() {
  const contenedor = document.createElement("div");
  contenedor.className = "stack";

  const todasLasFilas = obtenerMateriasVisibles();
  const todasOptativasDisponibles = obtenerOptativasDisponibles();
  const todasParaRevisar = obtenerMateriasRevisar();
  if (todasLasFilas.length === 0 && todasOptativasDisponibles.length === 0 && todasParaRevisar.length === 0) {
    const sec = document.createElement("section");
    sec.className = "glass-card";
    sec.innerHTML = `<p class="muted">Este plan todavía no tiene materias. Impórtalas o añádelas manualmente desde el panel de arriba.</p>`;
    contenedor.appendChild(sec);
    return contenedor;
  }

  // C.4 (v9): las optativas YA agregadas nunca entran en la agrupación
  // normal por bloque/categoría/estado — siempre viven en su propio bloque
  // "Optativas" al final (ver más abajo), sin importar el orden activo.
  const filas = filasFiltradas().filter((f) => !f.materia.es_optativa);
  const filasOptativasAgregadas = filasFiltradas().filter((f) => f.materia.es_optativa);

  // El filtro de búsqueda de texto también aplica a las disponibles/por
  // revisar; el de Categoría no (todavía no tienen ninguna asignada, así
  // que un filtro de categoría activo las oculta por completo — es el
  // comportamiento esperado, no un descuido).
  let disponibles = estado.filtroCategoriaId ? [] : todasOptativasDisponibles;
  let paraRevisar = estado.filtroCategoriaId ? [] : todasParaRevisar;
  const q = (estado.busquedaPlanEstudios || "").trim().toLowerCase();
  if (q) {
    disponibles = disponibles.filter(
      (f) => f.materia.nombre.toLowerCase().includes(q) || f.materia.codigo.toLowerCase().includes(q)
    );
    paraRevisar = paraRevisar.filter(
      (f) => f.materia.nombre.toLowerCase().includes(q) || f.materia.codigo.toLowerCase().includes(q)
    );
  }

  if (filas.length === 0 && filasOptativasAgregadas.length === 0 && disponibles.length === 0 && paraRevisar.length === 0) {
    const sec = document.createElement("section");
    sec.className = "glass-card";
    sec.innerHTML = `<p class="muted">Ninguna materia coincide con la búsqueda o el filtro actual.</p>`;
    contenedor.appendChild(sec);
    return contenedor;
  }

  const cfg = estado.datos.configuracion;
  const esEscritorio = window.innerWidth >= 900;

  if (filas.length > 0) {
    const grupos = new Map();
    const nombreGrupo = new Map();

    filas.forEach((fila) => {
      let clave, nombre;
      if (estado.ordenPlanEstudios === "categoria") {
        clave = fila.materia.categoria_id || "sin_categoria";
        const cat = fila.plan.categorias.find((c) => c.id === fila.materia.categoria_id);
        nombre = cat ? cat.nombre : "Sin categoría";
      } else if (estado.ordenPlanEstudios === "estado") {
        // D/E/F: estado EFECTIVO, no el campo crudo — si no se usa esto,
        // una materia repetida (matriculada de nuevo tras estar "Aprobada")
        // se seguiría agrupando bajo "Aprobada" en vez de "Cursando".
        const efectivo = obtenerEstadoEfectivoMateria(fila.materia, fila.plan.id, estado.datos);
        clave = efectivo;
        const infoEstado = ESTADOS_MATERIA.find((e) => e.valor === efectivo);
        nombre = infoEstado ? infoEstado.texto : efectivo;
      } else {
        clave = String(fila.materia.bloque);
        nombre = `${fila.plan.parametros_universidad.nombre_bloque} ${fila.materia.bloque}`;
      }
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(fila);
      nombreGrupo.set(clave, nombre);
    });

    const clavesOrdenadas = Array.from(grupos.keys()).sort((a, b) => {
      if (estado.ordenPlanEstudios === "estado") {
        // Orden lógico (Pendiente → Cursando → Aprobada → Reprobada), no alfabético.
        const ia = ESTADOS_MATERIA.findIndex((e) => e.valor === a);
        const ib = ESTADOS_MATERIA.findIndex((e) => e.valor === b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      }
      const na = Number(a), nb = Number(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return String(nombreGrupo.get(a)).localeCompare(String(nombreGrupo.get(b)));
    });

    clavesOrdenadas.forEach((clave) => {
      const bloqueCard = document.createElement("section");
      bloqueCard.className = "glass-card bloque-card";

      const colapsado = estado.bloquesColapsados.has(clave);

      const encabezado = document.createElement("div");
      encabezado.className = "bloque-encabezado";
      encabezado.innerHTML = `<h3>${nombreGrupo.get(clave)}</h3><span style="opacity:0.7;">${colapsado ? "▼" : "▲"}</span>`;
      encabezado.addEventListener("click", () => {
        if (estado.bloquesColapsados.has(clave)) estado.bloquesColapsados.delete(clave);
        else estado.bloquesColapsados.add(clave);
        renderizarPlanEstudios();
      });
      bloqueCard.appendChild(encabezado);

      if (!colapsado) {
        const cuerpoBloque = document.createElement("div");
        cuerpoBloque.className = "stack";
        cuerpoBloque.style.marginTop = "12px";
        grupos.get(clave).forEach((fila) => {
          cuerpoBloque.appendChild(construirTarjetaMateria(fila, esEscritorio, cfg.modo_hardcore));
        });
        bloqueCard.appendChild(cuerpoBloque);
      }

      contenedor.appendChild(bloqueCard);
    });
  }

  // v1.12.15: "Optativas" y "Revisar" son 2 bloques especiales DISTINTOS —
  // ambos siempre al final, sin importar el orden activo, y SIN mezclarse
  // entre sí: primero la tarjeta de "Optativas", después la de "Revisar"
  // (punto 4 del prompt). "Optativas" combina las ya agregadas formalmente
  // (tarjeta completa, dato heredado de versiones anteriores) con las
  // detectadas y aún no agregadas (tarjeta simplificada + botón). "Revisar"
  // solo tiene detectadas-y-aún-no-agregadas (nunca hay una versión
  // "agregada formalmente" para Revisar: al vincularla, siempre pasa a un
  // bloque numerado real).
  if (filasOptativasAgregadas.length > 0 || disponibles.length > 0) {
    contenedor.appendChild(construirBloqueOptativas(filasOptativasAgregadas, disponibles, esEscritorio, cfg.modo_hardcore));
  }
  if (paraRevisar.length > 0) {
    contenedor.appendChild(construirBloqueRevisar(paraRevisar));
  }

  return contenedor;
}

/**
 * C.4 (v9): bloque especial "Optativas" — nunca participa del orden por
 * bloque/categoría/estado, siempre se dibuja al final. Muestra primero la
 * etiqueta "Electivas u optativas disponibles: N" + las tarjetas
 * simplificadas con botón "Agregar al plan de estudios", y debajo las que
 * ya fueron agregadas formalmente (tarjeta completa, igual que cualquier
 * otra materia — ya cuentan en los totales).
 */

function construirBloqueOptativas(filasAgregadas, filasDisponibles, esEscritorio, mostrarOrigen) {
  const bloqueCard = document.createElement("section");
  bloqueCard.className = "glass-card bloque-card";

  const clave = "__optativas__";
  const colapsado = estado.bloquesColapsados.has(clave);

  const encabezado = document.createElement("div");
  encabezado.className = "bloque-encabezado";
  encabezado.innerHTML = `<h3>Optativas</h3><span style="opacity:0.7;">${colapsado ? "▼" : "▲"}</span>`;
  encabezado.addEventListener("click", () => {
    if (estado.bloquesColapsados.has(clave)) estado.bloquesColapsados.delete(clave);
    else estado.bloquesColapsados.add(clave);
    renderizarPlanEstudios();
  });
  bloqueCard.appendChild(encabezado);

  if (!colapsado) {
    const cuerpoBloque = document.createElement("div");
    cuerpoBloque.className = "stack";
    cuerpoBloque.style.marginTop = "12px";

    if (filasDisponibles.length > 0) {
      const etiquetaDisponibles = document.createElement("p");
      etiquetaDisponibles.className = "muted";
      etiquetaDisponibles.textContent = `Electivas u optativas disponibles: ${filasDisponibles.length}`;
      cuerpoBloque.appendChild(etiquetaDisponibles);

      // v1.16 (fix bug de distinción visual): sin esta aclaración, esta
      // tarjeta se veía y actuaba exactamente igual que la de "Revisar" —
      // mismo layout, mismo botón — sin transmitir que aquí NO es obligatorio
      // agregar nada: son opciones que existen en el plan, elegís las que
      // querés cursar (podés no agregar ninguna).
      const aclaracionOpcional = document.createElement("p");
      aclaracionOpcional.className = "muted";
      aclaracionOpcional.style.fontSize = "0.85em";
      aclaracionOpcional.textContent = "Son opcionales: elegí las que vayas a cursar, no hace falta agregarlas todas.";
      cuerpoBloque.appendChild(aclaracionOpcional);

      filasDisponibles.forEach((fila) => {
        cuerpoBloque.appendChild(construirTarjetaOptativaDisponible(fila.materia, fila.plan));
      });
    }

    filasAgregadas.forEach((fila) => {
      cuerpoBloque.appendChild(construirTarjetaMateria(fila, esEscritorio, mostrarOrigen));
    });

    bloqueCard.appendChild(cuerpoBloque);
  }

  return bloqueCard;
}

/**
 * C.4 (v9): tarjeta simplificada de solo-lectura para una electiva
 * detectada pero todavía NO agregada al plan — nombre, código, créditos,
 * horas y requisitos/correquisitos (informativos), más el botón "+ Agregar
 * al plan de estudios". Mientras esté aquí no cuenta en ningún total (ver
 * obtenerOptativasDisponibles/obtenerMateriasVisibles).
 */

function construirTarjetaOptativaDisponible(materiaTemplate, plan) {
  const card = document.createElement("div");
  card.className = "glass-panel materia-card";

  const linea1 = document.createElement("div");
  linea1.className = "materia-linea1";
  linea1.style.cursor = "default";

  const prefijo = document.createElement("span");
  prefijo.className = "materia-prefijo";
  const spanCodigo = document.createElement("span");
  spanCodigo.className = "materia-codigo";
  spanCodigo.style.cursor = "default";
  spanCodigo.textContent = materiaTemplate.codigo;
  prefijo.appendChild(spanCodigo);
  linea1.appendChild(prefijo);

  const spanNombre = document.createElement("span");
  spanNombre.className = "materia-nombre completa";
  spanNombre.textContent = aplicarFormatoTexto(materiaTemplate.nombre);
  linea1.appendChild(spanNombre);
  card.appendChild(linea1);

  const linea2 = document.createElement("div");
  linea2.className = "materia-linea2";
  const spanHoras = document.createElement("span");
  spanHoras.className = "materia-linea2-horas";
  spanHoras.textContent = formatearHoras(materiaTemplate);
  linea2.appendChild(spanHoras);
  const badgeTipo = document.createElement("span");
  badgeTipo.className = "badge badge-accent";
  badgeTipo.style.opacity = "0.85";
  badgeTipo.textContent = "Opcional";
  linea2.appendChild(badgeTipo);
  const badgeCreditos = document.createElement("span");
  badgeCreditos.className = "badge badge-accent";
  badgeCreditos.textContent = `Créditos: ${materiaTemplate.creditos}`;
  linea2.appendChild(badgeCreditos);
  card.appendChild(linea2);

  const cuerpo = document.createElement("div");
  cuerpo.className = "materia-cuerpo stack";
  cuerpo.appendChild(construirBloqueCompletoRequisitos(materiaTemplate, plan));

  const btnAgregar = document.createElement("button");
  btnAgregar.type = "button";
  btnAgregar.className = "btn btn-secondary btn-block";
  // v1.12.15 (punto 5 del prompt): un solo botón, sin pill de Estado — abre
  // el modal de 2 formas (agregar a bloque / reemplazar por otra materia).
  // Ver abrirModalVincularOptativa en plan-esquema.js.
  // v1.16: texto propio ("Elegir") en vez de "Agregar al plan de estudios" —
  // antes era idéntico al botón de "Revisar", lo que hacía que ambos bloques
  // se sintieran como si fueran lo mismo.
  btnAgregar.textContent = "Elegir esta optativa";
  btnAgregar.addEventListener("click", () => abrirModalVincularOptativa(materiaTemplate, plan, "optativa"));
  cuerpo.appendChild(btnAgregar);

  card.appendChild(cuerpo);
  return card;
}

/**
 * v1.12.15: bloque especial "Revisar" — materias que el import no pudo
 * ubicar en un bloque numérico claro y que tampoco parecen electiva/
 * optativa (ver plan-importacion-csv.js). Nunca se dibuja en el Mapa
 * (plan-mapa.js) ni cuenta en totales/estadísticas mientras esté aquí (vive
 * en plan.materias_revisar, nunca en plan.materias). Siempre se muestra
 * DESPUÉS de "Optativas" en la Vista de Lista (punto 4 del prompt).
 */

function construirBloqueRevisar(filasParaRevisar) {
  const bloqueCard = document.createElement("section");
  bloqueCard.className = "glass-card bloque-card";

  const clave = "__revisar__";
  const colapsado = estado.bloquesColapsados.has(clave);

  const encabezado = document.createElement("div");
  encabezado.className = "bloque-encabezado";
  encabezado.innerHTML = `<h3>Revisar</h3><span style="opacity:0.7;">${colapsado ? "▼" : "▲"}</span>`;
  encabezado.addEventListener("click", () => {
    if (estado.bloquesColapsados.has(clave)) estado.bloquesColapsados.delete(clave);
    else estado.bloquesColapsados.add(clave);
    renderizarPlanEstudios();
  });
  bloqueCard.appendChild(encabezado);

  if (!colapsado) {
    const cuerpoBloque = document.createElement("div");
    cuerpoBloque.className = "stack";
    cuerpoBloque.style.marginTop = "12px";

    const etiqueta = document.createElement("p");
    etiqueta.className = "muted";
    etiqueta.textContent = `Materias sin bloque claro, pendientes de revisar: ${filasParaRevisar.length}`;
    cuerpoBloque.appendChild(etiqueta);

    // v1.16 (fix bug de distinción visual): a diferencia de "Optativas", esto
    // NO es opcional — son materias que el import detectó como parte real
    // del plan, solo que no se pudo determinar en qué bloque van. Sin esta
    // aclaración, la tarjeta se veía y actuaba idéntica a una optativa
    // opcional.
    const aclaracionObligatorio = document.createElement("p");
    aclaracionObligatorio.className = "muted";
    aclaracionObligatorio.style.fontSize = "0.85em";
    aclaracionObligatorio.style.color = "var(--color-warning, #f59e0b)";
    aclaracionObligatorio.textContent = "Estas SÍ son parte de tu plan — solo falta ubicarlas en el bloque correcto para que cuenten en tus totales.";
    cuerpoBloque.appendChild(aclaracionObligatorio);

    filasParaRevisar.forEach((fila) => {
      cuerpoBloque.appendChild(construirTarjetaParaRevisar(fila.materia, fila.plan));
    });

    bloqueCard.appendChild(cuerpoBloque);
  }

  return bloqueCard;
}

/**
 * v1.12.15: tarjeta simplificada de solo-lectura para una materia dentro del
 * bloque especial "Revisar" — mismo formato que
 * construirTarjetaOptativaDisponible (sin pill de Estado, un solo botón
 * "Agregar al plan de estudios", punto 5 del prompt).
 */

function construirTarjetaParaRevisar(materiaTemplate, plan) {
  const card = document.createElement("div");
  card.className = "glass-panel materia-card";

  const linea1 = document.createElement("div");
  linea1.className = "materia-linea1";
  linea1.style.cursor = "default";

  const prefijo = document.createElement("span");
  prefijo.className = "materia-prefijo";
  const spanCodigo = document.createElement("span");
  spanCodigo.className = "materia-codigo";
  spanCodigo.style.cursor = "default";
  spanCodigo.textContent = materiaTemplate.codigo;
  prefijo.appendChild(spanCodigo);
  linea1.appendChild(prefijo);

  const spanNombre = document.createElement("span");
  spanNombre.className = "materia-nombre completa";
  spanNombre.textContent = aplicarFormatoTexto(materiaTemplate.nombre);
  linea1.appendChild(spanNombre);
  card.appendChild(linea1);

  const linea2 = document.createElement("div");
  linea2.className = "materia-linea2";
  const spanHoras = document.createElement("span");
  spanHoras.className = "materia-linea2-horas";
  spanHoras.textContent = formatearHoras(materiaTemplate);
  linea2.appendChild(spanHoras);
  const badgeTipo = document.createElement("span");
  badgeTipo.className = "badge";
  badgeTipo.style.background = "var(--color-warning, #f59e0b)";
  badgeTipo.style.color = "#1a1a1a";
  badgeTipo.textContent = "Revisar";
  linea2.appendChild(badgeTipo);
  const badgeCreditos = document.createElement("span");
  badgeCreditos.className = "badge badge-accent";
  badgeCreditos.textContent = `Créditos: ${materiaTemplate.creditos}`;
  linea2.appendChild(badgeCreditos);
  card.appendChild(linea2);

  const cuerpo = document.createElement("div");
  cuerpo.className = "materia-cuerpo stack";
  cuerpo.appendChild(construirBloqueCompletoRequisitos(materiaTemplate, plan));

  const btnAgregar = document.createElement("button");
  btnAgregar.type = "button";
  btnAgregar.className = "btn btn-secondary btn-block";
  // v1.16: texto propio ("Ubicar en mi plan") en vez de "Agregar al plan de
  // estudios" — antes era idéntico al botón de "Optativas", lo que hacía que
  // ambos bloques se sintieran como si fueran lo mismo (una opción para
  // elegir), cuando en realidad esta materia ya es parte confirmada del plan.
  btnAgregar.textContent = "Ubicar en mi plan";
  btnAgregar.addEventListener("click", () => abrirModalVincularOptativa(materiaTemplate, plan, "revisar"));
  cuerpo.appendChild(btnAgregar);

  card.appendChild(cuerpo);
  return card;
}

/**
 * Ajuste (2026-08-02 — "para evitar que el usuario haga más cambios cuando
 * hay choque de versiones, y que en el teléfono no se rompa"): antes cada
 * entidad en conflicto mostraba un badge de TEXTO "⚠️ Editado en 2
 * dispositivos" metido en la fila — competía por espacio con el resto del
 * contenido y en pantallas angostas rompía el layout. Ahora se monta un
 * overlay invisible sobre TODA la tarjeta (position:absolute, inset:0 — no
 * empuja ni mueve nada de lo que ya está dibujado debajo) con un solo ⚠️
 * centrado flotando encima. El overlay intercepta CUALQUIER clic dentro de
 * la tarjeta y abre el modal de resolución — a propósito: mientras hay un
 * choque sin resolver, no tiene sentido dejar seguir editando esa entidad,
 * podría perderse la versión alterna sin que la persona llegara a verla.
 * `cardEl` debe ser el contenedor de la tarjeta completa; si no tiene ya
 * position relative/absolute/fixed, se lo fuerza a "relative" para que el
 * overlay quede centrado respecto a la tarjeta y no respecto a la página.
 */
function agregarIndicadorConflicto(cardEl, onResolver) {
  if (getComputedStyle(cardEl).position === "static") cardEl.style.position = "relative";

  const overlay = document.createElement("div");
  overlay.className = "overlay-indicador-conflicto";
  overlay.style.cssText =
    "position:absolute; inset:0; display:flex; align-items:center; justify-content:center; " +
    "cursor:pointer; z-index:5; border-radius:inherit;";
  overlay.title = "Se cambió de forma distinta en dos dispositivos. Toca para elegir cuál dejar.";

  const emoji = document.createElement("span");
  emoji.textContent = "⚠️";
  emoji.style.cssText = "font-size:1.4rem; filter:drop-shadow(0 1px 4px rgba(0,0,0,0.6));";
  overlay.appendChild(emoji);

  overlay.addEventListener("click", (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    onResolver();
  });

  cardEl.appendChild(overlay);
}

const ESTADOS_MATERIA = [
  { valor: "pendiente", texto: "Pendiente", badge: "badge-neutral" },
  { valor: "cursando", texto: "Cursando", badge: "badge-warning" },
  { valor: "aprobado", texto: "Aprobada", badge: "badge-success" },
  { valor: "reprobado", texto: "Reprobada", badge: "badge-danger" },
];

/**
 * D/E/F (2026-08-02): "Cursando" salió de las opciones que la persona puede
 * elegir a mano — ahora se deriva solo (ver obtenerEstadoEfectivoMateria en
 * schema.js) de si la materia está matriculada en un semestre actual, así
 * que nunca puede quedar manualmente marcada como "Cursando" sin estarlo de
 * verdad. El pill group de la tarjeta del Plan usa esta lista recortada;
 * ESTADOS_MATERIA completo se sigue usando para los badges/agrupaciones que
 * sí necesitan mostrar las 4 opciones (incluida la derivada).
 */
const ESTADOS_MATERIA_MANUALES = ESTADOS_MATERIA.filter((e) => e.valor !== "cursando");

function estaExpandida(codigo, esEscritorio) {
  if (estado.materiasExpandidas.has(codigo)) return estado.materiasExpandidas.get(codigo);
  return esEscritorio;
}

/**
 * Encabezado FINAL de 2 líneas (v5 #4/#5) — reemplaza el diseño v4 de una
 * sola fila con badge de Categoría visible.
 * Línea 1: Luz · Código · Nombre (con flecha de expandir/colapsar al final).
 * Línea 2: Estado (pegado a la izquierda) · Créditos (pegado a la derecha).
 * La Categoría NO aparece en ningún lado del encabezado — solo la franja
 * lateral de color (card.style.borderLeft) la indica. Luz y horas ya no van
 * sueltas/a la derecha: la luz vive en la línea 1, las horas se movieron al
 * detalle expandido (junto con la categoría en texto, para no perder la
 * función de reasignar categoría con mantener-presionado).
 */

function construirTarjetaMateria(fila, esEscritorio, mostrarOrigen) {
  const { materia, plan } = fila;
  const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);
  const disponible = materiaDisponible(materia, plan.materias);
  const expandida = estaExpandida(materia.codigo, esEscritorio);

  const card = document.createElement("div");
  card.className = "glass-panel materia-card" + (estado.modoEdicionPlan ? " modo-edicion-activa" : "");
  if (categoria) card.style.borderLeft = `6px solid ${categoria.color}`;

  // Punto 6 (v1.9.6): lápiz de edición — la visibilidad la controla el CSS
  // (.modo-edicion-activa .materia-editar-lapiz), así que solo hace falta
  // crearlo siempre; nunca queda huérfano al alternar el modo porque toda
  // la sección se vuelve a renderizar en alternarModoEdicionPlan().
  const lapizEditar = document.createElement("span");
  lapizEditar.className = "materia-editar-lapiz";
  lapizEditar.textContent = "✏️";
  lapizEditar.title = "Editar esta materia";
  lapizEditar.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalMateriaManual(materia, plan);
  });
  card.appendChild(lapizEditar);

  const filaPrincipal = document.createElement("div");
  filaPrincipal.className = "materia-fila-principal";
  filaPrincipal.addEventListener("click", () => {
    estado.materiasExpandidas.set(materia.codigo, !expandida);
    renderizarPlanEstudios();
  });

  // ---- Línea 1: luz · código · nombre (prefijo de ancho fijo, flotante,
  // para la indentación colgante real — ver .materia-prefijo / .materia-nombre.completa) ----
  const linea1 = document.createElement("div");
  linea1.className = "materia-linea1";

  const prefijo = document.createElement("span");
  prefijo.className = "materia-prefijo";

  // Ajuste v4 #3 / v5 #4: candado -> "luz" (encendida = disponible, apagada
  // = bloqueada). +50% de glow y fix de contraste en modo oscuro ya están
  // en design-system.css (.luz-punto.disponible / [data-mode="dark"] .luz-punto.bloqueada).
  const luzDisponibilidad = document.createElement("span");
  luzDisponibilidad.className = "luz-punto " + (disponible ? "disponible" : "bloqueada");
  luzDisponibilidad.title = disponible ? "Disponible" : "Bloqueada";
  prefijo.appendChild(luzDisponibilidad);

  const spanCodigo = document.createElement("span");
  spanCodigo.className = "materia-codigo";
  spanCodigo.textContent = materia.codigo;
  spanCodigo.title = "Clic: ver detalle · Mantén presionado (o clic derecho): cambiar categoría";
  // v8 punto 2 / B (v9): clic en el Código abre la ventana de detalle
  // unificada de esta materia — igual que al hacer clic en un requisito.
  spanCodigo.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalRequisito(materia.codigo);
  });
  agregarLongPress(spanCodigo, () => abrirMenuRapidoCategoria(materia, plan, spanCodigo));
  prefijo.appendChild(spanCodigo);

  linea1.appendChild(prefijo);

  const spanNombre = document.createElement("span");
  // Colapsada: trunca con "…". Expandida: nombre completo con indentación
  // colgante REAL (Bug 4 v8) — .materia-prefijo flota a la izquierda dentro
  // del mismo flujo de texto que este span, así que el navegador ya
  // resuelve el ajuste de línea 1 alrededor del float de forma nativa, y
  // padding-left/text-indent (en CSS) alinean las líneas siguientes.
  spanNombre.className = "materia-nombre " + (expandida ? "completa" : "truncada");
  spanNombre.textContent = aplicarFormatoTexto(materia.nombre);
  linea1.appendChild(spanNombre);

  const iconoExpandir = document.createElement("span");
  iconoExpandir.className = "materia-expandir";
  iconoExpandir.textContent = expandida ? "▲" : "▼";
  linea1.appendChild(iconoExpandir);

  filaPrincipal.appendChild(linea1);

  // ---- Línea 2 (v8 punto 2): Estado (izq) · Horas (centro) · Créditos (der).
  // Colapsada usa iniciales compactas de horas; expandida, palabra completa.
  const linea2 = construirLinea2Materia(materia, !expandida, plan);
  filaPrincipal.appendChild(linea2);

  // Pedido explícito (2026-08-03): se quita el badge Principal/Secundario —
  // `mostrarOrigen` se deja como parámetro (lo sigue pasando el llamador en
  // construirBloqueOptativas) para no tocar esa firma, pero ya no se usa acá.

  // FIX sync (conflicto real sin resolver): si esta materia se editó de
  // forma distinta en dos dispositivos a partir de la misma versión
  // (ver hayConflictoReal en storage-merge.js), queda marcada con
  // materia._conflicto — pero eso solo vivía en los datos, nunca se le
  // mostraba a la persona. Sin este badge, el conflicto se re-marcaba en
  // cada sync sin que nadie pudiera resolverlo (ni reiniciando la app, ver
  // conversación 2026-07-30), porque solo resolverConflicto() vuelve a
  // sellar la entidad con una base limpia y rompe el ciclo. Se muestra
  // SIEMPRE (tarjeta colapsada o no) para que no pase desapercibido.
  if (materia._conflicto) {
    agregarIndicadorConflicto(card, () => abrirModalResolverConflicto(materia, plan));
  }

  card.appendChild(filaPrincipal);

  if (expandida) {
    const cuerpo = document.createElement("div");
    cuerpo.className = "materia-cuerpo stack";

    // v1.9.8: desde acá se arma el diseño EXCLUSIVO de la tarjeta de lista
    // (grid de 2 columnas: Requisitos/Correquisitos a la izquierda,
    // Categoría + "Es requisito" + "Historial" a la derecha) — ya no es el
    // mismo layout que usa el modal (ver plan-detalle.js). Las horas ya no
    // van sueltas en el cuerpo: viven en la Línea 2 del encabezado, arriba.
    cuerpo.appendChild(construirCuerpoDetalleMateria(materia, plan, { modo: "tarjeta" }));

    const grupoEstado = document.createElement("div");
    grupoEstado.className = "pill-group";
    ESTADOS_MATERIA_MANUALES.forEach((e) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-item" + (materia.estado === e.valor ? " active" : "");
      btn.textContent = e.texto;
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        materia.estado = e.valor; // siempre manual, nunca automático
        // FIX CRÍTICO: sin esto, esta edición nunca tenía un _actualizadoEn
        // real (ver comentario en sellarTimestamp, core/schema.js) y la
        // fusión con el otro dispositivo nunca detectaba que este cambio
        // era el más reciente — por eso no llegaba de un dispositivo al
        // otro sin importar cuánto se esperara.
        sellarTimestamp(materia);
        marcarCambioPendiente();
        renderizarPlanEstudios();
      });
      grupoEstado.appendChild(btn);
    });
    cuerpo.appendChild(grupoEstado);
    // Bug 3 (v8): respaldo de scroll horizontal + flechitas si los 4 pills
    // de Estado no caben en una fila (pantallas muy angostas) — nunca se
    // acomodan en 2 líneas ni en grid 2x2.
    envolverConFlechasScroll(grupoEstado);

    card.appendChild(cuerpo);
  }

  return card;
}

/* ===================== Resolución de conflictos reales ===================== */

/** Etiqueta humana de un campo de materia para mostrar en el comparador de
 *  conflicto — solo traduce lo que realmente puede diferir entre las dos
 *  versiones en pantalla (estado, categoría, nota/override); cualquier otro
 *  campo se muestra tal cual con su nombre técnico como respaldo. */
function etiquetaCampoConflicto(campo, valor, plan) {
  if (campo === "estado") {
    const info = ESTADOS_MATERIA.find((e) => e.valor === valor);
    return info ? info.texto : String(valor);
  }
  if (campo === "categoria_id") {
    if (!valor) return "Sin categoría";
    const cat = plan.categorias.find((c) => c.id === valor);
    return cat ? cat.nombre : valor;
  }
  if (valor === null || valor === undefined) return "—";
  if (typeof valor === "object") {
    try { return JSON.stringify(valor); } catch (e) { return String(valor); }
  }
  return String(valor);
}

const CAMPOS_META_CONFLICTO = new Set([
  "_conflicto", "_version_alterna", "_actualizadoEn", "_version_base", "_dispositivoId",
  // FIX sync (2026-08-02 — JSON ilegible en el modal de conflicto de
  // semestre): este modal genérico se reutiliza para materia, mm, criterio
  // y semestre — cada uno puede traer UNA colección anidada propia
  // (materias_matriculadas en semestre, criterios en mm, asignaciones en
  // criterio) que YA se funde aparte con su propio detector de conflicto
  // por elemento (ver storage-merge.js). Compararla acá, a nivel plano,
  // solo puede dar dos resultados igual de malos: mostrar un
  // JSON.stringify() completo e ilegible del array (lo que reportó el
  // usuario), o marcarla como "distinta" por simple ausencia en una de las
  // dos versiones (ver fusionarSemestre) cuando en realidad nunca hubo
  // choque en esos elementos. Ninguna de las entidades que usan este modal
  // necesita mostrar su colección anidada acá: si esa colección SÍ tiene un
  // conflicto real propio, se resuelve con su propio modal (uno por mm o
  // por criterio), no con el de su padre.
  "materias_matriculadas", "_eliminados_materias_matriculadas",
  "criterios", "_eliminados_criterios",
  "asignaciones", "_eliminados_asignaciones",
]);

/** Arma la lista de campos que realmente difieren entre las dos versiones en
 *  conflicto (para no mostrarle a la persona un comparador con 15 campos
 *  idénticos cuando solo cambió, por ejemplo, el Estado). */
function camposEnConflicto(local, alterna) {
  const llaves = new Set([...Object.keys(local), ...Object.keys(alterna)]);
  const diferentes = [];
  llaves.forEach((campo) => {
    if (CAMPOS_META_CONFLICTO.has(campo)) return;
    // FIX sync (2026-08-09, mismo bug que hayConflictoReal en
    // storage-merge.js): comparar con JSON.stringify campo por campo tiene
    // el mismo problema a nivel de un solo campo — un objeto anidado con
    // las llaves en otro orden, o un arreglo de ids en otro orden (ej.
    // profesor_ids), se veía como "diferente" en este comparador aunque el
    // contenido fuera exactamente igual. Se usa la misma igualdad profunda
    // que ya decide si el conflicto es real, para que la lista de campos
    // que se le muestra a la persona nunca incluya algo que en realidad es
    // idéntico.
    if (!sonValoresEquivalentes(local[campo], alterna[campo])) diferentes.push(campo);
  });
  return diferentes;
}

/**
 * Entrega 3 (Semestres y Notas): versión genérica del modal de resolución
 * de conflicto real (ver hayConflictoReal en storage-merge.js), extraída de
 * lo que antes era abrirModalResolverConflicto de aquí abajo, para que
 * semestres-tarjetas.js pueda reutilizarla tal cual con materia-matriculada
 * y criterio — ahora que ambos también pasan por marcarConflictoSiCorresponde
 * (ver storage-merge.js) en vez de que la fusión elija un ganador a ciegas.
 * Se construye 100% en JS (sin depender de markup nuevo en index.html,
 * igual que abrirMenuRapidoCategoria) porque es la única pieza que faltaba
 * para que un conflicto real deje de quedar atascado para siempre: hasta
 * que la persona elige una versión, cada sync lo vuelve a marcar contra la
 * misma base vieja sin avanzar (ni un reinicio lo arregla solo). Elegir acá
 * llama a resolverConflicto(), que resella la entidad con un _version_base
 * limpio — eso es lo que rompe el ciclo.
 *
 * `entidad` es el objeto con `_conflicto: true` tal como se veía al abrir el
 * modal — se usa SOLO para pintar el contenido inicial (título, campos
 * distintos). `obtenerFresca` es obligatoria: una función que, en el momento
 * exacto del clic, vuelve a buscar la entidad VIVA dentro de estado.datos
 * (por id) y la muta in-place. Esto es necesario porque `estado.datos` se
 * REEMPLAZA por un objeto nuevo en cada sync (sondeo cada 9s, pull-to-
 * refresh, o cualquier guardado — ver aplicarDatosRemotosFrescos en
 * storage-sync.js: `estado.datos = fusionarDatos(...)`). Si el modal queda
 * abierto más de 9s y el sondeo trae un cambio remoto mientras tanto, la
 * referencia `entidad` capturada al abrir el modal queda huérfana — mutarla
 * no toca nada de lo que en verdad está en `estado.datos`, así que el clic
 * "se pierde" en silencio (bug real reportado: "a veces sí, a veces no").
 * Fix (2026-08-02): en vez de mutar la referencia vieja, se busca la
 * entidad fresca justo antes de resolver.
 * `onResuelto` reemplaza la llamada fija a renderizarPlanEstudios() para
 * que cada pantalla refresque lo que le corresponde.
 */
/**
 * Aplica la resolución de un conflicto ("local" o "alterna") directamente
 * sobre la entidad viva, sin pasar por ningún modal — es la misma lógica que
 * antes vivía adentro de `elegir()` en abrirModalResolverConflictoGenerico,
 * extraída para que "resolver todos a la vez" (ver el modal global en
 * semestres-tarjetas.js) pueda reutilizarla exactamente igual, campo por
 * campo, en vez de reimplementar el mismo mutado a ciegas en otro archivo.
 * Nunca muta la referencia capturada al listar los conflictos — siempre
 * busca la copia viva con `obtenerFresca()` en el momento del clic, por la
 * misma razón documentada arriba (estado.datos se reemplaza por completo en
 * cada sync). Devuelve true si resolvió algo, false si no había nada que
 * resolver (ya se había resuelto o la entidad ya no existe).
 */
function resolverConflictoDirecto({ obtenerFresca, cual }) {
  const viva = obtenerFresca();
  if (!viva) return false; // se borró desde el otro dispositivo mientras tanto
  if (!viva._conflicto) return false; // ya se resolvió por otro medio (ej. sync entre medio)

  const resuelta = resolverConflicto(viva, cual, sellarTimestamp);
  Object.keys(viva).forEach((k) => delete viva[k]);
  Object.assign(viva, resuelta);
  marcarCambioPendiente();
  return true;
}

function abrirModalResolverConflictoGenerico({ entidad, plan, titulo, explicacion, onResuelto, obtenerFresca }) {
  document.querySelectorAll(".overlay-resolver-conflicto").forEach((el) => el.remove());

  const alterna = entidad._version_alterna || {};
  const diferentes = camposEnConflicto(entidad, alterna);

  const overlay = document.createElement("div");
  overlay.className = "overlay-resolver-conflicto";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " +
    "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:420px; width:100%; padding:18px; max-height:80vh; overflow-y:auto;";
  caja.addEventListener("click", (ev) => ev.stopPropagation());

  const tituloEl = document.createElement("h3");
  tituloEl.style.cssText = "margin:0 0 4px;";
  tituloEl.textContent = titulo || "⚠️ Edición en dos dispositivos";
  caja.appendChild(tituloEl);

  const explicacionEl = document.createElement("p");
  explicacionEl.style.cssText = "font-size:0.85rem; opacity:0.85; margin:0 0 12px;";
  explicacionEl.textContent =
    explicacion ||
    "Esto se editó de forma distinta en dos dispositivos antes de que sincronizaran entre sí. Elegí cuál versión dejar — la otra se descarta.";
  caja.appendChild(explicacionEl);

  if (diferentes.length === 0) {
    const sinDiferencias = document.createElement("p");
    sinDiferencias.style.cssText = "font-size:0.85rem; opacity:0.7;";
    sinDiferencias.textContent = "No se detectaron diferencias visibles — es seguro dejar cualquiera de las dos.";
    caja.appendChild(sinDiferencias);
  } else {
    // Ajuste (2026-08-02 — "necesito que haya una versión más accesible
    // para que el usuario sepa cuál es cuál"): antes cada campo distinto se
    // veía comprimido en una sola línea "valorLocal → valorAlterna", sin
    // etiqueta de cuál lado era cuál hasta cruzar mentalmente contra los
    // botones de abajo. Ahora cada campo es su propio bloque, con las DOS
    // versiones en líneas separadas y etiquetadas — mismas etiquetas que
    // usan los botones de elegir, para que no haga falta adivinar.
    const tabla = document.createElement("div");
    tabla.className = "stack";
    tabla.style.cssText = "font-size:0.82rem; margin-bottom:14px; gap:10px;";
    diferentes.forEach((campo) => {
      const bloque = document.createElement("div");
      bloque.style.cssText = "padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.08);";

      const nombreCampo = document.createElement("div");
      nombreCampo.style.cssText = "opacity:0.65; text-transform:capitalize; margin-bottom:4px;";
      nombreCampo.textContent = campo.replace(/_/g, " ");
      bloque.appendChild(nombreCampo);

      const filaLocal = document.createElement("div");
      filaLocal.style.cssText = "display:flex; justify-content:space-between; gap:10px; padding:2px 0;";
      filaLocal.innerHTML = `<span style="opacity:0.7;">📍 Este dispositivo</span><span style="font-weight:600;"></span>`;
      filaLocal.lastElementChild.textContent = etiquetaCampoConflicto(campo, entidad[campo], plan);
      bloque.appendChild(filaLocal);

      const filaAlterna = document.createElement("div");
      filaAlterna.style.cssText = "display:flex; justify-content:space-between; gap:10px; padding:2px 0;";
      filaAlterna.innerHTML = `<span style="opacity:0.7;">📱 El otro dispositivo</span><span style="font-weight:600;"></span>`;
      filaAlterna.lastElementChild.textContent = etiquetaCampoConflicto(campo, alterna[campo], plan);
      bloque.appendChild(filaAlterna);

      tabla.appendChild(bloque);
    });
    caja.appendChild(tabla);
  }

  const elegir = (cual) => {
    resolverConflictoDirecto({ obtenerFresca, cual });
    overlay.remove();
    onResuelto();
  };

  const btnLocal = document.createElement("button");
  btnLocal.type = "button";
  btnLocal.className = "btn btn-secondary btn-block";
  btnLocal.textContent = "📍 Usar este dispositivo";
  btnLocal.addEventListener("click", () => elegir("local"));
  caja.appendChild(btnLocal);

  const btnAlterna = document.createElement("button");
  btnAlterna.type = "button";
  btnAlterna.className = "btn btn-secondary btn-block";
  btnAlterna.style.marginTop = "6px";
  btnAlterna.textContent = "📱 Usar el otro dispositivo";
  btnAlterna.addEventListener("click", () => elegir("alterna"));
  caja.appendChild(btnAlterna);

  overlay.appendChild(caja);
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

/** Caso particular de abrirModalResolverConflictoGenerico para una materia del plan.
 *  `onResueltoExtra` (opcional): además del refresco fijo de siempre
 *  (renderizarPlanEstudios), permite que quien llama enganche un refresco
 *  propio — lo usa el modal global "ver todos los choques" en
 *  semestres-tarjetas.js para actualizarse a sí mismo tras resolver una fila. */
function abrirModalResolverConflicto(materia, plan, onResueltoExtra) {
  const planId = plan.id;
  const materiaId = materia.id;
  abrirModalResolverConflictoGenerico({
    entidad: materia,
    plan,
    titulo: "⚠️ Edición en dos dispositivos",
    explicacion:
      `"${aplicarFormatoTexto(materia.nombre)}" (${materia.codigo}) se editó de forma distinta en dos ` +
      "dispositivos antes de que sincronizaran entre sí. Elegí cuál versión dejar — la otra se descarta.",
    onResuelto: () => {
      renderizarPlanEstudios();
      if (onResueltoExtra) onResueltoExtra();
    },
    obtenerFresca: () => {
      const planVivo = (estado.datos.planes_estudio || []).find((p) => p.id === planId);
      if (!planVivo) return null;
      return (planVivo.materias || []).find((m) => m.id === materiaId) || null;
    },
  });
}

/** Ajuste v4 #7: menú rápido (lista de categorías del plan) para reasignar
 *  la categoría de una materia puntual, sin entrar al flujo completo de
 *  edición de categoría. Se muestra como un pequeño popover junto al badge. */

function abrirMenuRapidoCategoria(materia, plan, anclaEl) {
  document.querySelectorAll(".popover-categoria-rapida").forEach((el) => el.remove());

  const pop = document.createElement("div");
  pop.className = "glass-card stack popover-categoria-rapida";
  pop.style.cssText = "position:fixed; z-index:200; padding:8px; min-width:160px;";
  const rect = anclaEl.getBoundingClientRect();
  pop.style.top = `${rect.bottom + 6}px`;
  pop.style.left = `${Math.max(8, rect.left)}px`;

  const opciones = [{ id: null, nombre: "Sin categoría" }, ...plan.categorias];
  opciones.forEach((cat) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "btn btn-secondary btn-block";
    item.style.cssText = "text-align:left; padding:6px 10px; font-size:0.85rem;";
    item.textContent = cat.nombre;
    item.addEventListener("click", () => {
      materia.categoria_id = cat.id;
      sellarTimestamp(materia);
      marcarCambioPendiente();
      pop.remove();
      renderizarPlanEstudios();
    });
    pop.appendChild(item);
  });

  document.body.appendChild(pop);
  // v1.12: antes el listener de "clic afuera cierra" se enganchaba con
  // setTimeout(0) — en móvil, el propio gesto de mantener presionado suele
  // terminar en un "click fantasma" (touchend -> click) que dispara
  // prácticamente en el mismo tick, así que el popover se cerraba solo
  // antes de que a la persona le diera tiempo de tocar una opción. 300ms es
  // más que suficiente para dejar pasar ese click fantasma sin que la
  // apertura del popover se sienta lenta.
  setTimeout(() => {
    document.addEventListener("click", function cerrar(e) {
      if (!pop.contains(e.target)) {
        pop.remove();
        document.removeEventListener("click", cerrar);
      }
    });
  }, 300);
}

export {
  ESTADOS_MATERIA,
  abrirMenuRapidoCategoria,
  abrirModalResolverConflicto,
  abrirModalResolverConflictoGenerico,
  resolverConflictoDirecto,
  agregarIndicadorConflicto,
  construirBloqueOptativas,
  construirContenidoBloques,
  construirTarjetaMateria,
  construirTarjetaOptativaDisponible,
  estaExpandida,
  materiaDisponible,
  obtenerMateriasQueDesbloquea,
};
