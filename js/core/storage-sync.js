/* =========================================================================
   SINCRONIZACIÓN CON GOOGLE DRIVE
   Motor de sincronización: reconexión silenciosa, refresco proactivo del
   token, reintento automático tras 401, pull-to-refresh, sondeo periódico
   multi-dispositivo, subida/bajada de datos y el indicador de estado.
   ========================================================================= */

import { renderizarAjustes } from "../config/config-ajustes.js";
import { renderizarEnlacesRapidos } from "../config/config-enlaces.js";
import { renderizarPerfil } from "../main.js";
import { renderizarModoHardcore, renderizarSelectorPlan } from "../plan/plan-gestionar.js";
import { renderizarPlanEstudios } from "../plan/plan-vista-lista.js";
import { renderizarSemestres } from "../semestres/semestres.js";
import { abrirModalTodosLosConflictos } from "../semestres/semestres-tarjetas.js";
import { renderizarFinanzas } from "../finanzas/finanzas.js";
import { mostrarToast } from "../ui/componentes.js";
import { aplicarPaleta } from "../ui/tema.js";
import {
  NOMBRE_CARPETA_BACKUP,
  buscarArchivoEnCarpeta,
  buscarOCrearCarpetaEnDrive,
  copiarArchivoDrive,
  eliminarArchivoDeDriveConId,
  guardarDatos,
  leerDatos,
  moverArchivoAlaCarpeta,
  obtenerMetadatosArchivo,
  renombrarArchivoDrive,
  // OAuth con refresh_token vía Worker (2026-08-25) — ver asegurarTokenValido más abajo:
  borrarRefreshTokenGoogle,
  guardarRefreshTokenGoogle,
  leerRefreshTokenGoogle,
  refrescarAccessTokenViaWorker,
} from "./auth.js";
import { FRECUENCIAS_BACKUP_DRIVE, crearBackupDriveDefault, migrarDatosAntiguos, sellarTimestamp } from "./schema.js";
import { fusionarDatos } from "./storage-merge.js";
import { authListo, establecerTokenActivo, estado, guardarCacheLocal, leerTokenCacheValido } from "./storage.js";

/**
 * MIGRACIÓN 2026-08-25 (reemplaza el flujo implícito + refresco silencioso
 * viejo por completo): antes, "reconectar en silencio" significaba
 * pedirle un token nuevo a Google mismo (google.accounts.oauth2
 * .initTokenClient().requestAccessToken({prompt:""})) — un método que la
 * propia documentación de Google llama "OAuth 2.0 Token UX flow" y que
 * espera gesto del usuario. Llamado sin gesto (desde timers, desde el
 * sondeo, al volver a la pestaña) y con el navegador bloqueando cookies de
 * terceros hacia accounts.google.com (Tracking Prevention y similares),
 * eso terminaba mostrando la ventana real de Google una y otra vez.
 *
 * Ahora el login (ver auth.js, initCodeClient) entrega un refresh_token de
 * verdad la primera vez, y asegurarTokenValido() — el ÚNICO punto que
 * queda en toda la app para "conseguir un access_token que sirva" — lo usa
 * contra POST /oauth/refresh del Worker: una llamada REST servidor-a-
 * servidor pura, que NUNCA puede abrir una ventana. Reemplaza a los 4
 * disparadores dispersos que antes llamaban a Google directo (volver a la
 * pestaña, sondeo, guardado, refresco proactivo) — todos pasan por acá
 * ahora. Ya no hace falta ningún freno/cooldown de emergencia: si esto
 * falla, es porque el refresh_token de verdad venció o se revocó (ej.
 * límite de 7 días en modo Prueba de Google Cloud), no porque Google
 * decidió mostrar una ventana — en ese caso sí hace falta el popup real
 * (ver btn-reconectar-sesion en main.js, que llama a iniciarSesionConGoogle
 * directo cuando esto devuelve false).
 */

let refrescoEnCurso = null;

async function asegurarTokenValido() {
  const cacheValida = leerTokenCacheValido();
  if (cacheValida) {
    estado.token = cacheValida.token;
    return true;
  }

  if (refrescoEnCurso) return refrescoEnCurso; // evita refrescos duplicados en paralelo

  const refreshToken = leerRefreshTokenGoogle();
  if (!refreshToken) {
    // Todavía no hay refresh_token guardado en este dispositivo — primera
    // vez real, o una cuenta migrando desde el flujo viejo (ver B.5): no
    // hay nada que se pueda resolver en silencio acá, hace falta el login
    // completo (popup, gesto real) al menos una vez.
    mostrarAvisoReconexion();
    return false;
  }

  refrescoEnCurso = refrescarAccessTokenViaWorker(refreshToken)
    .then(({ token, expiresIn, refreshTokenNuevo }) => {
      // Google normalmente NO rota el refresh_token en un refresco — esto
      // solo corre en el caso puntual en que sí lo hace, para no quedarse
      // usando uno viejo que Google ya invalidó del otro lado.
      if (refreshTokenNuevo) guardarRefreshTokenGoogle(refreshTokenNuevo);
      establecerTokenActivo(token, expiresIn);
      ocultarAvisoReconexion();
      if (estado.pendienteSync) intentarSincronizar();
      return true;
    })
    .catch((e) => {
      console.warn("No se pudo refrescar el token vía el Worker:", e);
      // El refresh_token que había ya no sirve (revocado desde la cuenta
      // de Google, o venció por el límite de 7 días en modo Prueba) — se
      // borra para no seguir reintentando contra algo que Google ya no va
      // a aceptar nunca; el próximo "Reconectar" hace el login completo.
      borrarRefreshTokenGoogle();
      mostrarAvisoReconexion();
      return false;
    })
    .finally(() => {
      refrescoEnCurso = null;
    });
  return refrescoEnCurso;
}

/**
 * v9.4 (2026-08-08 — arquitectura de adjuntos, evitar import circular):
 * este archivo es el motor base de sync — no debería tener que IMPORTAR a
 * cada módulo de features que quiera enterarse de "recién se fundieron
 * datos remotos" (hoy solo storage-adjuntos.js, pero cualquier feature
 * futura con el mismo patrón puede sumarse igual). En vez de eso, exponen
 * su interés registrando un hook acá; este archivo nunca necesita saber
 * qué módulo lo registró ni importarlo. Mismo espíritu que ya usa
 * resolverConflicto en storage-merge.js (recibe sellarTimestamp como
 * parámetro en vez de importar schema.js), generalizado a una lista.
 */
const hooksPostFusion = [];

function registrarHookPostFusion(fn) {
  hooksPostFusion.push(fn);
}

/**
 * Horario entre Amigos — Parte 1/3 (BUG encontrado en esta ronda: horario-
 * amigos.js ya importaba y llamaba a registrarHookPostGuardado() desde la
 * Parte 1, pero esta función nunca se llegó a definir acá — el import
 * fallaba con un SyntaxError que rompía la carga de TODO el módulo, mismo
 * tipo de bug que ya se documentó arriba para sincronizarAlIniciar). A
 * diferencia de hooksPostFusion (corre tras bajar/fundir datos remotos),
 * este corre tras SUBIR datos exitosamente — es el punto que necesita
 * horario-amigos.js para mantener los archivos públicos de Drive al día
 * cada vez que algo se sincroniza, no solo cuando baja algo nuevo.
 */
const hooksPostGuardado = [];

function registrarHookPostGuardado(fn) {
  hooksPostGuardado.push(fn);
}

/**
 * v8.3 (Bug 3): antes el token SOLO se refrescaba de forma reactiva (al
 * recibir un 401 de Drive, o al recuperar una sesión de caché). En la
 * práctica, con la pestaña abierta más de ~1h sin disparar ningún guardado,
 * el token quedaba vencido y el usuario se topaba con el aviso de
 * reconexión (o la pantalla de login) "de la nada" — sentía que la sesión
 * pedía volver a iniciar sesión todo el tiempo. Ahora, cada vez que se
 * obtiene un token (login, reconexión silenciosa, reconexión manual, o
 * refresco tras 401) se programa el SIGUIENTE refresco silencioso 5 minutos
 * antes de que ese token expire, para que mientras la pestaña siga abierta
 * la sesión nunca llegue a vencerse de verdad.
 */

let temporizadorRefrescoProactivo = null;

function programarRefrescoProactivo(expiresInSegundos) {
  clearTimeout(temporizadorRefrescoProactivo);
  const segundos = Number(expiresInSegundos) || 3600; // Google normalmente da 3600 (1h)
  const esperaMs = Math.max((segundos - 300) * 1000, 10000); // 5 min antes, mínimo 10s de espera
  temporizadorRefrescoProactivo = setTimeout(() => {
    asegurarTokenValido();
  }, esperaMs);
}

function mostrarAvisoReconexion() {
  estado.conexionDrive = "desconectado";
  const aviso = document.getElementById("aviso-reconexion");
  if (aviso) aviso.classList.remove("oculto");
  actualizarIndicadorSync();
}

function ocultarAvisoReconexion() {
  estado.conexionDrive = "ok";
  const aviso = document.getElementById("aviso-reconexion");
  if (aviso) aviso.classList.add("oculto");
  actualizarIndicadorSync();
}

/**
 * v8.3 (prioridad máxima, reporte "cada vez que actualizo se abre la
 * página de Google"): ESTA función existía antes y disparaba una
 * reconexión real en el primer toque/click de CUALQUIER parte de la
 * página. En compu eso es casi invisible (Google abre y cierra un popup
 * pequeño en una fracción de segundo), pero en móvil ese mismo popup se
 * abre como página completa — así que cada vez que el usuario tocaba la
 * pantalla (incluyendo el propio gesto de deslizar para sincronizar) se
 * disparaba una navegación real a Google. Se elimina ese gatillo genérico:
 * ahora la reconexión automática solo se intenta UNA vez al cargar la app
 * (ver DOMContentLoaded); cualquier intento adicional queda ligado a una
 * acción explícita de sincronizar (deslizar hacia abajo, forzar sync, o el
 * botón "Reconectar" del banner), nunca a un toque cualquiera.
 */

/* --------------------- Overlay de carga (3 puntitos) --------------------- */

let contadorCargando = 0; // soporta llamados anidados/simultáneos sin ocultarse de más

function mostrarCargando() {
  contadorCargando++;
  const overlay = document.getElementById("overlay-cargando");
  if (overlay) overlay.classList.remove("oculto");
}

function ocultarCargando() {
  contadorCargando = Math.max(0, contadorCargando - 1);
  if (contadorCargando > 0) return;
  const overlay = document.getElementById("overlay-cargando");
  if (overlay) overlay.classList.add("oculto");
}

/* ------------------- Deslizar hacia abajo para sincronizar ------------------- */

/**
 * v8.3: gesto tipo "pull-to-refresh" nativo, pero en vez de recargar la
 * página entera, sincroniza los DATOS (sube lo pendiente, baja lo último
 * que haya en Drive, y repinta la UI en el sitio). Funciona con dedo
 * (móvil) y con mouse (compu) porque usa Pointer Events, que unifican
 * ambos. Solo se activa si el gesto arranca con la página ya en el tope
 * (scrollY === 0) — así nunca interfiere con scroll normal ni con clics.
 */

function inicializarPullToRefresh() {
  const indicador = document.getElementById("pull-refresh-indicador");
  if (!indicador) return;

  const UMBRAL_PX = 78;
  const MAX_ARRASTRE_PX = 120;
  // v9.1 (punto 6, ajuste v1.8.7): antes de este umbral el gesto es solo un
  // "candidato" — no se toca preventDefault ni user-select, para no
  // interferir con un clic normal o con una selección de texto real que
  // arranca en el mismo lugar. Recién al superar este umbral de arrastre
  // vertical se "compromete" como pull-to-refresh: ahí sí se bloquea la
  // selección y se toma el control del gesto.
  const UMBRAL_COMPROMISO_PX = 12;
  let arrastreInicioY = null;
  let arrastreInicioX = null;
  let candidato = false; // hubo un pointerdown válido, todavía sin confirmar dirección
  let comprometido = false; // ya se confirmó que es un pull vertical, se tomó el control
  let listoParaSoltar = false;
  let sincronizando = false;

  function posicion(distancia) {
    // Recorrido con resistencia (como el pull-to-refresh nativo): se mueve
    // más rápido al principio y se frena cerca del máximo.
    const limitada = Math.min(distancia, MAX_ARRASTRE_PX);
    return -60 + limitada * 0.9;
  }

  function cancelarCandidato() {
    candidato = false;
    comprometido = false;
    arrastreInicioY = null;
    arrastreInicioX = null;
    indicador.classList.remove("visible", "listo", "arrastrando");
    indicador.style.transform = "";
    document.body.style.userSelect = "";
  }

  window.addEventListener(
    "pointerdown",
    (e) => {
      // v9 (punto 6): antes exigía scrollY === 0 exacto — en móvil (rebote
      // elástico, redondeo de subpíxeles, barra de direcciones
      // colapsándose) el valor real casi nunca es exactamente 0 aunque la
      // página esté visualmente en el tope, así que el gesto nunca llegaba
      // a iniciar. Se da un pequeño margen de tolerancia.
      if (sincronizando || window.scrollY > 4) return;
      // Ignora clics normales sobre controles interactivos.
      if (e.target.closest("button, a, input, textarea, select")) return;
      // v9.3 (fix "pull-to-refresh se activa desde cualquier parte del
      // scroll"): el toque inicial (touchstart/pointerdown) tiene que
      // empezar sobre el encabezado general donde vive el logo —
      // .mobile-topbar (barra superior en viewport móvil) o
      // .sidebar-titulo (título del sidebar/drawer, visible en desktop y
      // también en móvil cuando el drawer está abierto). Si el toque
      // arranca en cualquier otro contenedor de la app, se descarta acá
      // mismo y el scroll nativo de esa sección queda intacto — nunca se
      // marca `candidato`, así que pointermove/touchmove de más abajo no
      // tienen nada que "comprometer" ni preventDefault() que llamar.
      if (!e.target.closest(".mobile-topbar, .sidebar-titulo")) return;
      arrastreInicioY = e.clientY;
      arrastreInicioX = e.clientX;
      candidato = true;
      comprometido = false;
      // Importante (ajuste v1.8.7): a propósito NO se toca user-select ni
      // se llama preventDefault aquí — este es solo un candidato. Si el
      // usuario en realidad quería seleccionar texto, eso sigue funcionando
      // con total normalidad hasta que el movimiento confirme que es un
      // pull vertical (ver pointermove).
    },
    { passive: true }
  );

  // v8.3 (fix móvil): este listener YA NO es pasivo — necesita poder llamar
  // preventDefault() para bloquear el "pull-to-refresh" NATIVO del
  // navegador (que recarga la página completa) mientras dura nuestro
  // propio gesto. Sin esto, en Chrome/Safari de teléfono el navegador se
  // quedaba con el gesto antes que nuestro JS, y el custom nunca se veía.
  window.addEventListener(
    "pointermove",
    (e) => {
      if (!candidato || arrastreInicioY === null) return;
      // Si a mitad de gesto la página ya no está en el tope (el usuario
      // terminó soltando en scroll normal), se cancela el gesto sin tocar
      // nada más.
      if (window.scrollY > 4) {
        cancelarCandidato();
        return;
      }
      const distancia = e.clientY - arrastreInicioY;

      if (!comprometido) {
        // Todavía no se confirma que sea un pull: si el movimiento es hacia
        // arriba, o más horizontal que vertical, o menor al umbral, se deja
        // que el navegador haga lo que corresponda (incluida selección de
        // texto normal) sin interferir en absoluto.
        const distanciaX = Math.abs(e.clientX - arrastreInicioX);
        if (distancia < UMBRAL_COMPROMISO_PX || distanciaX > distancia) return;
        // Se confirma el pull vertical: recién ahora se toma el control.
        comprometido = true;
        indicador.classList.add("arrastrando");
        // Punto 6: si el arrastre se hace con mouse en escritorio (sin
        // dedo), evita que se seleccione texto de la página por accidente
        // MIENTRAS dura el gesto ya confirmado — no antes.
        document.body.style.userSelect = "none";
      }

      if (distancia <= 0) {
        indicador.classList.remove("visible", "listo");
        return;
      }
      // A partir de aquí sí es un arrastre hacia abajo confirmado con la
      // página en el tope: se bloquea el comportamiento nativo del
      // navegador (rebote de scroll / pull-to-refresh nativo) para que no
      // compita con el gesto.
      e.preventDefault();
      listoParaSoltar = distancia >= UMBRAL_PX;
      indicador.classList.add("visible");
      indicador.classList.toggle("listo", listoParaSoltar);
      indicador.style.transform = `translate(-50%, ${posicion(distancia)}px)`;
    },
    { passive: false }
  );

  async function soltar() {
    if (!candidato) return;
    const estabaComprometido = comprometido;
    candidato = false;
    comprometido = false;
    indicador.classList.remove("arrastrando");
    arrastreInicioY = null;
    arrastreInicioX = null;
    document.body.style.userSelect = ""; // punto 6: restaura la selección normal de texto

    if (!estabaComprometido || !listoParaSoltar) {
      indicador.classList.remove("visible", "listo");
      indicador.style.transform = "";
      return;
    }

    listoParaSoltar = false;
    sincronizando = true;
    indicador.classList.add("sincronizando");
    indicador.style.transform = "translate(-50%, 6px)";
    try {
      await sincronizarAhora();
    } finally {
      sincronizando = false;
      indicador.classList.remove("visible", "listo", "sincronizando");
      indicador.style.transform = "";
    }
  }

  window.addEventListener("pointerup", soltar);
  window.addEventListener("pointercancel", soltar);

  // v1.15.2 (fix real de "el pull-to-refresh solo funciona con mouse en
  // compu, en teléfono no pasa nada"): toda la lógica de arriba corre bien
  // con Pointer Events, pero hay una limitación conocida de Safari/iOS (y
  // algunos Android): llamar preventDefault() dentro de un evento
  // *pointermove* no siempre alcanza a bloquear el scroll nativo del
  // navegador — el motor de touch ya "decidió" hacer scroll antes de que
  // el hilo de JS llegue a frenarlo. Hace falta interceptar también el
  // evento *touch* real (no solo el pointer) para que el preventDefault
  // realmente tenga efecto. Este listener no duplica el cálculo del
  // arrastre (eso ya lo hacen los listeners de pointer de arriba, que sí
  // se disparan igual en touch); solo actúa como respaldo para bloquear el
  // scroll nativo mientras el gesto ya está "comprometido".
  window.addEventListener(
    "touchmove",
    (e) => {
      if (comprometido) e.preventDefault();
    },
    { passive: false }
  );
}

/**
 * v9.1 (ajuste v1.8.7, puntos 1 y 4): envoltorio compartido para las
 * LECTURAS de Drive (leerDatos, obtenerMetadatosArchivo). Hasta ahora solo
 * la ESCRITURA (guardarDatos, dentro de intentarSincronizar) sabía
 * refrescar el token en silencio y reintentar tras un 401 — las lecturas
 * simplemente fallaban. En móvil, con la pestaña en segundo plano, el
 * navegador puede pausar el refresco proactivo programado (setTimeout) y
 * el token vence de verdad sin que nadie lo renueve: eso hacía fallar el
 * pull-to-refresh con "No se pudo actualizar" (punto 1) y dejaba el sondeo
 * cada 9s fallando en silencio para siempre, sin otra forma de recuperarse
 * que cerrar sesión y volver a entrar (punto 4). Reintenta UNA sola vez
 * tras un refresco silencioso exitoso; si el refresco también falla, marca
 * el error como `reconexionFallida` para que quien llama refleje el 3er
 * estado real del indicador (ver actualizarIndicadorSync) en vez de un
 * error genérico, sin bloquear la app ni perder datos locales.
 */

async function conReintentoSi401(operacion) {
  try {
    return await operacion();
  } catch (primerError) {
    if (primerError.status !== 401) throw primerError;
    estado.token = null; // fuerza que cualquier otro intento pase por reconexión
    // asegurarTokenValido() ya deja estado.token listo (vía caché o
    // establecerTokenActivo) cuando devuelve true — no hace falta repetir
    // ese trabajo acá, a diferencia del refresco viejo directo contra Google.
    const ok = await asegurarTokenValido();
    if (!ok) {
      const error = new Error("No se pudo renovar la sesión con Drive.");
      error.reconexionFallida = true;
      throw error;
    }
    return await operacion(); // reintento único, ya con el token renovado
  }
}

/**
 * v8.3: sincronización completa "en el sitio" — sube cambios pendientes
 * primero (nunca se pisa trabajo local sin subir), luego baja la última
 * versión de Drive, y repinta toda la UI ya renderizada sin recargar la
 * página ni tocar la pantalla de login. La usa tanto el gesto de deslizar
 * como (más adelante) el sondeo automático multi-dispositivo.
 */

async function sincronizarAhora() {
  mostrarCargando();
  try {
    if (!estado.token) {
      await asegurarTokenValido();
    }
    if (estado.pendienteSync) {
      await intentarSincronizar(); // sube lo local primero
      // v8.3 (FIX crítico de pérdida de datos): antes, si este envío
      // fallaba (sin conexión, token vencido de nuevo, error de Drive),
      // igual se seguía de largo y se sobrescribía estado.datos con lo
      // último que hubiera en Drive — borrando en el momento los cambios
      // locales que todavía no se habían guardado. Ahora, si sigue
      // pendiente después de intentarlo, se aborta ANTES de tocar
      // estado.datos: tus cambios locales quedan intactos (siguen en caché
      // y marcados como pendientes) y se reintentará más adelante.
      if (estado.pendienteSync) {
        mostrarToast("⚠️ No se pudo enviar tus cambios todavía, se reintentará. No se actualizó nada para no perderlos.");
        return;
      }
    }
    if (!estado.token || !estado.fileId) {
      mostrarToast("No se pudo actualizar: falta conexión con Drive");
      return;
    }
    // v9.1 (punto 1): la lectura ahora pasa por conReintentoSi401 — si el
    // token venció mientras la pestaña estaba en segundo plano, se refresca
    // en silencio y se reintenta una vez antes de rendirse.
    const datosFrescos = await conReintentoSi401(() => leerDatos(estado.token, estado.fileId));
    aplicarDatosRemotosFrescos(datosFrescos);
    try {
      const meta = await conReintentoSi401(() => obtenerMetadatosArchivo(estado.token, estado.fileId));
      estado.ultimoModifiedTimeConocido = meta.modifiedTime;
    } catch (e) {
      // No crítico: si falla, el próximo ciclo de sondeo simplemente
      // establece la base de comparación de nuevo.
    }
    mostrarToast("✓ Datos actualizados");
  } catch (e) {
    console.warn("No se pudo actualizar los datos:", e);
    if (e.reconexionFallida) {
      // v9.1 (punto 4): el token no se pudo renovar solo ni con el
      // reintento — se refleja el 3er estado real del indicador en vez de
      // un toast genérico. Los datos locales no se tocan ni se pierden.
      mostrarAvisoReconexion();
    } else {
      mostrarToast("No se pudo actualizar. Intenta de nuevo.");
    }
  } finally {
    ocultarCargando();
  }
}

/**
 * v9: bloque compartido que aplica datos ya descargados de Drive — repinta
 * toda la UI en el sitio, sin recargar la página. Lo usan tanto
 * sincronizarAhora() (pull-to-refresh manual, con overlay y toast) como
 * sondearCambiosRemotos() (en segundo plano, en silencio).
 */

function aplicarDatosRemotosFrescos(datosFrescos) {
  // FIX (scroll fantasma — capa adicional sobre el fix local de
  // renderizarSemestres/renderizarPlanEstudios): esta función es el único
  // punto por el que pasan LOS 3 disparadores de sync (sincronizarAhora,
  // sondearCambiosRemotos cada ~9s, y sincronizarAlIniciar), y dispara en
  // cadena varios renders más (renderizarSelectorPlan, renderizarAjustes,
  // renderizarModoHardcore, renderizarEnlacesRapidos, renderizarPerfil)
  // antes de llegar siquiera a renderizarPlanEstudios/renderizarSemestres.
  // Esos renders "hermanos" viven en otros archivos (plan-gestionar.js,
  // config-ajustes.js, config-enlaces.js, main.js) y no tienen su propio
  // guardado/restauración de scrollY. Si cualquiera de ellos provoca un
  // reflow con el contenedor momentáneamente más corto, el navegador puede
  // recortar window.scrollY ANTES de que renderizarSemestres/
  // renderizarPlanEstudios lleguen a capturar su propio "scrollPrevio" —
  // en ese caso el fix local de cada uno restaura fielmente una posición
  // que ya venía corrompida desde antes. Capturando acá, antes de la
  // primera llamada del lote, y restaurando después de la última, la
  // posición correcta queda protegida sin importar qué pase en el medio,
  // sin necesidad de tocar esos otros archivos.
  //
  // FIX (scroll fantasma, ronda 2 — "dos restauradores compitiendo"): esta
  // función y renderizarSemestres() capturaban CADA UNA su propio
  // scrollPrevio y reafirmaban en paralelo — la de renderizarSemestres se
  // leía tarde (después de que los renders "hermanos" ya movieron la
  // página) y la de acá solo tenía un rAF, más débil que la reafirmación
  // en varios frames que sí tiene renderizarSemestres. Dos restauraciones
  // corriendo en frames similares, con valores de referencia distintos,
  // producían el patrón "a veces se corrige, a veces no". Ahora
  // renderizarSemestres recibe omitirRestauracionScroll=true cuando la
  // llama este lote (ver más abajo) y no toca el scroll por su cuenta;
  // esta función queda como la única fuente de verdad, y usa el mismo
  // mecanismo de reafirmación en varios frames (no un solo rAF) para
  // cubrir el mismo reflow tardío (igualarAnchoBadges en
  // semestres-tarjetas.js, etc.) que motivó ese refuerzo en primer lugar.
  const scrollPrevio = window.scrollY;

  const remotoMigrado = migrarDatosAntiguos(datosFrescos);
  // v1.16 (FIX CRÍTICO — reporte Ivanna, "se sobrepone lo de un dispositivo
  // sobre el otro" / "categorías creadas pero no en cada materia"): antes
  // esta línea era `estado.datos = migrarDatosAntiguos(datosFrescos)` — un
  // reemplazo TOTAL de estado.datos con lo que viniera de Drive, sin pasar
  // por fusionarDatos (que hasta ahora solo se usaba una vez, en el
  // login). Cualquier sondeo (cada 9s) o pull-to-refresh pisaba entero lo
  // que hubiera en memoria, incluidas asignaciones materia→categoría u
  // otras ediciones que el otro dispositivo no conociera todavía. Ahora se
  // funde por entidad, con la misma función y las mismas reglas que ya usa
  // el login (nada se pierde por omisión; gana el más reciente por id).
  estado.datos = fusionarDatos(estado.datos, remotoMigrado);
  guardarCacheLocal();
  // BUG FIX v1.15.4 (causa raíz real de "funcionó, se aplicó la paleta...
  // pero a los segundos se fue"): faltaba el 3er argumento acá también.
  // Esta función corre después de CUALQUIER sync — el sondeo automático
  // cada 9s (sondearCambiosRemotos), el pull-to-refresh, y también dentro
  // de intentarSincronizar() — así que aunque el guardado y la fusión de
  // datos fueran perfectos, la paleta personalizada se borraba visualmente
  // (aplicarPaleta cae en la rama de "limpiar" cuando no recibe colores,
  // ver tema.js) en el próximo ciclo de sync después de guardarla.
  aplicarPaleta(
    estado.datos.configuracion.paleta,
    estado.datos.configuracion.modo,
    estado.datos.configuracion.paleta === "personalizada" ? estado.datos.configuracion.paleta_personalizada?.colores : undefined
  );
  renderizarSelectorPlan();
  renderizarAjustes();
  renderizarModoHardcore();
  renderizarEnlacesRapidos();
  renderizarPerfil();
  if (typeof renderizarPlanEstudios === "function") renderizarPlanEstudios();
  // BUG FIX (ronda actual — "se actualiza pero tengo que recargar toda la
  // página"): faltaba repintar la pantalla de Semestre acá. estado.datos ya
  // se fusionaba bien (por eso un F5 completo lo mostraba correcto — vuelve
  // a correr el render inicial), pero ningún sondeo (~9s) ni pull-to-refresh
  // volvía a llamar a renderizarSemestres(), así que el DOM de esa pantalla
  // quedaba congelado con los datos viejos hasta recargar. renderizarSemestres
  // ya se protege sola si #seccion-semestres no está en el DOM, así que es
  // seguro llamarla siempre, mismo patrón que renderizarPlanEstudios arriba.
  // omitirRestauracionScroll=true: este lote ya captura y restaura su
  // propio scrollPrevio acá abajo (ver comentario al inicio de la
  // función); si renderizarSemestres además capturara y reafirmara el
  // suyo, las dos restauraciones competirían por la posición final.
  if (typeof renderizarSemestres === "function") renderizarSemestres(true);
  // Finanzas (2026-08-10): mismo patrón que renderizarSemestres arriba —
  // sin esto, un cambio financiero hecho en otro dispositivo quedaría
  // congelado en el DOM de #seccion-finanzas hasta un F5 completo, el mismo
  // bug que ya se cazó y arregló para Semestres.
  if (typeof renderizarFinanzas === "function") renderizarFinanzas();
  marcarUltimaSincronizacionConfirmada();

  // Adjuntos (2026-08-08) / mecanismo genérico de hooks (ver
  // registrarHookPostFusion más abajo): tras CUALQUIER fusión remota
  // (sondeo, pull-to-refresh, pull inicial), puede haber housekeeping que
  // otros módulos quieran correr en segundo plano — ej. storage-
  // adjuntos.js limpiando archivos de Drive huérfanos que un dispositivo
  // offline no llegó a borrar. Se dispara sin await (no bloquea el render
  // de la UI por housekeeping que al usuario no le importa ver) y cada
  // hook se protege solo (un hook roto no debe tirar abajo los demás).
  hooksPostFusion.forEach((hook) => {
    try {
      Promise.resolve(hook()).catch((e) => console.warn("Error en hook post-fusión:", e));
    } catch (e) {
      console.warn("Error en hook post-fusión:", e);
    }
  });

  // Nota: la limpieza de adjuntos huérfanos en Drive ya corre arriba, vía
  // hooksPostFusion — storage-adjuntos.js se registra solo (ver
  // registrarHookPostFusion). Este archivo no importa procesarTumbasDrive-
  // Huerfanas a propósito (evita el import circular), así que NO debe
  // llamarla directo acá: una llamada suelta a una función no importada
  // reventaba con ReferenceError en cada sync/sondeo/login, cortando esta
  // función antes de llegar a la reafirmación de scroll de abajo. Fix
  // 2026-08-08.

  // Mismo mecanismo de reafirmación en varios frames que usa
  // renderizarSemestres() (semestres.js) para su propio fix local: un solo
  // requestAnimationFrame no alcanza porque el layout de la página puede
  // seguir "asentándose" después de ese primer frame (reflows en cascada
  // de los renders del lote de arriba, incluido igualarAnchoBadges en
  // semestres-tarjetas.js, que agenda su propio rAF anidado). Reafirmar
  // scrollPrevio durante varios frames hasta acumular lecturas estables
  // cubre ese asentamiento tardío sin quedar corriendo para siempre.
  const FRAMES_MAXIMOS_REAFIRMAR = 12;
  const LECTURAS_ESTABLES_REQUERIDAS = 3;
  let framesRestantes = FRAMES_MAXIMOS_REAFIRMAR;
  let lecturasEstables = 0;

  function reafirmarScroll() {
    if (Math.abs(window.scrollY - scrollPrevio) > 0.5) {
      window.scrollTo(0, scrollPrevio);
      lecturasEstables = 0;
    } else {
      lecturasEstables += 1;
    }
    framesRestantes -= 1;
    if (framesRestantes > 0 && lecturasEstables < LECTURAS_ESTABLES_REQUERIDAS) {
      requestAnimationFrame(reafirmarScroll);
    }
  }
  requestAnimationFrame(reafirmarScroll);
}

/**
 * v9 (bug real encontrado — no venía en el reporte original): esta función
 * se llamaba desde sincronizarAhora() pero NUNCA estaba definida en ningún
 * archivo. Eso significa que cada pull-to-refresh (y cada sondeo) reventaba
 * con un ReferenceError silencioso, atrapado por el catch de
 * sincronizarAhora, que mostraba "No se pudo actualizar" aunque los datos
 * sí se hubieran traído bien — un falso negativo que hacía parecer rota la
 * sincronización cuando en realidad había funcionado.
 */

function marcarUltimaSincronizacionConfirmada() {
  estado.ultimaSincronizacionConfirmadaEn = Date.now();
  actualizarIndicadorSync();
}

/**
 * v9 (punto 5 — sondeo periódico multi-dispositivo): revisa cada ~9s (ver
 * setInterval en DOMContentLoaded) si el archivo cambió en Drive desde otro
 * dispositivo/pestaña, usando SOLO su modifiedTime (llamada barata, no
 * descarga el archivo). Antes, obtenerMetadatosArchivo() existía en
 * auth.js pero no se llamaba desde ningún lado — por eso los cambios de un
 * dispositivo nunca llegaban al otro. Corre en silencio: sin overlay ni
 * toast, para no interrumpir al usuario con algo que no pidió.
 */

async function sondearCambiosRemotos() {
  await authListo; // nunca sondear antes de saber si hay token (punto 5, condición de carrera)
  if (document.hidden) return; // ahorra cuota de la API si la pestaña no está visible
  if (!estado.token || !estado.fileId) return;
  // Si hay cambios locales sin subir todavía, se deja que intentarSincronizar()
  // (el reintento cada 45s, o el próximo cambio del usuario) suba eso primero —
  // pisar aquí con lo remoto arriesgaría perder esos cambios locales.
  if (estado.pendienteSync) return;

  try {
    // v9.1 (punto 4): antes, un 401 aquí solo limpiaba estado.token y
    // dejaba el sondeo fallando en silencio cada 9s para siempre — la única
    // forma real de recuperar un token nuevo volvía a ser cerrar sesión y
    // entrar de nuevo. Ahora se intenta un refresco silencioso y un
    // reintento único, igual que en sincronizarAhora().
    const meta = await conReintentoSi401(() => obtenerMetadatosArchivo(estado.token, estado.fileId));
    if (!estado.ultimoModifiedTimeConocido) {
      estado.ultimoModifiedTimeConocido = meta.modifiedTime; // primera vez: solo fija la base de comparación
      return;
    }
    if (meta.modifiedTime === estado.ultimoModifiedTimeConocido) return; // sin cambios desde el último sondeo

    estado.ultimoModifiedTimeConocido = meta.modifiedTime;
    const datosFrescos = await conReintentoSi401(() => leerDatos(estado.token, estado.fileId));
    aplicarDatosRemotosFrescos(datosFrescos);
  } catch (e) {
    if (e.reconexionFallida) {
      // El refresco silencioso también falló (ej. el usuario revocó el
      // acceso, o el navegador bloquea el flujo de terceros en segundo
      // plano): se refleja el 3er estado real del indicador en vez de
      // seguir sondeando en silencio sin que el usuario se entere nunca.
      mostrarAvisoReconexion();
    }
    console.warn("No se pudo sondear cambios remotos de Drive:", e);
  }
}

/**
 * v1.15.2 (bug real encontrado — no venía en el reporte original):
 * main.js ya importaba y llamaba a sincronizarAlIniciar() en los dos
 * caminos de sesión recuperada de caché (token cacheado válido y
 * reconexión silenciosa), con el comentario explícito de que reemplazaba
 * el viejo `if (estado.pendienteSync) intentarSincronizar()` porque ese
 * viejo código solo SUBÍA cambios locales pendientes y nunca bajaba lo
 * que ya hubiera de nuevo en Drive desde otro dispositivo. Pero la función
 * nunca se llegó a definir aquí — el import fallaba con un SyntaxError que
 * rompía la carga completa del módulo (y por lo tanto de toda la app).
 *
 * Hace el pull real de lo que haya en Drive en este momento (a diferencia
 * de sondearCambiosRemotos, que en su primera pasada solo fija la base de
 * comparación sin traer nada) y, una vez resuelto eso, sube lo pendiente
 * si corresponde — igual que describe el comentario de main.js.
 */

async function sincronizarAlIniciar() {
  await authListo; // punto 5, misma condición de carrera que el resto del módulo
  if (!estado.token || !estado.fileId) return;

  try {
    const meta = await conReintentoSi401(() => obtenerMetadatosArchivo(estado.token, estado.fileId));
    estado.ultimoModifiedTimeConocido = meta.modifiedTime;
    const datosFrescos = await conReintentoSi401(() => leerDatos(estado.token, estado.fileId));
    aplicarDatosRemotosFrescos(datosFrescos);
  } catch (e) {
    if (e.reconexionFallida) {
      mostrarAvisoReconexion();
    }
    console.warn("No se pudo hacer el pull inicial desde Drive:", e);
  } finally {
    // Se sube lo pendiente después del pull (y no antes), para no pisar en
    // Drive un cambio remoto más reciente con datos locales desactualizados.
    if (estado.pendienteSync) intentarSincronizar();
  }
}

/**
 * v9.3: fuerza un sondeo inmediato apenas la pestaña/app vuelve a primer
 * plano (visibilitychange), en vez de esperar hasta 9s (el próximo tick del
 * setInterval en main.js) a que sondearCambiosRemotos() se entere de algo
 * que cambió en otro dispositivo mientras esta pestaña estaba minimizada o
 * en segundo plano. sondearCambiosRemotos ya se protege sola contra
 * pestañas ocultas (`if (document.hidden) return`) y contra sondeos
 * redundantes (compara modifiedTime), así que aquí basta con dispararla sin
 * lógica adicional.
 *
 * FIX histórico (reporte viejo: "cada pocos minutos se abre y cierra sola
 * una ventana de Google"), bajo el flujo implícito de antes: el refresco
 * proactivo dependía de un setTimeout que el navegador podía suspender en
 * 2do plano, dejando el token vencido en silencio hasta que un 401 real lo
 * descubría "de apuro" al volver a la pestaña — justo el peor momento para
 * un refresco silencioso contra Google. MIGRACIÓN 2026-08-25: con
 * asegurarTokenValido() esto ya no puede mostrar ninguna ventana (es REST
 * puro contra el Worker), así que ese riesgo desapareció de raíz — este
 * chequeo al volver a la pestaña ahora es solo una optimización de
 * frescura/latencia, no una salvaguarda contra popups.
 *
 * El fix no cambia CÓMO se pide el token sino CUÁNDO: se revalida la vigencia del token ANTES de la primera
 * llamada a Drive tras volver a la pestaña, reusando el mismo patrón ya
 * usado al cargar la app (ver DOMContentLoaded en main.js) — si la caché
 * todavía tiene margen, no se pide nada nuevo (cero llamadas de más); si no,
 * se refresca ahí mismo, una sola vez, de forma predecible, en vez de
 * dejar que lo descubra un 401 disparado desde cualquiera de los otros
 * caminos (el sondeo de 9s, el reintento de 45s, o el próximo cambio que
 * haga el usuario).
 */

let sondeoAlVolverRegistrado = false;

function inicializarSondeoAlVolver() {
  if (sondeoAlVolverRegistrado) return; // se llama una sola vez desde DOMContentLoaded en main.js
  sondeoAlVolverRegistrado = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    asegurarTokenFrescoAlVolver().finally(() => sondearCambiosRemotos());
  });
}

/**
 * Revalida el token justo al volver a primer plano — ver comentario arriba.
 * Si la caché local todavía es válida (le quedan más de 5 min, mismo margen
 * que usa el resto de la app), solo realinea estado.token con ella (por si
 * esta pestaña estuvo suspendida y quedó desactualizada en memoria) sin
 * pedirle nada a Google. Si no hay caché usable, recién ahí se refresca en
 * silencio — la misma llamada que ya se usaba, solo que disparada en el
 * momento correcto en vez de esperar a que un 401 la descubra.
 */
async function asegurarTokenFrescoAlVolver() {
  await authListo; // punto 5, misma condición de carrera que el resto del módulo
  if (!estado.fileId) return; // todavía no hay una sesión real armada (ej. pantalla de login)

  const cacheValida = leerTokenCacheValido();
  if (cacheValida) {
    estado.token = cacheValida.token;
    return;
  }
  await asegurarTokenValido(); // ya deduplicada (refrescoEnCurso) y ya sin popup (REST puro vía el Worker)
}

/**
 * Backup de seguridad rotativo a Drive (Ajustes — 2026-08-10): NO tiene
 * timer propio — se llama desde intentarSincronizar() justo después de un
 * guardado exitoso (ver más abajo). Es a propósito: reutiliza la MISMA
 * cadencia que ya dispara guardarDatos en cada sync (más el sondeo
 * periódico de ~9s y el pull-to-refresh), así que el chequeo "¿ya toca
 * según la frecuencia elegida?" corre con frecuencia de sobra sin necesitar
 * un setTimeout/setInterval propio — que además sería poco confiable en
 * móvil (el navegador/SO puede suspender timers de una pestaña en 2do
 * plano, mismo problema documentado arriba para programarRefrescoProactivo).
 * El chequeo en sí es barato (una resta de fechas), así que no penaliza en
 * absoluto que se dispare en cada sync.
 *
 * Carpeta "AppAcademica/" con máximo 2 copias rotativas:
 *   - Si ya existe backup_reciente.json, se borra el backup_anterior.json
 *     viejo (si había) y se renombra backup_reciente.json -> backup_anterior.json
 *     (PATCH de solo metadata, no re-sube contenido).
 *   - Se genera un backup_reciente.json NUEVO como copia server-side
 *     (Drive files.copy, sin bajar/subir bytes por el cliente) del archivo
 *     vigente actual (estado.fileId) — copia EXACTA, mismo JSON, pedido
 *     explícito.
 * Nunca se acumulan más de 2 copias.
 *
 * Totalmente silencioso: cualquier error se loguea y se descarta sin
 * avisar al usuario ni tocar estado.pendienteSync — para cuando esta
 * función corre, el sync normal ya tuvo éxito, y un backup fallido no debe
 * ensuciar ni interrumpir ese resultado. Se reintenta solo en el próximo
 * sync exitoso, una vez se cumpla el intervalo de nuevo.
 *
 * El ciclo de rotación en sí (crear carpeta si hace falta, migrar el
 * archivo vigente si es la primera vez, rotar backup_reciente.json ->
 * backup_anterior.json, copiar el archivo vigente como el nuevo
 * backup_reciente.json) vive en ejecutarCicloRotacionBackup, sin ninguna
 * condición de frecuencia — separado de esta función (2026-08-10, pedido
 * explícito: botón de "Hacer backup ahora") para que el botón manual
 * pueda correr el mismo ciclo real ignorando el intervalo elegido, sin
 * duplicar la lógica de rotación en dos lugares.
 */

/**
 * Migración única del archivo vigente (2026-08-10, pedido explícito): el
 * JSON central de la app (estado.fileId) se crea originalmente en la raíz
 * del Drive del usuario, antes de que exista la carpeta "AppAcademica". La
 * primera vez que el ciclo de backup corre de verdad —automático o
 * manual, lo que pase primero— este archivo se MUEVE (no se copia) hacia
 * adentro de la carpeta, conservando el mismo nombre. Como Drive conserva
 * el mismo fileId al mover (solo cambian los parents), guardarDatos/
 * leerDatos/obtenerMetadatosArchivo (que solo conocen estado.fileId, nunca
 * la ubicación) siguen apuntando ahí mismo sin ningún otro cambio: todo el
 * guardado normal de la app queda apuntando a la ubicación nueva dentro de
 * la carpeta automáticamente, sin tocar storage.js ni auth.js más allá de
 * la primitiva moverArchivoAlaCarpeta.
 *
 * Gateada por cfg.archivo_vigente_migrado para que esto corra una única
 * vez por cuenta — los intentos siguientes ven la bandera en true y
 * salen de inmediato, sin llamar a Drive.
 */
async function migrarArchivoVigenteSiHaceFalta(cfg, folderId) {
  if (cfg.archivo_vigente_migrado) return;
  await conReintentoSi401(() => moverArchivoAlaCarpeta(estado.token, estado.fileId, folderId));
  cfg.archivo_vigente_migrado = true;
}

/**
 * NO actualiza cfg.ultimo_backup_iso ni cachea — eso queda a cargo de
 * quien llama (ver ejecutarBackupSiToca y forzarBackupManual), porque
 * cada uno decide en qué momento y con qué efectos secundarios (silencioso
 * vs. con feedback al usuario) se sella el timestamp. Sí garantiza que
 * configuracion.backup_drive exista (lo crea con el default si hace
 * falta) — quien llama puede leerlo de estado.datos.configuracion.backup_drive
 * después, sin repetir la inicialización.
 */
async function ejecutarCicloRotacionBackup() {
  const cfg = (estado.datos.configuracion.backup_drive =
    estado.datos.configuracion.backup_drive || crearBackupDriveDefault());

  const folderId = await conReintentoSi401(() => buscarOCrearCarpetaEnDrive(estado.token, NOMBRE_CARPETA_BACKUP));

  await migrarArchivoVigenteSiHaceFalta(cfg, folderId);

  const idReciente = await conReintentoSi401(() => buscarArchivoEnCarpeta(estado.token, folderId, "backup_reciente.json"));

  if (idReciente) {
    const idAnterior = await conReintentoSi401(() => buscarArchivoEnCarpeta(estado.token, folderId, "backup_anterior.json"));
    // Se borra la copia vieja ANTES de renombrar la nueva encima: Drive
    // permite nombres duplicados dentro de una misma carpeta, así que sin
    // este paso quedarían 2 archivos "backup_anterior.json" sueltos y
    // buscarArchivoEnCarpeta (que toma el primero que devuelva la API,
    // sin orden garantizado) dejaría de ser determinista sobre cuál es
    // el real. Un 404 (ya no existe) se trata como éxito, ver
    // eliminarArchivoDeDriveConId en auth.js.
    if (idAnterior) await conReintentoSi401(() => eliminarArchivoDeDriveConId(estado.token, idAnterior));
    await conReintentoSi401(() => renombrarArchivoDrive(estado.token, idReciente, "backup_anterior.json"));
  }

  // Copia exacta del archivo vigente actual — mismo contenido, solo
  // cambia el nombre (pedido explícito).
  await conReintentoSi401(() => copiarArchivoDrive(estado.token, estado.fileId, "backup_reciente.json", folderId));
}

/**
 * Backup automático: revisa si ya toca según la frecuencia elegida y, si
 * toca, corre el ciclo de rotación. Totalmente silencioso: cualquier error
 * se loguea y se descarta sin avisar al usuario ni tocar
 * estado.pendienteSync — ver comentario grande más arriba.
 */
async function ejecutarBackupSiToca() {
  try {
    if (!estado.datos || !estado.datos.configuracion) return;

    const cfg = (estado.datos.configuracion.backup_drive =
      estado.datos.configuracion.backup_drive || crearBackupDriveDefault());

    const frecuenciaElegida =
      FRECUENCIAS_BACKUP_DRIVE.find((f) => f.id === cfg.frecuencia) ||
      FRECUENCIAS_BACKUP_DRIVE.find((f) => f.id === "semanal");
    const msIntervalo = frecuenciaElegida.dias * 24 * 60 * 60 * 1000;

    const ultimo = cfg.ultimo_backup_iso ? new Date(cfg.ultimo_backup_iso).getTime() : 0;
    if (Date.now() - ultimo < msIntervalo) return; // todavía no toca, según la frecuencia elegida

    await ejecutarCicloRotacionBackup();

    cfg.ultimo_backup_iso = new Date().toISOString();
    // A propósito NO se llama a marcarCambioPendiente() acá: eso dispararía
    // un intentarSincronizar() recursivo desde DENTRO de un sync que recién
    // terminó. El timestamp nuevo queda en memoria y en la caché local
    // (guardarCacheLocal, justo abajo) y sube a Drive solo, en el PRÓXIMO
    // cambio real del usuario o el próximo sync/sondeo periódico — que de
    // sobra van a ocurrir mucho antes de que vuelva a tocar otro backup
    // (el intervalo más corto disponible es 1 día).
    guardarCacheLocal();
  } catch (e) {
    console.warn("No se pudo completar el backup rotativo a Drive (se reintentará en el próximo sync):", e);
  }
}

/**
 * Backup manual (2026-08-10, botón "Hacer backup ahora" en Ajustes):
 * corre el mismo ciclo real de rotación, IGNORANDO el intervalo de la
 * frecuencia elegida — a diferencia de ejecutarBackupSiToca, acá SÍ
 * interesa que el usuario se entere del resultado, así que no traga el
 * error en silencio: lo relanza para que quien llama (la UI) pueda
 * mostrar un aviso. Si tiene éxito, sella el timestamp y SÍ llama a
 * marcarCambioPendiente() (a diferencia del automático) porque este no
 * corre desde dentro de un sync en curso — es una acción nueva e
 * independiente iniciada por la persona.
 */
async function forzarBackupManual() {
  if (!estado.datos || !estado.datos.configuracion) throw new Error("No hay datos cargados todavía.");
  if (!estado.token || !estado.fileId) throw new Error("No hay sesión de Drive activa.");

  // Cada llamada interna a Drive dentro de ejecutarCicloRotacionBackup ya
  // va envuelta en conReintentoSi401 por separado — no hace falta un
  // envoltorio extra acá afuera. ejecutarCicloRotacionBackup ya garantiza
  // que configuracion.backup_drive exista (lo crea si hace falta), así que
  // acá abajo alcanza con leerlo, no hay que volver a inicializarlo.
  await ejecutarCicloRotacionBackup();

  const cfg = estado.datos.configuracion.backup_drive;
  cfg.ultimo_backup_iso = new Date().toISOString();
  sellarTimestamp(estado.datos.configuracion);
  marcarCambioPendiente();
}

/** Se llama cada vez que se modifica algo en `estado.datos`. */

function marcarCambioPendiente() {
  guardarCacheLocal();
  estado.pendienteSync = true;
  actualizarIndicadorSync();
  if (navigator.onLine) intentarSincronizar();
}

async function intentarSincronizar() {
  if (!estado.pendienteSync || !estado.fileId) return;

  // v9 (punto 5 — condición de carrera): nunca intentar nada antes de saber
  // si esta carga terminó de resolver si hay o no un token de Drive. Antes
  // era posible que un intento se disparara (ej. desde el setInterval de
  // reintento) a mitad de la inicialización de auth.
  await authListo;

  // Bug 1 (v8): antes, si no había token (ej. sesión recuperada de caché sin
  // reconexión todavía), esta función se salía aquí mismo sin intentar nada
  // ni avisar — la causa raíz de que la sincronización pareciera "rota"
  // permanentemente en visitas de retorno. Ahora se intenta reconectar en
  // silencio primero.
  if (!estado.token) {
    await asegurarTokenValido();
    if (!estado.token) return; // seguimos sin token: ya se mostró el aviso si aplicaba
  }

  try {
    // v1.16 (FIX CRÍTICO — reporte Ivanna, "se actualiza lo del teléfono y
    // se sobrepone a lo de PC"): antes esta función subía estado.datos TAL
    // CUAL con guardarDatos, sin bajar primero la última versión de Drive.
    // Si el otro dispositivo había subido algo mientras tanto, esta subida
    // lo pisaba entero — "quien suba último, gana el archivo completo".
    // Ahora SIEMPRE se baja lo último de Drive y se funde por entidad
    // (aplicarDatosRemotosFrescos, la misma fusión que ya usa el login y
    // el pull-to-refresh) ANTES de subir, para que lo que se suba sea el
    // resultado ya fusionado — nunca un reemplazo total.
    const remoto = await conReintentoSi401(() => leerDatos(estado.token, estado.fileId));
    aplicarDatosRemotosFrescos(remoto); // funde con estado.datos + re-renderiza + guarda caché local
    // v9.1: reutiliza el mismo envoltorio de reintento-tras-401 que ahora
    // usan las lecturas (leerDatos/obtenerMetadatosArchivo en
    // sincronizarAhora y sondearCambiosRemotos), en vez de duplicar aquí a
    // mano la misma lógica de refresco+reintento.
    const meta = await conReintentoSi401(() => guardarDatos(estado.token, estado.fileId, estado.datos));
    estado.pendienteSync = false;
    if (meta && meta.modifiedTime) estado.ultimoModifiedTimeConocido = meta.modifiedTime;
    ocultarAvisoReconexion();
    actualizarIndicadorSync();
    // Backup rotativo a Drive (Ajustes): fire-and-forget a propósito — no
    // se espera (sin await) para no demorar el indicador de "Todo
    // sincronizado" con las llamadas extra a Drive que puede implicar. En
    // la enorme mayoría de los syncs esta llamada no hace ninguna petición
    // de red real: el propio chequeo interno de frecuencia (ver
    // ejecutarBackupSiToca) vuelve de inmediato si todavía no toca.
    ejecutarBackupSiToca();
    // Horario entre Amigos — Parte 1: mismo mecanismo fire-and-forget que
    // hooksPostFusion (ver aplicarDatosRemotosFrescos) pero disparado tras
    // cada SUBIDA exitosa — cada hook se protege solo, uno roto no debe
    // tirar abajo los demás ni bloquear el resto de intentarSincronizar.
    hooksPostGuardado.forEach((hook) => {
      try {
        Promise.resolve(hook()).catch((e) => console.warn("Error en hook post-guardado:", e));
      } catch (e) {
        console.warn("Error en hook post-guardado:", e);
      }
    });
  } catch (e) {
    // v7 (Bug 2): antes solo se logueaba un mensaje genérico. Ahora se
    // imprime el detalle real (status HTTP + cuerpo de la respuesta de
    // Drive, si vino) para poder diagnosticar la causa de verdad.
    console.warn(
      `No se pudo sincronizar (status: ${e.status ?? "desconocido"}). Se reintentará más tarde.`,
      e.body || e.message || e
    );
    if (e.reconexionFallida) {
      // El token venció y el refresco silencioso (más el reintento único)
      // también falló: se refleja el 3er estado real del indicador. Los
      // cambios locales siguen en caché y marcados como pendientes.
      mostrarAvisoReconexion();
    }
  }
}

/** Botón 🔄: fuerza el intento de sincronización YA, sin esperar el evento
 *  "online" del navegador (útil si la conexión volvió pero el evento no
 *  disparó, o si se quiere forzar un guardado inmediato). */

async function forzarSincronizacion() {
  const el = document.getElementById("indicador-sync");
  if (!estado.pendienteSync) {
    if (el) {
      el.textContent = "Ya estaba sincronizado";
      setTimeout(actualizarIndicadorSync, 1500);
    }
    return;
  }
  if (el) {
    el.textContent = "Sincronizando…";
    el.className = "badge badge-neutral";
  }
  await intentarSincronizar();
  if (estado.pendienteSync && el) {
    // Seguía pendiente: no había conexión o falló el guardado en Drive.
    el.textContent = "No se pudo sincronizar, se reintentará";
    el.className = "badge badge-danger";
    setTimeout(actualizarIndicadorSync, 2500);
  }
}

/**
 * Punto 4 del prompt: el indicador debe tener 3 estados reales y nunca
 * mentir. Se prioriza "sin conexión" sobre "cambios sin sincronizar" —
 * si el token no se pudo renovar, eso es lo más importante que el usuario
 * necesita saber, tenga o no cambios pendientes en ese momento.
 */

/**
 * Punto 4 (badge ⚠️ global): cuenta TODOS los choques de sincronización
 * pendientes en cualquier parte de los datos — planes → materias,
 * semestres → materias_matriculadas → criterios, y los semestres mismos —
 * para pintar el número en el badge junto a #indicador-sync. La lista
 * completa (con detalle de cada uno) la arma listarTodosLosConflictos() en
 * semestres-tarjetas.js; acá solo se necesita el conteo.
 */
function contarConflictosGlobales() {
  // Fix (2026-08-03 — "ERROR GRAVE" al loguearse): establecerTokenActivo()
  // (storage.js) llama a ocultarAvisoReconexion() -> actualizarIndicadorSync()
  // -> esta función, TODO de forma síncrona, apenas se obtiene el token. Pero
  // estado.datos recién se asigna después, dentro de onLoginExitoso (main.js),
  // una vez que termina el await de buscarOCrearArchivoDatos(). En un
  // dispositivo sin caché local todavía (primer login ahí) estado.datos sigue
  // en null en ese instante -> estallaba acá. Con caché local ya cargada no
  // se nota, por eso era intermitente.
  if (!estado.datos) return 0;

  let total = 0;

  (estado.datos.planes_estudio || []).forEach((plan) => {
    (plan.materias || []).forEach((materia) => {
      if (materia._conflicto) total++;
    });
  });

  (estado.datos.semestres || []).forEach((semestre) => {
    if (semestre._conflicto) total++;
    (semestre.materias_matriculadas || []).forEach((mm) => {
      // mm._conflicto ya cubre el vínculo Profesor↔Semestre embebido
      // (profesor_id/calificacion_profesor/volveria_a_llevar_profesor son
      // campos planos de mm, no una sub-entidad con su propio timestamp) —
      // no hace falta un chequeo aparte para eso acá.
      if (mm._conflicto) total++;
      (mm.criterios || []).forEach((criterio) => {
        if (criterio._conflicto) total++;
      });
    });
  });

  // Comunidad — Parte 1: profesores y companeros son colecciones top-level
  // planas, igual que agenda — se cuentan igual de directo.
  (estado.datos.profesores || []).forEach((profesor) => {
    if (profesor._conflicto) total++;
  });
  (estado.datos.companeros || []).forEach((companero) => {
    if (companero._conflicto) total++;
  });

  return total;
}

/**
 * El markup del badge (#indicador-conflictos) vive en index.html como
 * hermano oculto de #indicador-sync, dentro del mismo .row del sidebar —
 * acá solo se lo muestra/oculta y se le pone el conteo + el click. Se usa
 * `onclick` (no addEventListener) a propósito: esta función se llama en
 * cada sync/sondeo (cada ~9s) y con addEventListener iría acumulando un
 * listener duplicado por cada llamada.
 */
function actualizarBadgeConflictosGlobales() {
  const badge = document.getElementById("indicador-conflictos");
  if (!badge) return;

  const n = contarConflictosGlobales();
  if (n === 0) {
    badge.classList.add("oculto");
    return;
  }

  badge.classList.remove("oculto");
  badge.textContent = `⚠️ ${n}`;
  badge.title =
    n === 1 ? "1 choque pendiente de resolver — toca para verlo" : `${n} choques pendientes de resolver — toca para verlos`;
  badge.onclick = () => abrirModalTodosLosConflictos();
}

function actualizarIndicadorSync() {
  const el = document.getElementById("indicador-sync");
  if (!el) return;

  if (estado.conexionDrive === "desconectado") {
    el.textContent = "Sin conexión con Drive — toca para reconectar";
    el.className = "badge badge-danger";
    el.style.cursor = "pointer";
  } else if (estado.pendienteSync) {
    el.textContent = "Cambios sin sincronizar";
    el.className = "badge badge-warning";
    el.style.cursor = "";
  } else {
    el.textContent = "Todo sincronizado";
    el.className = "badge badge-success";
    el.style.cursor = "";
  }

  actualizarBadgeConflictosGlobales();
}

export {
  actualizarIndicadorSync,
  aplicarDatosRemotosFrescos,
  // OAuth con refresh_token vía Worker (2026-08-25) — punto único de
  // "conseguir un access_token que sirva" para toda la app (reemplaza a
  // intentarReconexionSilenciosa, eliminada):
  asegurarTokenValido,
  conReintentoSi401,
  contadorCargando,
  contarConflictosGlobales,
  ejecutarBackupSiToca,
  forzarBackupManual,
  forzarSincronizacion,
  inicializarPullToRefresh,
  inicializarSondeoAlVolver,
  intentarSincronizar,
  marcarCambioPendiente,
  marcarUltimaSincronizacionConfirmada,
  mostrarAvisoReconexion,
  mostrarCargando,
  ocultarAvisoReconexion,
  ocultarCargando,
  programarRefrescoProactivo,
  registrarHookPostFusion,
  registrarHookPostGuardado,
  sincronizarAhora,
  sincronizarAlIniciar,
  sondearCambiosRemotos,
  temporizadorRefrescoProactivo,
};
