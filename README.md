# DIGESTA — Mi Diario Digestivo

Aplicación web personal, instalable en Android (PWA), para registrar comidas, bebidas, suplementos, deposiciones y síntomas digestivos, y reconocer patrones de tolerancia alimentaria con el paso de las semanas.

- **Privada**: todo se guarda en el teléfono (IndexedDB). Sin cuentas, sin publicidad, sin rastreadores, sin servidores.
- **Sin conexión**: después de abrirla una vez, funciona sin internet.
- **En español de Colombia**, fechas locales y reloj de 12 horas.
- **No diagnostica**: muestra asociaciones observadas en tus registros, nunca intolerancias confirmadas.

---

## 1. Iniciar el proyecto

Requisitos: [Node.js](https://nodejs.org) 20 o superior (probado con Node 22).

```bash
git clone https://github.com/Adictoz132413/Digesta.git
cd Digesta
npm install          # instala dependencias (una sola vez)
npm run dev          # servidor de desarrollo → http://localhost:5173
```

Otros comandos:

| Comando | Qué hace |
|---|---|
| `npm test` | Ejecuta las pruebas (persistencia, respaldo/importación, CSV, reglas de análisis, alertas, recordatorios, datos demo). |
| `npm run typecheck` | Verifica tipos de TypeScript. |
| `npm run build` | Genera la versión de producción en `dist/` (incluye service worker y manifiesto PWA). |
| `npm run preview` | Sirve la versión compilada en http://localhost:4173 para probarla. |
| `npm run icons` | Regenera los iconos PNG a partir del diseño SVG (usa Chromium de Playwright). |

## 2. Instalarla en tu celular Android

Una PWA sólo se puede instalar si se abre desde **HTTPS** o desde **localhost**. Tienes tres caminos (todos gratuitos):

### Opción A — Publicarla gratis (recomendada para uso diario)

1. Ejecuta `npm run build`. Se crea la carpeta `dist`.
2. Súbela a un hosting estático gratuito, por ejemplo:
   - **Netlify Drop**: entra a <https://app.netlify.com/drop> y arrastra la carpeta `dist`.
   - **Cloudflare Pages** o **Vercel**: crea un proyecto y sube la carpeta `dist`.
   - **GitHub Pages** (lo más simple con este repositorio): activa *Settings → Pages → Source: GitHub Actions*. El flujo `.github/workflows/pages.yml` prueba, compila y publica en cada push a `main` (o ejecútalo a mano en *Actions*). Quedará en `https://adictoz132413.github.io/Digesta/`. Es gratis en repositorios públicos; en privados requiere un plan de pago.
3. En el celular abre la dirección HTTPS con **Chrome**.
4. Toca el menú **⋮ → Instalar aplicación** (o «Agregar a la pantalla principal»).
5. Abre DIGESTA desde el icono. A partir de aquí funciona sin internet.

> El hosting sólo entrega los archivos de la aplicación. **Tus registros nunca se suben**: se quedan en tu teléfono.

### Opción B — Desde tu computador por cable USB (sin publicar nada)

1. Activa las *Opciones de desarrollador* y la *Depuración USB* en el celular.
2. En el computador: `npm run build && npm run preview`.
3. Conecta el celular y ejecuta `adb reverse tcp:4173 tcp:4173` (Android Platform Tools).
4. En Chrome del celular abre `http://localhost:4173` e instala desde el menú **⋮**.

### Opción C — Probar en la misma red Wi‑Fi

`npm run dev` muestra una dirección tipo `http://192.168.x.x:5173`. Sirve para **probar** la interfaz, pero Chrome no permite instalarla ni usarla sin conexión desde una dirección HTTP que no sea localhost.

### Actualizaciones

Cuando publiques una versión nueva, la app mostrará «Hay una nueva versión de DIGESTA» con el botón **Actualizar**. También puedes ir a **Ajustes → Acerca de → Buscar actualización** cuando quieras; ahí se ve la fecha de la versión instalada. Tus datos se conservan.

## 3. Uso diario en pocos segundos

- **Hoy**: botones grandes para *Agregar comida*, *Registrar deposición* y *Registrar síntoma*; resumen del día, hidratación, factores (estrés, sueño, ejercicio), síntomas en curso con botón «Ya pasó» y la pregunta de cierre *¿Cómo estuvo tu digestión hoy?*
- **Comida**: escribe o toca alimentos frecuentes → Guardar. La hora y el tipo de comida se sugieren solos. Cantidad, preparación, ingredientes, café/lácteos/picante/grasas/alcohol, suplementos, foto, notas y sensación son opcionales. Puedes **repetir** favoritas o comidas recientes y **duplicar** cualquier comida.
- **Deposición**: toca el tipo de Bristol → Guardar. Color, cantidad, urgencia, esfuerzo, dolor, evacuación incompleta, moco, sangre y notas son opcionales.
- **Síntoma**: toca uno o varios, ajusta la intensidad 0–10 → Guardar. Ubicación en el mapa abdominal, duración o fin y observaciones son opcionales.
- Atajos: mantén presionado el icono de la app en Android para ir directo a *Voz*, *Comida*, *Deposición* o *Síntoma*.

### Asistente de voz

Toca **Contar por voz** (en Hoy) o el micrófono flotante y habla con naturalidad:

> «Almorcé a la una arroz, fríjoles bastantes y carne asada, me cayó pesado»
> «Hace una hora me dio agrieras fuerte» · «Fui al baño y salió suelta, con un poquito de sangre en el papel»
> «Tomé 3 vasos de agua» · «Quita el pan» · «Fue a las 8» · «Guárdalo»

El asistente organiza la ficha (tipo de comida, hora, alimentos, cantidades, preparación, ingredientes, sensación, síntomas con intensidad, ubicación y duración, deposición con Bristol, sangre, color, urgencia y dolor) y **sólo pregunta lo que falta**: la hora si no coincide, el tamaño de las porciones, cómo te sentiste, la intensidad de un síntoma, el tipo de Bristol o si un alimento que no conoce es realmente un alimento. Puedes responder hablando o tocando las opciones, corregir sobre la marcha y guardar cuando quieras. Lee sus respuestas en voz alta y, en modo *conversación continua*, vuelve a escuchar solo.

**Preguntas sobre tu diario.** El asistente distingue cuando preguntas en vez de registrar y te responde con tus datos:

> «Recuérdame si ayer comí salchipapa» → «Sí. Ayer comiste salchipapa en la cena a las 7:00 p. m. Después registraste acidez 6/10…»
> «¿Qué cené el sábado?» · «¿Cuándo fue la última vez que comí leche?» · «¿Cuántas veces comí fríjoles esta semana?»
> «¿Qué síntomas tuve ayer?» · «¿Cuántas veces fui al baño hoy?» · «¿Cómo estuvo mi digestión la semana pasada?» · «¿Cuánta agua tomé ayer?»

Entiende hoy, ayer, antier, días de la semana («el jueves»), fechas («el 3 de noviembre»), «esta semana», «la semana pasada», «este mes» y «los últimos N días», y busca también los alimentos que fueron ingredientes de una preparación.

**Recordatorios.** «Recuérdame en 2 horas tomar la creatina», «avísame a las 9 de la noche que tome agua», «recuérdame mañana a las 8 registrar el desayuno», «recuérdame todos los días a las 7 de la mañana tomar el omeprazol». Si no dices la hora, te pregunta cuándo. Los ves y borras en *Ajustes → Recordatorios del asistente*. Como toda app web, sólo puede avisar mientras la app está abierta o en segundo plano; si estaba cerrada, te muestra el aviso al abrirla.

**Privacidad de la voz.** La interpretación (`src/voice/nlu.ts` y `src/voice/dialog.ts`) se hace con reglas y diccionarios en el teléfono: ningún texto se envía a un servicio de IA. La conversión de **voz a texto** la hace Chrome: si el teléfono permite reconocimiento en el dispositivo, se usa; si no, Chrome puede enviar el audio a Google, y la app lo explica y pide permiso antes del primer uso. Alternativa 100 % local: el micrófono del teclado (Gboard) con dictado sin conexión, escribiendo en el campo del asistente.

### Hidratación a tu manera

En Hoy (o en Ajustes) eliges cómo tomas agua:

- **A sorbos** (predeterminado): si tomas agua poco a poco durante el día, basta con un estimado de un toque: *poca*, *normal* o *bastante*.
- **En botella**: eliges el tamaño de tu botella (500 ml a 1,5 L) y sumas cuartos o medias botellas.
- **Por vasos**: vasos de unos 250 ml con una meta diaria.

Por voz también funciona: «hoy tomé poca agua», «me tomé media botella de agua», «tomé agua a sorbos» (y el asistente te pregunta cuánta en total).

### Ayuno intermitente

Desde **Hoy → Ayuno intermitente** puedes planear un día de ayuno y seguirlo:

- **Precauciones primero**: la primera vez se muestran los casos en que no conviene ayunar sin orientación profesional (embarazo o lactancia, diabetes con insulina o hipoglucemiantes, trastornos de la conducta alimentaria, bajo peso, menores de 18, enfermedad renal, hepática o cardíaca) y las señales para romper el ayuno de inmediato.
- **Plan del día**: eliges 12:12, 14:10, 16:8, 18:6 o tus propias horas (8–24 h) y la hora de tu última comida («Esta noche 8:00 p. m.»), y la app te muestra a qué hora puedes volver a comer y hasta cuándo va la ventana de comida. Puedes empezarlo ya o programarlo.
- **Temporizador** con la fase aproximada en la que estás, avisos al empezar un ayuno programado y al cumplir la meta (con permiso de notificaciones, mientras la app esté abierta).
- **Romper el ayuno**: al registrar una comida que lo rompe (por formulario o por voz), DIGESTA lo termina sola a esa hora; agua, tinto o aromática sin azúcar no lo rompen. Al terminarlo puedes anotar hambre, energía y cómo te fue.
- **Tu digestión y el ayuno**: compara las molestias después de la comida que rompe el ayuno con las de tus otras comidas, y los días con y sin ayuno (síntomas, digestión, heces blandas o duras).
- **Por voz**: «empiezo el ayuno», «empecé a ayunar a las 8 de la noche», «rompí el ayuno con una arepa y un tinto».
- Guía con qué tomar durante el ayuno, cómo romperlo sin molestias y consejos si entrenas. Los ayunos se incluyen en la copia de seguridad, el CSV y el informe.

Lo que dice la evidencia (resumen usado en la app):

- Para bajar de peso, el ayuno intermitente rinde en general igual que reducir calorías sin horario ([metaanálisis en red de 99 ensayos, BMJ 2025;389:e082007](https://sciencemediacentre.es/en/node/5424); [revisión en mujeres, Frontiers in Nutrition 2025](https://www.frontiersin.org/journals/nutrition/articles/10.3389/fnut.2025.1664412/full)).
- El paso de glucosa a grasa y cetonas ocurre entre ~12 y 36 h y varía entre personas ([Anton y col., *Flipping the Metabolic Switch*, Obesity 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5783752)); la idea de que la autofagia «empieza a las 16 h» no está demostrada en humanos.
- Con entrenamiento de fuerza y proteína suficiente, el 16:8 fue compatible con ganar músculo ([JISSN 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12006946/)).
- El resumen de congreso de 2024 que asoció ventanas de 8 h con más mortalidad cardiovascular fue muy criticado por sus limitaciones ([respuesta colectiva de investigadores](https://cms.ahs.uic.edu/inside-ahs/wp-content/uploads/sites/12/2024/04/Collective-Reponse-to-AHA-press-release-on-TRE.pdf)).
- En la digestión hay poca evidencia y mucha variación individual; comidas grandes al romper el ayuno pueden dar hinchazón y el ayuno puede empeorar reflujo o estreñimiento en algunas personas. Por eso DIGESTA lo mide con tus propios datos.

## 4. Cómo funciona el análisis de patrones

El motor (`src/analysis/engine.ts`) corre 100 % en el teléfono:

1. Cada comida genera **exposiciones** a cada alimento y a cada ingrediente de las preparaciones.
2. Los **episodios** son síntomas con intensidad ≥ umbral (3 por defecto, ajustable), deposiciones Bristol 6–7 o 1–2 y el malestar marcado justo al comer.
3. Para cada alimento y síntoma se revisan las **ventanas** que corresponden al tipo de síntoma: 0–6 h (acidez, náuseas, pesadez…), 6–24 h (gases, hinchazón, diarrea…) y 24–72 h (estreñimiento, heces duras). Sólo se cuentan comidas cuya ventana ya terminó.
4. Se compara la tasa «comidas con el alimento seguidas del síntoma» con la **línea base** de comidas sin ese alimento.
5. Reglas conservadoras:
   - **Observación aislada**: menos de 3 exposiciones o menos de 2 episodios. Nunca se saca una conclusión de una sola comida.
   - **Posible asociación**: ≥ 3 exposiciones, ≥ 2 episodios, ≥ 30 % y al menos 10 puntos por encima de la línea base.
   - **Patrón repetido**: ≥ 4 exposiciones, ≥ 3 episodios, ≥ 50 % y al menos 20 puntos por encima de la línea base.
6. Se informan **factores de confusión**: otros alimentos presentes casi siempre, porciones abundantes, frituras, estrés alto, poco sueño, alcohol y otras comidas dentro de la ventana.
7. Se detecta si un alimento parece **tolerarse mejor en poca cantidad o con otra preparación**.
8. Puedes **comparar días con y sin** un alimento (síntomas, intensidad, digestión, deposiciones).

Ejemplo de resultado: *«Consumiste leche en 8 ocasiones. Registraste hinchazón entre 0 y 6 horas después en 5 de ellas. En las comidas sin leche ocurrió después del 8 % (1 de 12). Es un patrón que se repite y vale la pena comentarlo con un profesional, pero no confirma una intolerancia.»*

La ficha de tolerancia de cada alimento muestra la **sugerencia automática** (Tolero bien / Tolero a medias / Posible mala tolerancia / Sin datos suficientes) separada de **tu clasificación manual**, que nunca se sobrescribe.

## 5. Privacidad y seguridad

**Qué protege el almacenamiento local**
- Tus datos no salen del dispositivo: no hay servidor, cuenta, analítica ni publicidad.
- La versión publicada incluye una política de seguridad de contenido (CSP) que impide conexiones a servidores externos.
- La base de datos sólo es accesible desde el origen (dirección) donde instalaste la app.

**Qué NO protege**
- Cualquier persona con acceso a tu teléfono desbloqueado puede abrir la app.
- Borrar los datos de Chrome/del sitio o desinstalar la app **elimina todos los registros**. Haz copias de seguridad.
- No hay cifrado adicional más allá del cifrado del propio teléfono.
- Los archivos que exportes (JSON, CSV, PDF) no están cifrados: guárdalos con cuidado.
- Si pierdes el teléfono sin copia de seguridad, pierdes los datos.

Desde **Ajustes** puedes: exportar e importar una copia completa en JSON (incluye fotos), exportar CSV, ver el espacio usado, borrar fotos y **eliminar todos los datos** (con confirmación escrita). Las fotos se comprimen en el teléfono (WebP/JPEG, lado máximo configurable).

## 6. Datos de demostración

En *Ajustes → Modo demostración* se abre una base **separada** (`digesta-demo`) con 60 días de datos ficticios y patrones sembrados (leche → hinchazón, fríjoles abundantes → gases, ají → acidez) y ayunos 16:8 cada cuatro días. Una franja ámbar lo indica siempre. Tus datos reales (`digesta`) no se tocan; al salir vuelves a ellos.

## 7. Precauciones médicas

DIGESTA es un diario de seguimiento. No diagnostica enfermedades ni recomienda eliminar grupos de alimentos. Si registras sangre en las heces, heces negras tipo alquitrán, dolor abdominal intenso o persistente, vómito intenso o diarrea muy frecuente, la app muestra una recomendación prudente según la gravedad. Ante una urgencia en Colombia llama al **123**.

## 8. Arquitectura

```
Digesta/
├─ .github/workflows/pages.yml     pruebas + publicación en GitHub Pages
├─ index.html, vite.config.ts      PWA (vite-plugin-pwa/Workbox), CSP en producción
├─ public/                          iconos, theme-init.js, sw-notifications.js
├─ src/
│  ├─ domain/       tipos, etiquetas, catálogo de alimentos colombianos, fechas es-CO, alertas médicas
│  ├─ db/           Dexie (IndexedDB), validación zod, repositorio, respaldo JSON, CSV, datos demo
│  ├─ analysis/     motor de asociaciones, estadísticas y hooks reactivos
│  ├─ components/   UI accesible (Radix Dialog), ilustraciones Bristol y mapa abdominal
│  ├─ features/     today, diary, entries (formularios), assistant (voz), fasting (ayuno), tolerance, patterns, calendar, reports, settings
│  ├─ voice/        intérprete de lenguaje local (nlu), motor de diálogo y voz (reconocimiento/lectura)
│  └─ lib/          enrutador por hash, tema, fotos, descargas, recordatorios
└─ tests/           Vitest + fake-indexeddb
```

Tecnologías: React 19, TypeScript, Vite, Tailwind CSS 4, Dexie 4, Recharts, Radix UI, Zod, Lucide. Sin APIs de pago ni costos recurrentes.
