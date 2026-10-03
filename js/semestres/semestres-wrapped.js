import { estado } from "../core/storage.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { obtenerEstadoEfectivoSemestre, sellarTimestamp } from "../core/schema.js";
import { obtenerIdiomaActual, obtenerLocaleInterfaz } from "../core/i18n.js";

const fechaLocal = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? new Date(`${iso}T00:00:00`) : null;
const aISO = (fecha) => `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;

const TRADUCCIONES_EXTRA = {
  pt: {
    "minutos": "minutos", "horas": "horas", "Sin notas registradas": "Sem notas registradas",
    "Aún no hay notas": "Ainda não há notas", "Tu semestre": "Seu semestre",
    "Wrapped de": "Resumo do semestre de", "Cerrar Wrapped": "Fechar resumo",
    "Saltar / cerrar": "Pular / fechar", "Siguiente →": "Próximo →", "Terminar ✓": "Concluir ✓",
  },
  de: {
    "minutos": "Minuten", "horas": "Stunden", "Sin notas registradas": "Keine Noten eingetragen",
    "Aún no hay notas": "Noch keine Noten", "Tu semestre": "Dein Semester",
    "Wrapped de": "Semester-Rückblick: ", "Cerrar Wrapped": "Rückblick schließen",
    "Saltar / cerrar": "Überspringen / schließen", "Siguiente →": "Weiter →", "Terminar ✓": "Fertig ✓",
  },
  ja: {
    "minutos": "分", "horas": "時間", "Sin notas registradas": "記録された成績はありません",
    "Aún no hay notas": "成績はまだありません", "Tu semestre": "あなたの学期",
    "Wrapped de": "学期のまとめ：", "Cerrar Wrapped": "まとめを閉じる",
    "Saltar / cerrar": "スキップ / 閉じる", "Siguiente →": "次へ →", "Terminar ✓": "完了 ✓",
  },
};

function rangoSemestre(semestre) {
  const inicio = fechaLocal(semestre?.fecha_inicio);
  if (!inicio || Number.isNaN(inicio.getTime())) return null;
  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + Math.max(1, Number(semestre.duracion_semanas) || 16) * 7 - 1);
  return { inicio, fin, inicioISO: aISO(inicio), finISO: aISO(fin) };
}

function materiaDeMatriculada(mm) {
  for (const plan of estado.datos?.planes_estudio || []) {
    if (plan.id !== mm.plan_estudio_id) continue;
    return (plan.materias || []).find((m) => m.id === mm.materia_id) || null;
  }
  return null;
}

function perteneceEventoAlSemestre(evento, semestre, idsMaterias, rango) {
  if (evento.semestre_id) return evento.semestre_id === semestre.id;
  const idMateria = evento.materia_matriculada_id || evento.materiaMatriculadaId;
  if (idMateria) return idsMaterias.has(idMateria);
  return Boolean(rango && evento.fecha >= rango.inicioISO && evento.fecha <= rango.finISO);
}

/** Resumen determinista para la presentación; expuesto para verificar los conteos. */
function calcularDatosWrappedSemestre(semestre) {
  const rango = rangoSemestre(semestre);
  const materias = semestre?.materias_matriculadas || [];
  const conNota = materias.map((mm) => ({ mm, materia: materiaDeMatriculada(mm), nota: Number(mm.nota_final) }))
    .filter((x) => Number.isFinite(x.nota) && x.mm.nota_final !== null && x.mm.nota_final !== undefined);
  const creditos = (x) => Math.max(0, Number(x.mm.creditos ?? x.materia?.creditos) || 0);
  const totalCreditos = conNota.reduce((s, x) => s + creditos(x), 0);
  const promedio = conNota.length ? (totalCreditos
    ? conNota.reduce((s, x) => s + x.nota * creditos(x), 0) / totalCreditos
    : conNota.reduce((s, x) => s + x.nota, 0) / conNota.length) : null;
  const porNota = [...conNota].sort((a, b) => a.nota - b.nota);
  const idsMaterias = new Set(materias.map((mm) => mm.id).filter(Boolean));
  const eventos = (estado.datos?.agenda || []).filter((ev) => perteneceEventoAlSemestre(ev, semestre, idsMaterias, rango));
  const tareas = eventos.filter((ev) => ev.tipo === "tarea");
  const inicioRangoMs = rango ? rango.inicio.getTime() : 0;
  const finDia = rango ? new Date(rango.fin) : null;
  if (finDia) finDia.setHours(23, 59, 59, 999);
  const finRangoMs = finDia ? finDia.getTime() : 0;
  const sesiones = (estado.datos?.sesiones_estudio || []).filter((s) => rango && idsMaterias.has(s.materia_matriculada_id))
    .map((s) => {
      const inicio = Number(s.inicio);
      const fin = Number(s.fin);
      if (!Number.isFinite(inicio)) return { ...s, minutosWrapped: 0 };
      const finEfectivo = Number.isFinite(fin) ? fin : inicio + (Number(s.duracion_minutos) || 0) * 60000;
      const minutos = Math.max(0, Math.min(finEfectivo, finRangoMs) - Math.max(inicio, inicioRangoMs)) / 60000;
      return { ...s, minutosWrapped: minutos };
    });
  return {
    materias: materias.length, promedio,
    mejor: porNota.length ? { nombre: porNota.at(-1).materia?.nombre || "Materia", nota: porNota.at(-1).nota } : null,
    peor: porNota.length ? { nombre: porNota[0].materia?.nombre || "Materia", nota: porNota[0].nota } : null,
    tareas: tareas.length, examenes: eventos.filter((ev) => ev.tipo === "examen").length,
    completadas: tareas.filter((ev) => ev.completada).length,
    perdidas: tareas.filter((ev) => ev.perdida).length,
    pendientes: tareas.filter((ev) => !ev.completada && !ev.perdida).length,
    minutosEstudiados: Math.round(sesiones.reduce((total, s) => total + s.minutosWrapped, 0)),
    rango,
  };
}

function mostrarWrappedSemestre(semestreId, { automatico = false } = {}) {
  agregarEstilosWrapped();
  const semestre = (estado.datos?.semestres || []).find((s) => s.id === semestreId);
  if (!semestre) return false;
  const datos = calcularDatosWrappedSemestre(semestre);
  const idioma = obtenerIdiomaActual();
  const texto = (es, en, it, fr) => {
    const traduccion = ({ es, en, it, fr })[idioma];
    if (traduccion) return traduccion;
    return (TRADUCCIONES_EXTRA[idioma] || {})[es] || es;
  };
  const n = (valor) => new Intl.NumberFormat(obtenerLocaleInterfaz(), { maximumFractionDigits: 1 }).format(valor);
  const tiempo = datos.minutosEstudiados < 60
    ? `${datos.minutosEstudiados} ${texto("minutos", "minutes", "minuti", "minutes")}`
    : `${n(datos.minutosEstudiados / 60)} ${texto("horas", "hours", "ore", "heures")}`;
  const mejor = datos.mejor ? `${datos.mejor.nombre} · ${n(datos.mejor.nota)}` : texto("Sin notas registradas", "No grades recorded", "Nessun voto registrato", "Aucune note enregistrée");
  const peor = datos.peor ? `${datos.peor.nombre} · ${n(datos.peor.nota)}` : texto("Sin notas registradas", "No grades recorded", "Nessun voto registrato", "Aucune note enregistrée");
  const promedio = datos.promedio === null ? texto("Aún no hay notas", "No grades yet", "Ancora nessun voto", "Pas encore de notes") : n(datos.promedio);
  const diapositivas = [
    [texto("Tu semestre en números", "Your semester in numbers", "Il tuo semestre in numeri", "Votre semestre en chiffres"), String(datos.materias), texto("materias llevadas", "courses taken", "materie seguite", "matières suivies")],
    [texto("El promedio del semestre", "Your semester average", "La media del semestre", "La moyenne du semestre"), promedio, texto("promedio de notas", "grade average", "media dei voti", "moyenne des notes")],
    [texto("Tu mejor resultado", "Your best result", "Il tuo risultato migliore", "Votre meilleur résultat"), mejor, texto("mejor nota registrada", "highest recorded grade", "voto più alto registrato", "meilleure note enregistrée")],
    [texto("Un reto para la próxima", "A challenge for next time", "Una sfida per la prossima volta", "Un défi pour la prochaine fois"), peor, texto("nota más baja registrada", "lowest recorded grade", "voto più basso registrato", "note la plus basse")],
    [texto("Todo lo que organizaste", "Everything you organized", "Tutto ciò che hai organizzato", "Tout ce que vous avez organisé"), String(datos.tareas), texto("tareas y proyectos", "assignments and projects", "compiti e progetti", "tâches et projets")],
    [texto("Momentos de evaluación", "Assessment moments", "Momenti di valutazione", "Moments d’évaluation"), String(datos.examenes), texto("exámenes", "exams", "esami", "examens")],
    [texto("Cada paso cuenta", "Every step counts", "Ogni passo conta", "Chaque étape compte"), `${datos.completadas} · ${datos.pendientes} · ${datos.perdidas}`, texto("completadas · pendientes · perdidas", "completed · pending · missed", "completati · in sospeso · persi", "terminées · en attente · manquées")],
    [texto("El tiempo que invertiste", "The time you invested", "Il tempo che hai investito", "Le temps que vous avez investi"), tiempo, texto("estudiando materias de este semestre", "studying courses from this semester", "studiando le materie del semestre", "à étudier les matières du semestre")],
  ];
  document.getElementById("wrapped-semestre-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "wrapped-semestre-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `${texto("Wrapped de", "Semester Wrapped:", "Wrapped di", "Wrapped de")} ${semestre.nombre || "Semestre"}`);
  overlay.style.cssText = "position:fixed;inset:0;z-index:10050;display:grid;place-items:center;padding:18px;background:radial-gradient(ellipse at 15% 10%,color-mix(in srgb,var(--color-luz,#6d5efc) 65%,transparent),transparent 52%),linear-gradient(145deg,#11102e,#21114a 55%,#51204b);color:#fff;overflow:auto;";
  const panel = document.createElement("section");
  panel.style.cssText = "width:min(720px,100%);min-height:min(560px,calc(100dvh - 36px));display:flex;flex-direction:column;justify-content:space-between;padding:clamp(22px,6vw,50px);border:1px solid #ffffff35;border-radius:28px;background:#151329bb;backdrop-filter:blur(18px);box-shadow:0 30px 100px #0008;box-sizing:border-box;";
  const progress = document.createElement("div");
  progress.style.cssText = "display:grid;grid-template-columns:repeat(8,1fr);gap:6px;";
  const bars = diapositivas.map(() => { const b = document.createElement("span"); b.style.cssText = "height:4px;border-radius:9px;background:#ffffff35;transition:background .2s;"; progress.appendChild(b); return b; });
  const head = document.createElement("div");
  head.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:10px;";
  const titleSemestre = document.createElement("span"); titleSemestre.textContent = semestre.nombre || texto("Tu semestre", "Your semester", "Il tuo semestre", "Votre semestre");
  const cerrar = document.createElement("button"); cerrar.type = "button"; cerrar.textContent = "×"; cerrar.setAttribute("aria-label", texto("Cerrar Wrapped", "Close Wrapped", "Chiudi Wrapped", "Fermer Wrapped")); cerrar.style.cssText = "font-size:1.8rem;color:inherit;background:transparent;border:0;cursor:pointer;";
  head.append(titleSemestre, cerrar);
  const content = document.createElement("div"); content.setAttribute("aria-live", "polite"); content.style.cssText = "padding:24px 0;animation:wrapped-entrada .35s ease both;";
  const number = document.createElement("div"); number.style.cssText = "font-size:clamp(3.5rem,13vw,7.5rem);font-weight:900;line-height:1.05;letter-spacing:-.06em;overflow-wrap:break-word;word-break:normal;hyphens:auto;";
  const sub = document.createElement("p"); sub.style.cssText = "font-size:clamp(1.1rem,4vw,1.6rem);line-height:1.5;color:#ffffffc7;";
  const kicker = document.createElement("p"); kicker.style.cssText = "text-transform:uppercase;letter-spacing:.16em;color:#c4b5fd;font-size:.82rem;font-weight:700;";
  content.append(kicker, number, sub);
  const footer = document.createElement("div"); footer.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;";
  const skip = document.createElement("button"); skip.type = "button"; skip.className = "btn btn-secondary"; skip.textContent = texto("Saltar / cerrar", "Skip / close", "Salta / chiudi", "Passer / fermer");
  const counter = document.createElement("span"); counter.style.color = "#ffffffb8";
  const next = document.createElement("button"); next.type = "button"; next.className = "btn btn-primary"; next.textContent = texto("Siguiente →", "Next →", "Avanti →", "Suivant →");
  footer.append(skip, counter, next); panel.append(progress, head, content, footer); overlay.appendChild(panel); document.body.appendChild(overlay);
  let indice = 0, touchX = null;
  const cerrarWrapped = () => { document.removeEventListener("keydown", tecla); overlay.remove(); };
  const tecla = (e) => { if (e.key === "Escape") cerrarWrapped(); else if (e.key === "ArrowRight") avanzar(1); else if (e.key === "ArrowLeft") avanzar(-1); };
  function pintar() {
    const [titulo, valor, detalle] = diapositivas[indice];
    kicker.textContent = titulo; number.textContent = valor; sub.textContent = detalle;
    const textoLargo = indice === 2 || indice === 3;
    number.style.fontSize = textoLargo ? "clamp(1.8rem,7vw,3.25rem)" : "clamp(3.5rem,13vw,7.5rem)";
    number.style.letterSpacing = textoLargo ? "-.035em" : "-.06em";
    counter.textContent = `${indice + 1} / ${diapositivas.length}`;
    bars.forEach((b, i) => { b.style.background = i <= indice ? "#c4b5fd" : "#ffffff35"; });
    next.textContent = indice === diapositivas.length - 1 ? texto("Terminar ✓", "Finish ✓", "Fine ✓", "Terminer ✓") : texto("Siguiente →", "Next →", "Avanti →", "Suivant →");
    content.style.animation = "none"; void content.offsetWidth; content.style.animation = "wrapped-entrada .35s ease both";
  }
  function avanzar(direccion) { const nuevo = indice + direccion; if (nuevo < 0) return; if (nuevo >= diapositivas.length) { cerrarWrapped(); return; } indice = nuevo; pintar(); }
  cerrar.addEventListener("click", cerrarWrapped); skip.addEventListener("click", cerrarWrapped); next.addEventListener("click", () => avanzar(1));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) avanzar(1); });
  overlay.addEventListener("touchstart", (e) => { touchX = e.changedTouches[0]?.clientX ?? null; }, { passive: true });
  overlay.addEventListener("touchend", (e) => { const fin = e.changedTouches[0]?.clientX; if (touchX !== null && fin !== undefined && Math.abs(fin - touchX) > 45) avanzar(fin < touchX ? 1 : -1); touchX = null; }, { passive: true });
  document.addEventListener("keydown", tecla);
  if (automatico) { semestre.wrapped_mostrado_en = new Date().toISOString(); sellarTimestamp(semestre); marcarCambioPendiente(); }
  pintar();
  return true;
}

function esWrappedPendiente(semestre, hoy = new Date()) {
  if (!esSemestreActualMasReciente(semestre, hoy)) return false;
  const rango = rangoSemestre(semestre);
  if (!rango || semestre.wrapped_mostrado_en) return false;
  const manana = new Date(hoy); manana.setHours(0, 0, 0, 0);
  const fin = new Date(rango.fin); fin.setHours(23, 59, 59, 999);
  return manana > fin;
}

function semestreFinalizadoParaWrapped(semestre, hoy = new Date()) {
  if (!esSemestreActualMasReciente(semestre, hoy)) return false;
  const rango = rangoSemestre(semestre);
  if (!rango) return false;
  const fin = new Date(rango.fin); fin.setHours(23, 59, 59, 999);
  return hoy > fin;
}

function revisarWrappedAutomatico() {
  const candidato = (estado.datos?.semestres || []).filter((s) => esWrappedPendiente(s))
    .sort((a, b) => String(a.fecha_inicio).localeCompare(String(b.fecha_inicio)))[0];
  if (!candidato) return false;
  let intentos = 0;
  const intentar = () => {
    if (document.querySelector(".modal-overlay:not(.oculto)")) {
      if (intentos++ < 12) window.setTimeout(intentar, 1000);
      return;
    }
    mostrarWrappedSemestre(candidato.id, { automatico: true });
  };
  window.setTimeout(intentar, 900);
  return true;
}

function esSemestreActualMasReciente(semestre, hoy = new Date()) {
  const hoyISO = aISO(hoy);
  const semestres = (estado.datos?.semestres || [])
    .filter((s) => fechaLocal(s.fecha_inicio) && s.fecha_inicio <= hoyISO);
  if (!semestres.length) return false;
  const marcadosActuales = semestres.filter((s) => obtenerEstadoEfectivoSemestre(s) === "actual");
  const grupo = marcadosActuales.length ? marcadosActuales : semestres;
  grupo.sort((a, b) => String(b.fecha_inicio).localeCompare(String(a.fecha_inicio)));
  return grupo[0]?.id === semestre?.id;
}

function agregarEstilosWrapped() {
  if (document.getElementById("estilos-semestre-wrapped")) return;
  const style = document.createElement("style"); style.id = "estilos-semestre-wrapped";
  style.textContent = "@keyframes wrapped-entrada{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}@media(prefers-reduced-motion:reduce){#wrapped-semestre-overlay *{animation:none!important;transition:none!important}}";
  document.head.appendChild(style);
}

export { calcularDatosWrappedSemestre, esWrappedPendiente, semestreFinalizadoParaWrapped, mostrarWrappedSemestre, revisarWrappedAutomatico, agregarEstilosWrapped };
