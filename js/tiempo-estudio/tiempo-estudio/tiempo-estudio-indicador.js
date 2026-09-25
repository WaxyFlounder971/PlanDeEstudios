/* =========================================================================
   TIEMPO DE ESTUDIO — Indicador de sesión activa (rediseño 2026-09-19)
   -------------------------------------------------------------------------
   Reemplaza al badge fijo "⏱ IC-1010 · Cálculo I · 12:34" de la esquina
   inferior izquierda, que tapaba el perfil de la barra lateral y se veía
   como un parche. Ahora la MISMA información vive en el lugar que le toca a
   cada tamaño de pantalla (el CSS decide cuál se ve, ver design-system.css,
   sección "Tiempo de Estudio"):

     · >= 1500px  → tarjeta anclada al fondo de la columna derecha
                    (#timer-tarjeta-lateral, variante --lateral)
     · 900–1499px → tarjeta flotante abajo a la derecha, sobre el botón de
                    Enlaces rápidos (#badge-tiempo-estudio, variante
                    --flotante) — no hay columna derecha en ese rango
     · < 900px    → segunda línea bajo "App Académica" en la barra superior
                    (#timer-linea-topbar, variante --linea)

   Diseño: una lucecita que parpadea del COLOR DE LA MATERIA (el mismo que ya
   usa Horario/Agenda, ver obtenerColorMateria en tiempo-estudio.js), el
   nombre de la materia SIN código, y el tiempo. En pausa la luz se queda
   fija y se agrega "En pausa"; en un descanso de Pomodoro, "Descanso".

   Este archivo es DOM puro: no importa nada del resto de la app. Quién es la
   materia, su color y el texto del tiempo se los da tiempo-estudio.js por
   `resolverInfo` — así se puede probar con el CSS real sin levantar la app.
   ========================================================================= */

const COLOR_POR_DEFECTO = "var(--accent-1)";

function esColorHex(valor) {
  return typeof valor === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(valor.trim());
}

function crearSpan(clase, texto) {
  const s = document.createElement("span");
  s.className = clase;
  if (texto !== undefined) s.textContent = texto;
  return s;
}

/**
 * Arma la estructura interna de un indicador (idéntica en las 3 variantes;
 * lo que cambia entre ellas es solo el CSS). Devuelve las referencias que
 * después se actualizan cada segundo — así el tick solo toca `textContent`,
 * nunca reconstruye nodos.
 */
function construirContenidoIndicador(el) {
  el.classList.add("timer-indicador");
  el.textContent = "";

  const luz = crearSpan("timer-luz");
  luz.setAttribute("aria-hidden", "true");

  const materia = crearSpan("timer-materia");
  const separador = crearSpan("timer-sep", "·");
  separador.setAttribute("aria-hidden", "true");
  const tiempo = crearSpan("timer-tiempo");
  tiempo.setAttribute("aria-hidden", "true"); // cambia cada segundo: no se anuncia
  const estado = crearSpan("timer-estado");

  const fila = crearSpan("timer-fila-tiempo");
  fila.append(tiempo, estado);
  const textos = crearSpan("timer-textos");
  textos.append(materia, separador, fila);

  el.append(luz, textos);
  return { materia, tiempo, estado };
}

function actualizarTexto(nodo, texto) {
  if (nodo.textContent !== texto) nodo.textContent = texto;
}

function pintarUno(indicador, info) {
  const { el, refs, ultimo } = indicador;

  el.classList.remove("oculto");
  el.classList.toggle("timer-en-pausa", Boolean(info.pausado));

  const color = esColorHex(info.color) ? info.color.trim() : COLOR_POR_DEFECTO;
  if (ultimo.color !== color) {
    el.style.setProperty("--te-color", color);
    ultimo.color = color;
  }

  actualizarTexto(refs.materia, info.nombre);
  actualizarTexto(refs.tiempo, info.tiempo);
  actualizarTexto(refs.estado, info.estado || "");
  refs.estado.hidden = !info.estado;

  // Etiqueta accesible: solo cambia con la materia/estado, no cada segundo.
  const etiqueta = `Estudiando ${info.nombre}${info.estado ? `, ${info.estado.toLowerCase()}` : ""}. Abrir la materia`;
  if (ultimo.etiqueta !== etiqueta) {
    el.setAttribute("aria-label", etiqueta);
    el.title = "Ir a la materia para ver, pausar o detener la sesión";
    ultimo.etiqueta = etiqueta;
  }
}

/**
 * Conecta los elementos del indicador y devuelve la función `pintar(activo)`
 * que hay que pasarle a `suscribirseATimer`. Los elementos que no existan
 * en el HTML (`null`) se ignoran, así que el módulo tolera un index.html
 * viejo sin romper nada. Devuelve `null` si no encontró ninguno.
 *
 * @param {Object} opciones
 * @param {Array<HTMLElement|null>} opciones.elementos  los 3 contenedores
 * @param {(activo:Object)=>{nombre:string,color:string,tiempo:string,pausado:boolean,estado:string}} opciones.resolverInfo
 * @param {()=>void} opciones.alTocar  navegar al detalle de la materia
 */
function montarIndicadoresTimer({ elementos, resolverInfo, alTocar }) {
  const indicadores = elementos
    .filter(Boolean)
    .map((el) => ({ el, refs: construirContenidoIndicador(el), ultimo: {} }));
  if (indicadores.length === 0) return null;

  indicadores.forEach(({ el }) => el.addEventListener("click", alTocar));

  return function pintar(activo) {
    if (!activo) {
      indicadores.forEach(({ el, ultimo }) => {
        el.classList.add("oculto");
        el.classList.remove("timer-en-pausa");
        ultimo.etiqueta = undefined;
      });
      return;
    }
    const info = resolverInfo(activo);
    indicadores.forEach((indicador) => pintarUno(indicador, info));
  };
}

export { montarIndicadoresTimer, esColorHex };
