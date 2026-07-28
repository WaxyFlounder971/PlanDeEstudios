/* =========================================================================
   ARRANQUE DE LA APP
   Login con Google, decide qué sección mostrar, conecta e inicializa
   todos los demás módulos.
   ========================================================================= */

import { renderizarAjustes } from "./config/config-ajustes.js";
import { inicializarModalEnlace, renderizarEnlacesRapidos } from "./config/config-enlaces.js";
import { buscarOCrearArchivoDatos, cerrarSesionGoogle, inicializarGoogleAuth, iniciarSesionConGoogle, obtenerMetadatosArchivo, obtenerPerfilGoogle, refrescarAccessTokenGoogle } from "./core/auth.js";
import { migrarDatosAntiguos } from "./core/schema.js";
import { actualizarIndicadorSync, forzarSincronizacion, inicializarPullToRefresh, intentarReconexionSilenciosa, intentarSincronizar, mostrarAvisoReconexion, mostrarCargando, ocultarCargando, programarRefrescoProactivo, sondearCambiosRemotos, temporizadorRefrescoProactivo } from "./core/storage-sync.js";
import { CLAVE_CACHE_LOCAL, borrarTokenCache, correoConocido, establecerTokenActivo, estado, guardarCacheLocal, leerCacheLocal, leerTokenCacheValido, resolverAuthListo } from "./core/storage.js";
import { obtenerIniciales } from "./core/utils.js";
import { inicializarModalCategoria, inicializarModalCategoriaMaterias } from "./plan/plan-categorias.js";
import { inicializarModalDesbloquea, inicializarModalHistorial, inicializarModalRequisito } from "./plan/plan-detalle.js";
import { inicializarModalCrearPlan, inicializarModalMateriaManual, inicializarModalVincularOptativa } from "./plan/plan-esquema.js";
import { inicializarModalEditarPlanInfo, inicializarModalGestionPlanes, renderizarModoHardcore, renderizarSelectorPlan } from "./plan/plan-gestionar.js";
import { inicializarModalCapturasPDF, inicializarModalInstruccionesImportacion } from "./plan/plan-importacion.js";
import { inicializarResponsivoListaPlan, renderizarPlanEstudios } from "./plan/plan-vista-lista.js";
import { abrirConfirmacion, agregarLongPress, inicializarBotonesCerrarModal, inicializarLayoutResponsivo, inicializarModalConfirmacion, restaurarEstadoSidebar } from "./ui/componentes.js";
import { aplicarPaleta, aplicarTemaGuardadoLocalmente } from "./ui/tema.js";

/* ---------------------------- Arranque ---------------------------- */

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
    refrescarAccessTokenGoogle(correoConocido())
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

/* ============== Arranque de los módulos del Plan de Estudios ==============
 * v11 (migración a módulos): antes era el propio
 * window.addEventListener("DOMContentLoaded", …) al final de plan.js. Se
 * mantiene como un segundo listener separado (en vez de fusionarlo a mano
 * con el de arriba) para no arriesgar el orden/las dependencias del
 * arranque de login mientras se migraba la estructura de archivos. */
window.addEventListener("DOMContentLoaded", () => {
  inicializarModalCrearPlan();
  inicializarModalCategoria();
  inicializarModalCategoriaMaterias();
  inicializarModalMateriaManual();
  inicializarModalVincularOptativa();
  inicializarModalGestionPlanes();
  inicializarModalEditarPlanInfo();
  inicializarModalDesbloquea();
  inicializarModalInstruccionesImportacion();
  inicializarModalCapturasPDF();
  inicializarModalRequisito();
  inicializarModalHistorial();
  inicializarResponsivoListaPlan();
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
