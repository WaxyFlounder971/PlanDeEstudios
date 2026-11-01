# MAPA_JSON.md — Índice de datos persistidos y configuración

Los datos de cada cuenta se guardan en un objeto JSON principal en Google Drive y en la caché local mientras hay cambios pendientes. `js/core/schema.js` crea el objeto inicial y normaliza versiones; `js/core/storage/storage-merge.js` fusiona los datos de varios dispositivos.

## Colecciones de Finanzas

Todas las colecciones siguientes son de nivel superior del objeto de cuenta. Las colecciones con borrado definitivo tienen una lista tombstone `_eliminados_*`, que se combina durante la sincronización para evitar que el elemento borrado reaparezca.

| Campo | Contenido / campos de referencia | Borrados |
|---|---|---|
| `finanzas_semestre` | Registros por semestre; pagos en `pagos_matricula[]` e ingresos en `ingresos_beca[]`, cada elemento con id, monto, fecha, descripción y metadatos de sync | `_eliminados_finanzas_semestre`; tombstones anidados para pagos e ingresos |
| `gastos_u` | Gastos/ingresos universitarios heredados, simples o recurrentes, con posible vínculo a semestre | `_eliminados_gastos_u` |
| `movimientos` | `id`, `tipo`, `nombre`, `monto`, `fecha_registro`, nota y campos opcionales de semestre, origen, meta, cuenta, categoría, préstamo, compromiso, recurrencia o destino de traspaso | `_eliminados_movimientos` |
| `metas` | Metas de ahorro o gasto; objetivo, nombre, fecha, progreso derivado, aporte programado, reparto y estado archivado. Una meta de gasto tiene `tipo: "gasto"`, periodo y categorías | `_eliminados_metas` |
| `compromisos` | Compromisos y cuotas del Plan, con tipo, monto, fechas, estado y relación con el movimiento generado al confirmar | `_eliminados_compromisos` |
| `categorias_finanzas` | Categorías creadas por la persona, tipo y prioridad opcional `esencial`/`flexible` | `_eliminados_categorias_finanzas` |
| `sobres` | Presupuestos por periodo y categoría(s), objetivo, arrastre y archivado | `_eliminados_sobres` |
| `patrones_mensajes` | Formatos personales para leer mensajes bancarios: nombre, plantilla/huecos, tipo, activo y metadatos | `_eliminados_patrones_mensajes` |
| `prestamos` | Registro por persona de lo prestado/recibido, saldo derivado, archivo y movimientos vinculados | `_eliminados_prestamos` |
| `cuentas` | Cuentas con nombre, tipo, divisa, saldo inicial, efecto sobre Mi dinero y archivo | `_eliminados_cuentas` |

Los importes se guardan como números positivos; el tipo/sentido determina cómo se interpretan. El modelo se define en `js/core/finanzas/finanzas-modelo.js`; ver el [mapa detallado de Finanzas](MAPA_FUNCIONES_finanzas.md) para reglas, conversiones permitidas y comportamiento de cada tipo.

## Configuración relacionada con Finanzas

- `configuracion.finanzas_modulos`: interruptores de matrícula, beca, gastos e ingresos, y ahorros.
- `configuracion.finanzas_deudas`: interruptor independiente de Deudas, apagado por defecto.
- `configuracion.finanzas_cuentas`: interruptor de Cuentas, apagado por defecto.
- `configuracion.finanzas_consejos`: preferencia para mostrar consejos al activar módulos.
- `configuracion.plantillas_rapidas`: muestra u oculta accesos de registro rápido. `configuracion.horizonte_disponible_dias`: horizonte de cálculo de Disponible. `configuracion.bloqueo_finanzas`: reservado para una función aplazada; actualmente se inicializa como `null` y no activa un bloqueo.

La interfaz puede conservar estado transitorio en memoria; solo las propiedades del objeto de cuenta se persisten/sincronizan. Una colección que se añade al esquema debe añadirse también a la fusión y a sus tombstones.

## Campos de onboarding y Notas rápidas

Estos campos viven dentro de `configuracion`, no son archivos JSON separados:

* `onboarding_visto`, `onboarding_progreso`, `guia_plan_pendiente` y `onboarding_plan_en_blanco_pendiente`: avance de guías de entrada y reanudación.
* `notas_ajustes`: preferencias de Notas rápidas, por ejemplo vista/color/vencimiento e integración con Wapper.
* `terminos_aceptados`: versión, fecha e idioma aceptados.

## Colección sincronizada `notas`

`notas: []` y `_eliminados_notas: []` están declarados en el esquema. Cada nota guarda título, contenido HTML mínimo sanitizado, color, pin/orden, vencimiento, papelera, origen y timestamps. La fusión es por id y respeta tombstones; el contenido compartido recibido por el PWA se limpia de la URL antes de sincronizar/cachear.

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
* `share_target` — `action: "./"` dentro de `scope: "."`; recibe `title`, `text` y `url` por GET para crear una nota de texto/enlace. Depende del guardado idempotente de `js/notas/notas-compartir.js`. Disponible en PWA instalada en Android compatible.

## Patrones transversales (JSON)
- `background_color` y `theme_color` están pisados a mano con los valores de la paleta "azul"/oscuro — si en algún momento se cambia la paleta o modo **por defecto** de la app, hay que actualizar estos dos valores a mano acá también (no se leen dinámicamente de `design-system.css`).
- Cualquier ícono nuevo que se agregue al manifest debe existir físicamente en `imagenes/` con ese nombre exacto — el navegador falla silenciosamente (sin romper la app, pero sin ícono) si no lo encuentra.
