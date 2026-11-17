# Agregar un idioma

La interfaz conserva el español como texto de origen. Los idiomas adicionales traducen esas frases mediante archivos JSON en esta carpeta. Si una traducción no existe, la aplicación muestra el texto original en español.

## Crear un idioma

1. Copia `espanol.json` y cambia el nombre del archivo, por ejemplo `ingles.json`.
2. Cambia `id`, `nombre` y `locale` en el archivo nuevo. Usa un código de idioma estándar, como `en`, `it` o `fr`.
3. En `traducciones`, conserva cada frase original como clave y escribe su traducción como valor. No cambies las claves.
4. Si una frase contiene `{variable}`, conserva ese marcador en la traducción en el lugar donde debe aparecer el dato variable.
5. Añade el idioma a la lista `idiomas` en `lista.json`, con su código, nombre visible y nombre de archivo.

Al volver a abrir la app, el idioma aparece en **Ajustes generales → Idioma**. La selección se guarda en ese dispositivo y navegador; no cambia el idioma de otros dispositivos.

## Usar el catálogo de traducción

También puedes completar la columna del idioma en `catalogo_traduccion_app_academica.xlsx`. Cuando esté lista, se puede convertir esa columna al archivo JSON con las claves de origen correspondientes. El código de la aplicación no necesita cambios para agregar traducciones.

## Por qué existe `lista.json`

Los navegadores no permiten que una página enumere por sí sola los archivos de una carpeta del servidor. `lista.json` registra los archivos disponibles para que la aplicación los pueda mostrar. Añadir un idioma requiere el JSON de traducción y su entrada en esa lista.
