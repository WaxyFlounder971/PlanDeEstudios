import { estado } from "./storage.js";
import { marcarCambioPendiente } from "./storage-sync.js";
import { sellarTimestamp } from "./schema.js";
import { aplicarPaleta, obtenerModoTemaLocal, guardarModoTemaLocal } from "../ui/tema.js";
import { traducirTextoInterfaz } from "./i18n.js";
import { iniciarFlujoPaletaPersonalizada } from "../ui/paleta-personalizada.js";

const SECCIONES_TUTORIAL = [
  { id: "resumen", nombre: "Resumen", detalle: ["Revisa lo que tienes para hoy.", "Consulta clases, tareas y exámenes próximos.", "Personaliza qué información quieres ver primero."] },
  { id: "agenda", nombre: "Agenda", detalle: ["Guarda tareas, exámenes y eventos.", "Cambia entre Lista, Calendario y Cronograma deslizando.", "Usa filtros para encontrar lo que buscas."] },
  { id: "horario", nombre: "Horario", detalle: ["Organiza tus clases por día y hora.", "Abre una clase para ver profesor, aula y enlaces.", "Compara horarios con tus amistades."] },
  { id: "tiempo-estudio", nombre: "Tiempo de Estudio", detalle: ["Inicia una sesión desde una materia.", "Consulta rachas y estadísticas por semestre.", "Únete a competencias si quieres estudiar en grupo."] },
  { id: "semestres", nombre: "Semestres", detalle: ["Matricula materias en cada semestre.", "Registra criterios y notas de evaluación.", "Proyecta cuánto necesitas en las evaluaciones pendientes."] },
  { id: "comunidad", nombre: "Comunidad", detalle: ["Guarda profesores y compañeros.", "Consulta valoraciones y datos compartidos.", "Conecta amistades para comparar horarios."] },
  { id: "finanzas", nombre: "Finanzas", detalle: ["Registra ingresos y gastos.", "Separa tus datos por semestre.", "Revisa gráficos y tendencias."] },
  { id: "plan-estudios", nombre: "Plan de Estudios", detalle: ["Consulta los requisitos de tu carrera.", "Marca materias aprobadas y pendientes.", "Explora relaciones y rutas de cursos."] },
  { id: "configuracion", nombre: "Ajustes", detalle: ["Cambia idioma, tema y tamaño de letra.", "Ordena o esconde secciones de navegación.", "Vuelve a abrir este recorrido cuando quieras."] },
];

function guardarConfiguracionOnboarding() {
  const cfg = estado.datos?.configuracion;
  if (!cfg) return;
  sellarTimestamp(cfg);
  marcarCambioPendiente();
}

function mostrarOnboardingNuevoUsuario({ navegar, toast } = {}) {
  if (!estado.datos?.configuracion || estado.datos.configuracion.onboarding_v1_completado !== false) return false;
  const cfg = estado.datos.configuracion;
  const seccionesTutorial = SECCIONES_TUTORIAL.filter((seccion) => document.getElementById(`seccion-${seccion.id}`));
  let etapa = "nombre";
  let indiceTutorial = 0;
  let detalleAbierto = false;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay onboarding-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "onboarding-titulo");
  const panel = document.createElement("section");
  panel.className = "glass-card onboarding-panel stack";
  const progreso = document.createElement("div"); progreso.className = "onboarding-progreso";
  const titulo = document.createElement("h2"); titulo.id = "onboarding-titulo";
  const contenido = document.createElement("div"); contenido.className = "stack onboarding-contenido";
  const acciones = document.createElement("div"); acciones.className = "row-between onboarding-acciones";
  panel.append(progreso, titulo, contenido, acciones); overlay.appendChild(panel); document.body.appendChild(overlay);

  const boton = (texto, clase, fn) => {
    const b = document.createElement("button"); b.type = "button"; b.className = `btn ${clase}`;
    b.textContent = traducirTextoInterfaz(texto); b.addEventListener("click", fn); return b;
  };
  const terminar = () => {
    cfg.onboarding_v1_completado = true;
    guardarConfiguracionOnboarding();
    overlay.remove();
    toast?.(traducirTextoInterfaz("¡Listo! Puedes volver a ver la guía desde Ajustes."));
  };
  const pintar = () => {
    contenido.replaceChildren(); acciones.replaceChildren();
    const etiquetaEtapa = etapa === "nombre" ? "1 / 5" : etapa === "apariencia" ? "2 / 5" : etapa === "instalar" ? "3 / 5" : etapa === "plan" ? "4 / 5" : `5 / 5 · ${indiceTutorial + 1}/${Math.max(1, seccionesTutorial.length)}`;
    progreso.textContent = etiquetaEtapa;
    if (etapa === "nombre") {
      titulo.textContent = traducirTextoInterfaz("¿Cómo te llamas?");
      const descripcion = document.createElement("p"); descripcion.className = "muted"; descripcion.textContent = traducirTextoInterfaz("Así sabremos cómo saludarte. Puedes cambiarlo después.");
      const nombre = document.createElement("input"); nombre.className = "form-input"; nombre.maxLength = 60; nombre.autocomplete = "given-name"; nombre.value = estado.datos.perfil?.nombre_preferido || estado.datos.perfil?.nombre || ""; nombre.setAttribute("aria-label", titulo.textContent);
      contenido.append(descripcion, nombre);
      acciones.append(boton("Continuar", "btn-primary", () => { const v = nombre.value.trim(); if (!v) { nombre.focus(); return; } estado.datos.perfil.nombre_preferido = v; guardarConfiguracionOnboarding(); window.renderizarPerfil?.(); etapa = "apariencia"; pintar(); }));
      requestAnimationFrame(() => nombre.focus()); return;
    }
    if (etapa === "apariencia") {
      titulo.textContent = traducirTextoInterfaz("Personaliza tu app");
      const modos = document.createElement("div"); modos.className = "pill-group onboarding-modos";
      [["light", "Modo claro"], ["dark", "Modo color"], ["true-dark", "Modo oscuro"]].forEach(([valor, texto]) => {
        const b = boton(texto, obtenerModoTemaLocal() === valor ? "btn-primary" : "btn-secondary", () => {
          guardarModoTemaLocal(valor);
          aplicarPaleta(cfg.paleta || "azul", valor, cfg.paleta === "personalizada" ? cfg.paleta_personalizada?.colores : undefined);
          pintar();
        }); b.setAttribute("aria-pressed", String(obtenerModoTemaLocal() === valor)); modos.appendChild(b);
      });
      const colores = document.createElement("div"); colores.className = "onboarding-colores";
      const tonos = { rojo: "#ef4444", dorado: "#f97316", amarillo: "#facc15", verde: "#10b981", azul: "#3b82f6", morado: "#8b5cf6" };
      Object.entries(tonos).forEach(([paleta, color]) => {
        const b = document.createElement("button"); b.type = "button"; b.className = "onboarding-color"; b.style.setProperty("--onboarding-color", color); b.title = traducirTextoInterfaz(paleta); b.setAttribute("aria-label", traducirTextoInterfaz(paleta)); b.setAttribute("aria-pressed", String(cfg.paleta === paleta));
        b.addEventListener("click", () => { cfg.paleta = paleta; aplicarPaleta(paleta, obtenerModoTemaLocal()); guardarConfiguracionOnboarding(); pintar(); }); colores.appendChild(b);
      });
      const etiquetaIcono = document.createElement("label"); etiquetaIcono.className = "form-label"; etiquetaIcono.textContent = traducirTextoInterfaz("Icono de la app");
      const iconos = document.createElement("div"); iconos.className = "onboarding-iconos";
      ["📘", "🎓", "📚", "🗓️", "✨", "🧠"].forEach((icono) => {
        const b = document.createElement("button"); b.type = "button"; b.className = "onboarding-icono"; b.textContent = icono; b.setAttribute("aria-pressed", String((cfg.icono_app || "📘") === icono));
        b.addEventListener("click", () => { cfg.icono_app = icono; const iconoNav = document.getElementById("icono-app-usuario"); if (iconoNav) iconoNav.textContent = icono; guardarConfiguracionOnboarding(); pintar(); }); iconos.appendChild(b);
      });
      contenido.append(modos, colores, etiquetaIcono, iconos);
      const mas = boton("Ajustar colores", "btn-secondary", () => {
        iniciarFlujoPaletaPersonalizada({ alGuardar: () => {
        cfg.paleta = "personalizada";
        cfg.paleta_personalizada = estado.datos.configuracion.paleta_personalizada;
        guardarConfiguracionOnboarding();
        } });
        const editor = document.querySelector(".ppz-overlay");
        if (editor) editor.style.zIndex = "200001";
      });
      acciones.append(mas, boton("Continuar", "btn-primary", () => { etapa = "instalar"; pintar(); })); return;
    }
    if (etapa === "instalar") {
      titulo.textContent = traducirTextoInterfaz("Lleva App Académica contigo");
      const p = document.createElement("p"); p.className = "muted"; p.textContent = traducirTextoInterfaz("Puedes instalarla en tu dispositivo para abrirla como una app. Si tu navegador no ofrece instalación ahora, puedes continuar y hacerlo después."); contenido.appendChild(p);
      acciones.append(boton("Ahora no", "btn-secondary", () => { etapa = "plan"; pintar(); }), boton("Instalar app", "btn-primary", () => { window.instalarAppAcademica?.(); etapa = "plan"; pintar(); })); return;
    }
    if (etapa === "plan") {
      titulo.textContent = traducirTextoInterfaz("Tu plan de estudios");
      const p = document.createElement("p"); p.className = "muted"; p.textContent = traducirTextoInterfaz("Añadir tu carrera desbloquea matrículas, horarios y proyecciones de notas. Es muy recomendable, pero puedes hacerlo luego."); contenido.appendChild(p);
      acciones.append(boton("Lo haré después", "btn-secondary", () => { etapa = "tutorial"; pintar(); }), boton("Agregar plan", "btn-primary", () => { terminar(); navegar?.("plan-estudios"); })); return;
    }
    const seccion = seccionesTutorial[indiceTutorial];
    if (!seccion) { terminar(); return; }
    titulo.textContent = `${traducirTextoInterfaz("Conoce")} ${traducirTextoInterfaz(seccion.nombre)}`;
    const intro = document.createElement("p"); intro.className = "muted"; intro.textContent = traducirTextoInterfaz("Esta es una sección de App Académica.");
    const fuenteReal = document.getElementById(`seccion-${seccion.id}`);
    const fragmentoReal = fuenteReal?.querySelector("h1, h2, h3, .glass-card, .glass-panel");
    if (fragmentoReal) {
      const fragmento = document.createElement("div"); fragmento.className = "onboarding-fragmento";
      const tituloFragmento = document.createElement("strong"); tituloFragmento.textContent = fragmentoReal.matches("h1, h2, h3") ? fragmentoReal.textContent.trim() : fragmentoReal.querySelector("h1, h2, h3")?.textContent?.trim() || seccion.nombre;
      const textoFragmento = document.createElement("span");
      const tarjetaMuestra = fuenteReal.querySelector(".glass-card, .glass-panel");
      textoFragmento.textContent = tarjetaMuestra?.textContent?.trim().replace(/\s+/g, " ").slice(0, 150) || seccion.detalle[0];
      fragmento.append(tituloFragmento, textoFragmento); contenido.appendChild(fragmento);
    }
    const pasos = document.createElement("ol"); pasos.className = "onboarding-pasos";
    seccion.detalle.slice(0, detalleAbierto ? 3 : 1).forEach((texto) => { const li = document.createElement("li"); li.textContent = traducirTextoInterfaz(texto); pasos.appendChild(li); });
    const saberMas = boton(detalleAbierto ? "Ocultar detalles" : "Saber más", "btn-secondary", () => { detalleAbierto = !detalleAbierto; pintar(); });
    contenido.append(intro, pasos, saberMas);
    const noMeInteresa = boton("No me interesa", "btn-secondary", () => { cfg.navegacion_oculta = [...new Set([...(cfg.navegacion_oculta || []), seccion.id])]; guardarConfiguracionOnboarding(); window.aplicarVisibilidadNavegacion?.(); siguiente(); });
    if (seccion.id === "configuracion") noMeInteresa.disabled = true;
    acciones.append(noMeInteresa, boton("Lo usaré", "btn-primary", siguiente));
    function siguiente() { indiceTutorial += 1; detalleAbierto = false; if (indiceTutorial >= seccionesTutorial.length) terminar(); else pintar(); }
  };
  pintar();
  return true;
}

function inicializarTutorialDesdeAjustes({ navegar, toast } = {}) {
  const botonAjustes = document.getElementById("btn-repetir-tutorial");
  if (botonAjustes && !botonAjustes.dataset.inicializado) {
    botonAjustes.dataset.inicializado = "1";
    botonAjustes.addEventListener("click", () => {
      if (!estado.datos?.configuracion) return;
      estado.datos.configuracion.onboarding_v1_completado = false;
      mostrarOnboardingNuevoUsuario({ navegar, toast });
    });
  }
}

export { mostrarOnboardingNuevoUsuario, inicializarTutorialDesdeAjustes };
