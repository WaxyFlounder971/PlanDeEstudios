## 2026-10-09 — Animación de apertura (folder) como pantalla de carga

**Archivos:** `js/core/folder-intro.js` (nuevo, versión de la app), `js/core/intro-apertura.js` (nuevo, controlador),
`js/main.js`, `js/config/config-ajustes.js`, `js/core/schema.js`, `index.html`, `css/design-system.css`,
`service-worker.js` (VERSION → v3.22.25; `design-system.css?v=3.22.25` en index.html).

**Qué hace:** mientras la app carga, el folder cerrado saca sus pestañas 1→6 y las mete 6→1, en bucle. Al terminar
`mostrarApp()` las pestañas terminan de salir y el folder se abre mostrando la app. Es una capa encima de `#app-shell`;
no añade espera si la app ya estaba lista. Una vez por sesión de pestaña/PWA.

**Enganche en main.js:** `mostrarPantallaCargaSesion()` y `ocultarPantallaCargaSesion()` son ahora envoltorios de los
originales (importados como `...Base`): el primero arranca el folder, el segundo lo retira si el cargador se oculta
SIN app (login/error). Con sesión previa (caché o guardada) el folder arranca justo antes de decidir cómo entrar.
`mostrarApp()` llama a `mostrarAppInterno()` y luego `abrirIntroCarga()`.

**Toques:** durante la carga un toque retira el folder y queda el cargador de siempre; durante la apertura la salta
(también Escape/Enter/Espacio). Tras 20 s cargando, el folder se retira solo (para no tapar pantallas de recuperación).

**Se omite (queda el cargador de siempre):** demo/vista previa, "reducir movimiento", modo Optimizado, <4 núcleos o
<4 GB, usuario nuevo (si ya se sabe), `?abrir=` / `?comp=`, pestaña oculta, apagada en Ajustes.

**Ajustes → Personalizar → Animación de apertura:** interruptor, 6 bolitas (color de cada pestaña), "Usar colores de la
paleta" (degradado --accent-1 → --accent-2 en 6 pasos, sigue a la paleta), "Restablecer" (colores originales) y "Ver animación".
Datos: `configuracion.animacion_apertura` (bool) y `configuracion.intro_colores` (null | { modo: "paleta"|"personalizado", colores[6] }),
con espejo en localStorage (`app_intro_apertura_apagada`, `app_intro_colores`) porque al arrancar aún no hay datos de la cuenta.

**Pendiente:** textos nuevos en los catálogos de idioma. Los colores no cambian el logo PNG de la app.
Verificado en DOM simulado (jsdom), no en navegador real.
