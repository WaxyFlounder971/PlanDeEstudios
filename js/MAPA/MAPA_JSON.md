# MAPA_JSON.md — Índice de archivos JSON de configuración

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
* `icons` — dos tamaños (192×192, 512×512), ambos `purpose: "any"`, apuntando a `imagenes/LogoApp-192.png` y `imagenes/LogoApp-512.png`.

## Patrones transversales (JSON)
- `background_color` y `theme_color` están pisados a mano con los valores de la paleta "azul"/oscuro — si en algún momento se cambia la paleta o modo **por defecto** de la app, hay que actualizar estos dos valores a mano acá también (no se leen dinámicamente de `design-system.css`).
- Cualquier ícono nuevo que se agregue al manifest debe existir físicamente en `imagenes/` con ese nombre exacto — el navegador falla silenciosamente (sin romper la app, pero sin ícono) si no lo encuentra.
