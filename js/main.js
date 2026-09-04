/* =========================================================================
   ARRANQUE DE LA APP
   Login con Google, decide qué sección mostrar, conecta e inicializa
   todos los demás módulos.
   ========================================================================= */

import { aplicarModoRendimiento, renderizarAjustes } from "./config/config-ajustes.js";
import { inicializarModalEnlace, renderizarEnlacesRapidos } from "./config/config-enlaces.js";
import { buscarOCrearArchivoDatos, cerrarSesionGoogle, inicializarGoogleAuth, iniciarSesionConGoogle, obtenerMetadatosArchivo, obtenerPerfilGoogle } from "./core/auth.js";
import { migrarDatosAntiguos, sellarTimestamp } from "./core/schema.js";
import { fusionarDatos } from "./core/storage-merge.js";
import { actualizarIndicadorSync, asegurarTokenValido, forzarSincronizacion, inicializarPullToRefresh, inicializarReconexionAlVolverOnline, inicializarSondeoAlVolver, intentarSincronizar, marcarCambioPendiente, mostrarAvisoReconexion, programarRefrescoProactivo, registrarHookCierreSesionForzado, sincronizarAlIniciar, sondearCambiosRemotos, temporizadorRefrescoProactivo } from "./core/storage-sync.js";
import { CLAVE_CACHE_LOCAL, borrarTokenCache, establecerTokenActivo, estado, guardarCacheLocal, leerCacheLocal, leerTokenCacheValido, resolverAuthListo } from "./core/storage.js";
import { obtenerIniciales } from "./core/utils.js";
// Sincronización con Google Calendar (2026-08-25, reemplaza Web Push) —
// ver core/notificaciones-calendario.js.
import {
  actualizarResumenDiarioDelDia,
  inicializarModalPermisoCalendario,
  ofrecerActivarSincronizacionCalendario,
} from "./core/notificaciones-calendario.js";
import { inicializarComunidad, renderizarComunidad } from "./comunidad/comunidad.js";
import { renderizarFinanzas } from "./finanzas/finanzas.js";
import { inicializarModalCategoria, inicializarModalCategoriaMaterias } from "./plan/plan-categorias.js";
import { inicializarModalDesbloquea, inicializarModalHistorial, inicializarModalRequisito } from "./plan/plan-detalle.js";
import { inicializarModalCrearPlan, inicializarModalMateriaManual, inicializarModalVincularOptativa } from "./plan/plan-esquema.js";
import { inicializarModalEditarPlanInfo, inicializarModalGestionPlanes, renderizarModoHardcore, renderizarSelectorPlan } from "./plan/plan-gestionar.js";
import { inicializarModalCapturasPDF, inicializarModalInstruccionesImportacion } from "./plan/plan-importacion.js";
import { inicializarResponsivoListaPlan, renderizarPlanEstudios } from "./plan/plan-vista-lista.js";
import { renderizarSemestres } from "./semestres/semestres.js";
import { inicializarResumen, renderizarResumen } from "./resumen/resumen.js";
import { inicializarAgenda, renderizarAgenda } from "./agenda/agenda.js";
import { inicializarHorario, renderizarHorario } from "./horario/horario.js";
import { inicializarTiempoEstudio, renderizarTiempoEstudio } from "./tiempo-estudio/tiempo-estudio.js";
import { procesarAsociacionPendienteDeAmigo, iniciarRefrescoPeriodicoAmigos } from "./horario/horario-amigos.js";
// Asistente IA (Gemini): mismo patrón que horario.js/agenda.js arriba —
// este import no se usa directo acá, existe para que el navegador cargue
// el módulo y su línea `window.renderizarAsistente = renderizarAsistente`
// se ejecute (mostrarSeccion() más abajo la llama vía window, no vía
// import directo, para no acoplar main.js a cada sección una por una).
import "./asistente/asistente.js";
import { abrirConfirmacion, agregarLongPress, inicializarAutoScrollSelectoresEnModales, inicializarBotonesCerrarModal, inicializarLayoutResponsivo, inicializarModalConfirmacion, inicializarNavegacionBotonesMouse, mostrarPantallaCargaSesion, mostrarToastAccion, ocultarPantallaCargaSesion, restaurarEstadoSidebar } from "./ui/componentes.js";
import { aplicarPaleta, aplicarTemaGuardadoLocalmente } from "./ui/tema.js";

/* ===================== PWA: registro del Service Worker ===================== */
/*
   Se registra en el evento 'load' (no en DOMContentLoaded): así el
   registro del SW nunca compite por recursos con el arranque real de la
   app (login, primera carga de datos, etc.), que es justo lo que pide el
   punto 3 del prompt ("verificar que no rompa nada del flujo de
   autenticación ni del arranque normal"). Todo el bloque está guardado
   por el feature-check de arriba, así que en un navegador sin soporte
   simplemente no hace nada — la app sigue funcionando igual que antes,
   solo sin capacidad offline/instalable.

   Flujo de actualización (para que quede documentado en un solo lugar):
     1. El navegador detecta un service-worker.js distinto en el servidor
        (algo cambió) y lo empieza a instalar en segundo plano, en
        paralelo al que ya está activo — esto es 100% nativo del browser,
        no hace falta programarlo.
     2. 'updatefound' avisa que ese SW nuevo se está instalando. Cuando
        termina (state === "installed") Y YA HABÍA un SW controlando esta
        pestaña (navigator.serviceWorker.controller existe), eso significa
        que hay una versión nueva LISTA Y ESPERANDO — se muestra el aviso
        no intrusivo con mostrarToastAccion(). Si "controller" NO existe
        todavía, es la primera instalación de siempre (primera visita del
        usuario a la app) y no hay nada que avisar.
     3. El SW nuevo se queda en estado "esperando" (waiting) sin tomar
        control de nada — NUNCA se llama skipWaiting() de forma automática
        (eso vive del lado del propio service-worker.js, y solo reacciona
        a un mensaje explícito). Si el usuario no hace nada, sigue
        trabajando tranquilo con la versión vieja indefinidamente; no se
        le fuerza ni se le corta nada a mitad de un formulario.
     4. Si el usuario aprieta "Recargar" en el aviso, recién ahí se le
        manda el mensaje SKIP_WAITING al SW en espera. Este toma control
        (evento 'controllerchange') y ahí SÍ se recarga la página una
        única vez, ya con el usuario habiendo dado el visto bueno.
     5. Como esta app puede quedar con la pestaña abierta durante horas
        (mismo motivo que programarRefrescoProactivo() ya contempla para
        el token de Google en storage-sync.js), se le pide al navegador
        que revise si hay una versión nueva cada una hora y también cada
        vez que la pestaña vuelve a primer plano — si no, una
        actualización podría tardar en detectarse hasta el próximo cierre
        y apertura real de la app.
*/
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .then((registro) => {
        registro.addEventListener("updatefound", () => {
          const swInstalando = registro.installing;
          if (!swInstalando) return;
          swInstalando.addEventListener("statechange", () => {
            if (swInstalando.state === "installed" && navigator.serviceWorker.controller) {
              mostrarToastAccion("Hay una actualización disponible.", "Recargar", () => {
                if (registro.waiting) registro.waiting.postMessage({ type: "SKIP_WAITING" });
              });
            }
          });
        });

        setInterval(() => registro.update(), 60 * 60 * 1000); // cada 1h
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") registro.update();
        });
      })
      .catch((e) => {
        // No crítico: la app sigue funcionando 100% normal sin service
        // worker, solo sin capacidad offline/instalable.
        console.warn("No se pudo registrar el service worker:", e);
      });

    // Se dispara una única vez, cuando el SW nuevo por fin toma control
    // tras el SKIP_WAITING que manda el botón "Recargar" de arriba. El
    // guard evita un doble reload si el navegador disparara el evento más
    // de una vez.
    let yaRecargandoPorActualizacion = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (yaRecargandoPorActualizacion) return;
      yaRecargandoPorActualizacion = true;
      window.location.reload();
    });

    // Número de versión en Configuración → pie de página (2026-08-23):
    // se lo pedimos al Service Worker que esté controlando la pestaña
    // (navigator.serviceWorker.ready espera a que haya uno activo, tanto
    // en la primera visita como en cualquier carga posterior) en vez de
    // escribirlo a mano en index.html. Así el único lugar que hay que
    // tocar para subir de versión es la constante VERSION en
    // service-worker.js — index.html y main.js nunca vuelven a
    // necesitar edición manual por esto.
    navigator.serviceWorker.addEventListener("message", (evento) => {
      if (evento.data && evento.data.type === "VERSION") {
        const pie = document.getElementById("pie-version");
        if (pie) pie.textContent = evento.data.version;
      }
    });
    navigator.serviceWorker.ready.then((registro) => {
      registro.active?.postMessage({ type: "GET_VERSION" });
    });
  });
}

/* ---------------------------- Arranque ---------------------------- */

// Notificaciones push — flag de "ya se ofreció el diálogo en ESTE
// dispositivo/navegador" (ver onLoginExitoso más abajo). Va en localStorage
// y no en estado.datos.configuracion a propósito: el permiso del navegador
// (Notification.permission) es por dispositivo, no por cuenta, así que si
// esto sincronizara por Drive, alguien que ya vio el aviso en el celular
// nunca lo vería en la PC aunque ahí nunca haya dado el permiso.
const CLAVE_SYNC_CALENDARIO_OFRECIDA = "sincronizacion_calendario_ofrecida_v1";

window.addEventListener("DOMContentLoaded", () => {
  // v9.2 (ajuste v1.8.7, punto 6 — pull-to-refresh no funciona en teléfono
  // real aunque sí funciona arrastrando con mouse en compu): esto es
  // consecuencia de un mecanismo del NAVEGADOR que compite con el gesto
  // propio de la app y que las herramientas de emulación táctil de
  // escritorio no reproducen fielmente — el "rebote"/recarga nativa que
  // Chrome/Safari de teléfono activan al arrastrar hacia abajo estando ya
  // en el tope de la página, ANTES incluso de que nuestro pointermove
  // pueda hacer nada. `overscroll-behavior` es la propiedad hecha
  // específicamente para apagar ESE mecanismo del navegador (no tiene
  // relación con touch-action ni con nuestro preventDefault propio, así
  // que no debería competir con el gesto ya arreglado — a diferencia de un
  // intento anterior, el umbral de compromiso de 12px ya está en su lugar,
  // que es lo que de verdad evitaba que este ajuste conviviera bien con la
  // selección de texto). Si el gesto real sigue sin activarse en un
  // teléfono después de esto, lo más probable es que haya un
  // touch-action conflictivo en css/design-system.css — no tengo ese
  // archivo, así que no puedo revisarlo directamente.
  document.documentElement.style.overscrollBehaviorY = "contain";
  document.body.style.overscrollBehaviorY = "contain";

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
          // v1.15.2: antes esto era `if (estado.pendienteSync)
          // intentarSincronizar();` — solo SUBÍA cambios locales
          // pendientes, nunca bajaba lo que ya hubiera de nuevo en Drive
          // desde otro dispositivo. sincronizarAlIniciar() hace el pull real
          // (y sigue subiendo lo pendiente después, si corresponde).
          sincronizarAlIniciar();
        } else {
          asegurarTokenValido().finally(() => {
            resolverAuthListo();
            sincronizarAlIniciar();
          });
        }
      } else {
        // No había sesión en caché: recién ACÁ se confirma que de verdad
        // hace falta una acción del usuario, así que es el único momento en
        // que se revela la tarjeta de login real (con el botón) en vez del
        // loader de marca propia que estaba tapándola desde que cargó la
        // página (ver overlay-carga-sesion en index.html). No hay nada que
        // sincronizar todavía, así que la "inicialización de auth" se da
        // por terminada de inmediato.
        ocultarPantallaCargaSesion();
        document.getElementById("pantalla-login").classList.remove("oculto");
        resolverAuthListo();
      }
    },
    alFallar: () => {
      btnLogin.textContent = textoOriginalBtnLogin;
      btnLogin.disabled = false; // se reactiva para permitir reintentar
      // El script de Google nunca cargó: si esta carga NO venía de una
      // sesión en caché, no hay forma de seguir sin una acción del usuario
      // (reintentar), así que se revela la tarjeta de login real acá
      // también, igual que en el camino "sin caché" de arriba.
      if (!habiaCacheAlCargar) {
        ocultarPantallaCargaSesion();
        document.getElementById("pantalla-login").classList.remove("oculto");
      }
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
      // FIX (bug reportado: "no le da permisos la primera vez y se rompe el
      // inicio de sesión"): el temporizador arrancado por
      // programarAvisoLoginBloqueado() en el click seguía corriendo en
      // segundo plano aunque Google SÍ hubiera respondido (con un rechazo
      // de permiso). Si el usuario tardaba más de 6s en cerrar el popup de
      // consentimiento, ese temporizador disparaba después y pisaba este
      // aviso —el correcto, "te faltó aceptar Drive"— con el mensaje
      // genérico de "VPN/bloqueador de anuncios", que no tenía nada que
      // ver con lo que en verdad pasó. Se cancela aquí explícitamente,
      // igual que ya hacía ocultarAvisoLoginBloqueado() en el camino de
      // éxito.
      clearTimeout(temporizadorAvisoLogin);
      // FIX (2026-08-25): clearTimeout arriba solo cancela el timer si
      // TODAVÍA no disparó — si el usuario tardó más de 6s en el popup real
      // de Google (algo normal, no un bloqueo), el banner de "VPN/bloqueador
      // de anuncios" ya puede estar visible en pantalla para cuando este
      // callback corre. Sin esto, quedaba mostrado AL MISMO TIEMPO que el
      // aviso de acá abajo — dos mensajes contradictorios juntos, ninguno
      // de los dos siendo realmente lo que pasó.
      document.getElementById("aviso-login-bloqueado").classList.add("oculto");
      btnLogin.textContent = textoOriginalBtnLogin;
      btnLogin.disabled = false;
      const aviso = document.getElementById("aviso-permiso-rechazado");
      // Ajuste (v8): mensaje específico cuando sí se completó el login pero
      // sin la casilla de Drive marcada, para que quede claro qué faltó.
      // FIX (2026-08-25, MIGRACIÓN oauth code+refresh_token): "canje_fallido"
      // es un caso DISTINTO — el usuario SÍ aceptó el permiso de Drive
      // (auth.js ya revisó eso antes de intentar el canje), lo que falló fue
      // la llamada POST /oauth/exchange contra el Worker (caído, con un
      // endpoint que no responde, sin red, etc.). Antes esto reusaba el
      // mensaje genérico de "te faltó aceptar Drive", que es literalmente
      // falso en este caso y no le da al usuario ninguna pista real de qué
      // pasó ni qué reintentar.
      if (motivo === "canje_fallido") {
        aviso.textContent =
          "Aceptaste el permiso de Google Drive correctamente, pero no se pudo completar la conexión con el servidor de la app. Puede ser un problema temporal de conexión — espera un momento y vuelve a intentarlo. Si sigue fallando, avisa a soporte.";
      } else if (motivo === "permiso_drive_no_otorgado") {
        aviso.textContent =
          "No se completó el inicio de sesión: aceptaste tu cuenta de Google pero no marcaste el permiso de Google Drive, que es obligatorio para poder guardar tus datos. Vuelve a intentarlo y esta vez acepta también el permiso de Drive.";
      } else {
        aviso.textContent =
          "No se completó el inicio de sesión: para usar la app necesitas aceptar el permiso de Google Drive. Vuelve a intentarlo y acepta el permiso cuando Google te lo pida.";
      }
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
  // v2.8.9 (punto 10): botones "atrás"/"adelante" de un mouse de 5 botones
  // navegan entre secciones — se registra acá, junto al resto de
  // inicializaciones de gestos/eventos globales del arranque (mismo
  // criterio que agregarLongPress unas líneas arriba), y ANTES de
  // mostrarApp()/mostrarSeccion() más abajo, aunque no depende de que la
  // app ya esté visible (solo agrega un listener global de document, sin
  // tocar nada del DOM que dependa de haber iniciado sesión).
  inicializarNavegacionBotonesMouse();
  // Comunidad — Parte 3: se inyecta ANTES de inicializarBotonesCerrarModal()
  // (así sus 2 modales dinámicos también reciben el botón "✕" automático) y
  // ANTES del posible mostrarApp() por caché unas líneas más abajo (así
  // #seccion-comunidad ya existe si esa es la última sección que el usuario
  // tenía activa).
  inicializarComunidad();
  inicializarResumen();
  inicializarAgenda();
  inicializarHorario();
  // Tiempo de Estudio (Parte 1): se inicializa acá (junto al resto de
  // secciones) y no de forma lazy, porque el indicador persistente
  // (badge-tiempo-estudio) debe quedar suscrito al motor del timer desde el
  // arranque — tiene que poder aparecer en CUALQUIER sección, no solo
  // cuando se entra a "Tiempo de Estudio" por primera vez.
  inicializarTiempoEstudio();
  inicializarBotonesCerrarModal();
  inicializarAutoScrollSelectoresEnModales();
  inicializarPullToRefresh();

  const cache = leerCacheLocal();
  if (cache && cache.datos) {
    // Ya había una sesión local: mostramos la app de inmediato (offline-first).
    // estado.token queda en null aquí a propósito — se obtiene en segundo
    // plano en alListo() de arriba, vía asegurarTokenValido(), sin
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
    // MIGRACIÓN 2026-08-25: este banner ahora solo puede aparecer en dos
    // casos — (a) el refresh_token guardado ya falló de verdad contra
    // /oauth/refresh (revocado, o vencido por el límite de 7 días en modo
    // Prueba), o (b) todavía no hay ningún refresh_token guardado en este
    // dispositivo (cuenta migrando desde el flujo viejo, ver B.5). En
    // NINGUNO de los dos casos otro refresco silencioso serviría de algo —
    // hace falta el login completo con popup real. Se llama de forma
    // DIRECTA (sin async antes) para no romper el gesto de usuario en
    // navegadores móviles, igual que el botón de login normal.
    document.getElementById("aviso-reconexion").classList.add("oculto"); // ocultamiento visual inmediato, optimista
    iniciarSesionConGoogle();
  });

  // Punto 4: el indicador mismo también sirve de botón de reconexión cuando
  // está en el 3er estado ("Sin conexión con Drive — toca para reconectar"),
  // sin depender únicamente del banner separado.
  document.getElementById("indicador-sync").addEventListener("click", () => {
    if (estado.conexionDrive === "desconectado") {
      document.getElementById("btn-reconectar-sesion").click();
    }
  });

  // Bug 2 (2026-09-04 — "reconexión tras perder internet no sincroniza
  // sola, obliga a cerrar sesión"): el cierre de sesión forzado vive en
  // storage-sync.js (no puede importar cerrarSesion de acá sin crear un
  // import circular — mismo patrón que registrarHookPostFusion/
  // registrarHookPostGuardado), así que este archivo registra su propia
  // función para que storage-sync.js la llame solo cuando de verdad haga
  // falta (varios intentos fallidos seguidos, con conexión real
  // confirmada — ver manejarFalloReconexion).
  registrarHookCierreSesionForzado(cerrarSesion);

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

  // v9.3: fuerza un sondeo inmediato al volver a esta pestaña (ver
  // comentario en inicializarSondeoAlVolver, storage-sync.js) — es lo que
  // evita que datos viejos en memoria pisen lo último guardado desde otro
  // dispositivo mientras esta pestaña estuvo minimizada/en segundo plano.
  inicializarSondeoAlVolver();

  // Bug 2, punto 1 (2026-09-04): el comentario de arriba ("hasta el próximo
  // evento 'online'") daba por hecho que este listener ya existía — nunca
  // se había llegado a registrar. Sin esto, recuperar la conexión no
  // disparaba nada por sí solo: había que esperar hasta 45s (el retry
  // periódico) o 9s (el sondeo) para que la app se enterara. Ahora se
  // reintenta apenas el navegador confirma que la conexión volvió, sin que
  // el usuario tenga que tocar nada.
  inicializarReconexionAlVolverOnline();
});

/* ============== Arranque de los módulos del Plan de Estudios ==============
 * v11 (migración a módulos): antes era el propio
 * window.addEventListener("DOMContentLoaded", …) al final de plan.js. Se
 * mantiene como un segundo listener separado (en vez de fusionarlo a mano
 * con el de arriba) para no arriesgar el orden/las dependencias del
 * arranque de login mientras se migraba la estructura de archivos. */
window.addEventListener("DOMContentLoaded", () => {
  // v1.14.2: cada inicialización va en su propio try/catch — antes, un solo
  // error en cualquiera de estas (ej. un id que no existe en el HTML) hacía
  // que TODAS las que venían después de esa línea nunca se ejecutaran (un
  // throw sin capturar corta el resto del bloque), rompiendo "la mayoría de
  // los botones" por un solo bug puntual. Ahora, si una falla, se avisa en
  // consola con su nombre y las demás igual se inicializan con normalidad.
  [
    inicializarModalCrearPlan,
    inicializarModalCategoria,
    inicializarModalCategoriaMaterias,
    inicializarModalMateriaManual,
    inicializarModalVincularOptativa,
    inicializarModalGestionPlanes,
    inicializarModalEditarPlanInfo,
    inicializarModalDesbloquea,
    inicializarModalInstruccionesImportacion,
    inicializarModalCapturasPDF,
    inicializarModalRequisito,
    inicializarModalHistorial,
    inicializarResponsivoListaPlan,
    inicializarModalCompletarUniversidades,
    // 2026-08-26: mismo patrón que inicializarModalCompletarUniversidades
    // de arriba — modal bloqueante propio, ver core/notificaciones-calendario.js.
    inicializarModalPermisoCalendario,
  ].forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error(`[main.js] Falló ${fn.name}() al inicializar — el resto de los modales se inicializó igual:`, e);
    }
  });
});

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
  // Login real recién completado: se usa el mismo loader de marca propia
  // del arranque en vez de mostrarCargando() (los "3 puntitos" genéricos)
  // mientras se trae el archivo de datos de Drive — pedido explícito de que
  // esta espera puntual no se vea "como el default de carga".
  mostrarPantallaCargaSesion();
  // v8.3: le pide al navegador que este sitio quede en la lista de
  // almacenamiento "persistente" (no elegible para borrado automático por
  // presión de espacio) — reduce el riesgo de que un móvil borre la sesión
  // en caché sin que el usuario haya cerrado sesión a propósito.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
  try {
    const { fileId, datos, esArchivoNuevo } = await buscarOCrearArchivoDatos(token);
    estado.fileId = fileId;
    const remotoMigrado = migrarDatosAntiguos(datos);

    // v1.15 (FIX bug crítico "se me borró todo lo de PC al abrir en el
    // teléfono"): antes esta línea era `estado.datos = migrarDatosAntiguos
    // (datos)` — un reemplazo TOTAL, sin comparar nada. Si este dispositivo
    // ya traía algo cargado en estado.datos (offline-first: el bloque de
    // "const cache = leerCacheLocal()" de más arriba ya corrió mostrarApp()
    // con la caché local ANTES de que este login terminara), ese reemplazo
    // ciego pisaba lo local con lo remoto sin importar cuál era más nuevo.
    // Ahora, si ya había algo cargado (offline-first) Y el archivo de Drive
    // ya existía de antes (no se acaba de crear ahora mismo), se FUNDE por
    // entidad — cada materia/semestre/plan gana según su propio
    // `_actualizadoEn` real (ver storage-merge.js), nunca por "quién llegó
    // último a escribir". Si es la primera vez que este usuario entra
    // (archivo recién creado) o este dispositivo no tenía nada cargado
    // todavía, no hay nada con qué fundir y se usa lo remoto tal cual.
    if (estado.datos && !esArchivoNuevo) {
      estado.datos = fusionarDatos(estado.datos, remotoMigrado);
    } else {
      estado.datos = remotoMigrado;
    }

    // Punto 6: nombre + foto de perfil de Google.
    const perfilGoogle = await obtenerPerfilGoogle(token);
    if (perfilGoogle) {
      estado.datos.perfil.nombre = perfilGoogle.nombre;
      estado.datos.perfil.foto_url = perfilGoogle.foto_url;
      estado.datos.perfil.correo = perfilGoogle.correo || estado.datos.perfil.correo;
    }

    guardarCacheLocal();
    // v1.15: si la fusión de arriba encontró entidades locales más
    // recientes que las de Drive (ej. cambios hechos offline en este mismo
    // dispositivo antes de este login), esas entidades quedaron en
    // estado.datos pero Drive todavía no las tiene — hay que subirlas. Sin
    // esto, quedarían fundidas solo en memoria/caché local y nunca
    // llegarían a Drive ni a los demás dispositivos.
    estado.pendienteSync = true;
    intentarSincronizar();

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

    // Sincronización con Google Calendar — onboarding (2026-08-25,
    // reemplaza a Web Push): se ofrece la primera vez que este
    // dispositivo/navegador abre la app, ya no solo cuando el archivo de
    // Drive es recién creado. A diferencia del viejo mecanismo, esto NO
    // depende de que el navegador soporte notificaciones (era
    // `soportaNotificacionesPush()`) ni de `Notification.permission` — la
    // sincronización con Calendar no usa la API de Notification del
    // navegador en absoluto, así que esos 2 checks ya no aplican y se
    // eliminan sin reemplazo (ofrecerActivarSincronizacionCalendario ya
    // revisa por su cuenta si el usuario otorgó el scope de Calendar antes
    // de hacer nada, y no hace nada si no lo otorgó). La marca en
    // localStorage asegura que, se acepte, se rechace o se cierre el
    // diálogo sin elegir, este dispositivo no vuelva a verlo en logins
    // siguientes. El switch de Ajustes Avanzados sigue disponible siempre
    // para prender/apagar a mano (ver config-ajustes.js). Se dispara
    // después de mostrarApp() y sin `await`: es un diálogo de confirmación
    // no bloqueante, no debe demorar la entrada a la app.
    const yaSeOfrecioEnEsteDispositivo = localStorage.getItem(CLAVE_SYNC_CALENDARIO_OFRECIDA) === "1";
    if (!yaSeOfrecioEnEsteDispositivo) {
      localStorage.setItem(CLAVE_SYNC_CALENDARIO_OFRECIDA, "1");
      ofrecerActivarSincronizacionCalendario();
    }

    // Resumen Diario — contenido real del día + renovación del horizonte
    // de la recurrencia (2026-08-26, reportado: "llena el calendario hasta
    // que me muera" + "debería decir qué es el resumen, no un texto fijo").
    // Se llama una vez por carga; la propia función se deduplica sola
    // contra configuracion.resumen_diario_actualizado_el para no pegarle a
    // la API de Calendar más de una vez por día. Sin await: best-effort,
    // no debe demorar la entrada a la app (mismo criterio que la línea de
    // arriba).
    actualizarResumenDiarioDelDia();
  } catch (e) {
    // v1.15.1 (fix real del reporte "inicio sesión y como que no inicia,
    // tengo que recargar y volver a intentar"): antes este try no tenía
    // catch. Si buscarOCrearArchivoDatos (o cualquier llamada a Drive de
    // aquí adentro) fallaba por una red inestable o un error pasajero de
    // Google, el error quedaba como un rechazo de promesa sin atrapar:
    // mostrarApp() nunca se llegaba a llamar (está más abajo en el mismo
    // try), así que la pantalla de login se quedaba ahí sin ningún aviso,
    // y el botón de login no se reactivaba. La única forma de recuperarse
    // era recargar toda la página y volver a intentar — y como casi
    // siempre era un fallo pasajero, el segundo intento sí funcionaba,
    // dando la falsa impresión de que "se arregló solo". Ahora se avisa
    // explícitamente qué pasó y se deja el botón listo para reintentar
    // de inmediato, sin recargar nada.
    console.error("No se pudo completar el inicio de sesión (falló la conexión con Drive):", e);
    const btnLoginEl = document.getElementById("btn-login-google");
    if (btnLoginEl) btnLoginEl.disabled = false;
    const aviso = document.getElementById("aviso-login-bloqueado");
    if (aviso) {
      aviso.textContent =
        "No se pudo completar el inicio de sesión: falló la conexión con Google Drive. Revisa tu internet e intenta de nuevo (no hace falta recargar la página).";
      aviso.classList.remove("oculto");
    }
  } finally {
    ocultarPantallaCargaSesion();
  }
}

/**
 * Universidad — separación nombre_completo/siglas (2026-08-22, Parte 0).
 *
 * `revisarUniversidadesIncompletas()`: se llama al final de mostrarApp().
 * Busca planes con `universidad.siglas === ""` (dejados así a propósito
 * por migrarDatosAntiguos en core/schema.js) y, si encuentra alguno,
 * arma una fila editable por plan dentro del modal bloqueante y lo
 * muestra. Si no hay ninguno incompleto, no hace nada — la inmensa
 * mayoría de las cargas de la app pasan por acá sin efecto visible.
 *
 * `inicializarModalCompletarUniversidades()`: se llama una sola vez al
 * arrancar (ver lista de inicializadores en DOMContentLoaded) — solo
 * engancha el listener del botón "Guardar", que lee TODAS las filas
 * presentes en ese momento (pueden ser varias, una por plan afectado) y
 * las persiste de una sola vez.
 *
 * El modal es intencionalmente imposible de saltar: sin "X" (ver
 * exclusión en inicializarBotonesCerrarModal, ui/componentes.js), sin
 * click-afuera (nunca se registra ese listener acá, a diferencia del
 * resto de los modales de la app) y con el botón "Guardar" deshabilitado
 * hasta que TODAS las filas tengan ambos campos no vacíos.
 */
function inicializarModalCompletarUniversidades() {
  document.getElementById("btn-guardar-completar-universidades").addEventListener("click", () => {
    const filas = document.querySelectorAll("#lista-completar-universidades .fila-completar-universidad");
    filas.forEach((fila) => {
      const plan = estado.datos.planes_estudio.find((p) => p.id === fila.dataset.planId);
      if (!plan) return;
      plan.universidad.nombre_completo = fila.querySelector(".input-completar-nombre").value.trim();
      plan.universidad.siglas = fila.querySelector(".input-completar-siglas").value.trim();
      // FIX sync: cada plan se funde por su propio _actualizadoEn
      // (fusionarPlan en storage-merge.js) — sin sellar acá, el llenado
      // se perdería en el próximo sync igual que otros bugs ya
      // documentados en este archivo (ver comentarios de plan-esquema.js
      // y plan-gestionar.js sobre el mismo patrón).
      sellarTimestamp(plan);
    });
    marcarCambioPendiente();
    document.getElementById("modal-completar-universidades").classList.add("oculto");
    renderizarSelectorPlan();
    renderizarModoHardcore();
    if (typeof renderizarPlanEstudios === "function") renderizarPlanEstudios();
    if (typeof renderizarSemestres === "function") renderizarSemestres();
  });
}

function revisarUniversidadesIncompletas() {
  const incompletos = (estado.datos.planes_estudio || []).filter((p) => !p.universidad.siglas);
  if (incompletos.length === 0) return;

  const cont = document.getElementById("lista-completar-universidades");
  const btnGuardar = document.getElementById("btn-guardar-completar-universidades");
  cont.innerHTML = "";

  function actualizarHabilitado() {
    const todasCompletas = Array.from(cont.querySelectorAll(".fila-completar-universidad")).every(
      (fila) =>
        fila.querySelector(".input-completar-nombre").value.trim() &&
        fila.querySelector(".input-completar-siglas").value.trim()
    );
    btnGuardar.disabled = !todasCompletas;
  }

  incompletos.forEach((plan) => {
    const fila = document.createElement("div");
    fila.className = "fila-completar-universidad stack";
    fila.style.cssText = "gap:8px; padding:10px; border:1px solid var(--color-borde); border-radius:10px;";
    fila.dataset.planId = plan.id;

    const etiquetaPlan = document.createElement("p");
    etiquetaPlan.className = "muted";
    etiquetaPlan.style.margin = "0";
    etiquetaPlan.textContent = plan.nombre_carrera;
    fila.appendChild(etiquetaPlan);

    const campoNombre = document.createElement("div");
    const labelNombre = document.createElement("span");
    labelNombre.className = "form-label";
    labelNombre.textContent = "Nombre completo";
    const inputNombre = document.createElement("input");
    inputNombre.type = "text";
    inputNombre.className = "form-input input-completar-nombre";
    // Precargado con el nombre_completo que ya trae de la migración (el
    // string viejo tal cual estaba guardado) — el usuario solo tiene que
    // revisarlo/corregirlo si hace falta, no escribirlo de cero.
    inputNombre.value = plan.universidad.nombre_completo || "";
    campoNombre.appendChild(labelNombre);
    campoNombre.appendChild(inputNombre);
    fila.appendChild(campoNombre);

    const campoSiglas = document.createElement("div");
    const labelSiglas = document.createElement("span");
    labelSiglas.className = "form-label";
    labelSiglas.textContent = "Siglas";
    const inputSiglas = document.createElement("input");
    inputSiglas.type = "text";
    inputSiglas.className = "form-input input-completar-siglas";
    inputSiglas.placeholder = "Ej. TEC";
    campoSiglas.appendChild(labelSiglas);
    campoSiglas.appendChild(inputSiglas);
    fila.appendChild(campoSiglas);

    inputNombre.addEventListener("input", actualizarHabilitado);
    inputSiglas.addEventListener("input", actualizarHabilitado);

    cont.appendChild(fila);
  });

  actualizarHabilitado();
  document.getElementById("modal-completar-universidades").classList.remove("oculto");
}

function mostrarApp() {
  // Cubre los 2 caminos que llegan acá: sesión restaurada desde caché
  // (mostrarApp() se llama casi de inmediato al arrancar, ver
  // DOMContentLoaded) y login real recién completado (onLoginExitoso) — en
  // ambos, el loader de marca propia ya cumplió su función.
  ocultarPantallaCargaSesion();
  document.getElementById("pantalla-login").classList.add("oculto");
  document.getElementById("app-shell").classList.remove("oculto");
  // BUG FIX v1.15.4 (causa raíz de "se aplica y a los segundos vuelve a
  // blanco"): faltaba el 3er argumento acá. aplicarPaleta(paleta, modo)
  // sin coloresPersonalizados, cuando paleta === "personalizada", cae en
  // la rama que LIMPIA todas las propiedades inline (ver tema.js) — así
  // que cada vez que se llegaba a esta función (login, y cualquier otro
  // flujo que la dispare) se borraba visualmente la paleta guardada, aun
  // cuando el dato en sí seguía intacto en estado.datos. Mismo patrón que
  // el bug de abajo en storage-sync.js.
  const cfg = estado.datos.configuracion;
  aplicarPaleta(cfg.paleta, cfg.modo, cfg.paleta === "personalizada" ? cfg.paleta_personalizada?.colores : undefined);
  // Fix v1.16.1 (2026-08-23 — "switch de fancy necesita varios clicks"):
  // aplicarModoRendimiento() solo se llamaba desde el onchange del switch
  // en Ajustes, nunca al arrancar. El atributo [data-rendimiento] en <html>
  // (de donde depende toda la CSS del modo fancy/rendimiento) quedaba sin
  // inicializar hasta el primer toque del switch — el primer click movía
  // el dato guardado pero no cambiaba nada visible (porque el estado visual
  // de partida ya estaba desincronizado), y recién el segundo click se
  // notaba. Mismo lugar y mismo criterio que aplicarPaleta arriba: se
  // aplica acá, apenas se conocen los datos reales del usuario, ANTES de
  // que pueda entrar a Ajustes.
  aplicarModoRendimiento(!!cfg.modo_rendimiento);
  renderizarSelectorPlan();
  renderizarAjustes();
  renderizarModoHardcore();
  renderizarEnlacesRapidos();
  renderizarPerfil();
  restaurarEstadoSidebar();
  aplicarVisibilidadNavegacion();
  // Asistente IA (revisado 2026-08-22): ya redundante con la línea de
  // arriba (el gate de clave vive dentro de aplicarVisibilidadNavegacion
  // ahora), pero se deja esta llamada porque además refresca la lista de
  // switches de Ajustes > Navegación si estuviera montada — es idempotente,
  // no hace daño llamarla dos veces seguidas.
  aplicarVisibilidadBotonAsistente();
  if (typeof renderizarPlanEstudios === "function") renderizarPlanEstudios();
  if (typeof renderizarSemestres === "function") renderizarSemestres();
  if (typeof renderizarComunidad === "function") renderizarComunidad();
  if (typeof renderizarFinanzas === "function") renderizarFinanzas();
  if (typeof renderizarResumen === "function") renderizarResumen();
  if (typeof renderizarAgenda === "function") renderizarAgenda();
  if (typeof renderizarHorario === "function") renderizarHorario();
  // Horario entre Amigos — Parte 3: revisa si amigos.html dejó un pendiente
  // de "Asociar a mi cuenta" en localStorage (ver horario-amigos-publico.js).
  // Va DESPUÉS de renderizarHorario() para que, si se confirma, el próximo
  // renderizarHorario (disparado por marcarCambioPendiente → sync → re-render,
  // o el de Parte 3b que refresca el overlay) ya tenga el amigo recién
  // vinculado en estado.datos.
  iniciarRefrescoPeriodicoAmigos();
  procesarAsociacionPendienteDeAmigo();
  // Bug 3: antes mostrarSeccion() solo se llamaba desde clics del nav, así que
  // tras un refresh la sección de Plan de Estudios se quedaba con la clase
  // "oculto" del HTML aunque su contenido sí se hubiera renderizado.
  mostrarSeccion(localStorage.getItem(CLAVE_SECCION_ACTIVA) || "resumen");
  // Deep links por query param — ambos se limpian enseguida para que un
  // refresh posterior no vuelva a saltar de sección solo:
  //   "?abrir=agenda"  — notificación push vieja (Web Push, dada de baja
  //                       2026-08-25, ver 'notificationclick' en
  //                       service-worker.js — ese archivo no se revisó en
  //                       esta sesión, puede tener código muerto si seguía
  //                       generando este link).
  //   "?abrir=resumen" — (2026-08-25, NUEVO) el `source.url` del evento
  //                       recurrente del Resumen Diario en el calendario
  //                       secundario de Google (ver sincronizarResumenDiario
  //                       en core/notificaciones-calendario.js) — al tocar
  //                       la alarma nativa del calendario, el sistema
  //                       operativo abre esta URL en el navegador.
  const parametroAbrir = new URLSearchParams(window.location.search).get("abrir");
  if (parametroAbrir === "agenda") {
    mostrarSeccion("agenda");
    window.history.replaceState({}, "", window.location.pathname);
  } else if (parametroAbrir === "resumen") {
    mostrarSeccion("resumen");
    window.history.replaceState({}, "", window.location.pathname);
  }
  // Universidad — separación nombre_completo/siglas (2026-08-22): va AL
  // FINAL de mostrarApp() a propósito, después de todos los renders de
  // arriba — así el modal bloqueante (si hace falta) queda por encima de
  // una app ya completamente pintada, en vez de interrumpir a mitad de
  // los renders con la UI todavía a medio construir.
  revisarUniversidadesIncompletas();
}

// Notificaciones push — mismo caso que el query param de arriba, pero para
// cuando la app YA estaba abierta en una pestaña al tocar la notificación:
// el service worker no puede navegar una pestaña ya abierta con un query
// param nuevo sin recargarla, así que en ese caso le manda un mensaje
// directo (ver 'notificationclick' en service-worker.js) y acá se atiende.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (evento) => {
    if (evento.data && evento.data.tipo === "abrir-agenda") {
      mostrarSeccion("agenda");
    }
  });
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

/* --------------------------- Navegación entre secciones --------------------------- */

const CLAVE_SECCION_ACTIVA = "seccion_activa_v1";

function inicializarNavegacionSecciones() {
  document.querySelectorAll(".btn-nav[data-seccion]").forEach((btn) => {
    btn.addEventListener("click", () => mostrarSeccion(btn.dataset.seccion));
  });
}

function mostrarSeccion(nombre) {
  const secciones = {
    resumen: "seccion-resumen",
    configuracion: "seccion-configuracion",
    "plan-estudios": "seccion-plan-estudios",
    semestres: "seccion-semestres",
    comunidad: "seccion-comunidad",
    finanzas: "seccion-finanzas",
    agenda: "seccion-agenda",
    horario: "seccion-horario",
    "tiempo-estudio": "seccion-tiempo-estudio",
    asistente: "seccion-asistente",
  };
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
  // Horario depende de datos que se editan en otras pestañas (nombre/fechas
  // de semestre, materias matriculadas) — se re-renderiza al entrar para
  // que nunca se vea desactualizado.
  if (nombre === "horario") window.renderizarHorario?.();
  // Agenda: mismo motivo (materias matriculadas/bloques de Horario que se
  // editan en otras secciones), más el hecho de que "hoy"/"esta semana"
  // pueden haber cambiado si la pestaña quedó abierta de un día para otro.
  if (nombre === "agenda") window.renderizarAgenda?.();
  // Tiempo de Estudio: mismo motivo que Agenda/Horario arriba (meta y
  // sesiones se pueden haber editado en otra pestaña/dispositivo) — se
  // re-renderiza fresco cada vez que se entra a la sección.
  if (nombre === "tiempo-estudio") window.renderizarTiempoEstudio?.();
  // Resumen: agrega datos de Agenda/Horario/Semestres, así que le aplican
  // los mismos motivos de arriba (datos editados en otras secciones, más
  // "hoy" pudiendo haber cambiado) — se re-renderiza fresco cada vez que se
  // entra, en vez de confiar en el render inicial de mostrarApp().
  if (nombre === "resumen") window.renderizarResumen?.();
  // Asistente IA (revisado 2026-08-22): renderizarAsistente() SIEMPRE
  // reconstruye el DOM de cero al entrar (nunca deja restos de una visita
  // anterior colgando), pero eso no significa "chat en blanco siempre" —
  // si hay una conversación guardada en localStorage con menos de 1h desde
  // el último mensaje, esa misma función ofrece "Continuar"/"Nueva
  // conversación" antes de arrancar (ver leerHistorialLocalVigente +
  // mostrarAvisoContinuar en js/asistente/asistente.js). Con más de 1h, o
  // sin conversación guardada, arranca directo en blanco.
  if (nombre === "asistente") window.renderizarAsistente?.();
}
// v2.8.9 (punto 10): se expone en window para que ui/componentes.js pueda
// llamarla desde inicializarNavegacionBotonesMouse() sin crear un import
// circular (este archivo ya importa DE componentes.js) — mismo patrón que
// ya usan aplicarVisibilidadNavegacion/obtenerOrdenNavegacion más abajo.
window.mostrarSeccion = mostrarSeccion;

/**
 * Ajustes — ocultar botones de navegación principal (2026-08-04): oculta
 * (display:none vía la clase "oculto" de siempre) cada .btn-nav cuyo
 * data-seccion esté en configuracion.navegacion_oculta. "configuracion"
 * (Ajustes) se filtra acá también por las dudas — aunque la UI de Ajustes
 * ya ni siquiera ofrece la opción de desactivarlo, así nunca puede quedar
 * sin forma de volver a Ajustes ni por un dato corrupto/editado a mano.
 *
 * Se llama al mostrar la app (mostrarApp) y cada vez que se toca un
 * switch en Ajustes (ver renderizarAjustes en config-ajustes.js) — se
 * expone en window para que ese archivo la llame sin crear un import
 * circular (config-ajustes.js ya es importado POR main.js).
 */
/**
 * Ajustes — orden personalizable de navegación (2026-08-06): mismo patrón
 * que navegacion_oculta (arriba), pero para el ORDEN en vez de la
 * visibilidad. DEFAULT_ORDEN_NAV es la única lista de qué secciones son
 * reordenables — "Resumen" (fijo arriba) y "Configuración" (fijo abajo)
 * nunca entran acá, ni se les aplica ningún reordenamiento.
 *
 * Se resuelve el arreglo guardado en vivo, sin depender de un backfill en
 * schema.js: se descartan ids guardados que ya no existan (ej. una
 * sección que se haya quitado a futuro) y se agregan al final, en su
 * posición por defecto, los que falten (ej. "agenda"/"horario" recién
 * agregados para cuentas que ya tenían el arreglo guardado de antes). Se
 * expone en window para que config-ajustes.js dibuje los switches en el
 * mismo orden que el nav real, sin import circular (mismo motivo que
 * aplicarVisibilidadNavegacion ya se expone así).
 *
 * Bug — duplicado en drag-and-drop de navegación (2026-08-07): esta
 * función es el único punto de lectura real de `navegacion_orden` en toda
 * la app, así que acá va la limpieza defensiva general (corre en CADA
 * llamada, no una sola vez al cargar). Se queda con la PRIMERA aparición
 * de cada id y descarta duplicados posteriores. No es un parche de una
 * sola vez: si algún camino futuro que no anticipamos vuelve a introducir
 * un duplicado, se corrige solo cada vez que se lee. Si encuentra y
 * corrige uno, re-sella `configuracion` y marca el cambio pendiente para
 * que la limpieza se sincronice y no reaparezca en otros dispositivos con
 * el dato viejo.
 */
const DEFAULT_ORDEN_NAV = ["agenda", "horario", "tiempo-estudio", "semestres", "comunidad", "finanzas", "plan-estudios", "asistente"];

function obtenerOrdenNavegacionEfectivo() {
  const crudo = estado.datos.configuracion.navegacion_orden || [];

  const vistos = new Set();
  const sinDuplicados = [];
  crudo.forEach((id) => {
    if (vistos.has(id)) return;
    vistos.add(id);
    sinDuplicados.push(id);
  });

  if (sinDuplicados.length !== crudo.length) {
    console.warn("[nav] Se detectaron y limpiaron ids duplicados en navegacion_orden:", crudo);
    estado.datos.configuracion.navegacion_orden = sinDuplicados;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
  }

  const guardado = sinDuplicados.filter((id) => DEFAULT_ORDEN_NAV.includes(id));
  const faltantes = DEFAULT_ORDEN_NAV.filter((id) => !guardado.includes(id));
  return [...guardado, ...faltantes];
}
window.obtenerOrdenNavegacion = obtenerOrdenNavegacionEfectivo;

function aplicarVisibilidadNavegacion() {
  const ocultas = new Set((estado.datos.configuracion.navegacion_oculta || []).filter((s) => s !== "configuracion" && s !== "resumen"));
  // Asistente IA (Gemini): gate de EXISTENCIA por encima de la preferencia
  // manual de arriba — sin clave guardada el botón no sirve de nada, así
  // que se oculta sin importar lo que diga navegacion_oculta (ver
  // aplicarVisibilidadBotonAsistente() más abajo, que es quien dispara este
  // recálculo cada vez que se guarda/borra la clave).
  const hayClaveGemini = Boolean(estado.datos.configuracion.gemini_api_key);
  let seccionActivaOculta = false;
  document.querySelectorAll(".btn-nav[data-seccion]").forEach((btn) => {
    const seccion = btn.dataset.seccion;
    const oculto = ocultas.has(seccion) || (seccion === "asistente" && !hayClaveGemini);
    btn.classList.toggle("oculto", oculto);
    if (oculto && seccion === localStorage.getItem(CLAVE_SECCION_ACTIVA)) {
      seccionActivaOculta = true;
    }
  });

  // Reordena solo el bloque de botones togglables (ver DEFAULT_ORDEN_NAV);
  // "Resumen" y "Configuración" quedan exactamente donde ya están en el
  // HTML (primero y último), insertBefore los va colocando en su orden
  // guardado justo antes de "Configuración" sin tocarlos a ellos.
  const contenedorNav = document.querySelector(".sidebar-scroll");
  const btnConfiguracion = document.getElementById("nav-configuracion");
  if (contenedorNav && btnConfiguracion) {
    obtenerOrdenNavegacionEfectivo().forEach((id) => {
      const btn = contenedorNav.querySelector(`.btn-nav[data-seccion="${id}"]`);
      if (btn) contenedorNav.insertBefore(btn, btnConfiguracion);
    });
  }

  // Si la sección que se estaba viendo se acaba de ocultar, no dejar a la
  // persona sin nav visible para volver — se cae a la primera que siga
  // visible (Ajustes, al ser el único que nunca se puede ocultar, es
  // garantía de que siempre hay al menos una opción).
  if (seccionActivaOculta) {
    const primeraVisible = document.querySelector(".btn-nav[data-seccion]:not(.oculto)");
    mostrarSeccion(primeraVisible ? primeraVisible.dataset.seccion : "configuracion");
  }
}
window.aplicarVisibilidadNavegacion = aplicarVisibilidadNavegacion;

/**
 * Asistente IA (Gemini), revisado 2026-08-22: el gate de existencia de
 * "asistente" (según haya o no clave de Gemini guardada) ahora vive DENTRO
 * de aplicarVisibilidadNavegacion() de arriba, junto con el resto de la
 * lógica de mostrar/ocultar/reordenar nav — así el usuario tiene la misma
 * libertad de ocultarlo o moverlo desde Ajustes > Navegación que con
 * cualquier otra sección (agenda, horario, etc.), y el gate de clave se
 * aplica por encima de esa preferencia sin ser un sistema aparte.
 *
 * Esta función queda solo como disparador delgado: la usa
 * inicializarAsistenteAjustes() (config-ajustes.js) cada vez que se
 * guarda/borra la clave, y mostrarApp() al arrancar — así no hay que tocar
 * esos call-sites. Se expone en window por el motivo de siempre:
 * config-ajustes.js ya es importado POR main.js, llamarla al revés crearía
 * un import circular evitable.
 */
function aplicarVisibilidadBotonAsistente() {
  aplicarVisibilidadNavegacion();
  // Si Ajustes > Navegación está abierta en pantalla, su lista de switches
  // también debe reflejar en vivo que "Asistente" recién apareció/
  // desapareció (ver el gate de existencia dentro de
  // renderizarNavegacionOculta en config-ajustes.js).
  window.renderizarNavegacionOculta?.();
}
window.aplicarVisibilidadBotonAsistente = aplicarVisibilidadBotonAsistente;

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

export {
  CLAVE_SECCION_ACTIVA,
  cerrarSesion,
  inicializarNavegacionSecciones,
  mostrarApp,
  mostrarSeccion,
  ocultarAvisoLoginBloqueado,
  onLoginExitoso,
  pedirConfirmacionCerrarSesion,
  programarAvisoLoginBloqueado,
  renderizarPerfil,
  temporizadorAvisoLogin,
  togglePerfilPopover,
};
