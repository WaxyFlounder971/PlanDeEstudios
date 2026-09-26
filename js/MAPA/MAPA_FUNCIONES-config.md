## JS — Config

### config-ajustes.js
Propósito: Renderiza la sección de Ajustes (paletas, modo claro/oscuro, escala de notas, nota de aprobación por plan/universidad, formato de texto, backup rotativo a Drive, modo rendimiento, config de días de Horario).
Depende de: core/schema.js, core/storage-sync.js, core/storage.js, core/utils.js, plan/plan-vista-lista.js, ui/componentes.js, ui/tema.js, ui/paleta-personalizada.js
Exporta:

* `renderizarAjustes()` — reconstruye toda la sección de Ajustes (paletas, escalas, moneda, backup, etc.) e inicializa el accordion.
* `renderizarSeccionBackupDrive()` — pinta el bloque de frecuencia/estado del backup rotativo a Drive; solo lee/escribe la preferencia, nunca dispara un backup a mano.
* `aplicarModoRendimiento(activo)` — aplica/quita el atributo `data-rendimiento` en `<html>`, se usa tanto en Ajustes como al iniciar la app.
* `DIAS_SEMANA_CONFIG` — arreglo con id/etiqueta/abreviatura por defecto de cada día de la semana, usado en la config de días de Horario.

### config-baneados.js
Propósito: Placeholder vacío reservado para cuando se construya la sección de Baneados.
Depende de: (ninguno)
Exporta: (nada — solo `export {}`)

### config-enlaces.js
Propósito: Gestiona los Enlaces rápidos de Configuración — listar, agregar, editar, eliminar y renderizarlos en los distintos contenedores donde aparecen (Configuración, panel lateral, drawer móvil).
Depende de: core/schema.js, core/storage-sync.js, core/storage.js, core/utils.js
Exporta:

* `renderizarEnlacesRapidos()` — repinta las 3 listas de enlaces rápidos (Configuración, panel lateral, drawer móvil) y habilita/deshabilita el botón "Agregar" según el límite.
* `renderizarListaEnlacesEn(contenedorId, enlaces, conEditar)` — dibuja una lista de enlaces dentro de un contenedor dado; `conEditar` controla si aparece el lápiz de edición.
* `inicializarModalEnlace()` — engancha los listeners del modal de alta/edición de enlace (pills de tipo de ícono, guardar, cancelar, eliminar).
* `abrirModalEnlace(enlaceId?)` — abre el modal en modo alta o edición (si se pasa un id) y precarga sus datos.
* `cerrarModalEnlace()` — cierra el modal y limpia el id en edición.
* `eliminarEnlaceDesdeModal()` — borra el enlace en edición dejando una tumba en `_eliminados_enlaces` (evita que resucite al sincronizar).
* `guardarEnlaceDesdeModal()` — valida y persiste el enlace (nuevo o editado), sellando timestamp antes de marcar el cambio pendiente.
* `mostrarErrorModalEnlace(mensaje)` — muestra un mensaje de error dentro del modal de enlace.
