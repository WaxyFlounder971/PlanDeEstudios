## JS — Finanzas

### finanzas.js
Propósito: Shell de la sección Finanzas — arma las 4 pestañas (Resumen / Semestres / Gastos generales U / Beneficios) y calcula los totales del Resumen; el CRUD de cada pestaña vive en los otros dos archivos.
Depende de: core/schema.js, core/storage.js, finanzas-gastos.js, finanzas-semestres.js
Exporta:

* `calcularTotalesResumenFinanzas()` — suma costo_matricula (todos los semestres) + costo de cada gasto_u (recurrentes: solo lo ya pagado a la fecha) vs. beca_monto; devuelve `{ totalGastado, totalBecas, balanceNeto }`.
* `formatearFechaLarga(fechaIso)` — convierte `"YYYY-MM-DD"` a `"11 de agosto de 2026"`; vacío/null da `""`.
* `formatearMonto(numero)` — formatea a colones con 2 decimales; para negativos antepone un `"-"` explícito antes del `"₡"`.
* `renderizarContenidoFinanzasActivo()` — repinta solo el contenido de la pestaña activa dentro de `#finanzas-contenido`, sin reconstruir el tab bar.
* `renderizarFinanzas()` — punto de entrada de la sección; reconstruye tabs + contenido dentro de `#seccion-finanzas`.

### finanzas-gastos.js
Propósito: CRUD de gastos sueltos no vinculados a un semestre (pestaña "Gastos generales U", simples o recurrentes, con vínculo opcional a semestre) + generador de prompt de descuentos estudiantiles (pestaña "Beneficios").
Depende de: core/schema.js, core/storage-sync.js, core/storage.js, core/clipboard.js, ui/componentes.js, plan/plan-esquema.js, semestres/semestres.js, finanzas/finanzas.js
Exporta:

* `renderizarPestanaBeneficios(contenedor)` — pinta la pestaña Beneficios: botón(es) para copiar el prompt de descuentos estudiantiles según la(s) universidad(es) del/los plan(es) activo(s), y abrir claude.ai.
* `renderizarPestanaGastosU(contenedor)` — pinta la lista de gastos generales U (simples/recurrentes, con badge de monto o de total pagado a la fecha) + botón para abrir el modal de alta/edición.

### finanzas-semestres.js
Propósito: Pestaña "Semestres" de Finanzas — lista todos los semestres del historial (actuales + pasados) y permite crear/editar su registro financiero (costo de matrícula, monto de beca y desglose mensual del pago, manual o automático).
Depende de: core/schema.js, core/storage-sync.js, core/storage.js, ui/componentes.js, semestres/semestres.js, finanzas/finanzas.js
Exporta:

* `renderizarPestanaSemestresFinanzas(contenedor)` — pinta la lista de semestres con su registro financiero (badges de matrícula/beca, o botón "Crear registro" si aún no tiene) y abre el modal de alta/edición al interactuar.
