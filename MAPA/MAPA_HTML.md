# MAPA_HTML.md — Índice de archivos HTML

> Mismo criterio que `MAPA_FUNCIONES.md`, adaptado a HTML: en vez de "funciones exportadas" se documentan los **puntos de enganche** que el HTML expone a JS (ids de secciones/modales/botones/inputs) y sus dependencias externas. Sirve para saber, sin abrir el archivo, dónde vive cada bloque y qué id hay que usar/agregar al conectar algo nuevo.

---

## index.html
Propósito: cascarón único de la app (SPA de una sola página) — pantalla de login + app-shell con sidebar, 7 secciones internas (mostradas/ocultadas por JS, no son rutas reales) y ~25 modales. Todo el contenido dinámico lo llenan los módulos de `js/`.
Depende de:
- `css/design-system.css` (estilos)
- `manifest.json` (PWA)
- `js/main.js` (único `<script type="module">`, punto de entrada que importa y orquesta el resto de los módulos)
- CDN externos: Google Identity Services (`accounts.google.com/gsi/client`), `html2canvas`, `jspdf` (para el modal "Convertir capturas a PDF")

Bloques principales (por id, no son "exports" pero cumplen el mismo rol de mapa de conexión):

**Pantallas raíz**
* `#pantalla-login` — vista de login con Google, visible antes de autenticar.
* `#app-shell` — contenedor de toda la app ya autenticada (oculto hasta login).

**Chrome / layout general**
* `#pull-refresh-indicador` — indicador de "deslizar para sincronizar" (v8.3).
* `#overlay-cargando` — overlay de carga genérico (mostrarCargando/ocultarCargando en main.js).
* `#badge-modo-edicion` — badge fijo de Modo Edición del Plan (plan-modo-edicion.js).
* `#aviso-reconexion` / `#btn-reconectar-sesion` — aviso de sesión de Drive vencida.
* `#app-sidebar`, `#btn-colapsar-sidebar`, `#sidebar-overlay` — sidebar de navegación y su drawer móvil.
* `#drawer-enlaces-movil`, `#enlaces-movil-overlay`, `#btn-topbar-enlaces` — drawer de Enlaces rápidos en móvil.
* `#indicador-conflictos`, `#indicador-sync` — badges de estado de sincronización.
* `#perfil-popover`, `#perfil-foto`, `#btn-logout` — zona de perfil del sidebar.

**Navegación entre secciones** (botones `#nav-*`, atributo `data-seccion`):
`#nav-agenda`, `#nav-horario`, `#nav-semestres`, `#nav-comunidad`, `#nav-finanzas`, `#nav-plan-estudios`, `#nav-configuracion`.

**Secciones internas** (contenedores `#seccion-*`, se muestran/ocultan por navegación, no son páginas separadas):
`#seccion-configuracion` (con subsecciones `#seccion-notas-aprobacion`, `#seccion-datos-respaldo`), `#seccion-plan-estudios`, `#seccion-semestres`, `#seccion-comunidad`, `#seccion-finanzas`, `#seccion-agenda`, `#seccion-horario`.

**Modales** (contenedores `#modal-*`, patrón `.modal-overlay > .glass-card.modal-card`):
`#modal-selector-semestre`, `#modal-bloque-flotante`, `#modal-bloque-horario`, `#modal-enlace`, `#modal-instrucciones-importacion`, `#modal-crear-plan`, `#modal-requisito`, `#modal-historial`, `#modal-categoria`, `#modal-categoria-materias`, `#modal-gestion-planes`, `#modal-materia-manual`, `#modal-vincular-optativa`, `#modal-editar-plan-info`, `#modal-desbloquea`, `#modal-confirmacion` (reemplaza `confirm()` nativo), `#modal-agenda-evento`, `#modal-agenda-ajustes`, `#modal-agenda-semestres`, `#modal-agenda-info`, `#modal-panel-amigos`, `#modal-aviso-privacidad-horario`, `#modal-enlace-horario-generado`, `#modal-confirmar-asociar-amigo`, `#modal-capturas-pdf`.

Nota: hay ~263 ids en total en el archivo — la lista de arriba son los contenedores de nivel superior (secciones/modales/chrome). Los ids de inputs/botones internos de cada modal se dejan fuera a propósito: viven documentados junto a la función del `.js` que los usa (ver `MAPA_FUNCIONES.md`).

---

## amigos.html
Propósito: página **standalone** de solo lectura para ver un horario compartido sin sesión iniciada (vista pública del "Horario entre Amigos"). A propósito NO importa el stack de `js/core` ni `js/horario` de la app principal, para no arrastrar auth/sync solo para mostrar un horario a alguien sin cuenta.
Depende de:
- `css/design-system.css` (mismos estilos que index.html, reutilizados)
- `js/horario/horario-amigos-publico.js` (único script, `type="module"`, aún no subido según comentario del archivo)

Bloques principales:
* `#amigos-cargando` — estado de carga inicial.
* `#amigos-error` — estado de error (fileId inválido/revocado/ausente en la URL).
* `#amigos-contenido` — estado con datos: `#amigos-titulo-semestre`, `#amigos-subtitulo-semana`, `#btn-amigos-pantalla-completa`, `#btn-asociar-amigo`, `#amigos-grid-contenedor` / `#amigos-grid`.
* `#amigos-modal-asociar` — modal chico para confirmar apodo antes de asociar el horario a la cuenta propia (reusa `.modal-overlay`/`.glass-card` del design system, sin depender de `componentes.js`).

---

## Patrones transversales (HTML)
- Ambos archivos comparten `css/design-system.css` — cualquier clase nueva usada en un HTML debe existir ahí (ver `MAPA_CSS.md`).
- `index.html` es una SPA de una sola vista: "secciones" y "modales" son `div`s que se muestran/ocultan por JS (clase `.oculto`), no hay rutas ni recargas de página.
- `amigos.html` es la única página realmente standalone del proyecto — al agregar features ahí, evitar importar módulos de `js/core` salvo que se decida explícitamente sumar el stack de auth/sync.
- Convención de ids: `modal-*` para overlays, `seccion-*` para las vistas del shell, `nav-*` para los botones de navegación con `data-seccion` correspondiente.
