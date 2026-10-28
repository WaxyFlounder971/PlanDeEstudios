# Arquitectura de App Académica — mapa de módulos

Este documento es para que **cualquier IA (o Wagner) que entre a una sesión nueva**
entienda, sin tener que leer los archivos completos, qué hace cada capa y a qué
archivo hay que ir para pedir un cambio. Todo el proyecto usa **módulos ES nativos**
(`import`/`export`, sin build step). El único `<script>` en `index.html` es:

```html
<script type="module" src="js/main.js"></script>
```

## Cómo leer este documento

Este archivo es el mapa de **decisión** (capas, por qué existen los imports
circulares, y en qué archivo empezar según lo que te pidan). El detalle
función-por-función de cada archivo — qué exporta, con qué firma, qué hace cada
export — vive en **`MAPA_FUNCIONES.md`** y en mapas especializados de `MAPA/`,
como `MAPA_FUNCIONES_finanzas.md`, para mantener el detalle por área sin duplicar
la documentación extensa en un solo archivo. Si vas a pedirle a una IA que trabaje en
algo:

1. Buscá la fila que corresponda en la tabla "¿Dónde va cada cosa?" acá abajo para
   ubicar el/los archivo(s).
2. Andá a `MAPA_FUNCIONES.md` § ese archivo para ver el detalle de sus exports.
3. Antes de tocar código, hacé `grep -rn "nombreDeLaFuncion" js/` para confirmar en 1
   paso que la sospecha es correcta antes de editar.

---

## Capas del proyecto (de más base a más arriba)

```
js/core/       → datos, sesión, sincronización — base compartida
js/core/finanzas/ → lógica, modelo y cálculos de Finanzas 2.0
js/ui/         → componentes de interfaz genéricos y reutilizables (modales, toasts, tema)
js/config/     → secciones de Configuración (ajustes, enlaces, baneados)
js/plan/       → todo el Plan de Estudios (el módulo de negocio más grande)
js/semestres/  → Semestres, matrícula y el motor de notas
js/finanzas/   → shell e interfaz de Finanzas (Finanzas universitaria y Finanzas 2.0)
js/comunidad/  → Profesores y compañeros
js/horario/    → Horario semanal + Horario entre amigos (incluye amigos.html standalone)
js/agenda/     → Agenda (Lista + Calendario, eventos/tareas/exámenes)
js/asistente/  → Wapper: interacción con Gemini, captura y cola offline local
js/main.js     → arranque: login, navegación, conecta todo lo demás
```

`js/plan/` sigue siendo, con diferencia, la carpeta más grande — es el módulo de
negocio principal de la app. `js/core/` es la única capa que en teoría no debería
depender de nada más — en la práctica `storage.js` y `storage-sync.js` se necesitan
mutuamente, y `storage-sync.js` además importa módulos de capas superiores para poder
re-renderizarlos tras sincronizar (ver "Imports circulares" abajo). Todo lo demás
depende, directa o indirectamente, de `core/`.

`js/semestres/`, `js/finanzas/`, `js/comunidad/`, `js/horario/` y `js/agenda/`
reutilizan piezas de `js/plan/` en vez de duplicarlas:
- `semestres/semestres-tarjetas.js` reutiliza `plan/plan-detalle.js` (encabezado y
  cuerpo de detalle de materia) y `plan/plan-vista-lista-tarjetas.js` (`ESTADOS_MATERIA`).
- `comunidad/comunidad.js` reutiliza `plan/plan-detalle.js` y
  `semestres/semestres-tarjetas.js` para vincular profesores a materias matriculadas.
- `agenda/agenda-clases.js` y `agenda/agenda-utils.js` reutilizan `horario/horario.js`
  para calcular qué clases caen en un día dado.
- `finanzas/*` reutiliza `semestres/semestres.js` y `plan/plan-esquema.js`
  para funciones universitarias heredadas. Finanzas 2.0 separa la lógica en
  `core/finanzas/` y las vistas en `finanzas/`; ambos lados usan el almacenamiento
  y la sincronización comunes. Sus colecciones se definen en `core/schema.js` y
  se funden en `core/storage/storage-merge.js`.

> **Imports circulares — por qué existen y por qué son intencionales:**
> Varios módulos se importan entre sí en ambas direcciones. Esto es **seguro** en
> módulos ES mientras el nombre importado solo se use *dentro* de una función (nunca
> en el nivel superior del archivo, fuera de una función) — que es como está armado
> todo acá. Si una IA nueva ve esto y quiere "arreglarlo" separando más archivos, no
> hace falta: ya funciona. Los pares conocidos, y la razón de cada uno:
>
> | Par | Por qué |
> |---|---|
> | `core/storage/storage.js` ↔ `core/storage/storage-sync.js` | `storage.js` necesita `programarRefrescoProactivo`/`ocultarAvisoReconexion` de sync; sync necesita `estado` de storage. |
> | `core/storage/storage-sync.js` → `plan-gestionar.js`, `plan-vista-lista.js`, `semestres.js`, `semestres-tarjetas.js`, `finanzas.js`, `config-ajustes.js`, `config-enlaces.js`, `main.js` | tras `aplicarDatosRemotosFrescos()` hay que re-renderizar toda la UI activa; es la única razón por la que `core/` "mira hacia arriba". |
> | `plan/plan-esquema.js` ↔ `plan/plan-gestionar.js` | esquema necesita abrir el modal de gestión desde ciertos flujos; gestionar necesita los getters de esquema. |
> | `plan/plan-detalle.js` ↔ `plan/plan-vista-lista-tarjetas.js` | detalle necesita el candado de disponibilidad; tarjetas necesita el cuerpo de detalle compartido. |
> | `ui/componentes.js` ↔ `main.js` | componentes necesita `renderizarPerfil` al cambiar el layout; main usa casi todo lo de componentes. |
> | `semestres/semestres.js` ↔ `main.js` | mismo patrón que `componentes.js` ↔ `main.js`. |
> | `comunidad/comunidad.js` ↔ `plan/plan-detalle.js` | comunidad registra el callback real de "abrir alta de profesor" (`registrarAbrirAltaProfesorPreseleccionado`) para que plan-detalle lo dispare sin importar comunidad directamente. |
> | `comunidad/comunidad.js` ↔ `semestres/semestres-tarjetas.js` | mismo patrón, para "abrir tarjeta flotante de profesor" (`registrarAbrirTarjetaProfesorFlotante`). |
> | `agenda/agenda.js` ↔ `agenda/agenda-modal.js`, `agenda/agenda-calendario.js` | `renderizarAgenda()` se expone como `window.renderizarAgenda` para que modal/calendario la llamen sin import circular directo. |
>
> **Regla para agregar un módulo nuevo con este patrón:** si dos archivos necesitan
> funciones el uno del otro, preferí el patrón `registrarCallbackX(fn)` (ver
> comunidad.js) antes que un import circular directo, salvo que ya exista un ida-y-vuelta
> establecido como los de la tabla — no multipliques los circulares sin necesidad.

---

## Resumen por capa

(Detalle función-por-función de cada archivo → `MAPA_FUNCIONES.md`)

### Notas rápidas (v3.24.0)

Notas se integra como sección ES module (`js/notas/notas.js`) y almacena la colección `notas` dentro del documento JSON de cuenta. Las ediciones actualizan primero el estado/caché local mediante `marcarCambioPendiente()` y usan el ciclo de sync normal; `storage-merge.js` fusiona cada nota por id y respeta `_eliminados_notas` para que un borrado definitivo no reaparezca. El contenido se conserva como HTML mínimo de lista permitida y se sanitiza tanto antes de guardar como al pintar.

El `share_target` de `manifest.json` usa una acción relativa (`./`) dentro del scope y acepta solo title/text/url. `notas-compartir.js` copia esos parámetros a una bandeja local acotada e idempotente, limpia la URL antes de que continúe el login y procesa la bandeja cuando los datos de cuenta ya están listos. El Service Worker sirve el shell cacheado ante navegación offline y excluye las queries de contenido compartido de CacheStorage para no dejar texto privado en la caché HTTP. Las notas funcionan localmente sin red; la sincronización con otros dispositivos espera la conexión de Drive.

### `js/core/` — datos y sesión
`auth.js` (login Google + API Drive cruda), `clipboard.js` (blindaje de copiar al
portapapeles), `schema.js` (molde de datos, factories, migraciones y Lamport — la fuente de verdad del JSON de Drive; las reglas de Finanzas viven en `core/finanzas/`),
`storage.js` (`estado` en memoria + caché offline), `storage-sync.js` (motor de
sincronización), `storage-merge.js` (motor de fusión/conflictos), `storage-adjuntos.js`
(ciclo de vida de adjuntos binarios).
**Si vas a agregar una llave nueva al modelo de datos, es en `schema.js`. Si el bug es
"no sincroniza"/"se pierden cambios", es en `storage-sync.js`. Si es "se resucitó algo
que borré", es en `storage-merge.js`.**

### `js/ui/` — componentes genéricos
`componentes.js` (modal de confirmación, toasts, long-press, drawer/sidebar
responsivo), `tema.js` (paletas + modo claro/oscuro, utilidades de color puras),
`paleta-personalizada.js` (flujo de "Crear mi paleta").

### `js/config/` — Configuración
`config-ajustes.js` (panel de Ajustes: paletas, escalas, backup, rendimiento),
`config-enlaces.js` (Enlaces Rápidos, CRUD completo), `config-baneados.js`
(placeholder vacío, reservado).

### `js/plan/` — Plan de Estudios
`plan-esquema.js` (getters base + crear plan/materia manual), `plan-gestionar.js`
(selector de plan, Modo Hardcore hasta 3 planes, modal Gestionar Planes),
`plan-importacion.js` + `plan-importacion-csv.js` (prompt de importación IA + parser
CSV), `plan-vista-lista.js` (orquestador de la vista de lista, `renderizarPlanEstudios`),
`plan-vista-lista-tarjetas.js` (tarjeta de materia, candado de disponibilidad,
Optativas), `plan-detalle.js` (detalle unificado de materia, reutilizado en 3
lugares), `plan-categorias.js` (CRUD de categorías), `plan-mapa.js` (Vista de Mapa
interactivo), `plan-modo-edicion.js` (badge/toggle de Modo Edición).

### `js/semestres/` — Semestres y matrícula
`semestres.js` (alta/edición/listado, sincronía Matrícula↔Plan), `semestres-tarjetas.js`
(tarjetas + motor de notas completo — criterios, asignaciones, proyecciones,
conflictos), `semestres-dashboard.js` (Historial académico: aprobación + promedios).

### `js/core/finanzas/` y `js/finanzas/` — Finanzas
`js/core/finanzas/` contiene el modelo unificado, registro, cálculos de Disponible,
Plan, metas, presupuesto, categorías, sobres, importación/exportación, lectura de
mensajes, deudas y cuentas. `js/finanzas/` contiene el shell, pestañas y formularios.
La sección mantiene además las pantallas universitarias heredadas de Semestres y
Beneficios. El [mapa completo de Finanzas](MAPA/MAPA_FUNCIONES_finanzas.md) enumera
responsabilidades, exports, colecciones, sincronización y límites del producto.

### `js/comunidad/` — Profesores y compañeros
`comunidad.js` (única, ~3948 líneas — candidata a dividirse, ver Patrones
transversales en `MAPA_FUNCIONES.md`).

### `js/horario/` — Horario
`horario.js` (grid semanal propio + modo conjunto + vista individual de amigo),
`horario-modal.js` (alta/edición de bloque + Cronograma de excepciones),
`horario-amigos.js` (generar/vincular/revocar enlaces compartidos, snapshots en
caché), `horario-amigos-publico.js` (script standalone de `amigos.html`, sin sesión,
sin import de `js/core`).

### `js/agenda/` — Agenda
`agenda.js` (núcleo: vista Lista, filtros, despacho Lista/Calendario),
`agenda-utils.js` (helpers puros: fechas, semanas, formateo), `agenda-clases.js`
(sección "Materias" inline por día, cruza con Horario), `agenda-modal.js`
(alta/edición de evento/tarea/examen), `agenda-calendario.js` (vista Calendario
mensual/semanal).

### `js/main.js` — arranque
Todo lo que pasa una sola vez al cargar la página: sesión guardada vs. login,
perfil de Google, navegación entre secciones del sidebar, y llama a todas las
`inicializarX()` de los demás módulos. Tiene 2 `DOMContentLoaded` separados a
propósito (no fusionados, para no arriesgar el orden del login durante futuras
migraciones): el primero es login/sync/tema/perfil; el segundo llama a los
`inicializarX()` de las secciones de negocio.

---

## ¿Dónde va cada cosa? (cheat-sheet para pedidos futuros)

| Si te piden... | Empezá por... |
|---|---|
| Cambiar una llave del JSON que se guarda en Drive | `core/schema.js` |
| Un bug de login / sesión que no inicia | `core/auth.js`, `main.js` |
| "No sincroniza" / "se pierden cambios" / spinner de carga | `core/storage/storage-sync.js` |
| "Se resucitó algo que borré" / conflicto entre 2 dispositivos | `core/storage/storage-merge.js` |
| Agregar una llave nueva a `estado` (memoria de sesión) | `core/storage/storage.js` |
| Ciclo de vida de un adjunto (subir/descargar/borrar binario) | `core/storage/storage-adjuntos.js` |
| Un helper genérico de texto/color/fecha reutilizable | `core/utils.js` |
| Modal de confirmación, toast, drawer móvil, flechas `‹ ›` | `ui/componentes.js` |
| Paletas / modo claro-oscuro | `ui/tema.js` |
| El flujo de "Crear mi paleta" | `ui/paleta-personalizada.js` |
| Panel de Ajustes generales, backup a Drive, Modo Rendimiento | `config/config-ajustes.js` |
| Enlaces Rápidos | `config/config-enlaces.js` |
| El prompt que se copia a la IA para importar el plan | `plan/plan-importacion.js` |
| El parser de CSV / bugs de importación del plan | `plan/plan-importacion-csv.js` |
| Crear plan, universidad "Otra", añadir materia manual | `plan/plan-esquema.js` |
| Orden de las tarjetas de arriba, estadísticas, barra de acciones del Plan | `plan/plan-vista-lista.js` |
| Diseño de la tarjeta de materia, bloque de Optativas | `plan/plan-vista-lista-tarjetas.js` |
| Encabezado de 2 líneas, modal de detalle, "Es requisito"/Historial | `plan/plan-detalle.js` |
| Categorías del Plan (CRUD) | `plan/plan-categorias.js` |
| Selector de plan, Modo Hardcore (3 planes), Gestionar Planes | `plan/plan-gestionar.js` |
| Vista de Mapa interactivo del Plan | `plan/plan-mapa.js` |
| Alta de semestre, matricular materias, sincronía con el Plan | `semestres/semestres.js` |
| Tarjeta de semestre/materia matriculada, motor de notas, criterios/asignaciones | `semestres/semestres-tarjetas.js` |
| Dashboard de promedio/aprobación en Semestres | `semestres/semestres-dashboard.js` |
| Pagos de matrícula/beca heredados por semestre | `js/finanzas/finanzas-semestres.js` |
| Gastos universitarios heredados y Beneficios | `js/finanzas/finanzas-gastos.js` |
| Registro de movimientos, metas, disponible y resumen | `js/core/finanzas/` + `js/finanzas/finanzas.js` |
| Importar/exportar CSV y respaldos | `js/core/finanzas/finanzas-importar.js`, `js/finanzas/finanzas-datos-ui.js` |
| Plantillas para leer mensajes bancarios | `js/core/finanzas/finanzas-mensajes.js`, `js/finanzas/finanzas-mensajes-ui.js` |
| Préstamos y gastos divididos | `js/core/finanzas/finanzas-deudas.js`, `js/finanzas/finanzas-deudas-ui.js` |
| Cuentas, divisas y traspasos | `js/core/finanzas/finanzas-cuentas.js`, `js/finanzas/finanzas-cuentas-ui.js` |
| Colecciones, migraciones y sync de Finanzas | `js/core/schema.js`, `js/core/storage/storage-merge.js` |
| Alta/edición de profesor o compañero, vincular profesor a materia | `comunidad/comunidad.js` |
| Grid semanal de Horario, modo conjunto, colores/nombres de bloque | `horario/horario.js` |
| Modal de alta/edición de bloque de horario, Cronograma de excepciones | `horario/horario-modal.js` |
| Enlaces compartidos de Horario, vincular/revocar amigos | `horario/horario-amigos.js` |
| La página pública `amigos.html` (sin sesión) | `horario/horario-amigos-publico.js` |
| Vista Lista de Agenda, filtros, selector de semestres | `agenda/agenda.js` |
| Modal de evento/tarea/examen de Agenda | `agenda/agenda-modal.js` |
| Vista Calendario (mensual/semanal) de Agenda | `agenda/agenda-calendario.js` |
| Clasificación de Wapper, grabación o mensajes offline | `asistente/asistente.js`, `asistente/asistente-cola.js` |
| "Materias" inline por día en Agenda | `agenda/agenda-clases.js` |
| Navegación del sidebar, qué sección se muestra al entrar | `main.js` |

### Cola offline de Wapper

La cola de mensajes de Wapper vive exclusivamente en IndexedDB del dispositivo y se separa por correo de la cuenta. No se sincroniza con Drive: conserva texto, blobs de audio y fecha/zona de referencia, y al recuperar internet delega la extracción al mismo pipeline de Gemini del chat. La integración guarda automáticamente solo eventos con etiqueta vigente, fecha válida, materia no ambigua y confianza alta. La clave estable derivada del id de cola más el índice del evento hace idempotente el guardado si la app se cierra entre crear el evento y actualizar el estado de la cola. Los elementos que necesitan revisión permanecen locales hasta que el usuario los revise o descarte. El borrado desde «Deshacer» usa el tombstone ya existente de Agenda.

---

## Deuda pendiente conocida (para no perderla de vista)

- **`plan/plan-mapa.js` no combina Modo Hardcore** — solo muestra el plan principal;
  con Hardcore ahora a 3 planes la brecha es más notoria. No bloqueante, pendiente de
  confirmar prioridad.
- **`plan/plan-esquema.js` no tiene `obtenerPlanTerciario()`** — no hizo falta porque
  `js/semestres/` usa `obtenerPlanesActivos()` de `schema.js` directamente, pero si
  otro módulo necesita el plan terciario suelto, falta ese getter.
- **Archivos por encima del límite de 800 líneas**, candidatos a dividirse en un
  próximo prompt: `comunidad/comunidad.js` (~3948), `semestres/semestres-tarjetas.js`
  (~3540), `horario/horario.js` (2064), `horario/horario-modal.js` (1038). Ver
  "Patrones transversales" en `MAPA_FUNCIONES.md`.
- **`semestres-tarjetas.js` — resolver conflicto de materia matriculada** hoy solo
  muestra un aviso genérico (`mostrarToast`) en vez de un resolver de campo-por-campo
  como `abrirModalResolverConflictoGenerico` de `plan-vista-lista-tarjetas.js`. Evaluar
  si conviene unificar ambos en un solo resolver genérico reutilizable desde
  `storage-merge.js` en vez de mantener 2 implementaciones paralelas.
- **`config/config-baneados.js`** sigue vacío/reservado — no tocar con código de otra
  sección por error.

---

## Nota de mantenimiento

Este archivo y `MAPA_FUNCIONES.md` son documentos vivos. Cualquier prompt que:
- cree un archivo `.js` nuevo,
- agregue/quite funciones o constantes exportadas de uno existente, o
- cambie a qué capa pertenece un archivo, o agregue/quite un import circular,

debe actualizar la entrada correspondiente en **ambos** documentos en el mismo
prompt — `MAPA_FUNCIONES.md` con el detalle de exports, este archivo con la capa/
cheat-sheet/imports circulares si corresponde. No dupliques la lista de exports acá:
si necesitás el detalle función-por-función, va en `MAPA_FUNCIONES.md`.
