/* =========================================================================
   PLAN DE ESTUDIOS — IMPORTACIÓN (prompt + panel)
   Construcción del prompt oficial para la IA (v1.12: universal, detecta
   HORAS_COLUMNAS automáticamente en vez de preguntar la universidad), el
   panel de importación (modo Link-PDF-Capturas), y el modal de instrucciones
   antes de enviar.
   ========================================================================= */

import { abrirModalCopiaManualPortapapeles, copiarAlPortapapelesBlindado, copiarPromptConAviso } from "../core/clipboard.js";
import { PRESETS_TIPOS_HORAS } from "../core/schema.js";
import { marcarCambioPendiente, mostrarCargando, ocultarCargando } from "../core/storage/storage-sync.js";
import { estado } from "../core/storage/storage.js";
import { mostrarToast } from "../ui/componentes.js";
import { abrirModalCrearPlan } from "./plan-esquema.js";
import { abrirModalGestionPlanes } from "./plan-gestionar.js";
import { manejarClickImportar, mostrarErroresImportacion, parsearCSVPlanEstudios } from "./plan-importacion-csv.js";
import { renderizarPlanEstudios } from "./plan-vista-lista.js";
import { obtenerIdiomaActual, traducirTextoInterfaz } from "../core/i18n.js";
import { iniciarProcesoAnalitico } from "../core/analitica.js";

/* =========================================================================
   PLAN.JS — Iteración 1 (Parte 1-B + Parte 2 FINAL)
   Encargado de: importar el CSV generado por IA (formato-agnóstico, con
   grupos de requisitos "Y"/"O"), gestión de hasta 3 Planes de Estudio,
   añadir materias manualmente, la vista completa por bloques colapsables,
   candados, badges de categoría/estado, botón "Desbloquea" (búsqueda
   inversa), modal de requisito navegable, flujo completo de categorías
   (crear/filtrar/editar), buscador general y exportación a CSV.
   Depende de: js/schema.js (estructuras) y js/app.js (estado global,
   marcarCambioPendiente, mostrarSeccion, abrirConfirmacion, etc.).
   ========================================================================= */

/**
 * Arma la lista de columnas de horas para el encabezado del CSV, según los
 * tipos_horas del plan (dinámico — TEC trae 1 columna, UCR trae 4, una
 * universidad personalizada trae las que el usuario haya definido).
 * Ej.: ["Horas"] -> "Horas_Horas" ; ["Teoría","Práctica"] -> "Horas_Teoría,Horas_Práctica"
 */

/**
 * v1.12: ya NO antepone "Horas_" a cada columna — el prompt de importación
 * universal (ver construirPromptImportacion) le pide a la IA que use el
 * código de HORAS_COLUMNAS tal cual como nombre de columna (ej. "T","P","L"),
 * y el parser (plan-importacion-csv.js) las detecta por POSICIÓN, no por
 * nombre. Se mantiene esta función (en vez de inlinear tipos.join(",")) para
 * que exportarPlanACSV (plan-vista-lista.js, Parte G) siga usando un único
 * punto de verdad para el formato del encabezado de horas.
 */
function construirColumnasHoras(tiposHoras) {
  const tipos = tiposHoras || ["Horas"];
  if (tipos.length === 0) return ""; // v7 #1: "No aplica" -> sin columnas de horas en el CSV
  return tipos.join(",");
}

function construirEncabezadoCSV(tiposHoras) {
  const columnasHoras = construirColumnasHoras(tiposHoras);
  const partes = ["Bloque", "Codigo", "Nombre", "Creditos"];
  if (columnasHoras) partes.push(columnasHoras);
  partes.push("Requisitos", "Correquisitos", "SinDefinir");
  return partes.join(",");
}

// Traducciones del prompt extenso. Los nombres de metadatos, encabezados y
// valores de control se conservan en español porque forman parte del contrato
// que consume plan-importacion-csv.js.
const PROMPTS_IMPORTACION = {
  en: (modo, link) => `${modo === "link" ? `If web browsing is unavailable or you cannot open this link, tell me so I can use another method; do not assume it is impossible without trying.\n\nVisit this public university page and extract the complete curriculum: ${link}\nIf courses are shown in JavaScript tabs or blocks and you cannot confidently determine a course's Bloque, put "REVISAR" in that row instead of guessing.` : modo === "pdf" ? "I am attaching my degree curriculum as a PDF. It may contain real text tables or scanned image pages; process either kind." : modo === "imagenes" ? "I am attaching up to four image files showing my curriculum. Read all attached images together as one continuous curriculum, joining their information without losing courses or depending on image order." : "I am attaching a PDF made from screenshots of my curriculum (one screenshot per page). Read all pages together as one continuous curriculum, joining their information without losing courses or depending on page order."}

Act as a UNIVERSAL academic-data structurer. Handle curricula from any university (including UCR, UNA, TEC, UTP, UNAM, and others) and any layout: tables, diagrams, grids, or lists grouped by blocks, cycles, levels, years, or semesters.

=== REQUIRED OUTPUT ===
Put the entire result inside ONE plain CSV code block. Return no explanation before or after it, except the continuation notice allowed by rule 11. Anything outside the block will be lost.

At the very top of that same block, include these metadata lines, one per line, only when certain; omit any uncertain line and never invent a value:
CARRERA: ...
CODIGO_PLAN: ...
UNIVERSIDAD: ...
TIPO_TITULO: ... (Diplomado/Bachillerato/Licenciatura/Maestría/Doctorado, if identified)
HORAS_COLUMNAS: comma-separated full names of the hour types used by this specific document. Use the full words as written in the source, never abbreviations. If the source only gives T/P/L/TP/EI/HT/HD, use the most likely full names: Teoría, Práctica, Laboratorio, Teoría-Práctica, Estudio Independiente, Horas Teóricas, Horas de Docencia. If the curriculum has no hour concept, write HORAS_COLUMNAS: Ninguna. If it gives only a total, use one column named Horas. Detect this from the document; do not assume every university uses T/P/L/TP.

Immediately after metadata, in the same code block, write the header and all course rows in this exact schema:
Bloque,Codigo,Nombre,Creditos,[one column per HORAS_COLUMNAS value],Requisitos,Correquisitos,SinDefinir
If HORAS_COLUMNAS is Ninguna, omit hour columns. Always keep every other column, including SinDefinir.

RULES:
1. BLOQUE has exactly three kinds of value: a sequential integer, "OPTATIVA" (or "ELECTIVA"), or "REVISAR". (a) Use a sequential integer when a course or reserved elective slot is tied to a required year/cycle/semester/term. Number every chronological sub-block in actual order (1, 2, 3...), without restarting each year; convert named levels to that sequence. (b) Use "OPTATIVA" or "ELECTIVA" for a genuinely optional course from a general elective bank that can be taken at different points or not taken; a suggested cycle does not make its location mandatory. (c) Use "REVISAR" only when you cannot determine either its required location or whether it is optional. Never use it as a synonym for optional.
2. CODIGO must be exactly as printed, even for an undefined elective slot (for example "Elective", "Wahlfach", or "Cours au choix"). Never invent, normalize, or replace a source code. Only when the document truly supplies no code, use "SD-B" plus the sequential block (e.g. SD-B7). If multiple rows in that block lack codes, make them unique and sequential in source order: SD-B7-1, SD-B7-2, etc.
3. HORAS: use 0 when the document does not report a particular hour type for a course; never leave the cell blank. Extract hours from diagrams or colored grids as well as tables.
4a. REQUISITOS and CORREQUISITOS: never put a comma inside a cell (it breaks CSV). Use ";" for requirements that are all necessary (AND), and "/" for equivalent alternatives (OR). Use parentheses to combine, e.g. (A;B)/(C;D) means (A AND B) OR (C AND D). Convert "QU-0102, QU-0103 o (QU-0114, QU-0115)" to "(QU-0102;QU-0103)/(QU-0114;QU-0115)". Use "Ninguno" when none exist, never blank; if the source has no corequisite concept, put "Ninguno" for every course. A condition requiring completion of an entire level/block becomes exactly "Bloque N" (optionally followed by "completo" or "aprobado"), using the sequential number from rule 1; the app expands it to all courses in that block. Other non-course conditions, such as a credit threshold or regular-student status, remain plain text; do not invent a course code.
4b. SINDEFINIR is always the last column and always filled: write exactly "true" for a reserved elective slot with no selected real course yet, and "false" for every confirmed course, including defined courses in separate elective lists.
5. If a course name (or another cell) contains a comma, wrap the whole cell in double quotes. When unsure, quote it.
6. Do not add category, area, color, or any unlisted column.
7. Include every course: electives, languages, seminars, practicums, capstones, and remedial/precalculus courses, even with zero credits.
8. Include separate elective catalogs too. Use "OPTATIVA" or "ELECTIVA" as Bloque, not the suggested cycle and not "REVISAR" merely because no cycle is stated. These are defined courses, so SinDefinir=false.
9. For any illegible, ambiguous, or unconfirmed cell, write "REVISAR" instead of inventing codes, credits, or hours.
10. Ignore summary totals (for example, total degree credits); they are metadata, not course rows.
11. If the curriculum does not fit in one response, split it into consecutive parts. Only part 1 may contain metadata and the header; later parts contain only rows, in order, with no repeated metadata/header. The app concatenates the parts, so a repeated header breaks import. Tell me between parts that more is coming.`,
  it: (modo, link) => `${modo === "link" ? `Se non hai la navigazione web o non riesci ad aprire questo link, dimmelo così userò un altro metodo; non presumere che sia impossibile senza prima provare.\n\nVisita questa pagina universitaria pubblica ed estrai il piano di studi completo: ${link}\nSe i corsi sono organizzati in schede o blocchi JavaScript e non puoi stabilire con certezza il Bloque di un corso, scrivi "REVISAR" nella sua riga invece di indovinare.` : modo === "pdf" ? "Allego il piano di studi del mio corso in PDF. Può contenere tabelle di testo o pagine scansionate come immagini: elabora entrambi i formati." : modo === "imagenes" ? "Allego fino a quattro immagini del piano di studi. Leggi tutte le immagini allegate come un unico piano continuo, unendo le informazioni senza perdere corsi e senza dipendere dall'ordine delle immagini." : "Allego un PDF creato da più schermate del piano di studi (una schermata per pagina). Leggi tutte le pagine come un unico piano continuo, unendo le informazioni senza perdere corsi e senza dipendere dall'ordine delle pagine."}

Agisci come strutturatore UNIVERSALE di dati accademici. Elabora piani di qualsiasi università (incluse UCR, UNA, TEC, UTP, UNAM e altre) e in qualsiasi formato: tabelle, diagrammi, griglie o elenchi per blocchi, cicli, livelli, anni o semestri.

=== FORMATO RICHIESTO ===
Inserisci tutto il risultato in UN SOLO blocco di codice CSV semplice. Non aggiungere spiegazioni prima o dopo, tranne l'avviso di continuazione ammesso dalla regola 11. Qualsiasi testo fuori dal blocco andrà perso.

All'inizio dello stesso blocco inserisci questi metadati, uno per riga, solo se sei certo; ometti ogni riga incerta e non inventare valori:
CARRERA: ...
CODIGO_PLAN: ...
UNIVERSIDAD: ...
TIPO_TITULO: ... (Diplomado/Bachillerato/Licenciatura/Maestría/Doctorado, se identificato)
HORAS_COLUMNAS: nomi completi, separati da virgole, dei tipi di ore usati nel documento. Usa le parole complete della fonte, mai sigle. Se la fonte riporta solo T/P/L/TP/EI/HT/HD, usa i nomi più probabili: Teoría, Práctica, Laboratorio, Teoría-Práctica, Estudio Independiente, Horas Teóricas, Horas de Docencia. Se il piano non prevede ore, scrivi HORAS_COLUMNAS: Ninguna. Se riporta solo un totale, usa una colonna Horas. Rilevalo dal documento: non presumere che ogni università usi T/P/L/TP.

Subito dopo i metadati, nello stesso blocco di codice, inserisci intestazione e righe con questo schema ESATTO:
Bloque,Codigo,Nombre,Creditos,[una colonna per ogni valore di HORAS_COLUMNAS],Requisitos,Correquisitos,SinDefinir
Se HORAS_COLUMNAS è Ninguna, ometti le colonne delle ore. Mantieni sempre tutte le altre colonne, inclusa SinDefinir.

REGOLE:
1. BLOQUE ammette solo tre tipi di valore: intero progressivo, "OPTATIVA" (o "ELECTIVA"), oppure "REVISAR". (a) Usa l'intero quando il corso o uno spazio riservato a un'elettiva è vincolato a un anno/ciclo/semestre obbligatorio. Numera tutti i sottoblocchi cronologici nell'ordine reale (1, 2, 3...) senza ripartire ogni anno; converti i livelli denominati in tale sequenza. (b) Usa "OPTATIVA" o "ELECTIVA" per un corso davvero facoltativo, da un elenco generale che si può seguire in momenti diversi o non seguire; un ciclo consigliato non rende obbligatoria la collocazione. (c) Usa "REVISAR" solo se non puoi determinare con certezza né la collocazione obbligatoria né la natura facoltativa. Non usarlo come sinonimo di facoltativo.
2. CODIGO deve essere identico a quello stampato, anche per uno spazio elettivo non ancora definito (es. "Elective", "Wahlfach", "Cours au choix"). Non inventare, normalizzare o sostituire un codice fonte. Solo se il documento non fornisce alcun codice usa "SD-B" più il numero progressivo del blocco (es. SD-B7). Se più righe dello stesso blocco non hanno codice, rendile univoche in ordine di fonte: SD-B7-1, SD-B7-2, ecc.
3. HORAS: usa 0 quando il documento non riporta uno specifico tipo di ora per quel corso; non lasciare celle vuote. Estrai le ore anche da diagrammi o griglie colorate, non solo da tabelle.
4a. REQUISITOS e CORREQUISITOS: non inserire mai virgole nella cella (rompono il CSV). Usa ";" per requisiti necessari tutti insieme (AND) e "/" per alternative equivalenti (OR). Usa parentesi per combinare, ad es. (A;B)/(C;D) significa (A E B) OPPURE (C E D). Converti "QU-0102, QU-0103 o (QU-0114, QU-0115)" in "(QU-0102;QU-0103)/(QU-0114;QU-0115)". Se non ce ne sono, scrivi "Ninguno", mai lasciare vuoto; se la fonte non prevede correquisiti, scrivi "Ninguno" per ogni corso. Una condizione che richiede di completare un intero blocco/livello diventa esattamente "Bloque N" (facoltativamente seguito da "completo" o "aprobado"), usando la numerazione della regola 1; l'app la espande in tutti i corsi del blocco. Altre condizioni non riferite a corsi, come una soglia di crediti o lo status di studente regolare, restano testo libero; non inventare codici.
4b. SINDEFINIR è sempre l'ultima colonna e non può essere vuota: scrivi esattamente "true" per uno spazio elettivo riservato senza corso reale scelto e "false" per ogni corso confermato, inclusi quelli definiti in elenchi separati.
5. Se il nome di un corso (o un'altra cella) contiene una virgola, racchiudi l'intera cella tra virgolette doppie. In caso di dubbio, usa le virgolette.
6. Non aggiungere colonne di categoria, area, colore o altre non elencate.
7. Includi tutti i corsi: elettivi, lingue, seminari, tirocini, lavori finali e corsi propedeutici/precalcolo, anche con zero crediti.
8. Includi anche elenchi separati di elettivi. Usa "OPTATIVA" o "ELECTIVA" come Bloque, non il ciclo consigliato e non "REVISAR" solo perché il ciclo non è indicato. Sono corsi definiti, quindi SinDefinir=false.
9. Per ogni cella illeggibile, ambigua o non verificabile scrivi "REVISAR" invece di inventare codici, crediti o ore.
10. Ignora i totali riepilogativi (per esempio i crediti totali del corso di laurea): sono metadati, non righe di corsi.
11. Se il piano non entra in una risposta, dividilo in parti consecutive. Solo la prima può contenere metadati e intestazione; le successive devono contenere solo righe, in ordine, senza ripetere intestazione o metadati. L'app concatena le parti, quindi un'intestazione ripetuta rompe l'importazione. Tra una parte e l'altra avvisa che ne seguiranno altre.`,
  fr: (modo, link) => `${modo === "link" ? `Si la navigation web n'est pas disponible ou si vous ne pouvez pas ouvrir ce lien, dites-le-moi afin que j'utilise une autre méthode ; ne concluez pas que c'est impossible sans avoir essayé.\n\nVisitez cette page universitaire publique et extrayez le programme complet : ${link}\nSi les cours sont répartis dans des onglets ou blocs JavaScript et que vous ne pouvez pas déterminer avec certitude le Bloque d'un cours, écrivez "REVISAR" sur sa ligne au lieu de deviner.` : modo === "pdf" ? "Je joins le programme de mes études au format PDF. Il peut contenir des tableaux textuels ou des pages numérisées comme images : traitez les deux." : modo === "imagenes" ? "Je joins jusqu'à quatre images de mon programme d'études. Lisez toutes les images jointes comme un seul programme continu, en réunissant les informations sans perdre de cours et sans dépendre de leur ordre." : "Je joins un PDF composé de plusieurs captures d'écran de mon programme (une capture par page). Lisez toutes les pages comme un seul programme continu, en réunissant les informations sans perdre de cours et sans dépendre de l'ordre des pages."}

Agissez comme un système UNIVERSEL de structuration des données académiques. Traitez les programmes de toute université (dont UCR, UNA, TEC, UTP, UNAM et autres), quels que soient leur format : tableaux, diagrammes, grilles ou listes par blocs, cycles, niveaux, années ou semestres.

=== FORMAT DE SORTIE REQUIS ===
Placez tout le résultat dans UN SEUL bloc de code CSV brut. N'ajoutez aucune explication avant ou après, sauf l'avis de continuation permis par la règle 11. Tout texte hors du bloc sera perdu.

Au début de ce même bloc, indiquez ces métadonnées, une par ligne, uniquement si vous en êtes certain ; omettez chaque ligne incertaine et n'inventez jamais de valeur :
CARRERA: ...
CODIGO_PLAN: ...
UNIVERSIDAD: ...
TIPO_TITULO: ... (Diplomado/Bachillerato/Licenciatura/Maestría/Doctorado, si identifiable)
HORAS_COLUMNAS: noms complets, séparés par des virgules, des types d'heures employés dans ce document. Utilisez les mots complets de la source, jamais les sigles. Si la source ne donne que T/P/L/TP/EI/HT/HD, utilisez les noms complets les plus probables : Teoría, Práctica, Laboratorio, Teoría-Práctica, Estudio Independiente, Horas Teóricas, Horas de Docencia. Si le programme ne prévoit aucune heure, écrivez HORAS_COLUMNAS: Ninguna. S'il ne donne qu'un total, utilisez une seule colonne Horas. Déduisez-le du document ; ne supposez pas que toutes les universités utilisent T/P/L/TP.

Immédiatement après les métadonnées, dans le même bloc, écrivez l'en-tête et les lignes selon ce schéma EXACT :
Bloque,Codigo,Nombre,Creditos,[une colonne pour chaque valeur de HORAS_COLUMNAS],Requisitos,Correquisitos,SinDefinir
Si HORAS_COLUMNAS vaut Ninguna, omettez les colonnes d'heures. Gardez toujours toutes les autres colonnes, y compris SinDefinir.

RÈGLES :
1. BLOQUE n'admet que trois types de valeur : entier séquentiel, "OPTATIVA" (ou "ELECTIVA"), ou "REVISAR". (a) Utilisez l'entier lorsqu'un cours ou un emplacement réservé à une option est rattaché à une année/cycle/semestre obligatoire. Numérotez tous les sous-blocs chronologiques dans l'ordre réel (1, 2, 3...) sans recommencer chaque année ; convertissez les niveaux nommés en cette séquence. (b) Utilisez "OPTATIVA" ou "ELECTIVA" pour un cours réellement facultatif d'une liste générale, pouvant être suivi à différents moments ou ignoré ; un cycle conseillé ne rend pas son emplacement obligatoire. (c) Utilisez "REVISAR" uniquement si vous ne pouvez déterminer avec certitude ni l'emplacement obligatoire ni le caractère facultatif. Ne l'utilisez jamais comme synonyme de facultatif.
2. CODIGO doit reproduire exactement le code imprimé, même pour un emplacement facultatif non défini (p. ex. "Elective", "Wahlfach", "Cours au choix"). N'inventez, ne normalisez et ne remplacez jamais un code source. Seulement si le document ne donne vraiment aucun code, utilisez "SD-B" suivi du numéro séquentiel du bloc (p. ex. SD-B7). Si plusieurs lignes du bloc n'ont pas de code, rendez-les uniques dans l'ordre source : SD-B7-1, SD-B7-2, etc.
3. HORAS : utilisez 0 si le document ne précise pas un type d'heure pour un cours ; ne laissez aucune cellule vide. Extrayez aussi les heures des diagrammes et grilles colorées, pas seulement des tableaux.
4a. REQUISITOS et CORREQUISITOS : ne mettez jamais de virgule dans une cellule (cela casse le CSV). Utilisez ";" pour les prérequis tous nécessaires (ET) et "/" pour les alternatives équivalentes (OU). Groupez avec des parenthèses : (A;B)/(C;D) signifie (A ET B) OU (C ET D). Convertissez "QU-0102, QU-0103 o (QU-0114, QU-0115)" en "(QU-0102;QU-0103)/(QU-0114;QU-0115)". S'il n'y en a pas, écrivez "Ninguno", jamais une cellule vide ; si la source ne prévoit pas de corequis, écrivez "Ninguno" pour chaque cours. Une condition exigeant d'avoir terminé un bloc/niveau entier devient exactement "Bloque N" (éventuellement suivi de "completo" ou "aprobado"), avec la numérotation de la règle 1 ; l'application la développe en tous les cours du bloc. Les autres conditions sans lien avec un cours (seuil de crédits, statut d'étudiant régulier) restent en texte libre ; n'inventez pas de code.
4b. SINDEFINIR est toujours la dernière colonne et ne doit jamais être vide : écrivez exactement "true" pour un emplacement réservé sans cours réel choisi et "false" pour chaque cours confirmé, y compris les cours définis dans une liste distincte.
5. Si le nom d'un cours (ou une autre cellule) contient une virgule, encadrez toute la cellule de guillemets doubles. En cas de doute, mettez-les.
6. N'ajoutez aucune colonne de catégorie, domaine, couleur ou autre colonne non indiquée.
7. Incluez tous les cours : options, langues, séminaires, stages, projets de fin d'études et cours préparatoires/précalcul, même avec zéro crédit.
8. Incluez aussi les listes séparées d'options. Utilisez "OPTATIVA" ou "ELECTIVA" comme Bloque, jamais le cycle conseillé ni "REVISAR" au seul motif qu'aucun cycle n'est indiqué. Ce sont des cours définis, donc SinDefinir=false.
9. Pour toute cellule illisible, ambiguë ou non confirmée, écrivez "REVISAR" au lieu d'inventer codes, crédits ou heures.
10. Ignorez les totaux récapitulatifs (p. ex. crédits totaux du diplôme) : ce sont des métadonnées, pas des lignes de cours.
11. Si le programme ne tient pas dans une réponse, divisez-le en parties consécutives. Seule la première contient les métadonnées et l'en-tête ; les suivantes contiennent uniquement les lignes, dans l'ordre, sans répéter en-tête ni métadonnées. L'application concatène les parties : un en-tête répété casse l'importation. Entre les parties, indiquez qu'une suite arrive.`
};

/**
 * Prompt oficial y único del proyecto para pedirle a Claude que estructure
 * el plan de estudios en CSV. `modo` cambia solo el
 * párrafo de instrucción de entrada; las reglas de formato CSV son las
 * mismas siempre. Cualquier flujo del proyecto que necesite este texto
 * (import inicial, re-importar/actualizar malla desde gestión de planes)
 * debe reutilizar esta función — nunca generar un texto distinto a mano.
 *
 * v1.12: ya NO recibe `columnasHoras` — el documento a importar puede ser de
 * cualquier universidad y ya no se le pregunta al usuario por adelantado qué
 * tipos de hora usa (eso obligaba a preseleccionar TEC/UCR/Otra antes de
 * poder generar el prompt). En su lugar, el propio prompt le pide a la IA
 * que DETECTE los tipos de hora leyendo el documento (línea HORAS_COLUMNAS:
 * en los metadatos) y arme el CSV con las columnas correspondientes. El
 * parser (plan-importacion-csv.js) deriva `tipos_horas` de esa línea.
 */

function construirPromptImportacion(modo, link) {
  const idioma = obtenerIdiomaActual();
  const modoPrompt = modo === "capturas" && archivosFuenteImportacion.length > 0 && archivosFuenteImportacion.length <= 4
    && archivosFuenteImportacion.every((archivo) => archivo.type.startsWith("image/")) ? "imagenes" : modo;
  if (PROMPTS_IMPORTACION[idioma]) return PROMPTS_IMPORTACION[idioma](modoPrompt, link);
  let instruccionEntrada = "";
  let avisoNavegacion = "";

  if (modo === "link") {
    // v5 1.3: el aviso de navegación web se refuerza DENTRO del propio texto
    // del prompt (no solo en la UI), como primera línea — en pruebas reales
    // la IA a veces respondía "es imposible" sin aclarar que el problema era
    // que su navegación no estaba activada.
    avisoNavegacion = `Si no tienes activada la navegación/búsqueda web y no puedes visitar este link, dímelo y usaré otro método en su lugar — no asumas que es imposible sin intentarlo primero.\n\n`;
    instruccionEntrada = `Visita esta página pública y extrae el plan de estudios completo desde su contenido: ${link}
Es una página institucional sin inicio de sesión. Si la página organiza las materias en pestañas o bloques mediante controles de navegador (JavaScript) que no se reflejen con claridad en el contenido que puedas leer, y no puedes determinar con certeza a qué Bloque pertenece cada materia, escribe "REVISAR" en la columna Bloque de esa fila en vez de adivinar.`;
  } else if (modo === "pdf") {
    instruccionEntrada = `Te voy a adjuntar el plan de estudios de mi carrera en un archivo PDF (puede tener tablas de texto real, o ser páginas escaneadas como imágenes — trátalo igual en ambos casos).`;
  } else if (modoPrompt === "imagenes") {
    instruccionEntrada = `Te voy a adjuntar hasta cuatro imágenes de mi plan de estudios. Lee todas las imágenes adjuntas como una sola malla curricular continua, uniendo la información sin perder materias ni depender del orden de las imágenes.`;
  } else if (modoPrompt === "capturas") {
    instruccionEntrada = `Te voy a adjuntar un PDF armado a partir de varias capturas de pantalla de mi plan de estudios (una captura por página). Trátalo igual que si fuera un PDF real de mi plan de estudios: lee todas las páginas como una sola malla curricular continua, uniendo la información entre todas, sin perder ninguna materia, sin importar el orden de las páginas.`;
  }

  return `${avisoNavegacion}Actúa como un estructurador de datos académicos UNIVERSAL, capaz de procesar mallas curriculares
de cualquier universidad (ejemplos de referencia: UCR, UNA, TEC, Universidad Tecnológica del Perú,
UNAM, y cualquier otra con formato distinto), sin importar si vienen en tabla, en cuadrícula gráfica
tipo diagrama de flujo, o en listado por bloques/ciclos/niveles/años/semestres.

${instruccionEntrada}

=== QUÉ DEVOLVER ===
Todo tu resultado va DENTRO DE UN ÚNICO bloque de código plano (formato CSV) — nada de esto es
opcional ni es un paso aparte: si algo queda fuera de ese bloque de código, se pierde por completo,
porque de tu respuesta solo se copia el bloque de código, nunca el texto que pongas antes o después.
No devuelvas texto explicativo antes o después del bloque (salvo el aviso de "hay más partes" de la
regla 11, si aplica).

Las PRIMERAS líneas de ese mismo bloque de código (nunca antes, nunca en un bloque separado) son los
metadatos, una línea por dato, SOLO si tienes certeza de cada uno (si no estás seguro de alguno,
simplemente omite esa línea puntual — nunca inventes un valor para rellenarla):
CARRERA: ...
CODIGO_PLAN: ...
UNIVERSIDAD: ...
TIPO_TITULO: ... (Diplomado/Bachillerato/Licenciatura/Maestría/Doctorado, si se identifica)
HORAS_COLUMNAS: lista separada por comas de los tipos de hora que usa ESTE documento específico,
  usando la PALABRA COMPLETA de cada tipo (nunca su sigla/abreviatura) tal como la nombra el
  documento — ej: Teoría,Práctica,Laboratorio,Teoría-Práctica  o  Horas  o  Teórico,Práctico
  (si el documento SOLO trae siglas como "T"/"P"/"L" sin decir en ningún lado qué significan,
  escribe la palabra completa más probable para esa sigla en el contexto académico: T→Teoría,
  P→Práctica, L→Laboratorio, TP→Teoría-Práctica, EI→Estudio Independiente, HT→Horas Teóricas,
  HD→Horas de Docencia — nunca dejes la sigla sola). Esto es importante: la app usa esta palabra
  completa tal cual para mostrarla en pantalla cuando hay espacio (ej. "Práctica: 4"), y deriva ella
  sola las iniciales para cuando no hay espacio (ej. "P4") — si acá se manda la sigla, después no hay
  forma de recuperar la palabra completa para mostrarla.
  Si el documento no maneja el concepto de horas en absoluto, escribe: HORAS_COLUMNAS: Ninguna
  (detéctalas leyendo el propio documento — NO asumas que todas las universidades usan T/P/L/TP;
  si no distingue tipos de hora y solo da un total, usa una sola columna "Horas")

Inmediatamente después, EN EL MISMO BLOQUE DE CÓDIGO (sin línea en blanco de más ni separador), el
encabezado y las filas de la malla, con esta estructura EXACTA:

Bloque,Codigo,Nombre,Creditos,[una columna por cada valor listado en HORAS_COLUMNAS],Requisitos,Correquisitos,SinDefinir

(Si HORAS_COLUMNAS es "Ninguna", omite esas columnas del encabezado y de cada fila. El resto de
columnas, incluida SinDefinir al final, van SIEMPRE, sin excepción.)

REGLAS:

1. BLOQUE: tiene TRES valores posibles — un ENTERO SECUENCIAL, la palabra "OPTATIVA" (o "ELECTIVA"),
   o la palabra "REVISAR". Decide entre los tres usando tu propio criterio, así:

   a) ENTERO SECUENCIAL — cuando la materia (o el espacio reservado de electiva/optativa dentro de un
      bloque, ver regla 2) está atada a un nivel/ciclo/año/semestre/cuatrimestre concreto y obligatorio
      del plan: aunque el CONTENIDO sea optativo (el estudiante elige cuál cursar), la UBICACIÓN no lo
      es (hay que cursar algo ahí, en ese punto específico de la carrera). Conviértelo a un entero único
      y creciente según el orden real en que se cursan (ej: si el documento organiza por "Año" y dentro
      por "Ciclo I/II", o por "Verano", cada uno de esos sub-bloques cronológicos es un número distinto:
      1, 2, 3, 4... no reinicies el conteo al cambiar de año). Si el documento usa nombres en vez de
      números, conviértelo al secuencial correspondiente.

   b) "OPTATIVA" (o "ELECTIVA") — cuando la materia es genuinamente opcional y NO está atada a un punto
      fijo obligatorio de la carrera: un curso de un banco/listado general de electivas que el
      estudiante puede tomar (o no) en varios momentos posibles, sin que el documento la exija en un
      ciclo específico. Esto es un juicio de contenido, no de dónde aparece impresa en el documento —
      si el propio documento sugiere un ciclo "recomendado" para cursarla pero deja claro que es
      flexible/opcional (a diferencia de una asignación fija de la malla), sigue siendo "OPTATIVA", no
      un número. Ver regla 8 para más detalle de este caso.

   c) "REVISAR" — ÚNICAMENTE cuando genuinamente no puedes determinar ninguna de las dos anteriores con
      certeza (ni a qué ciclo pertenece, ni si es opcional o no) — nunca lo uses como cajón de sastre
      para "esto es opcional" (para eso está (b)); resérvalo solo para ambigüedad real de ubicación/
      naturaleza de la fila. Confundir (b) y (c) hace que el estudiante no pueda distinguir "esto es una
      opción real para elegir" de "esto necesito revisarlo a mano porque no se entendió bien" — son
      cosas completamente distintas para la app que procesa este CSV, así que la distinción importa.

2. CODIGO: SIEMPRE el código EXACTO tal como aparece en el documento — SIN EXCEPCIÓN, incluso si la
   materia es un espacio reservado para una electiva/optativa sin contenido definido todavía (sin
   importar cómo la llame el documento en su propio idioma: "Optativa", "Electivo 1", "Elective",
   "Wahlfach", "Cours au choix", "Idioma Intensivo", etc.). NUNCA reemplaces, inventes, ni normalices
   un código real que el documento sí trae — aunque sea el código de un espacio todavía sin materia
   elegida — eso sería fabricar datos que no existen en la fuente. Marca estos espacios reservados
   con la columna SinDefinir (regla 4b más abajo); el CÓDIGO real queda intacto siempre.
   Solo si el documento genuinamente NO da ningún código para esa fila (ni siquiera uno administrativo/
   interno), y necesitas escribir algo porque la columna no puede quedar vacía, usa "SD-B" + el número
   de Bloque (ej: SD-B7) — ÚNICAMENTE en este caso de "no hay ningún código que preservar", nunca
   cuando el documento sí trae uno, así sea genérico. IMPORTANTE: si en ESE MISMO Bloque hay más de
   una fila sin código (ej. varias materias de un mismo cuatrimestre que el documento solo nombra, sin
   código alguno), agrégale a cada una un consecutivo distinto empezando en 1, en el mismo orden en que
   aparecen: "SD-B7-1", "SD-B7-2", "SD-B7-3"... — nunca repitas "SD-B7" solo para dos filas de ese
   bloque, porque la app identifica cada materia por su código y dos filas con el mismo código se
   pisarían entre sí, perdiendo todas menos la última.

3. HORAS: usa 0 si el documento no reporta ese tipo de hora para esa materia puntual — nunca dejes
   la celda vacía. Si el documento presenta las horas dentro de una cuadrícula gráfica (cajas de
   colores, diagramas tipo escalera, etc.) en vez de una tabla, extrae el mismo dato de cada caja
   como si fuera una fila de tabla.

4a. REQUISITOS y CORREQUISITOS — sintaxis para relaciones lógicas, SIN usar nunca coma "," dentro
   de la celda (la coma rompe el CSV):
   - ";" separa requisitos que se necesitan TODOS (Y / AND).
   - "/" separa alternativas equivalentes dentro de un mismo requisito, incluyendo tanto
     disyunciones explícitas ("Materia A o Materia B") como equivalencias declaradas
     ("Equiv.: MateriaB", "PS-0002 o PS-0128").
   - Si hay que combinar Y/O en la misma celda, usa paréntesis para agrupar y evitar ambigüedad:
     "(A;B)/(C;D)" significa (A Y B) O (C Y D).
     Ejemplo real: "QU-0102, QU-0103 o (QU-0114, QU-0115)" → "(QU-0102;QU-0103)/(QU-0114;QU-0115)"
   - Si no hay requisitos o correquisitos, escribe "Ninguno" (nunca dejes la celda vacía ni cortes
     la fila antes de completar todas las columnas del encabezado).
   - Si el documento no maneja el concepto de "correquisitos" en absoluto, escribe igual "Ninguno"
     en esa columna para todas las filas (mantén la columna por consistencia del esquema).
   - Si un requisito/correquisito es "haber aprobado/cursado TODO un bloque/nivel/ciclo/año/semestre
     completo" (nunca una condición de créditos u otra cosa, solo esta), escríbelo EXACTAMENTE como
     "Bloque N" seguido opcionalmente de una palabra más (ej. "Bloque 9", "Bloque 9 completo",
     "Bloque 9 aprobado") — usando el mismo número secuencial de Bloque de la regla 1, no el nombre
     original del documento (ej. no "Año 3" ni "Nivel III", el número ya convertido). La app
     reemplaza esto automáticamente por TODAS las materias reales de ese bloque como requisitos — no
     hace falta (ni se debe) que vos enumeres los códigos a mano.
   - Para cualquier OTRA condición que no sea un código de materia ni "Bloque N" (ej. "tener 90
     créditos aprobados", "ser estudiante regular"), escríbela tal cual como texto plano dentro de la
     celda — no inventes un código de materia falso para representarla, y no la fuerces dentro de la
     sintaxis de códigos de arriba; un texto libre como único contenido de la celda es válido.

4b. SINDEFINIR (última columna, SIEMPRE presente): escribe exactamente "true" si esta fila es un
   espacio reservado de electiva/optativa sin materia real elegida todavía (sin importar si tiene
   código real o no — ver regla 2), o "false" para cualquier materia ya confirmada por el documento
   (incluidas las electivas ya definidas de listados aparte, regla 8). Nunca dejes esta celda vacía.

5. NOMBRE (y cualquier otra columna): si el nombre real de la materia trae una coma
   (ej. "Ética, Persona y Sociedad"), envuelve ESA CELDA completa entre comillas dobles.
   Ante la duda, usa comillas de más y no de menos.

6. No agregues columnas de categoría, área, color, ni ninguna otra fuera de las indicadas.
7. No omitas ninguna materia, incluidas optativas, electivas, idiomas, seminarios, prácticas,
   trabajos finales de graduación y cursos de nivelación/precálculo (aunque tengan 0 créditos).
8. Si el documento incluye tablas separadas de "cursos optativos" o "electivas disponibles" fuera
   de la malla principal, inclúyelas también, usando "OPTATIVA" (o "ELECTIVA") como Bloque — ver
   regla 1b: son cursos opcionales de un banco/listado general, no están atadas a un ciclo
   obligatorio de la malla, así que NUNCA les pongas el número de ciclo "recomendado" ni "REVISAR"
   solo porque el documento no menciona uno (eso sería confundir 1b con 1a o con 1c). Estas ya son
   materias reales y definidas (tienen código y nombre propios) — van con SinDefinir=false.
9. Si una celda es ilegible, ambigua, o no puedes confirmarla con certeza, escribe "REVISAR" en
   vez de inventar un dato — nunca inventes códigos, créditos u horas que no estén en el documento.
10. Ignora tablas resumen de totales generales (ej. "Créditos totales de la carrera: 448") — esas
    no son filas de materias, son metadatos de resumen y no van en el CSV.
11. Si el plan es tan grande que no te cabe en una sola respuesta, divídelo en varias respuestas
    consecutivas, pero SOLO la PRIMERA lleva las líneas de metadatos (CARRERA/CODIGO_PLAN/etc.) y el
    encabezado (Bloque,Codigo,Nombre,...); las respuestas siguientes deben traer ÚNICAMENTE filas de
    datos, en el mismo orden del plan, SIN repetir el encabezado ni los metadatos — esta app arma el
    CSV final pegando las partes una tras otra en el mismo cuadro de texto, en orden, así que un
    encabezado repetido en medio se leería como si fuera una materia más (rompe la importación).
    Avisa igual entre una parte y otra que hay más por venir, para que el usuario sepa que faltan.`;
}

/** Lee las líneas opcionales CARRERA:/CODIGO_PLAN:/UNIVERSIDAD:/TIPO_TITULO:/
 *  HORAS_COLUMNAS: al inicio de la respuesta de la IA (v5 1.3, ampliado en
 *  v1.12 con los últimos dos), sin romperse si no existen. Devuelve
 *  { metadatos: {...}, csv: "texto sin esas líneas" }.
 *  `metadatos.horas_columnas` viaja como el string crudo tal cual lo mandó la
 *  IA (ej. "T,P,L,EI" o "Ninguna") — quien la consuma (plan-importacion-csv.js
 *  / plan-esquema.js) es quien la convierte a arreglo `tipos_horas`. */

function extraerMetadatosImportacion(textoCrudo) {
  const lineas = textoCrudo.replace(/```[a-zA-Z]*\n?/g, "").split(/\r?\n/);
  const metadatos = {};
  let i = 0;
  const patrones = {
    carrera: /^CARRERA:\s*(.+)$/i,
    codigo_plan: /^CODIGO_PLAN:\s*(.+)$/i,
    universidad: /^UNIVERSIDAD:\s*(.+)$/i,
    // Siglas — separación nombre_completo/siglas (2026-08-22): línea nueva
    // de metadato, solo la trae un CSV que esta misma app ya exportó con
    // fidelidad completa (ver exportarPlanACSV en plan-vista-lista.js). Un
    // CSV externo/nuevo no la trae y el campo de siglas queda vacío para
    // completar a mano en el modal "Nuevo Plan".
    siglas_universidad: /^SIGLAS_UNIVERSIDAD:\s*(.+)$/i,
    tipo_titulo: /^TIPO_TITULO:\s*(.+)$/i,
    horas_columnas: /^HORAS_COLUMNAS:\s*(.+)$/i,
  };
  while (i < lineas.length) {
    const linea = lineas[i].trim();
    if (!linea) { i++; continue; }
    let coincidio = false;
    for (const [clave, patron] of Object.entries(patrones)) {
      const m = linea.match(patron);
      if (m) { metadatos[clave] = m[1].trim(); coincidio = true; break; }
    }
    if (!coincidio) break;
    i++;
  }
  return { metadatos, csv: lineas.slice(i).join("\n") };
}
/**
 * FIX (mismo bug de arranque "Cannot access 'estado' before initialization"
 * ya visto en plan-categorias.js/plan-modo-edicion.js/etc.): estos 8 campos
 * estaban `estado.X = ...;` a nivel de módulo. Se mueven a una función
 * lazy, exportada porque plan-importacion-csv.js también lee varios de
 * estos mismos campos (modoImportacion, linkImportacion) y necesita poder
 * garantizar que ya existan antes de leerlos, sin depender del orden en
 * que cada archivo termine de cargar.
 *
 * Ojo particular con linkImportacion: a diferencia de los campos que solo
 * se comparan (=== o truthy, donde `undefined` se comporta igual que
 * `null`/`false`), este campo se lee con `.trim()` (ver
 * plan-importacion-csv.js) — ahí sí hace falta que exista como string
 * real ("") y no como `undefined`, o revienta con "Cannot read
 * properties of undefined (reading 'trim')". Por eso esta guardia no es
 * solo cosmética para ese campo en particular.
 */
function inicializarEstadoImportacionPlanSiHaceFalta() {
  if (typeof estado.planImportandoId === "undefined") estado.planImportandoId = null; // "principal" | "secundario", elegido antes de importar (primer plan)
  if (typeof estado.csvPendienteDeImportar === "undefined") estado.csvPendienteDeImportar = null; // texto CSV en espera mientras se crea el plan
  if (!estado.csvImportacionTexto || typeof estado.csvImportacionTexto !== "object") estado.csvImportacionTexto = { nuevo:"", actualizar:"" };
  if (typeof estado.panelImportacionAbierto === "undefined") estado.panelImportacionAbierto = false; // v5 1.2/1.3: import/actualizar malla, siempre inline
  // ---- B.2: flujo de importación de 3 modos (Link / PDF / Capturas) ----
  // Estas llaves viven en `estado` (no en los datos del usuario) porque son
  // solo del momento de importar, antes de que exista el plan.
  if (typeof estado.modoImportacion === "undefined") estado.modoImportacion = null; // null (sin selección) | "link" | "pdf" | "capturas"
  if (typeof estado.importacionEtapa === "undefined") estado.importacionEtapa = "fuente";
  if (typeof estado.linkImportacion === "undefined") estado.linkImportacion = ""; // URL pegada en el modo "link"
  // Universidad/tipos_horas elegidos ANTES de que el plan exista (para poder
  // construir el prompt con las columnas de horas correctas). Se resuelven acá
  // primero y se copian al crear el plan real en abrirModalCrearPlan/confirmar.
  if (typeof estado.universidadImportacion === "undefined") estado.universidadImportacion = "TEC";
  if (typeof estado.tiposHorasImportacion === "undefined") estado.tiposHorasImportacion = PRESETS_TIPOS_HORAS.TEC.slice();
  if (typeof estado.tiposHorasPersonalizadoTexto === "undefined") estado.tiposHorasPersonalizadoTexto = ""; // texto crudo cuando universidadImportacion === "Otra"
}

/* ===================== B.2 — Panel de importación (solo cuando no hay plan) ===================== */

/**
 * v7 #3: texto final de la ventana "Antes de ir a Claude", con un salto de
 * línea entre cada instrucción. Es el mismo para los 3 modos (Link/PDF/
 * Capturas).
 * v-ajuste (2026-08-06): ahora copiar y enviar son dos acciones separadas
 * dentro de este mismo modal (ver botón "📋 Copiar prompt" más abajo), así
 * que las instrucciones reflejan ese orden explícito en vez de asumir que
 * la copia ya ocurrió sola en segundo plano.
 */

function construirTextoInstruccionesImportacion() {
  return [
    'Primero presiona "📋 Copiar prompt" para copiarlo a tu portapapeles.',
    'Después presiona "Aceptar" — se abrirá Claude en una pestaña nueva.',
    "Ya en el chat, pega el prompt copiado y adjunta el tipo de archivo que habías elegido.",
    "Guarda bien la respuesta que te entregue Claude para traerla de vuelta a esta página.",
  ].join("\n\n");
}

let archivosFuenteImportacion = [];
let ventanaGuiaImportacion = null;
let indicePasoGuiaImportacion = 0;

const PASO_SESION_ABRIR = ["Entra a tu cuenta de Claude", "Se abrirá en otra pestaña. Inicia sesión, o crea tu cuenta gratis desde ahí mismo.", "login", "Abrir Claude"];
const PASO_SESION_LISTO = ["¿Ya estás dentro?", "Lo sabrás cuando veas un cuadro para escribir mensajes.", "logged", "Ya inicié sesión"];
const PASO_COPIAR_RESPUESTA = ["Copia la respuesta", "Cuando Claude termine, toca el botón Copiar de su respuesta. Después vuelve a esta pestaña de Wapper.", "copied", "Ya la copié"];

const PASOS_GUIA_IMPORTACION = {
  link: [
    PASO_SESION_ABRIR, PASO_SESION_LISTO,
    ["Copia la instrucción", "El enlace de tu plan ya va incluido en el mensaje.", "copy", "Copiar instrucción"],
    ["Pégala en Claude y envía", "Haz clic derecho (o mantén presionado) en el cuadro de mensaje, elige Pegar y envía.", "sent", "Ya la envié"],
    PASO_COPIAR_RESPUESTA,
  ],
  file: [
    PASO_SESION_ABRIR, PASO_SESION_LISTO,
    ["Copia la instrucción", "Es el texto que le explica a Claude cómo organizar tu plan.", "copy", "Copiar instrucción"],
    ["Adjunta tu plan y envía", "Haz clic derecho (o mantén presionado) en el cuadro de mensaje y elige Pegar. Luego toca + y \"Subir o agregar archivos\" para adjuntar tu plan (puedes guardar una copia en Descargas) y envía.", "sent", "Ya lo envié", true],
    PASO_COPIAR_RESPUESTA,
  ],
  pdf: [
    PASO_SESION_ABRIR, PASO_SESION_LISTO,
    ["Copia la instrucción", "Es el texto que le explica a Claude cómo organizar tu plan.", "copy", "Copiar instrucción"],
    ["Adjunta tu PDF y envía", "Haz clic derecho (o mantén presionado) en el cuadro de mensaje y elige Pegar. Luego toca + y \"Subir o agregar archivos\", elige tu PDF y envía.", "sent", "Ya lo envié"],
    PASO_COPIAR_RESPUESTA,
  ],
  phone: [
    PASO_SESION_ABRIR, PASO_SESION_LISTO,
    ["Comparte tu plan con Claude", "Elige Claude en el menú. El archivo y la instrucción viajan juntos.", "share", "Compartir con Claude"],
    ["Revisa y envía", "Confirma que aparecen el archivo y la instrucción. Si falta la instrucción, pégala antes de enviar.", "sent", "Ya envié el mensaje"],
    PASO_COPIAR_RESPUESTA,
  ],
};

function obtenerPasosGuiaImportacion() {
  if (estado.modoImportacion === "link") return PASOS_GUIA_IMPORTACION.link;
  if (estado.modoImportacion === "pdf" && !archivosFuenteImportacion.length) return PASOS_GUIA_IMPORTACION.pdf;
  const files = archivosFuenteImportacion;
  const movil = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (movil && files.length && navigator.share && navigator.canShare?.({ files })) return PASOS_GUIA_IMPORTACION.phone;
  return PASOS_GUIA_IMPORTACION.file;
}

async function compartirArchivosClaude() {
  const files = archivosFuenteImportacion;
  if (!files.length || !navigator.share || !navigator.canShare?.({ files })) {
    mostrarToast("Tu navegador no permite compartir el archivo directamente. Adjunta el archivo en Claude.");
    return false;
  }
  try {
    await navigator.share({ files, title: "Plan de estudios", text: construirPromptImportacion(estado.modoImportacion, estado.linkImportacion) });
    return true;
  } catch (error) {
    if (error?.name !== "AbortError") mostrarToast("No se pudo compartir. Adjunta el archivo manualmente en Claude.");
    return false;
  }
}

/** Guarda en Descargas lo que el usuario va a adjuntar en Claude. Arrastrar desde
 *  Wapper a otra pestaña no funciona en los navegadores; adjuntar desde Descargas sí. */
function descargarArchivosImportacion() {
  archivosFuenteImportacion.forEach((file, i) => {
    const bajar = () => {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a"); a.href = url; a.download = file.name; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    if (i === 0) bajar(); else setTimeout(bajar, i * 450);
  });
}

function cerrarGuiaFlotanteImportacion() {
  if (ventanaGuiaImportacion && !ventanaGuiaImportacion.closed) ventanaGuiaImportacion.close();
  ventanaGuiaImportacion = null;
}

function avanzarGuiaImportacion(delta) {
  const pasos = obtenerPasosGuiaImportacion();
  indicePasoGuiaImportacion = Math.max(0, Math.min(pasos.length - 1, indicePasoGuiaImportacion + delta));
  dibujarGuiaFlotanteImportacion();
  renderizarPlanEstudios();
}

function construirEjemploClaude(accionPaso) {
  const muestra = document.createElement("div"); muestra.className = "importacion-mock"; muestra.setAttribute("aria-hidden", "true");
  const leyenda = document.createElement("small"); leyenda.textContent = traducirTextoInterfaz("Ejemplo de referencia: la pantalla de Claude puede verse distinta.");
  const ventana = document.createElement("div"); ventana.className = "importacion-mock-ventana";
  const cabecera = document.createElement("div"); cabecera.className = "importacion-mock-cabecera";
  const marca = document.createElement("strong"); marca.textContent = "Claude"; const chat = document.createElement("span"); chat.textContent = traducirTextoInterfaz("Chat nuevo"); cabecera.append(marca, chat);
  const cuerpo = document.createElement("div"); cuerpo.className = "importacion-mock-cuerpo";
  if (accionPaso === "copied") { const usuario = document.createElement("div"); usuario.className = "importacion-mock-burbuja usuario"; usuario.textContent = traducirTextoInterfaz("Tu instrucción"); const respuesta = document.createElement("div"); respuesta.className = "importacion-mock-burbuja respuesta"; respuesta.textContent = traducirTextoInterfaz("Tu plan organizado"); const copiar = document.createElement("span"); copiar.className = "importacion-mock-copiar"; copiar.textContent = traducirTextoInterfaz("Copiar"); respuesta.appendChild(copiar); cuerpo.append(usuario, respuesta); }
  else { const bienvenida = document.createElement("div"); bienvenida.className = "importacion-mock-burbuja"; bienvenida.textContent = traducirTextoInterfaz("¿En qué puedo ayudarte?"); cuerpo.appendChild(bienvenida); }
  const compositor = document.createElement("div"); compositor.className = "importacion-mock-compositor" + (accionPaso === "sent" ? " enfocado" : "");
  if (estado.modoImportacion !== "link" && (archivosFuenteImportacion.length || estado.modoImportacion === "pdf")) { const adjunto = document.createElement("span"); adjunto.className = "importacion-mock-adjunto"; adjunto.textContent = "📎 " + traducirTextoInterfaz("Tu plan adjunto"); compositor.appendChild(adjunto); }
  const texto = document.createElement("span"); texto.textContent = traducirTextoInterfaz("Escribe un mensaje…"); compositor.appendChild(texto); ventana.append(cabecera, cuerpo, compositor); muestra.append(leyenda, ventana); return muestra;
}

function ejecutarAccionGuiaImportacion(accion) {
  const prompt = construirPromptImportacion(estado.modoImportacion, estado.linkImportacion);
  if (accion === "login") abrirVentanaNueva("https://claude.ai/login");
  if (accion === "logged") registrarPasoSeguimientoImportacion("sesion_iniciada");
  if (accion === "save") { descargarArchivosImportacion(); registrarPasoSeguimientoImportacion("archivo_guardado"); }
  if (accion === "open") abrirVentanaNueva("https://claude.ai/new");
  if (accion === "copy") copiarPromptImportacionBlindado(prompt);
  if (accion === "sent") registrarPasoSeguimientoImportacion("mensaje_enviado");
  if (accion === "share") return compartirArchivosClaude();
  if (accion === "copied") {
    registrarPasoSeguimientoImportacion("respuesta_copiada");
    estado.importacionEtapa = "respuesta";
    cerrarGuiaFlotanteImportacion();
    renderizarPlanEstudios();
  }
  if (accion === "back") {
    estado.importacionEtapa = "respuesta";
    cerrarGuiaFlotanteImportacion();
    renderizarPlanEstudios();
  }
}

const VARIABLES_PALETA_GUIA = ["--bg-canvas", "--bg-card", "--bg-panel", "--text-primary", "--text-secondary", "--text-muted", "--accent-1", "--accent-2", "--accent-1-10", "--accent-1-20", "--gradient-accent", "--on-accent", "--border-glass", "--border-glass-fuerte", "--font-display", "--font-body", "--radius-pill"];
const CSS_GUIA_FLOTANTE = "*{box-sizing:border-box}body{margin:0;padding:14px 16px;min-height:100vh;display:flex;flex-direction:column;gap:10px;font:14px/1.45 var(--font-body,system-ui,sans-serif);color:var(--text-primary,#f5f3ff);background:radial-gradient(120% 90% at 0% 0%,var(--accent-1-20,#3b2f8f55),transparent 60%),var(--bg-canvas,#0b0b13)}.progreso{display:flex;gap:5px}.progreso i{height:4px;flex:1;border-radius:9px;background:var(--border-glass,#38364c)}.progreso i.activo{background:var(--accent-1,#9b87ff)}.cabeza{display:flex;gap:10px;align-items:center}.numero{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--gradient-accent,#6c55db);color:var(--on-accent,#fff);font-weight:800;font-size:13px}h2{margin:0;font:700 17px/1.2 var(--font-display,var(--font-body,system-ui,sans-serif))}p{margin:0;color:var(--text-secondary,#cbc7de)}.acciones{margin-top:auto;display:grid;gap:2px}.principal{padding:12px;border:0;border-radius:var(--radius-pill,999px);background:var(--gradient-accent,#7162e8);color:var(--on-accent,#fff);font:inherit;font-weight:700;cursor:pointer}.principal:hover{filter:brightness(1.08)}.archivos{display:grid;gap:6px}.archivo{display:flex;gap:8px;align-items:center;padding:8px 10px;border:1px dashed var(--accent-1,#9b87ff);border-radius:12px;background:var(--accent-1-10,#ffffff10);cursor:grab;font-size:13px;word-break:break-all}.archivo img{width:30px;height:30px;object-fit:cover;border-radius:6px}.atras{padding:6px;border:0;background:none;color:var(--text-muted,#9a9ab5);font:inherit;font-size:12px;cursor:pointer}button:focus-visible{outline:2px solid var(--accent-1,#fff);outline-offset:2px}";

/** Copia a la ventana flotante los colores y tipografías de la paleta que el
 *  usuario tiene activa AHORA (se vuelve a leer en cada paso). */
function aplicarPaletaGuiaFlotante(doc) {
  const css = getComputedStyle(document.body);
  const decl = VARIABLES_PALETA_GUIA.map((v) => { const val = css.getPropertyValue(v).trim(); return val ? `${v}:${val}` : ""; }).filter(Boolean).join(";");
  let paleta = doc.getElementById("paleta-guia");
  if (!paleta) { paleta = doc.createElement("style"); paleta.id = "paleta-guia"; doc.head.appendChild(paleta); }
  paleta.textContent = `:root{${decl}}`;
  if (!doc.getElementById("base-guia")) {
    const base = doc.createElement("style"); base.id = "base-guia"; base.textContent = CSS_GUIA_FLOTANTE; doc.head.appendChild(base);
    document.querySelectorAll('link[rel="stylesheet"][href*="fonts.googleapis"]').forEach((l) => { const c = doc.createElement("link"); c.rel = "stylesheet"; c.href = l.href; doc.head.appendChild(c); });
  }
}

function dibujarGuiaFlotanteImportacion() {
  if (!ventanaGuiaImportacion || ventanaGuiaImportacion.closed) return;
  const doc = ventanaGuiaImportacion.document;
  const pasos = obtenerPasosGuiaImportacion();
  const paso = pasos[indicePasoGuiaImportacion];
  const accion = paso[2];
  aplicarPaletaGuiaFlotante(doc);
  const progreso = doc.createElement("div"); progreso.className = "progreso";
  pasos.forEach((_, i) => { const marca = doc.createElement("i"); if (i <= indicePasoGuiaImportacion) marca.className = "activo"; progreso.appendChild(marca); });
  const cabeza = doc.createElement("div"); cabeza.className = "cabeza";
  const numero = doc.createElement("div"); numero.className = "numero"; numero.textContent = String(indicePasoGuiaImportacion + 1);
  const h = doc.createElement("h2"); h.textContent = traducirTextoInterfaz(paso[0]); cabeza.append(numero, h);
  const p = doc.createElement("p"); p.textContent = traducirTextoInterfaz(paso[1]);
  const acciones = doc.createElement("div"); acciones.className = "acciones";
  const principal = doc.createElement("button"); principal.className = "principal"; principal.textContent = traducirTextoInterfaz(paso[3]);
  principal.addEventListener("click", async () => { const resultado = await ejecutarAccionGuiaImportacion(accion); if (resultado === false) return; if (indicePasoGuiaImportacion < pasos.length - 1 && accion !== "copied" && accion !== "back") avanzarGuiaImportacion(1); });
  acciones.appendChild(principal);
  if (indicePasoGuiaImportacion > 0) { const anterior = doc.createElement("button"); anterior.className = "atras"; anterior.textContent = traducirTextoInterfaz("Paso anterior"); anterior.addEventListener("click", () => avanzarGuiaImportacion(-1)); acciones.appendChild(anterior); }
  const piezas = [progreso, cabeza, p];
  if (paso[4] && archivosFuenteImportacion.length) { const copia = doc.createElement("button"); copia.className = "atras"; copia.textContent = traducirTextoInterfaz("Guardar una copia en Descargas"); copia.addEventListener("click", () => { descargarArchivosImportacion(); registrarPasoSeguimientoImportacion("archivo_guardado"); }); acciones.appendChild(copia); }
  doc.body.replaceChildren(...piezas, acciones);
}

async function abrirGuiaFlotanteImportacion() {
  if (!("documentPictureInPicture" in window)) return false;
  try {
    ventanaGuiaImportacion = await window.documentPictureInPicture.requestWindow({ width: 340, height: 300 });
    ventanaGuiaImportacion.addEventListener("pagehide", () => { ventanaGuiaImportacion = null; renderizarPlanEstudios(); });
    dibujarGuiaFlotanteImportacion();
    return true;
  } catch (error) { console.warn("Picture-in-Picture no disponible; se usará la guía integrada.", error); return false; }
}

function crearBotonImportacion(texto, accion, clase = "btn btn-secondary") {
  const b = document.createElement("button"); b.type = "button"; b.className = clase; b.textContent = texto; b.addEventListener("click", accion); return b;
}

const ETAPAS_IMPORTACION = [
  ["intro", "Cómo funciona"], ["fuente", "Tu plan"], ["entrada", "Tu enlace o archivo"],
  ["guia", "Guía"], ["respuesta", "Resultado"], ["revision", "Revisión"],
];

function impEl(tag, clase, texto) {
  const n = document.createElement(tag);
  if (clase) n.className = clase;
  if (texto) n.textContent = traducirTextoInterfaz(texto);
  return n;
}
function impBoton(texto, accion, clase = "btn btn-secondary") { return crearBotonImportacion(traducirTextoInterfaz(texto), accion, clase); }
function impNav(atras, principal) {
  const nav = impEl("div", "imp-nav" + (principal ? "" : " imp-nav-uno"));
  nav.append(atras); if (principal) nav.append(principal);
  return nav;
}
function irEtapaImportacion(etapa) { if (etapa === "entrada" && estado.modoImportacion === "pdf") etapa = "fuente"; estado.importacionEtapa = etapa; renderizarPlanEstudios(); }

/** La respuesta de Claude siempre trae el encabezado Bloque,Codigo,Nombre,... */
function tieneEncabezadoRespuesta(texto) { return /Bloque\s*,\s*Codigo\s*,/i.test(texto || ""); }

/** Guarda lo pegado y pasa a revisión. Si Claude respondió en varias partes,
 *  las partes sin encabezado se agregan al final de lo ya pegado (regla 11 del prompt). */
function aplicarRespuestaImportacion(nuevo) {
  const previo = (estado.csvImportacionTexto.nuevo || "").trim();
  const conEncabezado = tieneEncabezadoRespuesta(nuevo);
  if (!conEncabezado && !previo) return false;
  estado.csvImportacionTexto.nuevo = conEncabezado ? nuevo : previo + "\n" + String(nuevo || "").trim();
  registrarPasoSeguimientoImportacion("respuesta_pegada");
  irEtapaImportacion("revision");
  return true;
}

/** Al volver a Wapper desde Claude, si el portapapeles trae la respuesta, se
 *  toma sola (el permiso de portapapeles ya lo pide la app al iniciar). */
let escuchaFocoImportacion = false;
function activarPegadoAutomaticoImportacion() {
  if (escuchaFocoImportacion) return;
  escuchaFocoImportacion = true;
  window.addEventListener("focus", async () => {
    if (estado.importacionEtapa !== "respuesta" || !document.getElementById("textarea-csv-importar")) return;
    if ((estado.csvImportacionTexto?.nuevo || "").trim() || estado.permisoPortapapeles === "denegado") return;
    try {
      const texto = await navigator.clipboard.readText();
      if (tieneEncabezadoRespuesta(texto)) aplicarRespuestaImportacion(texto);
    } catch { /* sin permiso o sin foco: queda el botón manual */ }
  });
}

function empezarEnBlancoImportacion() {
  cancelarSeguimientoImportacion(); cerrarGuiaFlotanteImportacion();
  estado.importacionEtapa = "fuente"; estado.modoImportacion = null; archivosFuenteImportacion = [];
  const cfg = estado.datos.configuracion;
  if (cfg?.guia_plan_pendiente === "plan") { cfg.onboarding_plan_en_blanco_pendiente = true; marcarCambioPendiente(); }
  abrirModalCrearPlan(estado.planImportandoId === "secundario", null);
}

function construirGuiaIntegradaImportacion(sec, pasos) {
  const paso = pasos[indicePasoGuiaImportacion];
  const puntos = impEl("div", "imp-puntos"); puntos.setAttribute("aria-hidden", "true");
  pasos.forEach((_, i) => { const p = document.createElement("i"); if (i <= indicePasoGuiaImportacion) p.className = "activo"; puntos.appendChild(p); });
  const fila = impEl("div", "imp-paso-grande");
  const num = impEl("span", "imp-num"); num.textContent = String(indicePasoGuiaImportacion + 1);
  const textos = impEl("div", "imp-paso-textos"); textos.append(impEl("h3", "imp-titulo imp-titulo-paso", paso[0]), impEl("p", "imp-lead", paso[1]));
  fila.append(num, textos); sec.append(puntos, fila);
  if (paso[2] === "sent" || paso[2] === "copied") sec.appendChild(construirEjemploClaude(paso[2]));
  const accion = paso[2];
  sec.appendChild(impBoton(paso[3], async () => {
    const resultado = await ejecutarAccionGuiaImportacion(accion);
    if (resultado === false || accion === "copied" || accion === "back") return;
    if (indicePasoGuiaImportacion < pasos.length - 1) avanzarGuiaImportacion(1);
  }, "btn btn-primary btn-block"));
  if (paso[4] && archivosFuenteImportacion.length) sec.appendChild(impBoton("Guardar una copia en Descargas", () => { descargarArchivosImportacion(); registrarPasoSeguimientoImportacion("archivo_guardado"); }, "btn btn-secondary btn-block"));
  sec.appendChild(impNav(impBoton("Atrás", () => { if (indicePasoGuiaImportacion > 0) avanzarGuiaImportacion(-1); else { cerrarGuiaFlotanteImportacion(); irEtapaImportacion("entrada"); } })));
}

function construirPanelImportacion() {
  inicializarEstadoImportacionPlanSiHaceFalta();
  activarPegadoAutomaticoImportacion();
  let etapa = estado.importacionEtapa || "fuente";
  if (etapa === "cuenta") etapa = "entrada";
  if (etapa === "fuente" && !estado.importacionIntroVista) etapa = "intro";
  const indice = Math.max(0, ETAPAS_IMPORTACION.findIndex((e) => e[0] === etapa));
  const sec = impEl("section", "glass-card stack imp-wizard");
  const ir = irEtapaImportacion;

  if (estado.mostrarPanelImportacionNuevoPlan) {
    const cancelar = impBoton("← Cancelar", () => { cancelarSeguimientoImportacion(); cerrarGuiaFlotanteImportacion(); estado.importacionEtapa = "fuente"; estado.modoImportacion = null; archivosFuenteImportacion = []; estado.mostrarPanelImportacionNuevoPlan = false; const reabrirGestion = estado.reabrirGestionPlanesTrasCrear; estado.reabrirGestionPlanesTrasCrear = false; renderizarPlanEstudios(); if (reabrirGestion) abrirModalGestionPlanes(); });
    cancelar.classList.add("imp-cancelar"); sec.appendChild(cancelar);
  }
  const cab = impEl("div", "imp-cabecera");
  const barra = impEl("div", "imp-progreso"); barra.setAttribute("role", "progressbar"); barra.setAttribute("aria-valuemin", "1"); barra.setAttribute("aria-valuemax", String(ETAPAS_IMPORTACION.length)); barra.setAttribute("aria-valuenow", String(indice + 1)); barra.setAttribute("aria-label", traducirTextoInterfaz("Progreso de importación"));
  const avance = document.createElement("span"); avance.style.width = `${((indice + 1) / ETAPAS_IMPORTACION.length) * 100}%`; barra.appendChild(avance);
  const etiqueta = impEl("p", "imp-paso-etiqueta"); etiqueta.textContent = `${traducirTextoInterfaz("Paso")} ${indice + 1} / ${ETAPAS_IMPORTACION.length} · ${traducirTextoInterfaz(ETAPAS_IMPORTACION[indice][1])}`;
  cab.append(barra, etiqueta); sec.appendChild(cab);

  if (etapa === "intro") {
    sec.append(impEl("h2", "imp-titulo", "Importa tu plan de estudios"), impEl("p", "imp-lead", "Wapper usa tu plan para armar tu semestre, tu horario y tus materias. En lugar de escribir todo a mano, Claude, un asistente gratuito, lo lee por ti."));
    const lista = impEl("ol", "imp-resumen-pasos");
    [["Nos dices cómo tienes tu plan", "Un enlace, un PDF o fotos."], ["Una guía te acompaña en Claude", "Te decimos qué tocar en cada momento."], ["Revisas y terminas", "Ves las materias antes de guardarlas."]].forEach(([t, d], i) => {
      const li = document.createElement("li"); const n = impEl("span", "imp-num"); n.textContent = String(i + 1);
      const c = document.createElement("div"); c.append(impEl("strong", null, t), impEl("small", "imp-nota", d)); li.append(n, c); lista.appendChild(li);
    });
    sec.appendChild(lista);
    sec.appendChild(impBoton("Empezar", () => { estado.importacionIntroVista = true; ir("fuente"); }, "btn btn-primary btn-block"));
  } else if (etapa === "fuente") {
    if (estado.datos.configuracion.modo_hardcore) {
      sec.appendChild(impEl("span", "form-label", "Esta malla corresponde al plan:"));
      const grupo = impEl("div", "pill-group");
      [{ valor: "principal", texto: "Principal" }, { valor: "secundario", texto: "Secundario 💀" }].forEach((op) => { const b = impBoton(op.texto, () => { estado.planImportandoId = op.valor; renderizarPlanEstudios(); }); b.className = "pill-item" + ((estado.planImportandoId || "principal") === op.valor ? " active" : ""); grupo.appendChild(b); });
      sec.appendChild(grupo);
    } else estado.planImportandoId = "principal";
    sec.appendChild(impEl("h2", "imp-titulo", "¿Cómo tienes tu plan de estudios?"));
    const opciones = impEl("div", "imp-opciones");
    [{ valor: "link", icono: "🔗", texto: "Tengo un enlace", detalle: "Una página pública, que se abre sin iniciar sesión." }, { valor: "pdf", icono: "📄", texto: "Tengo un PDF", detalle: "Un archivo guardado en este dispositivo." }, { valor: "capturas", icono: "🖼️", texto: "Tengo fotos o capturas", detalle: "Puedes elegir hasta 20 imágenes." }].forEach((op) => {
      const b = impEl("button", "imp-opcion"); b.type = "button";
      const ico = impEl("span", "imp-opcion-icono"); ico.textContent = op.icono; ico.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span"); copy.append(impEl("strong", null, op.texto), impEl("small", null, op.detalle)); b.append(ico, copy);
      b.addEventListener("click", () => { estado.modoImportacion = op.valor; archivosFuenteImportacion = []; estado.importacionImagenesComoPdf = false; estado.csvImportacionTexto.nuevo = ""; if (!flujoAnaliticoImportacion) iniciarSeguimientoImportacion(); registrarPasoSeguimientoImportacion("fuente_elegida"); if (op.valor === "pdf") { estado.importacionEtapa = "guia"; indicePasoGuiaImportacion = 0; estado.importacionGuiaIntegrada = false; registrarPasoSeguimientoImportacion("fuente_preparada"); renderizarPlanEstudios(); } else ir("entrada"); });
      opciones.appendChild(b);
    });
    sec.appendChild(opciones);
    sec.appendChild(impBoton("✏️ Empezar en blanco y agregar materias a mano", empezarEnBlancoImportacion, "btn btn-secondary btn-block"));
    sec.appendChild(impNav(impBoton("Atrás", () => { estado.importacionIntroVista = false; renderizarPlanEstudios(); })));
  } else if (etapa === "entrada") {
    const esLink = estado.modoImportacion === "link", esPdf = estado.modoImportacion === "pdf";
    const archivos = archivosFuenteImportacion;
    const todasImagenes = archivos.length > 0 && archivos.every((f) => f.type.startsWith("image/"));
    if (esLink) {
      sec.append(impEl("h2", "imp-titulo", "Pega el enlace de tu plan"), impEl("p", "imp-lead", "Cópialo desde la barra de direcciones de tu navegador."));
      const input = impEl("input", "form-input imp-input"); input.type = "url"; input.inputMode = "url"; input.placeholder = "https://tu-universidad.ac.cr/plan"; input.value = estado.linkImportacion || ""; input.setAttribute("aria-label", traducirTextoInterfaz("Enlace de tu plan")); input.addEventListener("input", () => { estado.linkImportacion = input.value; });
      sec.append(input, impEl("p", "imp-nota", "La página debe abrirse sin iniciar sesión."));
    } else {
      sec.append(impEl("h2", "imp-titulo", esPdf ? "Elige tu PDF" : "Elige las fotos de tu plan"), impEl("p", "imp-lead", esPdf ? "Lo buscas aquí mismo, sin salir de Wapper." : "Puedes elegir varias a la vez, hasta 20, directo desde tu galería."));
      const zona = impEl("label", "imp-zona"); const ico = impEl("span", "imp-zona-icono"); ico.textContent = esPdf ? "📄" : "🖼️"; ico.setAttribute("aria-hidden", "true");
      const input = document.createElement("input"); input.type = "file"; input.className = "imp-zona-input"; input.accept = esPdf ? "application/pdf,.pdf,image/*" : "image/*"; input.multiple = !esPdf;
      input.addEventListener("change", () => { const files = Array.from(input.files || []); if (!esPdf && files.length > 20) mostrarToast("Elegiste más de 20 imágenes; usaremos las primeras 20."); archivosFuenteImportacion = esPdf ? files.slice(0, 1) : files.slice(0, 20); estado.importacionImagenesComoPdf = false; renderizarPlanEstudios(); });
      zona.append(ico, impEl("strong", null, archivos.length ? "Cambiar selección" : (esPdf ? "Toca para elegir tu PDF" : "Toca para elegir tus fotos")), input); sec.appendChild(zona);
      if (archivos.length) {
        const lista = impEl("ul", "importacion-archivos"); archivos.forEach((f) => { const li = document.createElement("li"); li.textContent = f.name; lista.appendChild(li); }); sec.appendChild(lista);
        const imagenes = archivos.filter((f) => f.type.startsWith("image/")).slice(0, 12);
        if (imagenes.length) { const mini = impEl("div", "importacion-miniaturas"); imagenes.forEach((file) => { const img = document.createElement("img"); img.alt = file.name; const url = URL.createObjectURL(file); img.src = url; img.addEventListener("load", () => URL.revokeObjectURL(url), { once: true }); img.addEventListener("error", () => URL.revokeObjectURL(url), { once: true }); mini.appendChild(img); }); sec.appendChild(mini); }
      }
      if (!esPdf && todasImagenes) {
        if (archivos.length > 4) sec.appendChild(impEl("div", "imp-tarjeta", "Son más de 4 imágenes: las juntaremos automáticamente en un PDF para que Claude las lea mejor."));
        else {
          sec.appendChild(impEl("p", "imp-subtitulo", "¿Cómo quieres enviarlas a Claude?"));
          const grupo = impEl("div", "imp-opciones imp-opciones-2");
          [[false, "Como imágenes", "Se envían tal cual."], [true, "Juntarlas en un PDF", "Un solo archivo, más fácil de adjuntar."]].forEach(([valor, t, d]) => {
            const activa = Boolean(estado.importacionImagenesComoPdf) === valor;
            const b = impEl("button", "imp-opcion" + (activa ? " activa" : "")); b.type = "button"; b.setAttribute("aria-pressed", String(activa));
            const c = document.createElement("span"); c.append(impEl("strong", null, t), impEl("small", null, d)); b.appendChild(c);
            b.addEventListener("click", () => { estado.importacionImagenesComoPdf = valor; renderizarPlanEstudios(); }); grupo.appendChild(b);
          });
          sec.appendChild(grupo);
        }
      }
    }
    const continuar = impBoton("Continuar", async () => {
      if (esLink) { try { const u = new URL((estado.linkImportacion || "").trim()); if (!/^https?:$/.test(u.protocol)) throw new Error(); } catch { mostrarToast("Pega un enlace válido que comience con https://"); return; } }
      else if (!archivosFuenteImportacion.length) { mostrarToast("Selecciona primero tu archivo o tus imágenes."); return; }
      const aConvertir = estado.modoImportacion === "capturas" && todasImagenes && (archivosFuenteImportacion.length > 4 || estado.importacionImagenesComoPdf);
      if (aConvertir) {
        try { mostrarCargando(); const { archivoPDF, imagenesBajaResolucion } = await convertirCapturasAPDF(archivosFuenteImportacion, { descargar: false }); if (archivoPDF) archivosFuenteImportacion = [archivoPDF]; if (imagenesBajaResolucion.length) mostrarToast("El PDF está listo; algunas capturas podrían verse poco nítidas."); }
        catch (e) { mostrarToast("No se pudieron combinar las imágenes. Intenta con menos imágenes o un PDF."); return; }
        finally { ocultarCargando(); }
      }
      estado.importacionEtapa = "guia"; indicePasoGuiaImportacion = 0; estado.importacionGuiaIntegrada = false; registrarPasoSeguimientoImportacion("fuente_preparada"); renderizarPlanEstudios();
    }, "btn btn-primary");
    sec.appendChild(impNav(impBoton("Atrás", () => ir("fuente")), continuar));
  } else if (etapa === "guia") {
    const pasos = obtenerPasosGuiaImportacion(); indicePasoGuiaImportacion = Math.min(indicePasoGuiaImportacion, pasos.length - 1);
    const hayPiP = "documentPictureInPicture" in window;
    const abierta = ventanaGuiaImportacion && !ventanaGuiaImportacion.closed;
    sec.appendChild(impEl("h2", "imp-titulo", "Tu guía paso a paso"));
    if (abierta) {
      const t = impEl("div", "imp-tarjeta"); t.append(impEl("strong", null, "La guía está flotando encima de Claude"), impEl("p", "imp-nota", pasos[indicePasoGuiaImportacion][0]), impEl("p", "imp-nota", "Si no la ves, búscala en una esquina de tu pantalla.")); sec.appendChild(t);
      sec.appendChild(impNav(impBoton("Cerrar guía y volver", () => { cerrarGuiaFlotanteImportacion(); ir("entrada"); })));
    } else if (hayPiP && !estado.importacionGuiaIntegrada) {
      sec.appendChild(impEl("p", "imp-lead", "Te acompañamos desde una ventana flotante que se queda encima de Claude. Cada paso tiene un solo botón."));
      sec.appendChild(impBoton("Abrir guía flotante", () => { abrirGuiaFlotanteImportacion().then((ok) => { if (!ok) { estado.importacionGuiaIntegrada = true; mostrarToast("No se pudo abrir la ventana flotante. Te guiamos aquí mismo."); } renderizarPlanEstudios(); }); }, "btn btn-primary btn-block"));
      sec.appendChild(impBoton("Prefiero seguir los pasos aquí", () => { estado.importacionGuiaIntegrada = true; renderizarPlanEstudios(); }, "btn btn-secondary btn-block"));
      sec.appendChild(impNav(impBoton("Atrás", () => ir("entrada"))));
    } else {
      if (!hayPiP) sec.appendChild(impEl("p", "imp-nota", "Tu navegador no permite la ventana flotante, así que te guiamos aquí mismo."));
      construirGuiaIntegradaImportacion(sec, pasos);
    }
  } else {
    const enRespuesta = etapa === "respuesta";
    const textarea = impEl("textarea", "form-textarea"); textarea.id = "textarea-csv-importar"; textarea.dataset.csvContexto = "nuevo"; textarea.rows = enRespuesta ? 4 : 10; textarea.placeholder = traducirTextoInterfaz("Pega aquí lo que copiaste de Claude…"); textarea.value = estado.csvImportacionTexto.nuevo || "";
    textarea.addEventListener("input", (e) => { estado.csvImportacionTexto.nuevo = textarea.value; if (enRespuesta && !e.isTrusted && tieneEncabezadoRespuesta(textarea.value)) aplicarRespuestaImportacion(textarea.value); });
    const errores = document.createElement("div"); errores.id = "errores-importacion-csv"; errores.className = "stack oculto";
    if (enRespuesta) {
      sec.append(impEl("h2", "imp-titulo", "Último paso: trae tu plan de vuelta"), impEl("p", "imp-lead", "Ya copiaste la respuesta de Claude. Toca el botón y Wapper la lee por ti."));
      const detalles = impEl("details", "imp-detalles"); detalles.append(impEl("summary", null, "¿No funciona el botón? Pégalo a mano"), impEl("p", "imp-nota", "Mantén presionado en el recuadro y elige Pegar."), textarea, construirInputArchivoCSV(textarea, "nuevo"));
      textarea.addEventListener("paste", () => setTimeout(() => { if (!aplicarRespuestaImportacion(textarea.value)) mostrarToast("Eso no parece la respuesta de Claude. Vuelve a Claude y toca Copiar en su respuesta."); }, 0));
      sec.appendChild(impBoton("Pegar lo que copié", async () => {
        try { const texto = await navigator.clipboard.readText(); if (!texto) throw new Error(); if (!aplicarRespuestaImportacion(texto)) mostrarToast("Eso no parece la respuesta de Claude. Vuelve a Claude y toca Copiar en su respuesta."); }
        catch { detalles.open = true; textarea.focus(); mostrarToast("No se pudo leer lo copiado. Pégalo en el recuadro."); }
      }, "btn btn-primary btn-block"));
      sec.append(impEl("p", "imp-nota", "Si Claude te avisa que hay más partes, copia y pega cada una, en orden."), detalles, errores);
      sec.appendChild(impNav(impBoton("Volver a la guía", () => ir("guia"))));
    } else {
      const { csv } = extraerMetadatosImportacion(textarea.value);
      const parseo = parsearCSVPlanEstudios(csv, estado.tiposHorasImportacion || PRESETS_TIPOS_HORAS.TEC);
      const todas = [...parseo.materias, ...parseo.electivas, ...parseo.paraRevisar];
      const detalles = impEl("details", "imp-detalles"); detalles.append(impEl("summary", null, "Ver o editar el texto, o agregar otra parte"), textarea, impBoton("Pegar otra parte", () => ir("respuesta")));
      textarea.addEventListener("change", () => renderizarPlanEstudios());
      if (!todas.length) {
        sec.append(impEl("h2", "imp-titulo", "No pudimos leer materias"), impEl("p", "imp-lead", "Lo que pegaste no parece el plan que prepara Claude. Vuelve a Claude, toca Copiar en su respuesta y pégala de nuevo."), detalles, errores);
        estado.csvImportacionTexto.nuevo = "";
        sec.appendChild(impBoton("Intentar de nuevo", () => ir("respuesta"), "btn btn-primary btn-block"));
      } else {
        sec.append(impEl("h2", "imp-titulo", "Revisa que se vea bien"));
        const resumen = impEl("div", "imp-tarjeta importacion-resumen");
        const conteo = document.createElement("strong"); conteo.textContent = `${parseo.materias.length} ${traducirTextoInterfaz("materias")} · ${parseo.electivas.length} ${traducirTextoInterfaz("optativas")} · ${parseo.paraRevisar.length} ${traducirTextoInterfaz("por revisar")}`; resumen.appendChild(conteo);
        const lista = impEl("ul", "importacion-preview-lista"); todas.slice(0, 12).forEach((m) => { const li = document.createElement("li"); li.textContent = `${m.codigo || "Sin código"} · ${m.nombre || "Sin nombre"}`; lista.appendChild(li); }); resumen.appendChild(lista);
        if (todas.length > 12) { const resto = impEl("p", "imp-nota"); resto.textContent = `+ ${todas.length - 12} ${traducirTextoInterfaz("más")}`; resumen.appendChild(resto); }
        if (parseo.errores.length) { const e = impEl("p", "imp-nota"); e.textContent = `${parseo.errores.length} ${traducirTextoInterfaz("observaciones: al importar te mostraremos cuáles son.")}`; resumen.appendChild(e); }
        sec.append(resumen, detalles, errores);
        sec.appendChild(impNav(impBoton("Atrás", () => ir("respuesta")), impBoton("Terminar e importar", () => { estado.csvImportacionTexto.nuevo = textarea.value; manejarClickImportar(textarea.value); }, "btn btn-primary")));
      }
    }
  }
  return sec;
}
/* ===================== v1.10.0 — Capturas -> un solo PDF (modo "capturas") =====================
 * Antes de esto, el usuario adjuntaba cada foto/captura suelta directamente
 * en Claude. Ahora, en el modo "Tomar capturas", primero se arma UN
 * SOLO PDF (una imagen por página, sin backend, 100% en el navegador con
 * jsPDF vía CDN) y ESE PDF es lo que se adjunta en la IA. */

/** Lee un archivo de imagen como Data URL (para poder cargarlo en un <img>
 *  y luego insertarlo en el PDF). */

function leerImagenComoDataURL(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result || ""));
    lector.onerror = () => reject(new Error("No se pudo leer la imagen."));
    lector.readAsDataURL(archivo);
  });
}

/** Carga una Data URL en un elemento <img> real, solo para poder leer sus
 *  dimensiones naturales (ancho/alto) antes de insertarla en el PDF.
 *  Incluye un timeout de seguridad: en algunos navegadores, si el archivo no
 *  es una imagen decodificable (formato no soportado, archivo corrupto),
 *  ni onload ni onerror llegan a dispararse — sin este timeout, la
 *  conversión completa se quedaba esperando para siempre, sin error visible
 *  y sin que el overlay de carga terminara nunca. */

function cargarDimensionesImagen(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const limite = setTimeout(() => {
      reject(new Error("La imagen tardó demasiado en procesarse (puede no ser un formato soportado)."));
    }, 15000);
    img.onload = () => { clearTimeout(limite); resolve(img); };
    img.onerror = () => { clearTimeout(limite); reject(new Error("No se pudo procesar la imagen.")); };
    img.src = dataUrl;
  });
}

/** jsPDF necesita saber el formato real de la imagen para insertarla bien;
 *  se detecta a partir del prefijo de la Data URL en vez de asumir JPEG. */

function detectarFormatoImagen(dataUrl) {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

/**
 * Arma un solo PDF a partir de las capturas seleccionadas: una página por
 * imagen, tamaño A4, con la imagen centrada y ajustada al espacio disponible
 * MANTENIENDO su proporción original (nunca se deforma). La orientación de
 * cada página (vertical/horizontal) se elige según la proporción de esa
 * imagen. Descarga el resultado como "plan-de-estudios-capturas.pdf".
 */

async function convertirCapturasAPDF(archivos, { descargar = true } = {}) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("La librería jsPDF no está disponible todavía.");
  }
  const { jsPDF } = window.jspdf;
  const MARGEN_MM = 10;
  // v1.12.6: por debajo de esto, el texto de una captura de plan de estudios
  // ya no se lee con confianza (ni por una persona haciendo zoom, ni por la
  // IA al importarlo) — se usa solo para armar la advertencia al usuario,
  // nunca para bloquear la conversión.
  const ANCHO_MINIMO_RECOMENDADO_PX = 1200;
  let doc = null;
  const imagenesBajaResolucion = [];

  for (let i = 0; i < archivos.length; i++) {
    const dataUrl = await leerImagenComoDataURL(archivos[i]);
    const img = await cargarDimensionesImagen(dataUrl);
    const horizontal = img.width >= img.height;
    const anchoPagina = horizontal ? 297 : 210; // A4 en mm
    const altoPagina = horizontal ? 210 : 297;

    if (!doc) {
      doc = new jsPDF({ orientation: horizontal ? "landscape" : "portrait", unit: "mm", format: "a4" });
    } else {
      doc.addPage("a4", horizontal ? "landscape" : "portrait");
    }

    const anchoDisponible = anchoPagina - MARGEN_MM * 2;
    const altoDisponible = altoPagina - MARGEN_MM * 2;
    // v1.12.6: el "1" al final es el fix de calidad — antes, una imagen más
    // chica que el espacio disponible (típico de una captura de pantalla de
    // PC, a diferencia de una foto de celular) se ESTIRABA para llenar la
    // hoja, agrandando los píxeles existentes en vez de agregar detalle
    // (se veía borrosa/pixelada). Ahora nunca se agranda más allá de su
    // tamaño real: si es más chica que la hoja, se centra en su tamaño
    // nativo en vez de estirarse.
    const proporcion = Math.min(anchoDisponible / img.width, altoDisponible / img.height, 1);
    const anchoFinal = img.width * proporcion;
    const altoFinal = img.height * proporcion;
    const x = (anchoPagina - anchoFinal) / 2;
    const y = (altoPagina - altoFinal) / 2;

    if (img.width < ANCHO_MINIMO_RECOMENDADO_PX) {
      imagenesBajaResolucion.push(archivos[i].name);
    }

    doc.addImage(dataUrl, detectarFormatoImagen(dataUrl), x, y, anchoFinal, altoFinal);
  }
  const archivoPDF = new File([doc.output("blob")], "plan-de-estudios-capturas.pdf", { type: "application/pdf" });
  if (descargar) doc.save(archivoPDF.name);

  return { imagenesBajaResolucion, archivoPDF };
}

/* ===================== v1.10.1 — Ventana flotante: capturas -> PDF ===================== *
 * Reemplaza el input inline que vivía en el panel. Ahora el botón "Convertir
 * imágenes a PDF" del panel abre este modal aparte; al convertir con éxito
 * usa el overlay de carga global (mostrarCargando/ocultarCargando, las
 * mismas bolitas que ya existen para el resto de la app) y, al terminar,
 * autoselecciona el modo "Adjuntar PDF/Imagen" para que el usuario siga el flujo
 * normal desde ahí (adjuntar el PDF recién descargado). */

function abrirModalCapturasPDF() {
  const input = document.getElementById("input-capturas-pdf");
  if (input) input.value = ""; // limpia cualquier selección de una vez anterior
  document.getElementById("error-modal-capturas-pdf").classList.add("oculto");
  document.getElementById("modal-capturas-pdf").classList.remove("oculto");
}

function cerrarModalCapturasPDF() {
  document.getElementById("modal-capturas-pdf").classList.add("oculto");
}

function inicializarModalCapturasPDF() {
  inicializarEstadoImportacionPlanSiHaceFalta();
  document.getElementById("btn-cancelar-capturas-pdf").addEventListener("click", cerrarModalCapturasPDF);
  document.getElementById("modal-capturas-pdf").addEventListener("click", (e) => {
    if (e.target.id === "modal-capturas-pdf") cerrarModalCapturasPDF();
  });

  document.getElementById("btn-convertir-capturas-pdf").addEventListener("click", async () => {
    const input = document.getElementById("input-capturas-pdf");
    const archivos = input.files;
    const err = document.getElementById("error-modal-capturas-pdf");
    err.classList.add("oculto");

    if (!archivos || archivos.length === 0) {
      err.textContent = "Primero selecciona una o varias fotos/capturas.";
      err.classList.remove("oculto");
      return;
    }
    cerrarModalCapturasPDF();
    mostrarCargando();
    try {
      const { imagenesBajaResolucion } = await convertirCapturasAPDF(archivos);
      // Puntos 3/5: autoselecciona "Adjuntar PDF/Imagen" — el usuario ya tiene el
      // PDF descargado y solo falta que lo adjunte en la IA.
      estado.modoImportacion = "pdf";
      renderizarPlanEstudios();
      if (imagenesBajaResolucion.length > 0) {
        // v1.12.6: en vez de dejar que el usuario descubra hasta el final
        // (cuando la IA no puede leer bien el plan) que una o varias
        // capturas quedaron en baja resolución, se avisa apenas se genera
        // el PDF, mencionando cuáles, para que las vuelva a tomar mejor.
        mostrarToast(`✓ PDF descargado — ojo: ${imagenesBajaResolucion.length === 1 ? `"${imagenesBajaResolucion[0]}" quedó` : `${imagenesBajaResolucion.length} imágenes quedaron`} en baja resolución, puede costar leerlas bien`);
      } else {
        mostrarToast('✓ PDF descargado — se seleccionó "Adjuntar PDF/Imagen", adjúntalo ahí');
      }
    } catch (e) {
      console.warn("No se pudo convertir las capturas a PDF.", e);
      mostrarToast("No se pudo crear el PDF. Intenta de nuevo.");
      abrirModalCapturasPDF(); // deja al usuario reintentar sin perder el flujo
    } finally {
      ocultarCargando();
    }
  });
}

/** Ajuste v4 #8: además de pegar el CSV como texto, se puede subir un
 *  archivo .csv — se lee su contenido y se coloca en el textarea indicado,
 *  para que se procese exactamente igual que si se hubiera pegado a mano. */

function construirInputArchivoCSV(textareaDestino, contexto = "nuevo") {
  const wrap = document.createElement("div");
  wrap.className = "csv-archivo-wrap";
  const etiqueta = document.createElement("label");
  etiqueta.className = "btn btn-secondary csv-archivo-boton";
  etiqueta.setAttribute("for", "csv-archivo-" + contexto);
  const icono = document.createElement("span");
  icono.className = "csv-archivo-icono";
  icono.setAttribute("aria-hidden", "true");
  icono.textContent = "↑";
  const textoBoton = document.createElement("span");
  textoBoton.textContent = "Elegir archivo CSV";
  etiqueta.append(icono, textoBoton);
  const input = document.createElement("input");
  input.id = "csv-archivo-" + contexto;
  input.type = "file";
  input.accept = ".csv,text/csv";
  input.className = "csv-archivo-input";
  const nombre = document.createElement("span");
  nombre.className = "muted csv-archivo-nombre";
  nombre.textContent = "También puedes pegar el contenido en el campo de arriba.";
  input.addEventListener("change", () => {
    const archivo = input.files && input.files[0];
    if (!archivo) return;
    nombre.textContent = archivo.name;
    const lector = new FileReader();
    lector.onload = () => {
      const csv = String(lector.result || "").replace(/^\uFEFF/, "");
      estado.csvImportacionTexto = estado.csvImportacionTexto || { nuevo:"", actualizar:"" };
      estado.csvImportacionTexto[contexto] = csv;
      const textareaActual = document.querySelector('textarea[data-csv-contexto="' + contexto + '"]') || textareaDestino;
      if (textareaActual && textareaActual.isConnected) {
        textareaActual.value = csv;
        textareaActual.dispatchEvent(new Event("input", { bubbles:true }));
      }
      nombre.textContent = archivo.name + " listo para importar";
    };
    lector.onerror = () => { mostrarErroresImportacion(["No se pudo leer el archivo. Intenta pegar el CSV como texto."]); };
    lector.readAsText(archivo, "UTF-8");
  });
  wrap.append(etiqueta, input, nombre);
  return wrap;
}

/**
 * Bug 1 (v8.3, LETAL): en móvil, `window.open()` llamado DESPUÉS de un
 * `await` (como el `await navigator.clipboard.writeText()` de antes) ya no
 * cuenta como parte del gesto síncrono del click original — los navegadores
 * móviles lo bloquean como pop-up la mayoría de las veces. La técnica
 * confiable es crear un <a target="_blank" rel="noopener"> real y disparar
 * `.click()` sobre él de forma síncrona, en el mismo tick del evento.
 */

function abrirVentanaNueva(url) {
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.target = "_blank";
  enlace.rel = "noopener";
  enlace.style.display = "none";
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
}

/** Ya NO son async: la apertura de la ventana ocurre primero y de forma
 *  síncrona (mismo tick del click); copiar al portapapeles es asíncrono
 *  pero ya no bloquea ni retrasa la apertura, así que el orden entre ambas
 *  cosas ya no importa para el bloqueador de pop-ups. */

/** Copia blindada del prompt: si ya se sabe (por
 *  comprobarPermisoPortapapelesAlIniciar, en main.js) que el permiso está
 *  denegado, ni siquiera se intenta la copia automática — se ahorra el
 *  intento fallido y se va directo al modal de copia manual. En cualquier
 *  otro caso ("otorgado" o "desconocido"), copiarPromptConAviso hace el
 *  intento real y decide sola si mostrar el toast de éxito o el modal. */

function copiarPromptImportacionBlindado(texto) {
  if (estado.permisoPortapapeles === "denegado") {
    abrirModalCopiaManualPortapapeles(texto);
    return;
  }
  copiarPromptConAviso(texto);
}

/**
 * Abre Claude en pestaña nueva y, además, intenta copiar el prompt como
 * RESPALDO SILENCIOSO (sin toast ni modal de copia manual): la experiencia
 * de copia con feedback completo ya vive en el botón dedicado "📋 Copiar
 * prompt" del modal de instrucciones (ver más abajo) — este intento extra
 * es solo por si el usuario presionó "Aceptar" sin haber usado ese botón
 * antes, para no dejarlo sin nada en el portapapeles en ese caso. Si este
 * intento silencioso falla, no pasa nada visible: el usuario ya vio (o
 * puede volver a ver) el prompt completo a través del botón dedicado.
 */

function enviarPromptAClaude(texto) {
  abrirVentanaNueva("https://claude.ai/new");
  copiarAlPortapapelesBlindado(texto);
}

/* ===================== Modal de instrucciones antes de enviar (v6) ===================== */

/** Guarda qué prompt copiar/enviar si el usuario usa los botones del modal
 *  de instrucciones — null mientras el modal está cerrado. */

let instruccionesImportacionPendiente = null;
let flujoAnaliticoImportacion = null;

function iniciarSeguimientoImportacion() {
  if (!flujoAnaliticoImportacion) flujoAnaliticoImportacion = iniciarProcesoAnalitico("plan.importacion");
  return flujoAnaliticoImportacion;
}

function cancelarSeguimientoImportacion() {
  flujoAnaliticoImportacion?.cancelar("cancelado");
  flujoAnaliticoImportacion = null;
}

function completarSeguimientoImportacion() {
  const continuarOnboarding = estado.datos?.configuracion?.guia_plan_pendiente === "plan";
  flujoAnaliticoImportacion?.completar("guardado");
  flujoAnaliticoImportacion = null;
  cerrarGuiaFlotanteImportacion();
  estado.importacionEtapa = "fuente";
  estado.modoImportacion = null;
  archivosFuenteImportacion = [];
  if (continuarOnboarding) window.continuarTutorialDespuesDeImportarPlan?.();
}

function registrarPasoSeguimientoImportacion(paso) {
  flujoAnaliticoImportacion?.paso(paso);
}

/**
 * v6: en vez de copiar y redirigir de inmediato al presionar "Enviar a
 * Claude", primero se muestra este modal con las instrucciones completas
 * (adaptadas al modo Link/PDF/Capturas).
 * v-ajuste (2026-08-06): copiar y enviar ahora son dos botones separados
 * dentro del modal — "📋 Copiar prompt" copia (con su propio feedback: toast
 * de éxito o modal de copia manual si falla) y se puede presionar las veces
 * que haga falta sin cerrar nada; "Aceptar" recién ahí abre Claude en
 * pestaña nueva. Esto asegura que el usuario copie el prompt de forma
 * explícita y confirmada ANTES de irse a la pestaña de Claude, en vez de
 * que la copia ocurra en silencio justo cuando el foco ya se está yendo a
 * la ventana nueva (que es precisamente el escenario donde antes el
 * usuario podía no enterarse de que la copia había fallado).
 */

function abrirModalInstruccionesImportacion(modo, textoPrompt) {
  flujoAnaliticoImportacion?.paso("instrucciones_vistas");
  instruccionesImportacionPendiente = { textoPrompt };
  document.getElementById("titulo-modal-instrucciones-importacion").textContent = "Antes de ir a Claude…";
  document.getElementById("cuerpo-modal-instrucciones-importacion").textContent =
    construirTextoInstruccionesImportacion();
  document.getElementById("modal-instrucciones-importacion").classList.remove("oculto");
}

function cerrarModalInstruccionesImportacion() {
  instruccionesImportacionPendiente = null;
  document.getElementById("modal-instrucciones-importacion").classList.add("oculto");
}

function inicializarModalInstruccionesImportacion() {
  inicializarEstadoImportacionPlanSiHaceFalta();
  document.getElementById("btn-cancelar-instrucciones-importacion").addEventListener("click", cerrarModalInstruccionesImportacion);
  document.getElementById("modal-instrucciones-importacion").addEventListener("click", (e) => {
    if (e.target.id === "modal-instrucciones-importacion") cerrarModalInstruccionesImportacion();
  });
  // Botón dedicado de copia: usa copiarPromptImportacionBlindado (mismo
  // camino que ya respeta estado.permisoPortapapeles y abre el modal de
  // copia manual si hace falta) — no cierra este modal, para que el usuario
  // pueda copiar de nuevo si quiere antes de presionar "Aceptar".
  document.getElementById("btn-copiar-prompt-instrucciones-importacion").addEventListener("click", () => {
    if (!instruccionesImportacionPendiente) return;
    flujoAnaliticoImportacion?.paso("prompt_copiado");
    copiarPromptImportacionBlindado(instruccionesImportacionPendiente.textoPrompt);
  });
  document.getElementById("btn-aceptar-instrucciones-importacion").addEventListener("click", () => {
    if (!instruccionesImportacionPendiente) return;
    const { textoPrompt } = instruccionesImportacionPendiente;
    document.getElementById("modal-instrucciones-importacion").classList.add("oculto");
    instruccionesImportacionPendiente = null;
    flujoAnaliticoImportacion?.paso("enviado_a_ia");
    enviarPromptAClaude(textoPrompt);
  });
}

export {
  abrirModalCapturasPDF,
  abrirModalInstruccionesImportacion,
  abrirVentanaNueva,
  cerrarModalCapturasPDF,
  cerrarModalInstruccionesImportacion,
  construirColumnasHoras,
  construirEncabezadoCSV,
  construirInputArchivoCSV,
  construirPanelImportacion,
  inicializarEstadoImportacionPlanSiHaceFalta,
  cancelarSeguimientoImportacion,
  completarSeguimientoImportacion,
  registrarPasoSeguimientoImportacion,
  construirPromptImportacion,
  construirTextoInstruccionesImportacion,
  convertirCapturasAPDF,
  enviarPromptAClaude,
  extraerMetadatosImportacion,
  inicializarModalCapturasPDF,
  inicializarModalInstruccionesImportacion,
  instruccionesImportacionPendiente,
};

