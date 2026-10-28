/* =========================================================================
   AVISO: SIGLAS Y NOMBRE COMPLETO DE LA UNIVERSIDAD INVERTIDOS
   Módulo aparte y autocontenido (solo DOM, no importa nada de la app) a
   propósito: así agregar esta validación no obliga a tocar ui/componentes.js.
   Lo usan los 3 formularios que guardan una universidad:
   plan-esquema.js (crear plan, bloque "Otra"), plan-gestionar.js (editar
   plan) y main.js (modal de completar universidades).
   ========================================================================= */
/* ===================== Validación: siglas y nombre completo invertidos ===================== */

const SEGUNDOS_AVISO_UNIVERSIDAD_INVERTIDA = 5;

/**
 * Universidad (siglas + nombre completo): detecta cuando la persona
 * escribió los dos campos al revés. Señal fuerte: las siglas son MÁS LARGAS
 * que el nombre completo (ej. "Instituto Tecnológico de Costa Rica" en
 * Siglas y "TEC" en Nombre completo).
 *
 * Uso (desde cualquier formulario que guarde una universidad):
 *   const revisada = await confirmarUniversidadNoInvertida({ siglas, nombre_completo, nombrePlan });
 *   plan.universidad = { nombre_completo: revisada.nombre_completo, siglas: revisada.siglas };
 *
 * - Si NO hay señal de inversión, resuelve al instante con los valores
 *   tal cual (sin ningún modal).
 * - Si la hay, muestra un aviso BLOQUEANTE: sin "X", sin click afuera y sin
 *   Esc. Los dos botones arrancan deshabilitados y se habilitan recién
 *   pasados SEGUNDOS_AVISO_UNIVERSIDAD_INVERTIDA segundos, para asegurar
 *   que se lea el aviso antes de poder decidir.
 *     "Sí, me equivoqué"  -> resuelve con los dos valores intercambiados.
 *     "No, así está bien" -> resuelve con lo que la persona escribió.
 * `nombrePlan` es opcional: solo se muestra como contexto (útil cuando el
 * aviso aparece por cada plan en el modal de completar universidades).
 */
function confirmarUniversidadNoInvertida({ siglas, nombre_completo, nombrePlan } = {}) {
  const s = String(siglas || "").trim();
  const n = String(nombre_completo || "").trim();
  const talCual = { siglas: s, nombre_completo: n };
  if (s.length <= n.length) return Promise.resolve(talCual);

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "100000";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");

    const card = document.createElement("div");
    card.className = "glass-card modal-card stack";
    card.tabIndex = -1;

    const titulo = document.createElement("h2");
    titulo.style.margin = "0";
    titulo.textContent = "¿Escribiste las siglas y el nombre al revés?";
    card.appendChild(titulo);

    if (nombrePlan) {
      const plan = document.createElement("p");
      plan.className = "muted";
      plan.style.cssText = "margin:0; font-size:0.8rem;";
      plan.textContent = `Plan: ${nombrePlan}`;
      card.appendChild(plan);
    }

    const cuerpo = document.createElement("p");
    cuerpo.style.margin = "0";
    cuerpo.textContent =
      `Pusiste "${s}" en Siglas y "${n}" en Nombre completo. ` +
      "Normalmente las siglas son más cortas que el nombre completo, así que parece que quedaron invertidas.";
    card.appendChild(cuerpo);

    const consecuencia = document.createElement("p");
    consecuencia.className = "muted";
    consecuencia.style.margin = "0";
    consecuencia.textContent = `Si las intercambio, se guardaría como Siglas: "${n}" y Nombre completo: "${s}".`;
    card.appendChild(consecuencia);

    const fila = document.createElement("div");
    fila.className = "row";
    fila.style.justifyContent = "flex-end";

    const btnNo = document.createElement("button");
    btnNo.type = "button";
    btnNo.className = "btn btn-secondary";
    const btnSi = document.createElement("button");
    btnSi.type = "button";
    btnSi.className = "btn btn-primary";
    btnNo.disabled = true;
    btnSi.disabled = true;
    fila.append(btnNo, btnSi);
    card.appendChild(fila);
    overlay.appendChild(card);

    // Sin Esc: se intercepta en captura mientras el aviso esté abierto.
    const bloquearEsc = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", bloquearEsc, true);

    let restantes = SEGUNDOS_AVISO_UNIVERSIDAD_INVERTIDA;
    const pintarBotones = () => {
      const sufijo = restantes > 0 ? ` (${restantes})` : "";
      btnSi.textContent = `Sí, me equivoqué${sufijo}`;
      btnNo.textContent = `No, así está bien${sufijo}`;
    };
    pintarBotones();

    const temporizador = setInterval(() => {
      restantes -= 1;
      pintarBotones();
      if (restantes <= 0) {
        clearInterval(temporizador);
        btnSi.disabled = false;
        btnNo.disabled = false;
      }
    }, 1000);

    const cerrarConResultado = (resultado) => {
      clearInterval(temporizador);
      document.removeEventListener("keydown", bloquearEsc, true);
      overlay.remove();
      resolve(resultado);
    };
    btnSi.addEventListener("click", () => {
      if (btnSi.disabled) return;
      cerrarConResultado({ siglas: n, nombre_completo: s });
    });
    btnNo.addEventListener("click", () => {
      if (btnNo.disabled) return;
      cerrarConResultado(talCual);
    });

    document.body.appendChild(overlay);
    // Foco al card (no a un botón) para que Enter/Espacio no acepten nada
    // por accidente mientras corre la cuenta regresiva.
    card.focus();
  });
}

export { confirmarUniversidadNoInvertida };
