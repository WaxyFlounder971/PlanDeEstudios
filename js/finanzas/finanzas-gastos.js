/* =========================================================================
   FINANZAS — Pestaña Beneficios (2026-08-10; v2.8.8 renombrada de "Gastos
   estudiantiles")
   Generador del prompt de descuentos estudiantiles: arma el texto, lo copia
   al portapapeles (blindado) y abre claude.ai en pestaña nueva.

   Finanzas 2.0 (0B): el CRUD de gastos/ingresos que vivía acá se movió al
   modelo único de movimientos:
     - finanzas-movimientos.js        → lista (Por tipo / Cronológico)
     - finanzas-movimiento-modal.js   → formulario de los 4 tipos
     - finanzas-recurrencia.js        → bloque de pagos recurrentes
   Este archivo conserva `obtenerTodosLosSemestres` porque lo importan varias
   pantallas de Finanzas.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { traducirTextoInterfaz } from "../core/i18n.js";
import { copiarPromptConAviso } from "../core/clipboard.js";
import { mostrarToast } from "../ui/componentes.js";
import { obtenerPlanActivo } from "../plan/plan-esquema.js";
import { obtenerSemestresActuales, obtenerSemestresPasados } from "../semestres/semestres.js";

/** Todos los semestres del historial (actuales + pasados), mismo orden que la pestaña Semestres. */
function obtenerTodosLosSemestres() {
  return [...obtenerSemestresActuales(), ...obtenerSemestresPasados()];
}

/* ===================== Beneficios: generador de prompt de descuentos ===================== */

// Plantilla completa del prompt de descuentos — {UNIVERSIDAD} se interpola
// con el nombre real de la universidad del plan elegido antes de copiar.
const PLANTILLA_PROMPT_DESCUENTOS = `Necesito que uses tu herramienta de búsqueda web de forma activa para responder esto con información real y actual, no desde tu conocimiento general ni asumiendo que no podés buscar en internet, sí podés y necesito que lo hagas. No me respondas con advertencias tipo "no puedo verificar esto en tiempo real" ni te limites por precaución, buscá de verdad, confirmá lo que encuentres, y si algo no lo podés confirmar decímelo directamente sin rodeos ni disculpas innecesarias.

Tomate todo el tiempo y todas las búsquedas que necesites para hacer esto bien, no te apures ni te conformes con la primera página que encuentres. Al mismo tiempo, sé eficiente: no repitas la misma búsqueda con palabras casi idénticas, y no gastes búsquedas en cosas que ya confirmaste. Para cada categoría, buscá primero si existe una fuente oficial directa (por ejemplo, para IA: "GitHub Student Pack beneficios", luego "Claude descuento estudiantes", así uno por uno en vez de una búsqueda genérica que junte todo). Si una fuente oficial menciona un requisito (ej. correo institucional, carné vigente, verificación con SheerID u otro servicio), anotalo textualmente en tu respuesta, no lo resumas de forma vaga. Si encontrás una página de convenios o beneficios estudiantiles de {UNIVERSIDAD} en su sitio oficial, revisala completa, no te quedes solo con el resultado de búsqueda, entrá a la página real. Para cadenas o empresas costarricenses, verificá primero si tienen una página o publicación específica de "descuento estudiante" antes de asumir que no existe.

Necesito que investigues qué descuentos, beneficios o tarifas especiales existen actualmente para estudiantes activos de {UNIVERSIDAD}, en Costa Rica. Soy estudiante matriculado y busco esta información para aprovecharla activamente, no es una consulta teórica. Quiero una lista exhaustiva, no te dejes ninguna categoría a medias ni asumas que algo "no aplica" sin buscarlo primero.

Buscá información actual (no asumas que datos viejos siguen vigentes, verificá que sigan activos) organizada en las siguientes categorías. En cada categoría, los ejemplos que doy son solo punto de partida, buscá TODAS las opciones que encuentres, no te limites a los nombres que menciono.

INTELIGENCIA ARTIFICIAL (IMPORTANTE, no te saltes nada acá): planes pagos de IA con descuento o gratis para estudiantes (Claude, ChatGPT Plus, Gemini Advanced, Perplexity Pro, Copilot Pro, GitHub Copilot, Cursor, y cualquier otra), créditos gratuitos de API para estudiantes, convenios que {UNIVERSIDAD} tenga con empresas de IA, herramientas de IA para escritura/imágenes/transcripción/programación con tarifa estudiantil.
TECNOLOGÍA, SOFTWARE Y HERRAMIENTAS PROFESIONALES: licencias estudiantiles (Microsoft 365, Adobe, JetBrains, GitHub Student Pack, Autodesk, Figma, Notion, Canva), créditos de nube (AWS Educate, Google Cloud for Students, Azure for Students), software por carrera (CAD, MATLAB, SolidWorks), descuentos reales en compra de laptops y hardware (Apple, Lenovo, Dell, HP, ASUS, tiendas costarricenses), planes de datos/internet con tarifa estudiantil, seguro o reparación de celular.
TRANSPORTE (dentro de Costa Rica): buses, tren (INCOFER), apps de transporte, estacionamientos cerca de las sedes de {UNIVERSIDAD}, alquiler de vehículos y seguro vehicular con tarifa estudiantil.
ALIMENTACIÓN (a nivel nacional, no solo cerca de las sedes): sodas, restaurantes, cadenas de comida rápida, cafeterías o cualquier negocio de alimentación en Costa Rica con descuento por carné estudiantil, sin importar la provincia, esto debe cubrir todo el país. Cadenas con presencia nacional que tengan convenio recurrente. Delivery de comida con descuento estudiantil. Si encontrás algo específico de una zona, indicalo pero aclará que es local.
ENTRETENIMIENTO, CULTURA Y STREAMING: cines, TODOS los servicios de streaming de música/video/lectura/gaming con plan estudiantil en Costa Rica (no te limites a nombres específicos), museos, teatros, conciertos, festivales, eventos deportivos, boliche/arcades/escape rooms con tarifa estudiantil.
SALUD Y BIENESTAR: gimnasios, seguros médicos/dentales, farmacias, servicios de salud mental/psicología, ópticas, con descuento estudiantil.
BANCA Y FINANZAS: cuentas sin costo de mantenimiento, tarjetas estudiantiles, préstamos con tasa preferencial (BAC, BCR, BN, Scotiabank, Popular).
LIBRERÍAS, FOTOCOPIADO E IMPRESIÓN: librerías, fotocopiado, impresión 3D con tarifa estudiantil.
CERTIFICACIONES Y EXÁMENES PROFESIONALES: TOEFL, IELTS, certificaciones de AWS/Microsoft/Google, certificaciones contables/gestión de proyectos, cursos de idiomas con tarifa estudiantil.
VIAJES, TURISMO Y BENEFICIOS INTERNACIONALES (menor prioridad, pero igual buscala): carné internacional (ISIC), tarifas aéreas estudiantiles, hostales/alojamiento/seguros de viaje en el extranjero, programas de intercambio o convenios internacionales de {UNIVERSIDAD}, turismo de aventura y parques nacionales (SINAC), parques temáticos/acuáticos/zoológicos.
OTROS Y BENEFICIOS POCO OBVIOS (no dejes ninguno fuera): convenios institucionales de {UNIVERSIDAD} con comercios, tiendas de ropa/electrónica/peluquerías con carné universitario, cualquier otro beneficio que encuentres aunque sea pequeño o raro.

FORMATO DE RESPUESTA QUE NECESITO (esto es muy importante, seguilo al pie de la letra):

Mostrame SOLO los beneficios que SÍ encontraste y confirmaste. No escribas ninguna línea de "esto no existe" intercalada entre los resultados positivos. Organizá lo positivo por categoría, con títulos bien marcados. Para cada beneficio: qué es, qué descuento exacto da, qué se necesita para acceder (usualmente el carné vigente), y si es nacional, limitado a alguna sede, o internacional. Usá viñetas cortas, no párrafos densos. No omitas ningún beneficio real por considerarlo poco importante. Al final de TODO, un solo resumen corto (unas pocas líneas) de qué categorías no dieron resultado confiable y cuáles beneficios convendría confirmar directamente. Priorizá fuentes oficiales sobre foros.`;

const PLANTILLA_PROMPT_DESCUENTOS_EN = `OUTPUT LANGUAGE: Write your entire response in English, including the opening, headings, findings, and final summary. Never answer in Spanish, even if a source is in Spanish; translate your explanation while preserving official names and quotations accurately.

Actively use your web-search tool to answer with current, real information. Do not rely on general knowledge or assume you cannot browse the web—you can, and I need you to. Do not give me warnings such as "I can't verify this in real time" or hold back out of caution. Search thoroughly, confirm what you find, and tell me plainly if something cannot be confirmed, without unnecessary hedging or apologies.

Take the time and run all the searches needed to do this properly. Do not rush or settle for the first page. At the same time, work efficiently: do not repeat nearly identical searches or spend searches on facts you have already confirmed. For each category, first look for a direct official source (for example, for AI, search "GitHub Student Pack benefits" and then "Claude student discount" separately instead of using one broad search). If an official source states a requirement (such as an institutional email, a valid student ID, or verification through SheerID or another service), include it explicitly rather than describing it vaguely. If {UNIVERSIDAD}'s official site has a page about agreements or student benefits, review the full page; do not rely only on the search result. For Costa Rican chains or businesses, first check whether they have a specific student-discount page or post before concluding that no offer exists.

Research the discounts, benefits, and special rates currently available to active students at {UNIVERSIDAD} in Costa Rica. I am an enrolled student looking for benefits I can actually use, not theoretical information. Make the list exhaustive: do not leave any category half-researched or assume something does not apply without checking.

Find current information—do not assume older offers are still active; verify that they are—and organize it under these categories. The examples are only starting points: look for every option you can find and do not limit yourself to the names listed.

ARTIFICIAL INTELLIGENCE (IMPORTANT—do not skip anything here): paid AI plans that are discounted or free for students (Claude, ChatGPT Plus, Gemini Advanced, Perplexity Pro, Copilot Pro, GitHub Copilot, Cursor, and others); free API credits for students; agreements between {UNIVERSIDAD} and AI companies; AI tools for writing, images, transcription, or programming with student pricing.
TECHNOLOGY, SOFTWARE, AND PROFESSIONAL TOOLS: student licenses (Microsoft 365, Adobe, JetBrains, GitHub Student Pack, Autodesk, Figma, Notion, Canva); cloud credits (AWS Educate, Google Cloud for Students, Azure for Students); degree-specific software (CAD, MATLAB, SolidWorks); genuine discounts on laptops and hardware (Apple, Lenovo, Dell, HP, ASUS, and Costa Rican retailers); student data or internet plans; phone insurance or repair.
TRANSPORTATION (within Costa Rica): buses, trains (INCOFER), ride-hailing apps, parking near {UNIVERSIDAD} campuses, car rentals, and student-priced vehicle insurance.
FOOD (nationwide, not only near campuses): cafeterias, restaurants, fast-food chains, coffee shops, or any food business in Costa Rica offering a discount with a student ID, regardless of province. Cover the whole country. Include recurring agreements at nationwide chains and student discounts on food delivery. If an offer is location-specific, identify it as local.
ENTERTAINMENT, CULTURE, AND STREAMING: movie theaters; ALL music, video, reading, and gaming streaming services with student plans in Costa Rica (do not limit yourself to specific names); museums, theaters, concerts, festivals, sporting events, bowling, arcades, and escape rooms with student rates.
HEALTH AND WELLNESS: gyms, medical or dental insurance, pharmacies, mental-health or psychology services, and opticians with student discounts.
BANKING AND FINANCE: accounts with no maintenance fee, student cards, and preferential-rate loans (BAC, BCR, BN, Scotiabank, Popular).
BOOKSTORES, COPYING, AND PRINTING: bookstores, photocopying, and 3D printing with student rates.
CERTIFICATIONS AND PROFESSIONAL EXAMS: TOEFL, IELTS, AWS/Microsoft/Google certifications, accounting or project-management certifications, and language courses with student pricing.
TRAVEL, TOURISM, AND INTERNATIONAL BENEFITS (lower priority, but still research them): international student ID (ISIC), student airfares, hostels/accommodation/travel insurance abroad, exchange programs or international agreements with {UNIVERSIDAD}, adventure tourism and national parks (SINAC), theme parks, water parks, and zoos.
OTHER AND LESS OBVIOUS BENEFITS (do not leave any out): institutional agreements between {UNIVERSIDAD} and businesses; clothing, electronics, or hair salons offering a university-ID discount; and any other benefit you find, even if it is small or unusual.

RESPONSE FORMAT (this is very important; follow it exactly):

Show ONLY benefits you found and confirmed. Do not insert lines saying "this does not exist" between positive results. Organize the confirmed offers by category with clear headings. For each benefit, state what it is, the exact discount, what is required to get it (usually a valid student ID), and whether it is nationwide, limited to a campus, or international. Use short bullets, not dense paragraphs. Do not omit a real benefit because it seems unimportant. At the very end, include one brief summary of categories where you found no reliable result and offers that should be confirmed directly. Prefer official sources over forums.`;

function armarPromptDescuentos(universidad) {
  const plantilla = document.documentElement.lang?.toLowerCase().startsWith("en")
    ? PLANTILLA_PROMPT_DESCUENTOS_EN
    : PLANTILLA_PROMPT_DESCUENTOS;
  return plantilla.split("{UNIVERSIDAD}").join(universidad);
}

/**
 * Universidades distintas entre los planes activos (Hardcore) o solo la del
 * plan activo.
 *
 * FIX (2026-08-27, reportado desde Finanzas → Beneficios): `plan.universidad`
 * dejó de ser un string desde la separación nombre_completo/siglas
 * (2026-08-22, ver schema.js) y pasó a ser `{ nombre_completo, siglas }` —
 * esta función seguía devolviendo el objeto entero en vez de extraer un
 * campo. Como el llamador mete el resultado directo en un template literal
 * (`` `...de ${universidades[0]}` ``) y en el prompt (armarPromptDescuentos),
 * el objeto se stringificaba como "[object Object]" — tanto el botón como
 * el prompt copiado quedaban rotos. Pedido explícito: usar el nombre
 * completo (no las siglas) acá.
 * De paso, el `new Set()` de abajo (dedupe en modo Hardcore) tampoco
 * funcionaba con objetos — dos planes de la misma universidad nunca
 * deduplicaban porque cada objeto es una referencia distinta aunque el
 * contenido sea igual; con strings sí dedupe correctamente.
 */
function obtenerUniversidadesElegibles() {
  const cfg = estado.datos.configuracion;
  if (!cfg.modo_hardcore) {
    const activo = obtenerPlanActivo();
    return activo && activo.universidad && activo.universidad.nombre_completo ? [activo.universidad.nombre_completo] : [];
  }
  const idsActivos = [cfg.plan_activo_id, cfg.plan_activo_secundario_id, cfg.plan_activo_terciario_id].filter(Boolean);
  const universidades = (estado.datos.planes_estudio || [])
    .filter((p) => idsActivos.includes(p.id))
    .map((p) => p.universidad && p.universidad.nombre_completo)
    .filter(Boolean);
  return [...new Set(universidades)];
}

/**
 * v2.8.9: en vez de copiar y abrir claude.ai al toque (sensación de "no sé
 * si pasó algo"), se muestra un aviso explícito de que el prompt ya está
 * copiado y de que se va a abrir Claude, y recién 3 segundos después —
 * tiempo de sobra para leer el aviso — se abre la pestaña nueva. mostrarToast
 * ya limpia cualquier toast anterior (incluido el que pueda mostrar
 * copiarPromptConAviso al copiar), así que no queda ningún mensaje viejo
 * pisado con este.
 */
async function generarYCopiarPromptDescuentos(universidad) {
  const prompt = armarPromptDescuentos(universidad);
  await copiarPromptConAviso(prompt);
  mostrarToast("✓ Se copió el prompt. Pégalo en el chat — enviando a Claude en 3 segundos…", 3000);
  setTimeout(() => window.open("https://claude.ai", "_blank"), 3000);
}

function renderizarPestanaBeneficios(contenedor) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  sec.innerHTML = `
    <h3 class="texto-encabezado-seccion" style="margin:0;">Buscar descuentos para estudiantes</h3>
    <p class="muted" style="margin:0;">
      Copia un prompt listo para pegar en una sesión nueva de Claude, que investiga
      descuentos, beneficios y tarifas estudiantiles reales para tu universidad.
    </p>
  `;

  const universidades = obtenerUniversidadesElegibles();

  if (universidades.length === 0) {
    const aviso = document.createElement("p");
    aviso.className = "muted";
    aviso.textContent = "Necesitas tener un Plan de Estudios activo con universidad definida.";
    sec.appendChild(aviso);
  } else if (universidades.length === 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary btn-block";
      btn.textContent = traducirTextoInterfaz(
        `Buscar descuentos para estudiantes de ${universidades[0]}`,
        `Search for student discounts at ${universidades[0]}`
      );
    btn.addEventListener("click", () => generarYCopiarPromptDescuentos(universidades[0]));
    sec.appendChild(btn);
  } else {
    const aviso = document.createElement("p");
    aviso.className = "muted";
    aviso.style.margin = "0";
    aviso.textContent = traducirTextoInterfaz("Modo Hardcore activo con más de una universidad — elige de cuál generar el prompt:");
    sec.appendChild(aviso);
    universidades.forEach((uni) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-secondary btn-block";
      btn.textContent = traducirTextoInterfaz(
        `Buscar descuentos para estudiantes de ${uni}`,
        `Search for student discounts at ${uni}`
      );
      btn.addEventListener("click", () => generarYCopiarPromptDescuentos(uni));
      sec.appendChild(btn);
    });
  }

  contenedor.appendChild(sec);
}

export { obtenerTodosLosSemestres, renderizarPestanaBeneficios };
