# Matriz manual de clasificación de Wapper

Estas frases son una guía para validar con Gemini y con la cuenta real. No se ejecutaron automáticamente. Fecha de referencia para los casos relativos: 18/10/2026. Zona horaria: America/Costa_Rica. Preparar las materias Cálculo I, Biología y Programación. Para el caso ambiguo, matricular Matemática I en dos semestres seleccionados.

## Configuraciones de etiquetas

- A, predeterminadas: examen, quiz, tarea, proyecto, evento, feriado.
- B, personalizadas: añadir Laboratorio (base examen, ayuda: prácticas en laboratorio), Cumpleaños (base evento, ayuda: celebración personal) y Reunión de equipo (base evento).
- C, cambios: renombrar tarea a Entrega y borrar/desactivar quiz. Wapper debe usar el id vigente y nunca devolver el id eliminado.

## Frases y resultado esperado

| # | Config. | Mensaje | Resultado esperado |
|---:|:---:|---|---|
| 1 | A | Tengo examen de Cálculo I el 22 de octubre. | examen, 2026-10-22, Cálculo I, confianza alta |
| 2 | A | El primer parcial de Biología es el próximo jueves. | examen, 2026-10-22, Biología |
| 3 | A | Quiz corto de Programación el viernes a las 9. | quiz, 2026-10-23 09:00, Programación |
| 4 | A | Entrega el informe de Cálculo I el 25 de octubre. | tarea, 2026-10-25, Cálculo I |
| 5 | A | Presentar el proyecto final de Biología el 30 de octubre. | proyecto, 2026-10-30, Biología |
| 6 | A | Reunión con mi grupo el martes a las 14:30. | evento, 2026-10-20 14:30, sin materia |
| 7 | A | El 1 de noviembre es feriado y no hay clases. | feriado, 2026-11-01, sin materia |
| 8 | A | Examen de Cálculo I mañana. | examen, 2026-10-19, Cálculo I, sin hora inventada |
| 9 | A | Tengo que entregar la guía de Biología en dos semanas. | tarea, 2026-11-01, Biología |
| 10 | A | Cita de tutoría el lunes a las 3 de la tarde. | evento, 2026-10-19 15:00, sin materia |
| 11 | A | El parcial de Cálculo I es el 22 y el informe de Biología se entrega el 24. | Dos ítems: examen 22/10 y tarea 24/10 |
| 12 | A | Tengo laboratorio de Programación todos los martes durante tres semanas. | Tres ítems separados, fechas 20/10, 27/10 y 03/11; sin asumir etiqueta Laboratorio en config A |
| 13 | A | El quiz de Cálculo I es mañana a las 8. | quiz, 2026-10-19 08:00, Cálculo I |
| 14 | A | Reunión del club el 28 de octubre. | evento, 2026-10-28, sin materia |
| 15 | A | Examen de Cálculo I (Cálculo uno) el 29 de octubre. | examen, 2026-10-29, resolver nombre oficial |
| 16 | A | Examen de Matemática el viernes. | requiere ayuda, hay dos Matemática en semestres seleccionados |
| 17 | A | El examen es el 26 de octubre. | examen, sin materia, no inventar curso |
| 18 | A | Entrega el 31 de febrero. | requiere ayuda, fecha imposible |
| 19 | A | Reunión con el tutor el 27 de octubre. | evento, fecha 2026-10-27, hora null |
| 20 | A | Creo que quizá haya una prueba por ahí la próxima semana. | requiere ayuda, confianza baja o aclaración |
| 21 | B | Práctica de laboratorio de Biología el miércoles a las 10. | Laboratorio, base examen, 2026-10-21 10:00, Biología |
| 22 | B | Cumpleaños de Ana el 2 de noviembre. | Cumpleaños, base evento, 2026-11-02 |
| 23 | B | Reunión de equipo el jueves a las 16. | Reunión de equipo, base evento, 2026-10-22 16:00 |
| 24 | B | Práctica en laboratorio, edificio B, el 3 de noviembre. | Laboratorio, usando la ayuda del tipo, fecha 2026-11-03 |
| 25 | B | Examen de Biología el 4 de noviembre. | examen, 2026-11-04, Biología |
| 26 | B | Entrega del reporte de laboratorio el 5 de noviembre. | Preferir Laboratorio solo si la ayuda describe ese trabajo; si no, tarea y confianza media |
| 27 | C | Entrega del ensayo de Cálculo I el 26 de octubre. | ID vigente tarea renombrado Entrega, base tarea |
| 28 | C | Quiz de Programación el 27 de octubre. | requiere ayuda, quiz ya no está disponible; respaldo genérico Evento solo con revisión |
| 29 | C | Parcial de Biología el 28 de octubre. | examen, ID vigente, Biología |
| 30 | A | I have a midterm in Biology on October 24 at 10 a.m. | examen, 2026-10-24 10:00, Biología |
| 31 | A | J’ai un examen de Calcul I le 25 octobre. | examen, 2026-10-25, Cálculo I si coincide con alias configurado |
| 32 | A | Ho un quiz di Programmazione venerdì alle 11. | quiz, 2026-10-23 11:00, Programación |
| 33 | B | We have a lab practice in Biology on October 26. | Laboratorio, base examen, 2026-10-26, Biología |
| 34 | B | Réunion de l’équipe le 27 octobre à 15 h. | Reunión de equipo, 2026-10-27 15:00 |
| 35 | B | Il compleanno di Ana è il 2 novembre. | Cumpleaños, base evento, 2026-11-02 |
| 36 | B | Programación tiene práctica de laboratorio el 20 y el 27 de octubre. | Dos ítems Laboratorio, uno por fecha |
| 37 | A | El quiz y el examen final de Cálculo I son el 29 de octubre. | Dos ítems separados: quiz y examen, misma fecha |
| 38 | A | Cambia la modalidad de mi clase de Biología del jueves a virtual. | Acción editar_modalidad, ningún evento guardado en la cola |
| 39 | A | Examen de Matemática I, la del semestre actual, el 30 de octubre. | Resolver solo si el texto identifica un semestre sin ambigüedad; si no, requiere ayuda |
| 40 | B | En esta nota: [ ] entregar informe de Biología el 28; [ ] reservar laboratorio de Programación el 29 a las 9; [ ] reunión del grupo el 30 a las 14. | Tres elementos clasificados y validados por separado; confirmar si el contexto de cada uno no es suficiente |

## Criterio de aprobación manual

- Repetir las frases aplicables en cada configuración y revisar el id de etiqueta, la fecha, la hora y la materia.
- Los ids borrados o inventados nunca deben guardarse. Las fechas imposibles, materias ambiguas, acciones de edición y confianza baja deben quedar en ayuda.
- No se pudo probar contra Gemini ni en Android/escritorio desde esta edición. La cola y el micrófono requieren prueba real con una clave Gemini y permisos del dispositivo.
