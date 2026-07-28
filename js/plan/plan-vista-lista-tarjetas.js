/* =========================================================================
   PLAN DE ESTUDIOS — VISTA DE LISTA (bloques y tarjetas)
   Candado de disponibilidad, bloques colapsables y la tarjeta de materia
   completa (encabezado, requisitos, menú rápido de categoría).
   ========================================================================= */

import { arbolContieneCodigo, evaluarNodoRequisito } from "../core/schema.js";
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
        clave = fila.materia.estado;
        const infoEstado = ESTADOS_MATERIA.find((e) => e.valor === fila.materia.estado);
        nombre = infoEstado ? infoEstado.texto : fila.materia.estado;
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
  btnAgregar.textContent = "Agregar al plan de estudios";
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
  btnAgregar.textContent = "Agregar al plan de estudios";
  btnAgregar.addEventListener("click", () => abrirModalVincularOptativa(materiaTemplate, plan, "revisar"));
  cuerpo.appendChild(btnAgregar);

  card.appendChild(cuerpo);
  return card;
}

const ESTADOS_MATERIA = [
  { valor: "pendiente", texto: "Pendiente", badge: "badge-neutral" },
  { valor: "cursando", texto: "Cursando", badge: "badge-warning" },
  { valor: "aprobado", texto: "Aprobada", badge: "badge-success" },
  { valor: "reprobado", texto: "Reprobada", badge: "badge-danger" },
];

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
  const linea2 = construirLinea2Materia(materia, !expandida);
  filaPrincipal.appendChild(linea2);

  if (mostrarOrigen) {
    const badgeOrigen = document.createElement("span");
    badgeOrigen.className = "badge badge-neutral";
    badgeOrigen.style.fontSize = "0.68rem";
    badgeOrigen.textContent = fila.origen === "principal" ? "Principal" : "Secundario";
    linea2.appendChild(badgeOrigen);
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
    ESTADOS_MATERIA.forEach((e) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-item" + (materia.estado === e.valor ? " active" : "");
      btn.textContent = e.texto;
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        materia.estado = e.valor; // siempre manual, nunca automático
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
  construirBloqueOptativas,
  construirContenidoBloques,
  construirTarjetaMateria,
  construirTarjetaOptativaDisponible,
  estaExpandida,
  materiaDisponible,
  obtenerMateriasQueDesbloquea,
};
