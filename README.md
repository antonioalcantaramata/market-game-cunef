# The Electricity Market Game · CUNEF Open Day

Web app for the workshop *What happens when companies agree to raise prices?*

Each team runs a power plant. In each round they offer a price. The market buys the cheapest offers
until demand is covered, and every team that sells is paid **its own offer** (pay-as-bid). All plants
are 100 MW with no costs: asking a lot pays more per MWh, but a cheaper team may take your place.

## Cómo funciona (todo gratis)

```
 Móviles, proyector, panel ──►  GitHub Pages (web estática)  ──►  Supabase (base de datos + lógica)
```

- **GitHub Pages** sirve la web: solo HTML y JavaScript, sin servidor.
- **Supabase** guarda los datos y ejecuta la lógica del juego como funciones de Postgres
  (`supabase/schema.sql`): casación del mercado, validación de ofertas, permisos.
- El navegador usa la clave pública de Supabase, pero las tablas están cerradas: solo puede llamar a
  las funciones del juego. Un equipo necesita su código; el panel de profesores, la contraseña.
  Nadie ve las ofertas de otros equipos hasta que se cierra la ronda.

## Pantallas

| URL | Quién | Para qué |
|---|---|---|
| `/` | Todos | Alumnos: introducir el código. Abajo, accesos a *Instructor panel* y *Projector screen* |
| `/g/?code=CODE` | Cada equipo (móvil) | Ficha, enviar oferta, ver resultados |
| `/admin/` | Profesores | Crear sesiones (contraseña) |
| `/admin/session/?id=ID` | Profesores | Abrir y cerrar rondas, ver ofertas en directo, descargar datos |
| `/admin/cards/?id=ID` | Profesores | Tarjetas imprimibles con QR de cada equipo |
| `/screen/` | Proyector | Lista de sesiones recientes para elegir cuál proyectar (sin contraseña) |
| `/screen/?id=ID` | Proyector | Sala de espera → ronda abierta → resultados, cambia sola |

## Puesta en marcha (una vez, ~15 minutos)

> Guía detallada paso a paso, con comprobaciones y solución de problemas: [docs/supabase-setup.md](docs/supabase-setup.md).

### 1. Supabase (base de datos)
1. Crea una cuenta gratuita en [supabase.com](https://supabase.com) y un proyecto nuevo
   (región *West EU*, plan *Free*).
2. En **SQL Editor**, pega el contenido completo de [`supabase/schema.sql`](supabase/schema.sql) y pulsa *Run*.
3. En el mismo editor, fija la contraseña del panel de profesores:
   ```sql
   select set_admin_password('elige-una-contraseña');
   ```
4. En **Project Settings → API Keys** (o *Connect*), copia:
   - la **Project URL** (`https://xxxx.supabase.co`)
   - la clave **publishable** (`sb_publishable_…`) o, en proyectos antiguos, la **anon** (`eyJ…`).
     Es pública por diseño; no uses nunca la *secret* / *service_role*.

### 2. GitHub (web)
1. Crea un repositorio **público** (GitHub Pages es gratis en repositorios públicos) y sube esta carpeta:
   ```bash
   git remote add origin https://github.com/<usuario>/<repo>.git
   git push -u origin main
   ```
2. En el repositorio: **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → pestaña Variables**, crea:
   - `SUPABASE_URL` = la Project URL
   - `SUPABASE_ANON_KEY` = la clave publishable/anon
4. Ve a **Actions** y lanza *Deploy to GitHub Pages* (o haz cualquier push a `main`).
   En 1–2 minutos la web estará en `https://<usuario>.github.io/<repo>/`.

Cada push a `main` vuelve a pasar los tests y publica la web.

### Importante antes del evento
- Supabase **pausa los proyectos gratuitos tras 7 días sin uso**. Unos días antes, entra en el panel de
  Supabase (si está pausado, pulsa *Restore*) y haz una prueba completa.
- Para cambiar la lógica del juego, edita `supabase/schema.sql` y vuelve a ejecutarlo entero en el
  SQL Editor: es idempotente y conserva los datos.

## El día del taller

1. Entra en `/admin/` y crea la sesión con **más equipos de los esperados**
   (por ejemplo 12). Imprime las tarjetas (*Print team cards*) y reparte solo las que hagan falta.
2. **La demanda se ajusta sola a los equipos que juegan**: cuenta solo los que han abierto su página
   (punto verde en el panel) y se fija al abrir cada ronda. Las tarjetas sin usar no cuentan y no hay
   que borrarlas. Si llega un grupo tarde, *+ Add team* y le das el código del panel; contará desde la
   siguiente ronda. Si un equipo se va a mitad de partida, pulsa *pause*: deja de contar y no puede pujar
   (*resume* lo devuelve).
3. En el ordenador del proyector, abre la web, pulsa *Projector screen* (abajo en la página de inicio) y
   elige la sesión: no hace falta contraseña ni copiar enlaces. Pon el navegador a pantalla completa.
   La pantalla muestra el QR y qué equipos se han conectado; espera a que estén todos antes de abrir
   la ronda de práctica.
   **Diapositivas en el proyector:** en la vista proyector, mueve el ratón y aparece un menú abajo a la
   derecha. *Load PDF* (o arrastra el PDF a la pantalla) carga tu presentación; se guarda solo en ese
   navegador, no se sube a ningún sitio, y sigue ahí si recargas la página. Puedes cargar varios PDF y
   elegir cuál mostrar.
   - **→ / ← / AvPág / RePág** (o el mando de presentaciones): siguiente / anterior diapositiva.
   - **G** (o el botón de «pantalla en negro» del mando, que envía B o «.»): cambia entre diapositivas y juego.
   - **S**: muestra u oculta el **resumen** (también en el menú: *Game | Summary | Slides*). Tras la parte 1
     resume sus rondas (precio medio, todas las ofertas ronda a ronda, tabla), sin nombres. Cuando hay
     rondas de la parte 2, pasa a **Parte 1 vs Parte 2**: precio medio y pago de los consumidores antes y
     después, comparación por hora, todas las ofertas y «Who broke the deal?» (quién ofreció por debajo del
     precio más común de la parte 2). Arriba a la derecha puedes volver al resumen de la parte 1.
   - **A**: **análisis estadístico** (el de Elena), también en el menú (*Analysis*). Se abre cuando hay al menos una
     ronda de la parte 2. Cinco pasos que avanzan con el mando (→ siguiente o termina la animación,
     ← atrás, **R** repite): (1) la oferta de cada equipo ronda a ronda; (2) el ordenador busca el punto de
     cambio en las ofertas (distancia de energía, `ecp::e.divisive`) y lo compara con el inicio de los acuerdos;
     (3) la misma prueba sobre los beneficios; (4) de dónde sale el p-valor: se barajan las rondas 200 veces;
     (5) oferta frente a beneficio, ronda a ronda. Cada cambio se presenta como significativo al 5 %, al 10 %
     (si no llega al 5 %) o no significativo.
     Los cálculos reproducen exactamente `collusion_test.R` (mismos números aleatorios que R con
     `set.seed(123)`); `scripts/analysis.test.mjs` lo comprueba con los resultados de R.
     **Juego de ejemplo (respaldo):** con **E** (o el interruptor *This game | Example game*) se muestra un
     juego simulado de 7 + 7 rondas con resultados claros, por si los de la sesión real salen raros. En
     pantalla aparece marcado como «Simulated data · not today's session». Es el mismo juego que
     `data-for-elena/demo-full-game` y está en `lib/backup-game.json`.
   - El juego sigue actualizándose mientras se ven las diapositivas, y cada presentación recuerda en qué
     diapositiva estabas: al volver no se pierde nada. ⛶ pone la pantalla completa.
   - Las animaciones de PowerPoint no se conservan en el PDF; si las necesitas, exporta cada paso como
     una diapositiva.
4. Abre las rondas una a una desde el panel. Por defecto: 1 de práctica, 7 de competencia y
   7 con acuerdos (las mismas 7 horas del día y la misma demanda, para comparar). La demanda es un %
   de la capacidad total y se puede editar antes de abrir cada ronda. Son 15 rondas de 45 segundos
   por defecto (unos 11 minutos pujando, más el tiempo de comentar cada resultado). El tiempo se cambia al
   crear la sesión o en *Settings*, y con *+30 s* puedes alargar una ronda concreta.
   **Demanda incierta (opcional):** en la columna *Demand · ±🎲* puedes poner una incertidumbre por ronda
   (por ejemplo ±10 %), o aplicarla a todas las rondas pendientes desde *Settings*. Los equipos y el
   proyector ven solo la previsión («324–396 MW»); la demanda real se sortea al abrir la ronda (tú la ves
   en el panel) y se revela al cerrarla. Con 0 % la demanda es exacta, como por defecto.
5. *Close & clear market* cierra la ronda, casa el mercado y muestra los resultados en el proyector.
6. Descarga los datos (*Download data*), en CSV:
   - `results`: una fila por ronda y equipo (oferta, vendido, precio cobrado, ingresos/beneficio,
     precio medio y oferta más cara comprada). Es el fichero para el análisis.
   - `bid_log`: todas las ofertas enviadas, también las corregidas, con segundos desde la apertura.
   - `rounds`, `groups`.

## Reglas del juego (para el ponente)

- **Pago según oferta (pay-as-bid):** todas las centrales tienen 100 MW, sin costes; la cantidad no se
  elige. Cada equipo que vende cobra su propia oferta: ingresos = su precio × MWh vendidos.
- «Precio medio» de la ronda = media de lo pagado, ponderada por MWh (lo que se dibuja en la
  evolución de precios). También se guarda la oferta más cara comprada (`marginal_price`).
- Demanda sin elasticidad. Precio máximo configurable (200 €/MWh por defecto).
- Se compran las ofertas de la más barata a la más cara hasta cubrir la demanda.
- Empates en el precio marginal: la demanda que queda se reparte a partes iguales (a prorrata).
  Así, si todos pactan el precio máximo, todos venden algo; y quien rebaja aunque sea 1 € vende su
  planta entera (la tentación del cártel).
- **Tope de demanda:** la demanda (y el máximo de la previsión, si hay incertidumbre) nunca supera la
  capacidad de los equipos que juegan menos la central más grande. Siempre sobra al menos una central
  entera: con precios distintos, el equipo más caro no vende nada. Si varios empatan arriba, se reparten
  lo que queda. El panel marca *capped* en las rondas donde se aplica.
- **Parte 1 anónima:** tras cada ronda de práctica o de la parte 1, los alumnos y el proyector ven todas las
  ofertas, pero las de los demás equipos aparecen como «Company A, B, C…», con letras que se barajan en
  cada ronda (el anonimato viene de la base de datos, no solo de la pantalla). Tampoco se publican
  rankings con nombres: cada equipo ve en su móvil su total y su posición. En la parte 2 las ofertas y
  los rankings aparecen con nombre, porque un cártel necesita saber quién rompe el acuerdo. El panel de
  profesores lo ve todo siempre.
- **«What if»:** tras cada ronda, cada equipo ve en su móvil qué habría pasado si hubiera pedido 1 € menos
  o 1 € más (con las demás ofertas iguales).
- La ronda de práctica no suma al ranking.
- Demanda incierta: con ±X % la demanda real es un número entero de MW sorteado de forma uniforme
  entre la previsión mínima y la máxima. Se guarda (`demand_low`, `demand_high`, `demand_mw`) en los CSV.

## Desarrollo local

```bash
npm install
npm run dev     # web en http://localhost:3000 + base de datos local en :54321 (contraseña: admin)
npm test        # tests del mercado y de la base de datos
```

En local no hace falta Supabase: `scripts/dev-api.mjs` ejecuta el mismo `supabase/schema.sql` en
PGlite (Postgres en WebAssembly) y responde como la API de Supabase. Los datos quedan en `.data/`;
bórrala para empezar de cero.

| Fichero | Contenido |
|---|---|
| `supabase/schema.sql` | Tablas, permisos y toda la lógica del juego (funciones RPC) |
| `lib/api.ts` | Llamadas del navegador a Supabase |
| `lib/views.ts` | Convierte los datos en lo que muestra cada pantalla |
| `lib/game.ts` | Textos de las fases; implementación de referencia de la casación (los tests comprueban que coincide con la de SQL) |
| `lib/analysis.ts`, `lib/rrandom.ts` | Parte 3: el análisis de Elena (`collusion_test.R`) y el generador aleatorio de R |
| `components/part3.tsx` | Las cuatro pantallas animadas de la parte 3 |
| `scripts/*.test.*` | Tests |
