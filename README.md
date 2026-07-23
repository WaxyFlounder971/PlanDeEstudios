# Iteración 0 — Cimientos

> Nota: esta versión incluye la ronda de ajustes finales de la Iteración 0
> (responsive móvil, sidebar colapsable, foto de perfil de Google, modal de
> enlaces, corrección de contraste en la paleta "Blanco" y fix del login en
> móvil). Si ya tienes tu Client ID pegado en `js/auth.js`, no necesitas
> repetir el Paso 2 ni el Paso 3 — solo vuelve a subir los archivos.

Esto es lo primero que vamos a poner a funcionar: iniciar sesión con Google, guardar tus datos en tu propio Drive, elegir paleta de color y modo claro/oscuro, y ajustar la escala de notas. Las secciones del menú (Plan de Estudios, Semestres, Horario, etc.) aparecen deshabilitadas — se activan en las próximas iteraciones.

Sigue estos pasos **en orden**. No necesitas saber programar, solo copiar y pegar donde se indica.

---

## Paso 1 — Sube estos archivos a tu repositorio de GitHub

1. Entra a tu cuenta de GitHub y crea un repositorio nuevo (puede ser público o privado). Ejemplo de nombre: `app-academica`.
2. Sube TODOS estos archivos manteniendo la misma carpeta:
   ```
   index.html
   css/design-system.css
   js/schema.js
   js/auth.js
   js/app.js
   README.md
   ```
   (En GitHub: botón "Add file" → "Upload files", arrastras la carpeta completa).
3. Ve a **Settings → Pages** de tu repositorio → en "Branch" selecciona `main` y guarda. GitHub te va a dar una URL parecida a:
   `https://tu-usuario.github.io/app-academica/`
   Anota esa URL exacta, la vas a necesitar en el paso 2.

---

## Paso 2 — Crea tu "Client ID" de Google (gratis, sin tarjeta)

Esto es lo que permite que TU app (y solo la tuya) le pida permiso a cada usuario para guardar su archivo de datos en su propio Drive.

1. Ve a [console.cloud.google.com](https://console.cloud.google.com) e inicia sesión con cualquier cuenta de Google.
2. Arriba a la izquierda, crea un proyecto nuevo (ej. nómbralo "App Academica").
3. En el buscador de arriba escribe **"Google Drive API"**, entra y presiona **Habilitar**.
4. Ve a **"APIs y servicios" → "Pantalla de consentimiento de OAuth"**:
   - Tipo de usuario: **Externo**.
   - Nombre de la app: lo que quieras (ej. "App Académica").
   - Correo de soporte: el tuyo.
   - En "Usuarios de prueba" (Test users) agrega los correos de Google de las personas de tu círculo cercano que van a usar la app (mientras no publiques la app oficialmente, solo estos correos podrán iniciar sesión — esto es normal y no cuesta nada).
5. Ve a **"APIs y servicios" → "Credenciales" → "Crear credenciales" → "ID de cliente de OAuth"**:
   - Tipo de aplicación: **Aplicación web**.
   - En **"Orígenes de JavaScript autorizados"** pega la URL de tu GitHub Pages del Paso 1 (ej. `https://tu-usuario.github.io`).
   - Guarda. Te va a mostrar un **Client ID** parecido a `123456789-abc.apps.googleusercontent.com`. Cópialo.

---

## Paso 3 — Pega tu Client ID en el código

1. Abre el archivo `js/auth.js`.
2. Busca esta línea casi al inicio:
   ```js
   const CLIENT_ID = "TU_CLIENT_ID_DE_GOOGLE.apps.googleusercontent.com";
   ```
3. Reemplaza el texto entre comillas por el Client ID que copiaste en el Paso 2.
4. Sube el archivo de nuevo a GitHub (reemplazando el anterior).

---

## Paso 4 — Prueba

1. Abre la URL de tu GitHub Pages en el navegador (celular o computadora).
2. Presiona "Iniciar sesión con Google" e inicia con una de las cuentas que agregaste como "usuario de prueba".
3. Google te va a mostrar una pantalla pidiendo permiso para "ver y administrar únicamente los archivos que creaste con esta app" — es normal, acéptalo.
4. Deberías ver la app con el menú lateral, el selector de paleta, el switch de modo claro/oscuro y el apartado de escala de notas.
5. Cambia de paleta o de modo y recarga la página — debe recordar tu elección.
6. Prueba "Añadir enlace" y agrega uno de prueba.
7. Ve a tu Google Drive (drive.google.com) — vas a ver un archivo nuevo llamado `app_academica_datos.json`. Ese es tu archivo de datos personal.

Si algo de esto no funciona, cuéntame exactamente en qué paso se atoró y seguimos desde ahí.

---

## ¿Qué sigue?

Con esto ya tenemos el terreno listo. La **Iteración 1** agrega el Plan de Estudios de verdad: importar tu malla curricular (con el prompt hacia una IA que ya tienes armado), verla por bloques, categorizarla a tu manera, y marcar materias como aprobadas.
