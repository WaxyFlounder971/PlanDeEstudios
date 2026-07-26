/* =========================================================================
   APP.JS — Cimientos (Iteración 0)
   Encargado de: pantalla de login, cargar/guardar datos (offline-first +
   Google Drive), selector de plan activo, ajustes generales, cerrar sesión,
   layout responsivo (sidebar/drawer), perfil de Google y modal de enlaces.
   Las demás secciones del menú (Plan de Estudios, Semestres, etc.) quedan
   como "próximamente" — se construyen en las siguientes iteraciones.
   ========================================================================= */

const CLAVE_CACHE_LOCAL = "app_academica_cache";
const CLAVE_SIDEBAR_COLAPSADA = "sidebar_colapsada";
const CLAVE_TOKEN_CACHE = "google_token_cache";

/**
 * v9 (punto 2 — cachear el token con su expiración, no pedirlo de cero en
 * cada carga): guarda { token, expiraEn } en localStorage cada vez que se
 * obtiene un access_token nuevo (login, refresco silencioso, refresco
 * manual o refresco tras 401).
 */
function guardarTokenCache(token, expiresInSegundos) {
  const segundos = Number(expiresInSegundos) || 3600;
  const expiraEn = Date.now() + segundos * 1000;
  localStorage.setItem(CLAVE_TOKEN_CACHE, JSON.stringify({ token, expiraEn }));
}

/**
 * Devuelve { token, expiraEn } SOLO si hay un token cacheado y todavía le
 * quedan más de 5 minutos de vida (el mismo margen que usa el refresco
 * proactivo) — si le queda menos, se trata como inválido a propósito para
 * no arriesgarse a usarlo y toparse con un 401 a mitad de una operación.
 * Si no hay nada usable, devuelve null y quien llama debe recurrir al
 * refresco silencioso normal.
 */
function leerTokenCacheValido() {
  try {
    const crudo = localStorage.getItem(CLAVE_TOKEN_CACHE);
    if (!crudo) return null;
    const { token, expiraEn } = JSON.parse(crudo);
    if (!token || !expiraEn || Date.now() >= expiraEn - 5 * 60 * 1000) return null;
    return { token, expiraEn };
  } catch (e) {
    return null;
  }
}

function borrarTokenCache() {
  localStorage.removeItem(CLAVE_TOKEN_CACHE);
}

/**
 * Punto único por el que la app debe pasar cada vez que obtiene un token
 * válido (login, reconexión silenciosa, reconexión manual, refresco tras
 * 401): guarda el token en memoria, lo cachea con su expiración, programa
 * el siguiente refresco proactivo, y refleja "conexión OK" tanto en el
 * banner de reconexión como en el indicador de sincronización (punto 4).
 */
function establecerTokenActivo(token, expiresInSegundos) {
  estado.token = token;
  guardarTokenCache(token, expiresInSegundos);
  programarRefrescoProactivo(expiresInSegundos);
  estado.conexionDrive = "ok";
  ocultarAvisoReconexion();
}

/** Colores reales de cada paleta (modo oscuro), tomados de design-system.css.
 *  Se usan para pintar cada cuadro del selector con SU propio color, sin
 *  importar cuál paleta esté activa en <html> (punto 3 del prompt). */
const COLORES_PREVIEW_PALETA = {
  blanco:    ["#94A3B8", "#F1F5F9"],
  gris:      ["#4B5563", "#9CA3AF"],
  negro:     ["#18181B", "#000000"],
  rojo:      ["#B91C1C", "#F87171"],
  dorado:    ["#92400E", "#FBBF24"],
  amarillo:  ["#A16207", "#FDE047"],
  verde:     ["#15803D", "#4ADE80"],
  cyan:      ["#0E7490", "#22D3EE"],
  azul:      ["#2563EB", "#38BDF8"],
  indigo:    ["#4338CA", "#818CF8"],
  morado:    ["#6D28D9", "#C084FC"],
  rosado:    ["#BE185D", "#F472B6"],
  // "azucarado" no usa este formato [c1, c2]: tiene su propio fondo disperso
  // (ver FONDO_PREVIEW_AZUCARADO), igual que --gradient-accent en el CSS.
};

/** Fondo tipo "mancha de color" disperso para el swatch de azucarado (mismas
 *  manchas radiales que --gradient-accent de [data-palette="azucarado"] en
 *  design-system.css): pastel frío de rosa a cyan, sin verde ni amarillo. */
const FONDO_PREVIEW_AZUCARADO =
  "radial-gradient(120% 120% at 12% 20%, #F5A9D0 0%, transparent 42%)," +
  "radial-gradient(120% 120% at 88% 10%, #C599E8 0%, transparent 42%)," +
  "radial-gradient(120% 120% at 18% 90%, #9DC0F5 0%, transparent 42%)," +
  "radial-gradient(120% 120% at 85% 85%, #8FE3EA 0%, transparent 42%)," +
  "linear-gradient(135deg, #E0A0E8, #9DC0F5)";

/** Color de texto legible sobre el degradado de cada paleta (mismo criterio
 *  que --on-accent en el CSS: "blanco" necesita texto oscuro). */
const TEXTO_PREVIEW_PALETA = {
  blanco: "#1E293B",
};

const estado = {
  token: null,
  fileId: null,
  datos: null,
  pendienteSync: false,
  enlaceEditandoId: null,
  // "ok" | "desconectado" — refleja el 3er estado real del indicador de
  // sincronización (punto 4): no hay forma de renovar el token solo.
  conexionDrive: "ok",
  // Última modifiedTime de Drive que la app conoce (propia o ajena) — la usa
  // el sondeo periódico (punto 5) para detectar cambios hechos desde otro
  // dispositivo sin descargar el archivo completo en cada revisión.
  ultimoModifiedTimeConocido: null,
};

/**
 * v9 (punto 5 — condición de carrera en el arranque): promesa que se
 * resuelve una sola vez, cuando ya se supo si hay o no un token de Drive
 * utilizable (venga de caché válida o de un intento de reconexión que haya
 * terminado, con éxito o sin él). intentarSincronizar() y el sondeo
 * multi-dispositivo esperan esta promesa antes de tocar estado.token, para
 * que ningún intento se dispare a mitad de la inicialización de auth.
 */
let resolverAuthListo;
const authListo = new Promise((resolve) => {
  resolverAuthListo = resolve;
});

/* ---------------------------- Arranque ---------------------------- */

window.addEventListener("DOMContentLoaded", () => {
  aplicarTemaGuardadoLocalmente(); // para que no haya "flash" de color al cargar

  const btnLogin = document.getElementById("btn-login-google");
  const textoOriginalBtnLogin = btnLogin.textContent;
  // Bug 1 (v8): se define aquí arriba porque alListo (más abajo) la lee, pero
  // su valor real se fija después de leer la caché — como es una closure
  // sobre la variable (no una copia), para cuando alListo se dispare (async,
  // tras cargar el script de Google) ya va a tener el valor correcto.
  let habiaCacheAlCargar = false;

  // Mientras el script de Google no esté listo, el botón queda deshabilitado
  // en vez de fallar en silencio al hacer click (esta espera es la causa
  // raíz de que antes el login fallara "al azar").
  btnLogin.disabled = true;
  btnLogin.textContent = "Cargando inicio de sesión…";

  inicializarGoogleAuth({
    alObtenerToken: onLoginExitoso,
    alListo: () => {
      btnLogin.disabled = false;
      btnLogin.textContent = textoOriginalBtnLogin;
      // Bug 1 (v8): si esta carga viene de una sesión guardada en caché
      // (usuario recurrente), la pantalla de login nunca se muestra y por lo
      // tanto iniciarSesionConGoogle() nunca se llama — sin esto, estado.token
      // se quedaba en null para siempre y la sincronización con Drive jamás
      // se intentaba (fallaba en silencio, sin ningún error en consola).
      if (habiaCacheAlCargar) {
        // v9 (punto 2): antes de pedirle nada a Google, se revisa si ya
        // había un access_token cacheado que todavía no expiró. Si lo hay,
        // se usa directamente — CERO llamadas a Google en esta carga. Esto
        // es lo que corrige "cada vez que recargo se abre la pantalla de
        // Google": antes se pedía un token nuevo (aunque fuera en silencio)
        // en cada carga sin revisar primero si el que ya se tenía servía.
        const tokenCache = leerTokenCacheValido();
        if (tokenCache) {
          estado.token = tokenCache.token;
          estado.conexionDrive = "ok";
          programarRefrescoProactivo(Math.round((tokenCache.expiraEn - Date.now()) / 1000));
          resolverAuthListo();
          if (estado.pendienteSync) intentarSincronizar();
        } else {
          intentarReconexionSilenciosa().finally(resolverAuthListo);
        }
      } else {
        // No había sesión en caché (se muestra la pantalla de login): no hay
        // nada que sincronizar todavía, así que la "inicialización de auth"
        // se da por terminada de inmediato.
        resolverAuthListo();
      }
    },
    alFallar: () => {
      btnLogin.textContent = textoOriginalBtnLogin;
      btnLogin.disabled = false; // se reactiva para permitir reintentar
      const aviso = document.getElementById("aviso-login-bloqueado");
      aviso.textContent =
        "No se pudo cargar el inicio de sesión de Google. Revisa tu conexión a internet, desactiva bloqueadores de anuncios/VPN para este sitio, y recarga la página.";
      aviso.classList.remove("oculto");
      // Sin esto, si el script de Google nunca carga, authListo se queda
      // pendiente para siempre y cualquier intento de sync/sondeo quedaría
      // esperando indefinidamente en vez de simplemente no tener nada que
      // hacer sin token.
      estado.conexionDrive = habiaCacheAlCargar ? "desconectado" : "ok";
      actualizarIndicadorSync();
      resolverAuthListo();
    },
    alRechazarPermiso: (motivo) => {
      btnLogin.textContent = textoOriginalBtnLogin;
      btnLogin.disabled = false;
      const aviso = document.getElementById("aviso-permiso-rechazado");
      // Ajuste (v8): mensaje específico cuando sí se completó el login pero
      // sin la casilla de Drive marcada, para que quede claro qué faltó.
      aviso.textContent =
        motivo === "permiso_drive_no_otorgado"
          ? "No se completó el inicio de sesión: aceptaste tu cuenta de Google pero no marcaste el permiso de Google Drive, que es obligatorio para poder guardar tus datos. Vuelve a intentarlo y esta vez acepta también el permiso de Drive."
          : "No se completó el inicio de sesión: para usar la app necesitas aceptar el permiso de Google Drive. Vuelve a intentarlo y acepta el permiso cuando Google te lo pida.";
      aviso.classList.remove("oculto");
    },
  });

  // Punto 8: el click debe llamar iniciarSesionConGoogle() de forma directa
  // e inmediata (sin async/await de por medio) para no romper el gesto de
  // usuario en navegadores móviles.
  btnLogin.addEventListener("click", () => {
    ocultarAvisoLoginBloqueado();
    iniciarSesionConGoogle();
    programarAvisoLoginBloqueado();
  });

  document.getElementById("btn-logout").addEventListener("click", pedirConfirmacionCerrarSesion);
  document.getElementById("btn-logout-popover").addEventListener("click", pedirConfirmacionCerrarSesion);
  // Ajuste 1: ya no hay botón separado de sincronizar; el propio indicador
  // reacciona a mantener-presionado (~500ms) o clic derecho.
  agregarLongPress(document.getElementById("indicador-sync"), forzarSincronizacion);

  window.addEventListener("online", intentarSincronizar);

  // Aviso NATIVO del navegador (no personalizable, restricción de seguridad)
  // si se intenta recargar/cerrar la pestaña con cambios sin sincronizar.
  window.addEventListener("beforeunload", (e) => {
    if (estado.pendienteSync) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  inicializarLayoutResponsivo();
  inicializarModalEnlace();
  inicializarModalConfirmacion();
  inicializarNavegacionSecciones();
  inicializarBotonesCerrarModal();
  inicializarPullToRefresh();

  const cache = leerCacheLocal();
  if (cache && cache.datos) {
    // Ya había una sesión local: mostramos la app de inmediato (offline-first).
    // estado.token queda en null aquí a propósito — se obtiene en segundo
    // plano en alListo() de arriba, vía intentarReconexionSilenciosa(), sin
    // bloquear el primer render de la app.
    habiaCacheAlCargar = true;
    estado.datos = migrarDatosAntiguos(cache.datos);
    estado.fileId = cache.fileId;
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    mostrarApp();
  }

  document.getElementById("btn-reconectar-sesion").addEventListener("click", () => {
    // Se llama de forma DIRECTA (sin async antes), igual que
    // iniciarSesionConGoogle(), para no romper el gesto de usuario en
    // navegadores móviles — necesario porque un click real evita el bloqueo
    // de popups que sí puede afectar al refresco silencioso automático.
    document.getElementById("aviso-reconexion").classList.add("oculto"); // ocultamiento visual inmediato, optimista
    refrescarAccessTokenGoogle()
      .then(({ token, expiresIn }) => {
        establecerTokenActivo(token, expiresIn);
        if (estado.pendienteSync) intentarSincronizar();
        else if (estado.ultimoModifiedTimeConocido) sondearCambiosRemotos();
      })
      .catch((e) => {
        console.warn("No se pudo reconectar la sesión de Google:", e);
        mostrarAvisoReconexion();
      });
  });

  // Punto 4: el indicador mismo también sirve de botón de reconexión cuando
  // está en el 3er estado ("Sin conexión con Drive — toca para reconectar"),
  // sin depender únicamente del banner separado.
  document.getElementById("indicador-sync").addEventListener("click", () => {
    if (estado.conexionDrive === "desconectado") {
      document.getElementById("btn-reconectar-sesion").click();
    }
  });

  // Bug 1 (v8): reintento periódico — antes, si un intento de sincronización
  // fallaba (token vencido, red inestable, etc.), no volvía a intentarse
  // hasta el próximo cambio del usuario o el próximo evento "online". Esto
  // cubre el caso de que la app se quede abierta sin que el usuario edite
  // nada más, pero con cambios (o una reconexión) todavía pendientes.
  setInterval(() => {
    if (estado.pendienteSync || !estado.token) intentarSincronizar();
  }, 45000);

  // v9 (punto 5 — sondeo multi-dispositivo): cada ~9s revisa SOLO el
  // modifiedTime del archivo en Drive (llamada barata, ver
  // obtenerMetadatosArchivo en auth.js) para detectar cambios guardados
  // desde otro dispositivo/pestaña. Se registra aquí, en el arranque, sin
  // depender de ningún gesto del usuario (a diferencia del pull-to-refresh,
  // que es un mecanismo aparte). Antes esta función existía en auth.js pero
  // nunca se llamaba desde ningún lado — por eso los cambios de un
  // dispositivo nunca llegaban al otro.
  setInterval(sondearCambiosRemotos, 9000);
});

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
    refrescarAccessTokenGoogle(),
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

  // v9 (punto 6, fix real): en Chrome/Safari de móvil el pull-to-refresh
  // NATIVO del navegador puede ganarle al gesto propio incluso con
  // preventDefault() en pointermove, porque el navegador decide si va a
  // interceptar el gesto ANTES de que ese evento no-pasivo se procese. La
  // forma correcta de cederle el control al JS es declarar
  // "overscroll-behavior-y: contain" en el elemento que hace scroll (html y
  // body) — así el navegador nunca activa su propio refresco/rebote nativo
  // ahí, y el gesto queda enteramente en manos de este código. No se toca
  // css/design-system.css (no está disponible en este contexto) porque esta
  // propiedad es segura de fijar por JS y no depende del resto de estilos.
  document.documentElement.style.overscrollBehaviorY = "contain";
  document.body.style.overscrollBehaviorY = "contain";

  const UMBRAL_PX = 78;
  const MAX_ARRASTRE_PX = 120;
  let arrastreInicioY = null;
  let arrastrando = false;
  let listoParaSoltar = false;
  let sincronizando = false;

  function posicion(distancia) {
    // Recorrido con resistencia (como el pull-to-refresh nativo): se mueve
    // más rápido al principio y se frena cerca del máximo.
    const limitada = Math.min(distancia, MAX_ARRASTRE_PX);
    return -60 + limitada * 0.9;
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
      arrastrando = true;
      indicador.classList.add("arrastrando");
      // Punto 6: si el arrastre se hace con mouse en escritorio (sin dedo),
      // evita que se seleccione texto de la página por accidente mientras
      // dura el gesto.
      document.body.style.userSelect = "none";
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
      if (!arrastrando || arrastreInicioY === null) return;
      // Si a mitad de gesto la página ya no está en el tope (el usuario
      // terminó soltando en scroll normal), se cancela el gesto sin tocar
      // nada más.
      if (window.scrollY > 4) {
        arrastrando = false;
        indicador.classList.remove("visible", "listo", "arrastrando");
        indicador.style.transform = "";
        return;
      }
      const distancia = e.clientY - arrastreInicioY;
      if (distancia <= 0) {
        indicador.classList.remove("visible", "listo");
        return;
      }
      // A partir de aquí sí es un arrastre hacia abajo con la página en el
      // tope: se bloquea el comportamiento nativo del navegador (rebote de
      // scroll / pull-to-refresh nativo) para que no compita con el gesto.
      e.preventDefault();
      listoParaSoltar = distancia >= UMBRAL_PX;
      indicador.classList.add("visible");
      indicador.classList.toggle("listo", listoParaSoltar);
      indicador.style.transform = `translate(-50%, ${posicion(distancia)}px)`;
    },
    { passive: false }
  );

  async function soltar() {
    if (!arrastrando) return;
    arrastrando = false;
    indicador.classList.remove("arrastrando");
    arrastreInicioY = null;
    document.body.style.userSelect = ""; // punto 6: restaura la selección normal de texto

    if (!listoParaSoltar) {
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
    const datosFrescos = await leerDatos(estado.token, estado.fileId);
    aplicarDatosRemotosFrescos(datosFrescos);
    try {
      const meta = await obtenerMetadatosArchivo(estado.token, estado.fileId);
      estado.ultimoModifiedTimeConocido = meta.modifiedTime;
    } catch (e) {
      // No crítico: si falla, el próximo ciclo de sondeo simplemente
      // establece la base de comparación de nuevo.
    }
    mostrarToast("✓ Datos actualizados");
  } catch (e) {
    console.warn("No se pudo actualizar los datos:", e);
    mostrarToast("No se pudo actualizar. Intenta de nuevo.");
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
  estado.datos = migrarDatosAntiguos(datosFrescos);
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
    const meta = await obtenerMetadatosArchivo(estado.token, estado.fileId);
    if (!estado.ultimoModifiedTimeConocido) {
      estado.ultimoModifiedTimeConocido = meta.modifiedTime; // primera vez: solo fija la base de comparación
      return;
    }
    if (meta.modifiedTime === estado.ultimoModifiedTimeConocido) return; // sin cambios desde el último sondeo

    estado.ultimoModifiedTimeConocido = meta.modifiedTime;
    const datosFrescos = await leerDatos(estado.token, estado.fileId);
    aplicarDatosRemotosFrescos(datosFrescos);
  } catch (e) {
    if (e.status === 401) {
      // El token venció justo entre sondeos: se limpia para que el próximo
      // ciclo (o el próximo guardado) dispare la reconexión normal.
      estado.token = null;
    }
    console.warn("No se pudo sondear cambios remotos de Drive:", e);
  }
}

/* ------------------------------ Login ------------------------------ */

let temporizadorAvisoLogin = null;

function programarAvisoLoginBloqueado() {
  clearTimeout(temporizadorAvisoLogin);
  temporizadorAvisoLogin = setTimeout(() => {
    const aviso = document.getElementById("aviso-login-bloqueado");
    if (!aviso) return;
    aviso.textContent =
      "No se pudo abrir el inicio de sesión. Si usas VPN, un bloqueador de anuncios o una extensión de privacidad, desactívalo para este sitio e intenta de nuevo.";
    aviso.classList.remove("oculto");
  }, 6000);
}

function ocultarAvisoLoginBloqueado() {
  clearTimeout(temporizadorAvisoLogin);
  const aviso = document.getElementById("aviso-login-bloqueado");
  if (aviso) aviso.classList.add("oculto");
  const avisoPermiso = document.getElementById("aviso-permiso-rechazado");
  if (avisoPermiso) avisoPermiso.classList.add("oculto");
}

async function onLoginExitoso(token, expiresIn) {
  ocultarAvisoLoginBloqueado();
  establecerTokenActivo(token, expiresIn);
  // Este login es la primera vez que la app sabe si hay token o no en esta
  // carga (no venía de una sesión en caché) — resuelve authListo aquí por
  // si algún sondeo/sincronización quedó esperándola.
  resolverAuthListo();
  mostrarCargando();
  // v8.3: le pide al navegador que este sitio quede en la lista de
  // almacenamiento "persistente" (no elegible para borrado automático por
  // presión de espacio) — reduce el riesgo de que un móvil borre la sesión
  // en caché sin que el usuario haya cerrado sesión a propósito.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
  try {
    const { fileId, datos } = await buscarOCrearArchivoDatos(token);
    estado.fileId = fileId;
    estado.datos = migrarDatosAntiguos(datos);

    // Punto 6: nombre + foto de perfil de Google.
    const perfilGoogle = await obtenerPerfilGoogle(token);
    if (perfilGoogle) {
      estado.datos.perfil.nombre = perfilGoogle.nombre;
      estado.datos.perfil.foto_url = perfilGoogle.foto_url;
      estado.datos.perfil.correo = perfilGoogle.correo || estado.datos.perfil.correo;
    }

    guardarCacheLocal();
    // Punto 5: fija la base de comparación del sondeo multi-dispositivo con
    // la versión que se acaba de leer/crear, para no confundirla luego con
    // un cambio hecho desde otro dispositivo.
    try {
      const meta = await obtenerMetadatosArchivo(token, fileId);
      estado.ultimoModifiedTimeConocido = meta.modifiedTime;
    } catch (e) {
      // No crítico: si falla, el primer sondeo simplemente fija la base.
    }
    mostrarApp();
  } finally {
    ocultarCargando();
  }
}

function mostrarApp() {
  document.getElementById("pantalla-login").classList.add("oculto");
  document.getElementById("app-shell").classList.remove("oculto");
  aplicarPaleta(estado.datos.configuracion.paleta, estado.datos.configuracion.modo);
  renderizarSelectorPlan();
  renderizarAjustes();
  renderizarModoHardcore();
  renderizarEnlacesRapidos();
  renderizarPerfil();
  restaurarEstadoSidebar();
  if (typeof renderizarPlanEstudios === "function") renderizarPlanEstudios();
  // Bug 3: antes mostrarSeccion() solo se llamaba desde clics del nav, así que
  // tras un refresh la sección de Plan de Estudios se quedaba con la clase
  // "oculto" del HTML aunque su contenido sí se hubiera renderizado.
  mostrarSeccion(localStorage.getItem(CLAVE_SECCION_ACTIVA) || "plan-estudios");
}

/* --------------------------- Cerrar sesión --------------------------- */

/** Punto 9 (Parte 2): si hay cambios sin sincronizar, se advierte antes de
 *  cerrar sesión — perderlos del dispositivo sería irreversible. */
function pedirConfirmacionCerrarSesion() {
  togglePerfilPopover(true);
  if (!estado.pendienteSync) {
    cerrarSesion();
    return;
  }
  abrirConfirmacion({
    titulo: "⚠️ Cambios sin sincronizar",
    mensaje: "Tienes cambios sin sincronizar. Si cierras sesión ahora, se perderán del dispositivo. ¿Deseas continuar?",
    textoConfirmar: "Cerrar sesión de todas formas",
    onConfirmar: cerrarSesion,
  });
}

function cerrarSesion() {
  clearTimeout(temporizadorRefrescoProactivo);
  cerrarSesionGoogle();
  localStorage.removeItem(CLAVE_CACHE_LOCAL);
  borrarTokenCache();
  estado.token = null;
  estado.fileId = null;
  estado.datos = null;
  estado.conexionDrive = "ok";
  estado.ultimoModifiedTimeConocido = null;
  document.getElementById("app-shell").classList.add("oculto");
  document.getElementById("pantalla-login").classList.remove("oculto");
}

/* ------------------------- Cache local (offline) ------------------------- */

function guardarCacheLocal() {
  localStorage.setItem(
    CLAVE_CACHE_LOCAL,
    JSON.stringify({ fileId: estado.fileId, datos: estado.datos })
  );
}

function leerCacheLocal() {
  const crudo = localStorage.getItem(CLAVE_CACHE_LOCAL);
  return crudo ? JSON.parse(crudo) : null;
}

/**
 * Helper reutilizable: ejecuta `callback` cuando el elemento se mantiene
 * presionado (~500ms) o se hace clic derecho sobre él. Usado por el
 * indicador de sync (Ajuste 1) y por el badge de categoría de una materia
 * individual (Ajuste 7).
 */
function agregarLongPress(el, callback, duracionMs = 500) {
  if (!el) return;
  let timer = null;
  el.addEventListener("pointerdown", () => {
    timer = setTimeout(callback, duracionMs);
  });
  el.addEventListener("pointerup", () => clearTimeout(timer));
  el.addEventListener("pointerleave", () => clearTimeout(timer));
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    callback();
  });
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
    const meta = await guardarDatos(estado.token, estado.fileId, estado.datos);
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

    if (e.status === 401) {
      // Token expirado (duran ~1h y no se refrescan solos): se pide uno
      // nuevo en silencio y, si se obtiene, se reintenta esta misma
      // sincronización de inmediato.
      estado.token = null; // fuerza que el próximo intento pase por la reconexión de arriba
      try {
        const { token: nuevoToken, expiresIn } = await refrescarAccessTokenGoogle();
        establecerTokenActivo(nuevoToken, expiresIn);
        const meta = await guardarDatos(estado.token, estado.fileId, estado.datos);
        estado.pendienteSync = false;
        if (meta && meta.modifiedTime) estado.ultimoModifiedTimeConocido = meta.modifiedTime;
        actualizarIndicadorSync();
        return;
      } catch (errorRefresco) {
        console.warn("No se pudo refrescar el token de Google automáticamente:", errorRefresco);
        mostrarAvisoReconexion();
      }
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

/* ------------------------------ Tema ------------------------------ */

function aplicarPaleta(paleta, modo) {
  document.documentElement.setAttribute("data-palette", paleta);
  document.documentElement.setAttribute("data-mode", modo);
  localStorage.setItem("tema_paleta", paleta);
  localStorage.setItem("tema_modo", modo);
}

function aplicarTemaGuardadoLocalmente() {
  const paleta = localStorage.getItem("tema_paleta") || "azul";
  const modo = localStorage.getItem("tema_modo") || "dark";
  document.documentElement.setAttribute("data-palette", paleta);
  document.documentElement.setAttribute("data-mode", modo);
}

/* --------------------------- Selector de plan --------------------------- */

function renderizarSelectorPlan() {
  const cont = document.getElementById("selector-plan");
  const planes = estado.datos.planes_estudio;

  if (planes.length === 0) {
    cont.innerHTML = `<p class="muted">Todavía no tienes ningún Plan de Estudios. Eso se agrega en la Iteración 1 (importar tu malla curricular).</p>`;
    return;
  }

  cont.innerHTML = "";
  const grupo = document.createElement("div");
  grupo.className = "pill-group";
  planes.forEach((plan) => {
    const btn = document.createElement("button");
    btn.className = "pill-item" + (plan.id === estado.datos.configuracion.plan_activo_id ? " active" : "");
    btn.textContent = `${plan.universidad} · ${plan.nombre_carrera}`;
    btn.addEventListener("click", () => {
      estado.datos.configuracion.plan_activo_id = plan.id;
      marcarCambioPendiente();
      renderizarSelectorPlan();
    });
    grupo.appendChild(btn);
  });
  cont.appendChild(grupo);
}

/* ------------------------------ Ajustes ------------------------------ */

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
      marcarCambioPendiente();
      renderizarAjustes();
    });
    grid.appendChild(sw);
  });

  // Modo claro/oscuro
  const chkModo = document.getElementById("switch-modo");
  chkModo.checked = estado.datos.configuracion.modo === "light";
  chkModo.onchange = () => {
    const nuevoModo = chkModo.checked ? "light" : "dark";
    estado.datos.configuracion.modo = nuevoModo;
    aplicarPaleta(estado.datos.configuracion.paleta, nuevoModo);
    marcarCambioPendiente();
  };

  // Escala de notas global
  const grupoEscala = document.getElementById("pill-escala-notas");
  grupoEscala.querySelectorAll(".pill-item").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.valor) === estado.datos.configuracion.escala_notas_global);
    btn.onclick = () => {
      estado.datos.configuracion.escala_notas_global = Number(btn.dataset.valor);
      marcarCambioPendiente();
      renderizarAjustes();
    };
  });

  // Formato de texto de nombres de materias/carrera (v5 #9)
  const grupoFormato = document.getElementById("pill-formato-texto");
  if (grupoFormato) {
    grupoFormato.querySelectorAll(".pill-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.valor === (estado.datos.configuracion.formato_texto_nombres || "titulo"));
      btn.onclick = () => {
        estado.datos.configuracion.formato_texto_nombres = btn.dataset.valor;
        marcarCambioPendiente();
        renderizarAjustes();
        if (typeof renderizarPlanEstudios === "function") renderizarPlanEstudios();
      };
    });
  }

  actualizarIndicadorSync();
}

/* --------------------------- Modo Hardcore 💀 --------------------------- */

function renderizarModoHardcore() {
  const cfg = estado.datos.configuracion;
  const chk = document.getElementById("switch-modo-hardcore");
  const bloque = document.getElementById("bloque-plan-secundario");

  chk.checked = !!cfg.modo_hardcore;
  bloque.classList.toggle("oculto", !cfg.modo_hardcore);

  chk.onchange = () => {
    cfg.modo_hardcore = chk.checked;
    if (!cfg.modo_hardcore) {
      // No se borran datos, solo se deja de combinar/mostrar el segundo plan.
      bloque.classList.add("oculto");
    } else {
      bloque.classList.remove("oculto");
    }
    marcarCambioPendiente();
    if (typeof renderizarPlanEstudios === "function") renderizarPlanEstudios();
  };

  const cont = document.getElementById("selector-plan-secundario");
  const planes = estado.datos.planes_estudio.filter((p) => p.id !== cfg.plan_activo_id);
  cont.innerHTML = "";

  if (planes.length === 0) {
    cont.innerHTML = `<p class="muted">Necesitas al menos un segundo Plan de Estudios importado para usar el Modo Hardcore.</p>`;
    return;
  }

  const grupo = document.createElement("div");
  grupo.className = "pill-group";
  planes.forEach((plan) => {
    const btn = document.createElement("button");
    btn.className = "pill-item" + (plan.id === cfg.plan_activo_secundario_id ? " active" : "");
    btn.textContent = `${plan.universidad} · ${plan.nombre_carrera}`;
    btn.addEventListener("click", () => {
      cfg.plan_activo_secundario_id = plan.id;
      marcarCambioPendiente();
      renderizarModoHardcore();
      if (typeof renderizarPlanEstudios === "function") renderizarPlanEstudios();
    });
    grupo.appendChild(btn);
  });
  cont.appendChild(grupo);
}

/* --------------------------- Navegación entre secciones --------------------------- */

const CLAVE_SECCION_ACTIVA = "seccion_activa_v1";

function inicializarNavegacionSecciones() {
  document.querySelectorAll(".btn-nav[data-seccion]").forEach((btn) => {
    btn.addEventListener("click", () => mostrarSeccion(btn.dataset.seccion));
  });
}

function mostrarSeccion(nombre) {
  const secciones = { configuracion: "seccion-configuracion", "plan-estudios": "seccion-plan-estudios" };
  Object.entries(secciones).forEach(([clave, idEl]) => {
    const el = document.getElementById(idEl);
    if (el) el.classList.toggle("oculto", clave !== nombre);
  });
  document.querySelectorAll(".btn-nav[data-seccion]").forEach((btn) => {
    const activo = btn.dataset.seccion === nombre;
    btn.classList.toggle("btn-primary", activo);
    btn.classList.toggle("btn-secondary", !activo);
  });
  localStorage.setItem(CLAVE_SECCION_ACTIVA, nombre);
}

/* --------------------------- Enlaces rápidos --------------------------- */

function renderizarEnlacesRapidos() {
  const enlaces = estado.datos.configuracion.enlaces_rapidos;

  renderizarListaEnlacesEn("lista-enlaces", enlaces, true);
  renderizarListaEnlacesEn("lista-enlaces-lateral", enlaces, false);

  const btnAgregar = document.getElementById("btn-agregar-enlace");
  btnAgregar.disabled = enlaces.length >= LIMITE_ENLACES_RAPIDOS;
  btnAgregar.onclick = () => abrirModalEnlace();
}

/** Dibuja la lista de enlaces rápidos dentro de `contenedorId`. `conEditar`
 *  controla si aparece el lápiz de edición (sí en Configuración, no en el
 *  panel lateral fijo, que es solo de acceso rápido — v5 #2). */
function renderizarListaEnlacesEn(contenedorId, enlaces, conEditar) {
  const cont = document.getElementById(contenedorId);
  if (!cont) return;
  cont.innerHTML = "";

  if (enlaces.length === 0) {
    cont.innerHTML = `<p class="muted">Todavía no has añadido ningún enlace.</p>`;
    return;
  }

  enlaces.forEach((enlace) => {
    const item = document.createElement("div");
    item.className = "glass-panel row-between";
    item.style.padding = "10px 14px";

    const enlaceAbrir = document.createElement("a");
    enlaceAbrir.href = enlace.url;
    enlaceAbrir.target = "_blank";
    enlaceAbrir.rel = "noopener";
    enlaceAbrir.className = "row";
    enlaceAbrir.style.textDecoration = "none";
    enlaceAbrir.style.flex = "1";
    enlaceAbrir.style.minWidth = "0";
    enlaceAbrir.innerHTML = `<span style="font-size:1.3rem">${
      enlace.icono_tipo === "emoji" ? enlace.icono_valor : `<img src="${enlace.icono_valor}" style="width:24px;height:24px;border-radius:6px">`
    }</span><span class="enlace-rapido-nombre" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${enlace.nombre}</span>`;

    item.appendChild(enlaceAbrir);

    if (conEditar) {
      const btnEditar = document.createElement("button");
      btnEditar.className = "btn btn-secondary";
      btnEditar.title = "Editar enlace";
      btnEditar.textContent = "✏️";
      btnEditar.style.flexShrink = "0";
      btnEditar.addEventListener("click", () => abrirModalEnlace(enlace.id));
      item.appendChild(btnEditar);
    }

    cont.appendChild(item);
  });
}

/* ===================== Modal "Añadir enlace" (punto 7) ===================== */

function inicializarModalEnlace() {
  const modal = document.getElementById("modal-enlace");
  const pillTipo = document.getElementById("pill-tipo-icono");
  const bloqueEmoji = document.getElementById("bloque-icono-emoji");
  const bloqueImagen = document.getElementById("bloque-icono-imagen");

  pillTipo.querySelectorAll(".pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      pillTipo.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const esEmoji = btn.dataset.tipo === "emoji";
      bloqueEmoji.classList.toggle("oculto", !esEmoji);
      bloqueImagen.classList.toggle("oculto", esEmoji);
    });
  });

  document.getElementById("btn-cancelar-enlace").addEventListener("click", cerrarModalEnlace);
  document.getElementById("btn-guardar-enlace").addEventListener("click", guardarEnlaceDesdeModal);
  document.getElementById("btn-eliminar-enlace").addEventListener("click", eliminarEnlaceDesdeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) cerrarModalEnlace();
  });
}

/** Si se pasa `enlaceId`, abre el modal en modo edición precargando sus datos. */
function abrirModalEnlace(enlaceId) {
  const enlace = enlaceId
    ? estado.datos.configuracion.enlaces_rapidos.find((e) => e.id === enlaceId)
    : null;

  estado.enlaceEditandoId = enlace ? enlace.id : null;

  document.getElementById("titulo-modal-enlace").textContent = enlace ? "Editar enlace" : "Añadir enlace";
  document.getElementById("btn-eliminar-enlace").classList.toggle("oculto", !enlace);

  document.getElementById("input-enlace-nombre").value = enlace ? enlace.nombre : "";
  document.getElementById("input-enlace-url").value = enlace ? enlace.url : "";
  document.getElementById("input-enlace-emoji").value = enlace && enlace.icono_tipo === "emoji" ? enlace.icono_valor : "🔗";
  document.getElementById("input-enlace-imagen").value = "";
  document.getElementById("error-modal-enlace").classList.add("oculto");

  const esImagen = enlace && enlace.icono_tipo === "imagen";
  const pillTipo = document.getElementById("pill-tipo-icono");
  pillTipo.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
  pillTipo.querySelector(`[data-tipo="${esImagen ? "imagen" : "emoji"}"]`).classList.add("active");
  document.getElementById("bloque-icono-emoji").classList.toggle("oculto", esImagen);
  document.getElementById("bloque-icono-imagen").classList.toggle("oculto", !esImagen);

  document.getElementById("modal-enlace").classList.remove("oculto");
}

function cerrarModalEnlace() {
  document.getElementById("modal-enlace").classList.add("oculto");
  estado.enlaceEditandoId = null;
}

function eliminarEnlaceDesdeModal() {
  if (!estado.enlaceEditandoId) return;
  estado.datos.configuracion.enlaces_rapidos = estado.datos.configuracion.enlaces_rapidos.filter(
    (e) => e.id !== estado.enlaceEditandoId
  );
  marcarCambioPendiente();
  renderizarEnlacesRapidos();
  cerrarModalEnlace();
}

function mostrarErrorModalEnlace(mensaje) {
  const el = document.getElementById("error-modal-enlace");
  el.textContent = mensaje;
  el.classList.remove("oculto");
}

async function guardarEnlaceDesdeModal() {
  const nombre = document.getElementById("input-enlace-nombre").value.trim();
  const url = document.getElementById("input-enlace-url").value.trim();
  const tipoActivo = document.getElementById("pill-tipo-icono").querySelector(".pill-item.active").dataset.tipo;

  if (!nombre || !url) {
    mostrarErrorModalEnlace("El nombre y la URL son obligatorios.");
    return;
  }

  const enlaceExistente = estado.enlaceEditandoId
    ? estado.datos.configuracion.enlaces_rapidos.find((e) => e.id === estado.enlaceEditandoId)
    : null;

  if (!enlaceExistente && estado.datos.configuracion.enlaces_rapidos.length >= LIMITE_ENLACES_RAPIDOS) {
    mostrarErrorModalEnlace(`Ya tienes el máximo de ${LIMITE_ENLACES_RAPIDOS} enlaces.`);
    return;
  }

  let icono_tipo = "emoji";
  let icono_valor = "🔗";

  if (tipoActivo === "emoji") {
    icono_tipo = "emoji";
    icono_valor = document.getElementById("input-enlace-emoji").value.trim() || "🔗";
  } else {
    const archivo = document.getElementById("input-enlace-imagen").files[0];
    if (!archivo && !(enlaceExistente && enlaceExistente.icono_tipo === "imagen")) {
      mostrarErrorModalEnlace("Selecciona una imagen.");
      return;
    }
    if (archivo) {
      try {
        icono_valor = await convertirArchivoABase64(archivo);
        icono_tipo = "imagen";
      } catch (e) {
        mostrarErrorModalEnlace("No se pudo leer la imagen, intenta con otra.");
        return;
      }
    } else {
      // Se está editando y no se subió una imagen nueva: conserva la anterior.
      icono_tipo = "imagen";
      icono_valor = enlaceExistente.icono_valor;
    }
  }

  if (enlaceExistente) {
    enlaceExistente.nombre = nombre;
    enlaceExistente.url = url;
    enlaceExistente.icono_tipo = icono_tipo;
    enlaceExistente.icono_valor = icono_valor;
  } else {
    estado.datos.configuracion.enlaces_rapidos.push(
      crearEnlaceRapido({ nombre, url, icono_tipo, icono_valor })
    );
  }

  marcarCambioPendiente();
  renderizarEnlacesRapidos();
  cerrarModalEnlace();
}

function convertirArchivoABase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result);
    lector.onerror = () => reject(new Error("No se pudo leer el archivo"));
    lector.readAsDataURL(archivo);
  });
}

/* ===================== Confirmación genérica (reemplaza confirm() nativo) ===================== */

let callbackConfirmacionActual = null;

/**
 * Abre el modal de confirmación reutilizable. Uso:
 *   abrirConfirmacion({ titulo, mensaje, textoConfirmar, claseConfirmar, onConfirmar })
 * `claseConfirmar` es opcional (por defecto "btn-danger"; usa "btn-primary"
 * para acciones no destructivas).
 */
function abrirConfirmacion({ titulo, mensaje, textoConfirmar, claseConfirmar, onConfirmar }) {
  document.getElementById("titulo-modal-confirmacion").textContent = titulo || "¿Estás seguro?";
  document.getElementById("mensaje-modal-confirmacion").textContent = mensaje || "";
  const btn = document.getElementById("btn-aceptar-confirmacion");
  btn.textContent = textoConfirmar || "Confirmar";
  btn.className = "btn " + (claseConfirmar || "btn-danger");
  callbackConfirmacionActual = onConfirmar || null;
  document.getElementById("modal-confirmacion").classList.remove("oculto");
}

function cerrarConfirmacion() {
  document.getElementById("modal-confirmacion").classList.add("oculto");
  callbackConfirmacionActual = null;
}

function inicializarModalConfirmacion() {
  const modal = document.getElementById("modal-confirmacion");
  document.getElementById("btn-cancelar-confirmacion").addEventListener("click", cerrarConfirmacion);
  document.getElementById("btn-aceptar-confirmacion").addEventListener("click", () => {
    const cb = callbackConfirmacionActual;
    cerrarConfirmacion();
    if (cb) cb();
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) cerrarConfirmacion();
  });
}

/* ===================== Perfil de Google (punto 6) ===================== */

function renderizarPerfil() {
  const perfil = estado.datos.perfil;
  const foto = document.getElementById("perfil-foto");
  const fallback = document.getElementById("perfil-foto-fallback");
  const wrap = foto.closest(".perfil-foto-wrap");
  const nombre = document.getElementById("perfil-nombre");
  const popoverNombre = document.getElementById("perfil-popover-nombre");
  const popoverCorreo = document.getElementById("perfil-popover-correo");

  nombre.textContent = perfil.nombre || "";
  popoverNombre.textContent = perfil.nombre || "";
  popoverCorreo.textContent = perfil.correo || "";
  fallback.textContent = obtenerIniciales(perfil.nombre || perfil.correo || "?");

  // Empezamos mostrando el respaldo (iniciales); si la foto real carga bien,
  // la mostramos encima. Así nunca se ve un ícono de imagen rota.
  foto.classList.add("oculto");
  fallback.classList.remove("oculto");

  if (perfil.foto_url) {
    foto.onload = () => {
      foto.classList.remove("oculto");
      fallback.classList.add("oculto");
    };
    foto.onerror = () => {
      foto.classList.add("oculto");
      fallback.classList.remove("oculto");
    };
    foto.src = perfil.foto_url;
    foto.alt = perfil.nombre || "Foto de perfil";
  }

  wrap.onclick = () => {
    // El popover con confirmación solo tiene sentido cuando el sidebar está
    // colapsado (en expandido ya se ve el botón "Salir" directo).
    if (document.getElementById("app-sidebar").classList.contains("colapsada")) {
      togglePerfilPopover();
    }
  };
}

function obtenerIniciales(texto) {
  const partes = texto.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primera = partes[0][0] || "";
  const segunda = partes.length > 1 ? partes[1][0] || "" : "";
  return (primera + segunda).toUpperCase();
}

function togglePerfilPopover(forzarCerrado) {
  const popover = document.getElementById("perfil-popover");
  if (forzarCerrado) {
    popover.classList.add("oculto");
    return;
  }
  popover.classList.toggle("oculto");
}

document.addEventListener("click", (e) => {
  const popover = document.getElementById("perfil-popover");
  const wrap = document.querySelector(".perfil-foto-wrap");
  if (!popover || popover.classList.contains("oculto")) return;
  if ((wrap && wrap.contains(e.target)) || popover.contains(e.target)) return;
  popover.classList.add("oculto");
});

/* ===================== Layout responsivo (puntos 1 y 5) ===================== */

function inicializarLayoutResponsivo() {
  const sidebar = document.getElementById("app-sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  const btnHamburguesa = document.getElementById("btn-hamburguesa");
  const btnColapsar = document.getElementById("btn-colapsar-sidebar");

  btnHamburguesa.addEventListener("click", () => {
    sidebar.classList.add("abierta");
    overlay.classList.add("abierta");
  });

  overlay.addEventListener("click", cerrarSidebarMovil);

  // Cerrar el drawer móvil al usar cualquier botón de navegación/config.
  sidebar.addEventListener("click", (e) => {
    if (window.innerWidth < 900 && e.target.closest(".btn-nav")) {
      cerrarSidebarMovil();
    }
  });

  btnColapsar.addEventListener("click", () => {
    const colapsada = sidebar.classList.toggle("colapsada");
    localStorage.setItem(CLAVE_SIDEBAR_COLAPSADA, colapsada ? "1" : "0");
    togglePerfilPopover(true);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth >= 900) cerrarSidebarMovil();
  });
}

function cerrarSidebarMovil() {
  document.getElementById("app-sidebar").classList.remove("abierta");
  document.getElementById("sidebar-overlay").classList.remove("abierta");
}

function restaurarEstadoSidebar() {
  const colapsada = localStorage.getItem(CLAVE_SIDEBAR_COLAPSADA) === "1";
  document.getElementById("app-sidebar").classList.toggle("colapsada", colapsada);
}

/* ===================== Botón "X" propio en todos los modales (v5 #2) ===================== */

/**
 * Algunos modales tienen lógica extra al cerrarse (ej. limpiar un CSV en
 * espera). Para no duplicar esa lógica, el botón X simplemente dispara un
 * click sintético sobre el propio overlay del modal — reutilizando los
 * listeners de "clic afuera cierra" que cada modal ya tiene registrados
 * (todos comparan `e.target === modal`/`e.target.id === "..."`).
 */
function inicializarBotonesCerrarModal() {
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    const card = overlay.querySelector(".modal-card");
    if (!card || card.querySelector(".modal-x-close")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "modal-x-close";
    btn.setAttribute("aria-label", "Cerrar");
    btn.textContent = "✕";
    btn.addEventListener("click", () => {
      overlay.classList.add("oculto");
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    card.prepend(btn);
  });
}

/** Toast breve reutilizable (ej. "✓ Prompt copiado en el portapapeles", v5 #1.3). */
function mostrarToast(mensaje) {
  document.querySelectorAll(".toast-app").forEach((el) => el.remove());
  const toast = document.createElement("div");
  toast.className = "toast-app";
  toast.textContent = mensaje;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2400);
}
