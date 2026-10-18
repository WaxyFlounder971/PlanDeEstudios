# MAPA_JSON.md — Índice de archivos JSON de configuración

## Campos de `configuracion` gestionados por onboarding

Estos campos viven dentro del objeto `configuracion` sincronizado de la cuenta; no son archivos JSON independientes:

* `onboarding_visto` — indica que el onboarding ya se abrió y permite mostrar el control para salir.
* `onboarding_progreso` — etapa e índice guardados para reanudar el recorrido.
* `guia_plan_pendiente` — `"plan"` o `"semestres"` mientras queda una guía inicial por completar.
* `onboarding_plan_en_blanco_pendiente` — marca temporal para continuar a Semestres al guardar la primera materia creada manualmente desde «Empezar en blanco»; se limpia al continuar o al completar la materia.
* `terminos_aceptados` — versión, fecha e idioma aceptados por la persona.

---

## manifest.json
Propósito: manifest de PWA — permite instalar la app en el dispositivo (ícono, nombre, colores de splash/barra de estado, modo standalone). Leído por el navegador vía `<link rel="manifest">` en `index.html`, no por ningún módulo JS del proyecto.
Depende de: nada (JSON estático). Referencia dos íconos en `imagenes/`.

Campos clave:
* `name` / `short_name` — "App Académica" (nombre completo e ícono del homescreen).
* `description` — descripción mostrada en el diálogo de instalación.
* `start_url` / `scope` — `"."` — abre y limita la PWA a la raíz del proyecto.
* `display` — `"standalone"` — se abre sin barra de navegador del sistema, como app nativa.
* `background_color` — `#0A0E17` — color de splash screen al abrir (coincide con `--bg-canvas` de la paleta "azul" oscura, la paleta por defecto).
* `theme_color` — `#2563EB` — color de la barra de estado/título del navegador (coincide con `--accent-1` de la paleta "azul").
* `lang` — `"es"`.
* `icons` — dos tamaños (192×192, 512×512), ambos `purpose: "any"`, apuntando a `imagenes/LogoAppFolder-192.png` y `imagenes/LogoAppFolder-512.png`. El manifest conserva el logo estándar; el logo elegido en la app se refleja en favicon e interfaz y puede requerir reinstalar la PWA para actualizar el icono del sistema.

## Patrones transversales (JSON)
- `background_color` y `theme_color` están pisados a mano con los valores de la paleta "azul"/oscuro — si en algún momento se cambia la paleta o modo **por defecto** de la app, hay que actualizar estos dos valores a mano acá también (no se leen dinámicamente de `design-system.css`).
- Cualquier ícono nuevo que se agregue al manifest debe existir físicamente en `imagenes/` con ese nombre exacto — el navegador falla silenciosamente (sin romper la app, pero sin ícono) si no lo encuentra.
