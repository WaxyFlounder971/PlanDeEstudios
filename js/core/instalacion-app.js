let eventoInstalacionPendiente = null;
let temporizadoresBoton = [];

window.addEventListener("beforeinstallprompt", (evento) => {
  evento.preventDefault();
  eventoInstalacionPendiente = evento;
});

window.addEventListener("appinstalled", () => {
  eventoInstalacionPendiente = null;
  document.getElementById("btn-instalar-app-flotante")?.classList.add("oculto");
});

async function instalarAppAcademica() {
  if (eventoInstalacionPendiente) {
    eventoInstalacionPendiente.prompt();
    await eventoInstalacionPendiente.userChoice;
    eventoInstalacionPendiente = null;
    return true;
  }
  const android = /android/i.test(navigator.userAgent);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const mensaje = ios
    ? "En Safari, toca Compartir y luego Añadir a pantalla de inicio."
    : android
      ? "Abre el menú del navegador y elige Instalar app o Añadir a pantalla principal."
      : "Abre el menú del navegador y elige Instalar App Académica.";
  mostrarToast(mensaje);
  return false;
}

function mostrarInvitacionInstalacion() {
  const boton = document.getElementById("btn-instalar-app-flotante");
  if (!boton || window.matchMedia?.("(display-mode: standalone)")?.matches) return;
  temporizadoresBoton.forEach(clearTimeout); temporizadoresBoton = [];
  boton.classList.remove("oculto", "instalar-expandido");
  requestAnimationFrame(() => boton.classList.add("instalar-expandido"));
  temporizadoresBoton.push(setTimeout(() => boton.classList.remove("instalar-expandido"), 10000));
  temporizadoresBoton.push(setTimeout(() => boton.classList.add("oculto"), 15000));
}

function inicializarInstalacionApp() {
  const boton = document.getElementById("btn-instalar-app-flotante");
  if (!boton || boton.dataset.inicializado) return;
  boton.dataset.inicializado = "1";
  boton.addEventListener("click", instalarAppAcademica);
  window.instalarAppAcademica = instalarAppAcademica;
  mostrarInvitacionInstalacion();
}

export { inicializarInstalacionApp, instalarAppAcademica, mostrarInvitacionInstalacion };
import { mostrarToast } from "../ui/componentes.js";

