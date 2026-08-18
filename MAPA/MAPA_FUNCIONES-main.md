## js/main.js

**Propósito:** Orquestador raíz de la app — arranque, login/logout, navegación entre secciones y renderizado del perfil de usuario. Importa e inicializa el resto de módulos.

**Depende de:** config-ajustes.js, config-enlaces.js, auth.js, schema.js, storage-merge.js, storage-sync.js, storage.js, utils.js, comunidad.js, finanzas.js, plan-categorias.js, plan-detalle.js, plan-esquema.js, plan-gestionar.js, plan-importacion.js, plan-vista-lista.js, semestres.js, agenda.js, horario.js, horario-amigos.js, componentes.js, tema.js.

**Exporta:**

* `programarAvisoLoginBloqueado()` — arma un timeout de 6s que muestra el aviso "no se pudo abrir el login" (VPN/bloqueador de anuncios/extensión de privacidad).
* `ocultarAvisoLoginBloqueado()` — cancela ese timeout y oculta tanto el aviso de login bloqueado como el de permiso rechazado.
* `onLoginExitoso(token, expiresIn)` — flujo posterior a un login exitoso de Google: guarda el token activo, resuelve `authListo`, pide almacenamiento persistente al navegador y continúa la carga de datos.
* `mostrarApp()` — oculta la pantalla de login y muestra el shell de la app; aplica la paleta/tema guardado y renderiza el selector de plan.
* `pedirConfirmacionCerrarSesion()` — cierra el popover de perfil; si hay cambios sin sincronizar pide confirmación antes de cerrar sesión, si no cierra directo.
* `cerrarSesion()` — limpia token, caché local y estado en memoria; vuelve a mostrar la pantalla de login.
* `CLAVE_SECCION_ACTIVA` — clave de `localStorage` (`"seccion_activa_v1"`) donde se persiste qué sección de navegación quedó activa.
* `inicializarNavegacionSecciones()` — conecta los botones `.btn-nav[data-seccion]` para que llamen a `mostrarSeccion`.
* `mostrarSeccion(nombre)` — cambia la sección visible del app-shell (configuración, plan-estudios, semestres, comunidad, etc.) y persiste la elección.
* `temporizadorAvisoLogin` — id del `setTimeout` de `programarAvisoLoginBloqueado`, expuesto para que otros módulos puedan limpiarlo (ej. al cerrar sesión).
* `renderizarPerfil()` — pinta nombre, correo, foto/iniciales del perfil en el header y en el popover; maneja el fallback si la foto no carga.
* `togglePerfilPopover(forzarCerrado)` — abre/cierra el popover de perfil (o lo fuerza a cerrado si se pasa `true`).

## Patrones transversales

* **Sync:** todo cambio a `estado.datos` se marca con `sellarTimestamp()` (Lamport) y `marcarCambioPendiente()`; el merge entre dispositivos usa `_version_base` para resolver conflictos campo a campo.
* **Borrado:** los elementos eliminados no se sacan del array — se marcan como tumba (soft-delete) para que el merge no los resucite desde otro dispositivo desactualizado.
* **Tamaño de archivo:** límite de 800 líneas por archivo; al superarlo, dividir en un módulo nuevo en vez de seguir agregando.
* **Índice vivo:** cualquier prompt que cree un archivo o agregue/quite funciones exportadas debe actualizar la entrada correspondiente acá mismo, en `MAPA_FUNCIONES.md`.
