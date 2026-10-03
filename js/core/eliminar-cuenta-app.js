import { cerrarSesionGoogle, eliminarArchivoDeDriveConId, eliminarCalendarioGoogle, URL_WORKER_OAUTH } from "./auth.js";
import { CLAVE_CACHE_LOCAL, estado } from "./storage.js";
import { MODO_DEMO } from "./demo-mode.js";

async function listarArchivosDirectosDrive(token, folderName, nombresPermitidos = null) {
  const q = encodeURIComponent(`name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const rFolder = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!rFolder.ok) throw new Error("No se pudo revisar la carpeta de archivos de la app en Drive.");
  const folders = (await rFolder.json()).files || [];
  const ids = [];
  for (const folder of folders) {
    let pageToken = "";
    do {
      const params = new URLSearchParams({ q: `'${folder.id}' in parents and trashed=false`, spaces: "drive", fields: "nextPageToken,files(id,name)" });
      if (pageToken) params.set("pageToken", pageToken);
      const respuesta = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!respuesta.ok) throw new Error("No se pudieron enumerar los archivos de App Académica en Drive.");
      const datos = await respuesta.json();
      (datos.files || []).filter((f) => !nombresPermitidos || nombresPermitidos.includes(f.name)).forEach((f) => ids.push(f.id));
      pageToken = datos.nextPageToken || "";
    } while (pageToken);
  }
  return ids;
}

async function llamarWorker(path, opciones = {}) {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), 12000);
  try {
    return await fetch(`${URL_WORKER_OAUTH}${path}`, { ...opciones, signal: controlador.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function borrarParticipacionesCompetencias() {
  const correo = estado.datos.perfil?.correo;
  for (const competencia of estado.datos.competencias_unidas || []) {
    const id = encodeURIComponent(competencia.id);
    if (competencia.es_creador) {
      const tokenCreador = localStorage.getItem(`tokenCreadorCompetencia_${competencia.id}`);
      if (!tokenCreador) throw new Error(`Falta el permiso local para retirar la cuenta de «${competencia.nombre}».`);
      const respuesta = await llamarWorker(`/competencias/${id}`);
      if (!respuesta.ok && respuesta.status !== 404) throw new Error(`No se pudo revisar la competencia «${competencia.nombre}».`);
      if (respuesta.ok) {
        const datos = await respuesta.json();
        const otro = (datos.participantes || []).find((p) => p.id !== competencia.participante_id);
        if (otro) {
          const delegacion = await llamarWorker(`/competencias/${id}/delegar-borrado`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token_creador: tokenCreador, participante_id: otro.id }),
          });
          if (!delegacion.ok) throw new Error(`No se pudo transferir la administración de «${competencia.nombre}».`);
        }
      }
    }
    const salida = await llamarWorker(`/competencias/${id}/participantes/${encodeURIComponent(competencia.participante_id)}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identificador_usuario: correo }),
    });
    if (!salida.ok && salida.status !== 404) throw new Error(`No se pudo retirar la cuenta de «${competencia.nombre}».`);
  }
}

async function borrarDatosCuentaApp() {
  if (MODO_DEMO) throw new Error("Esta acción no está disponible en la demo.");
  const token = estado.token;
  if (!token || !estado.datos) throw new Error("La cuenta no está conectada a Google Drive.");

  const ids = new Set();
  const adjuntos = [
    ...(estado.datos.adjuntos || []),
    ...(estado.datos._eliminados_adjuntos || []),
  ];
  adjuntos.forEach((a) => { if (a?.driveFileId) ids.add(a.driveFileId); });
  (estado.datos.horario_enlaces_compartidos || []).forEach((h) => { if (h?.file_id) ids.add(h.file_id); });
  (estado.datos.horario_enlaces_compartidos || []).forEach((h) => { if (h?.fileId) ids.add(h.fileId); });

  // Solo carpetas reservadas por la app. En adjuntos se eliminan archivos
  // creados dentro de la carpeta dedicada; en backups, solo los dos nombres
  // que genera App Académica.
  (await listarArchivosDirectosDrive(token, "ArchivosAdjuntos")).forEach((id) => ids.add(id));
  (await listarArchivosDirectosDrive(token, "AppAcademica", ["backup_reciente.json", "backup_anterior.json"])).forEach((id) => ids.add(id));

  // Las competencias viven en el servicio propio, fuera de Drive. Se retira
  // la participación y se transfiere la administración si esta cuenta era
  // creadora con otros miembros; nunca se borra la competencia de terceros.
  await borrarParticipacionesCompetencias();

  // El archivo principal se borra al final: si algo falla antes, el usuario
  // conserva la referencia de su cuenta y puede volver a intentar.
  const calendarId = estado.datos.configuracion?.google_calendar_id;
  if (calendarId) await eliminarCalendarioGoogle(token, calendarId);
  if (estado.fileId) ids.delete(estado.fileId);
  for (const id of ids) await eliminarArchivoDeDriveConId(token, id);
  if (estado.fileId) await eliminarArchivoDeDriveConId(token, estado.fileId);

  // Este origen es la propia app; estas claves son su caché, preferencias,
  // sesión OAuth e historial local. No se modifica ningún otro sitio web.
  // Elimina datos locales de esta app. No limpia de forma indiscriminada
  // el almacenamiento del origen, por si comparte dominio con otra app.
  [
    CLAVE_CACHE_LOCAL, "google_token_cache", "google_refresh_token",
    "google_calendar_scope_otorgado_v1", "google_ya_autorizado",
    "seccion_activa_v1", "asistente_historial_dispositivo",
    "tema_paleta", "tema_modo", "tema_paleta_personalizada_colores",
    "modo_diseno_local_v1", "sidebar_colapsada", "idioma_interfaz_v1",
    "horario_amigo_pendiente", "horario_amigos_ocultos_vista", "horario_amigos_snapshots_backup_v1",
    "te_comp_vista", "te_filtro_vista_v1", "te_racha_oferta_dia_v1", "te_racha_perdida_dia_v1", "te_timer_activo_v1",
    "app_academica_dispositivo_id", "app_academica_reloj_logico",
  ].forEach((clave) => localStorage.removeItem(clave));
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const clave = sessionStorage.key(i);
    if (clave?.startsWith("app_academica_") || clave?.startsWith("te_")) sessionStorage.removeItem(clave);
  }
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const clave = localStorage.key(i);
    if (clave?.startsWith("te_comp_marcador_cache_v1:") || clave?.startsWith("tokenCreadorCompetencia_") || clave?.startsWith("te_comp_resultado_visto_")) localStorage.removeItem(clave);
  }
  cerrarSesionGoogle();
  estado.token = null;
  estado.fileId = null;
  estado.datos = null;
  estado.pendienteSync = false;
  window.location.reload();
}

export { borrarDatosCuentaApp };
