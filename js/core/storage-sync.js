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
import { mostrarToast } from "../ui/componentes.js";
import { aplicarPaleta } from "../ui/tema.js";
import { guardarDatos, leerDatos, obtenerMetadatosArchivo, refrescarAccessTokenGoogle } from "./auth.js";
import { migrarDatosAntiguos } from "./schema.js";
import { fusionarDatos } from "./storage-merge.js";
import { authListo, correoConocido, establecerTokenActivo, estado, guardarCacheLocal } from "./storage.js";

/**
 * Bug 1 (v8): pide un access_token nuevo de forma silenciosa apenas carga la
 * app (caso de sesión recuperada de caché, ver DOMContentLoaded arriba) o
 * cuando intentarSincronizar() se encuentra sin token. Tiene un timeout
 * propio porque el refresco silencioso de Google puede quedarse colgado sin
 * error ni resolución si el navegador bloquea el mecanismo (ej. "Tracking
 * Prevention" de Edge/Chrome bloqueando el almacenamiento de terceros que
 * usa Google para el flujo silencioso) — sin el timeout, ese cuelgue nunca
 * se reportaba ni se le daba al usuario una forma de reconectar a mano.
 */

let reconexionEnCurso = null;

function intentarReconexionSilenciosa() {
  if (reconexionEnCurso) return reconexionEnCurso; // evita refrescos duplicados en paralelo
  const timeoutMs = 8000;
  reconexionEnCurso = Promise.race([
    refrescarAccessTokenGoogle(correoConocido()),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Tiempo de espera agotado al refrescar el token de Google (posible bloqueo del navegador).")), timeoutMs)
    ),
  ])
    .then(({ token, expiresIn }) => {
      establecerTokenActivo(token, expiresIn);
      if (estado.pendienteSync) intentarSincronizar();
    })
    .catch((e) => {
      console.warn("No se pudo reconectar la sesión de Google en silencio:", e);
      // Solo se muestra el aviso si de verdad hace falta sincronizar algo —
      // no queremos asustar al usuario apenas abre la app si todavía no ha
      // cambiado nada.
      if (estado.pendienteSync) mostrarAvisoReconexion();
    })
    .finally(() => {
      reconexionEnCurso = null;
    });
  return reconexionEnCurso;
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
    intentarReconexionSilenciosa();
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
    let nuevoToken, expiresIn;
    try {
      ({ token: nuevoToken, expiresIn } = await refrescarAccessTokenGoogle(correoConocido()));
    } catch (errorRefresco) {
      console.warn("No se pudo refrescar el token de Google automáticamente:", errorRefresco);
      const error = new Error("No se pudo renovar la sesión con Drive.");
      error.reconexionFallida = true;
      throw error;
    }
    establecerTokenActivo(nuevoToken, expiresIn);
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
      await intentarReconexionSilenciosa();
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
  aplicarPaleta(estado.datos.configuracion.paleta, estado.datos.configuracion.modo);
  renderizarSelectorPlan();
  renderizarAjustes();
  renderizarModoHardcore();
  renderizarEnlacesRapidos();
  renderizarPerfil();
  if (typeof renderizarPlanEstudios === "function") renderizarPlanEstudios();
  marcarUltimaSincronizacionConfirmada();
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
    await intentarReconexionSilenciosa();
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
}

export {
  actualizarIndicadorSync,
  aplicarDatosRemotosFrescos,
  conReintentoSi401,
  contadorCargando,
  forzarSincronizacion,
  inicializarPullToRefresh,
  intentarReconexionSilenciosa,
  intentarSincronizar,
  marcarCambioPendiente,
  marcarUltimaSincronizacionConfirmada,
  mostrarAvisoReconexion,
  mostrarCargando,
  ocultarAvisoReconexion,
  ocultarCargando,
  programarRefrescoProactivo,
  reconexionEnCurso,
  sincronizarAhora,
  sondearCambiosRemotos,
  temporizadorRefrescoProactivo,
};
