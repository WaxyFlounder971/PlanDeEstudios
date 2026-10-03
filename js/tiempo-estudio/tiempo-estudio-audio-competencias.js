import { estado } from "../core/storage.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { adjuntarArchivo, descargarAdjunto, eliminarAdjunto } from "../core/storage-adjuntos.js";
import { mostrarToast } from "../ui/componentes.js";

function nombreAdjuntoAudio(id) {
  return (estado.datos.adjuntos || []).find((a) => a.id === id)?.nombre || "Audio seleccionado";
}

function abrirAjustesAudioCompetencia(competencia, refrescar) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.zIndex = "700";
  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";
  caja.style.cssText = "width:min(100%,460px); max-height:88vh; overflow:auto; gap:14px;";
  caja.innerHTML = `
    <h2 style="margin:0;">Mis audios · ${escapar(competencia.nombre || "Competencia")}</h2>
    <p class="muted" style="margin:0;">Estos sonidos son personales: solo se reproducen en tu dispositivo.</p>
    ${construirCampo("victoria", "Audio de victoria", competencia.audio_victoria_adjunto_id)}
    ${construirCampo("derrota", "Audio de derrota", competencia.audio_derrota_adjunto_id)}
    <label class="row" style="align-items:flex-start; gap:8px;">
      <input type="checkbox" id="comp-audio-aplicar-todos" ${cantidadCompetencias() > 1 ? "" : "disabled"}>
      <span>Usar los audios editados en todas mis competencias${cantidadCompetencias() > 1 ? "" : " (solo tienes una por ahora)"}</span>
    </label>
    <div class="row" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="comp-audio-cerrar" style="flex:1;">Cerrar</button>
      <button type="button" class="btn btn-primary" id="comp-audio-guardar" style="flex:1;">Guardar</button>
    </div>`;
  overlay.appendChild(caja);
  document.body.appendChild(overlay);
  const cerrar = () => overlay.remove();
  caja.querySelector("#comp-audio-cerrar").addEventListener("click", cerrar);
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) cerrar(); });
  const guardar = caja.querySelector("#comp-audio-guardar");
  guardar.addEventListener("click", async () => {
    guardar.disabled = true;
    guardar.textContent = "Guardando…";
    try {
      const compartir = caja.querySelector("#comp-audio-aplicar-todos").checked;
      const idsAnteriores = new Set();
      const tiposModificados = new Set();
      for (const tipo of ["victoria", "derrota"]) {
        const input = caja.querySelector(`#comp-audio-${tipo}`);
        if (input.files?.[0]) {
          validarAudio(input.files[0]);
          const idAnterior = competencia[`audio_${tipo}_adjunto_id`];
          if (idAnterior) idsAnteriores.add(idAnterior);
          const ref = adjuntarArchivo(input.files[0], "competencia-audio", `${competencia.id}:${tipo}`, input.files[0].name, "🎵");
          competencia[`audio_${tipo}_adjunto_id`] = ref.id;
          tiposModificados.add(tipo);
        } else if (input.dataset.quitar === "1") {
          const idAnterior = competencia[`audio_${tipo}_adjunto_id`];
          if (idAnterior) idsAnteriores.add(idAnterior);
          competencia[`audio_${tipo}_adjunto_id`] = null;
          tiposModificados.add(tipo);
        }
      }
      const competencias = estado.datos.competencias_unidas || [];
      if (compartir) {
        competencias.forEach((otra) => {
          if (otra.id === competencia.id) return;
          tiposModificados.forEach((tipo) => {
            otra[`audio_${tipo}_adjunto_id`] = competencia[`audio_${tipo}_adjunto_id`] || null;
          });
        });
      }
      for (const idAnterior of idsAnteriores) if (!audioEnUso(idAnterior)) await eliminarAdjunto(idAnterior);
      marcarCambioPendiente();
      mostrarToast(compartir ? "Audios guardados en todas tus competencias" : "Audios guardados");
      cerrar();
      refrescar?.();
    } catch (error) {
      mostrarToast(error.message || "No se pudieron guardar los audios");
      guardar.disabled = false;
      guardar.textContent = "Guardar";
    }
  });

  for (const tipo of ["victoria", "derrota"]) {
    const id = competencia[`audio_${tipo}_adjunto_id`];
    const quitar = caja.querySelector(`#comp-audio-quitar-${tipo}`);
    if (!id) quitar.disabled = true;
    quitar.addEventListener("click", () => {
      caja.querySelector(`#comp-audio-${tipo}`).dataset.quitar = "1";
      caja.querySelector(`#comp-audio-actual-${tipo}`).textContent = "Se quitará al guardar";
      quitar.disabled = true;
    });
  }
}

function construirCampo(tipo, etiqueta, id) {
  return `<div class="stack" style="gap:6px;">
    <label class="form-label" for="comp-audio-${tipo}">${etiqueta}</label>
    <input id="comp-audio-${tipo}" class="form-input" type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.flac">
    <div class="row-between" style="gap:8px;"><span id="comp-audio-actual-${tipo}" class="muted">${id ? escapar(nombreAdjuntoAudio(id)) : "Sin audio personalizado"}</span>
      <button type="button" id="comp-audio-quitar-${tipo}" class="btn-discreto">Quitar</button></div>
  </div>`;
}

function validarAudio(file) {
  if (!file.type.startsWith("audio/") && !/\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(file.name)) throw new Error("Elige un archivo de audio.");
  if (file.size > 10 * 1024 * 1024) throw new Error("El audio debe pesar 10 MB o menos.");
}

function cantidadCompetencias() { return (estado.datos?.competencias_unidas || []).length; }
function audioEnUso(id) { return (estado.datos?.competencias_unidas || []).some((c) => c.audio_victoria_adjunto_id === id || c.audio_derrota_adjunto_id === id); }
function escapar(valor) { const d = document.createElement("div"); d.textContent = String(valor || ""); return d.innerHTML; }

async function reproducirAudioPersonal(competenciaId, tipo) {
  const competencia = (estado.datos?.competencias_unidas || []).find((c) => c.id === competenciaId);
  const id = competencia?.[`audio_${tipo}_adjunto_id`];
  if (!id) return false;
  const adjunto = (estado.datos.adjuntos || []).find((a) => a.id === id);
  if (!adjunto || adjunto.subidaPendiente) return false;
  let url;
  try {
    url = await descargarAdjunto(adjunto);
    const audio = new Audio(url);
    audio.volume = 0.7;
    audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
    await audio.play();
    return true;
  } catch (error) {
    if (url) URL.revokeObjectURL(url);
    console.warn("No se pudo reproducir el audio personal de competencia:", error);
    return false;
  }
}

export { abrirAjustesAudioCompetencia, reproducirAudioPersonal, validarAudio };
