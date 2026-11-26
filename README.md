# Investment Edge Platform (IEP)

Análisis de acciones de EE. UU. en lenguaje simple: entiende el negocio con 10 años de datos de la SEC, escribe tu tesis con lo que te haría cambiar de idea y te avisamos cuando pase. En español e inglés, en el móvil, la tablet y el ordenador.

*US stock analysis in plain language: understand the business from 10 years of SEC data, write your thesis with what would change your mind, and get told when it happens. ES/EN.*

## Funciones

- **Mi análisis** (inicio): tus tesis con el precio de hoy frente a tu valor razonable, lo que tienes de cada acción y tus lienzos.
- **Página de cada acción**: lo esencial del negocio en frases (10 años de 10-K de la SEC, ajustados por splits), estados financieros anuales y trimestrales con su fuente, frente a su industria, valoración (qué crecimiento descuenta el precio, comparables y múltiplos frente a su historia de 5 años), filings, insiders y noticias.
- **Mi análisis de una acción**: un plan guiado en 3 pasos (por qué te interesa, qué te haría cambiar de idea, cuánto arriesgar), operaciones y notas con fecha.
- **Tesis vivas**: tu stop, objetivo, valor razonable, fecha de revisión y condiciones propias se revisan varias veces al día; los avisos llegan a la app y al teléfono (Web Push).
- **Trading Canvas** (`/canvas`): gráficos de TradingView y tu análisis en el mismo lienzo, con ventanas enlazadas por empresa.
- **Buscador de empresas** (`/screener`) con filtros sobre datos de la SEC, **lista** de seguimiento y **paleta de comandos** (Ctrl/⌘ K).
- Español e inglés, tema claro y oscuro, accesible (teclado, lectores de pantalla, contraste AA) y sin scroll horizontal desde 320 px.

## Stack

Next.js (App Router) · React · TypeScript · Tailwind CSS · Postgres (Neon) · Redis (Upstash) · gráficos de [TradingView](https://www.tradingview.com/widget/) · datos de la [SEC](https://www.sec.gov/edgar) y de [Financial Modeling Prep](https://site.financialmodelingprep.com/developer/docs) (plan gratuito: 250 llamadas al día).

Las claves solo se usan en el servidor. Las respuestas de FMP se cachean y se cuentan por endpoint (`/stats`) para no agotar el plan.

## Uso local

```bash
npm install
```

```bash
cp .env.example .env.local   # añade tu FMP_API_KEY (opcional)
```

```bash
npm run dev
```

Sin `FMP_API_KEY` la app funciona en **modo demo** con datos simulados.

Para desarrollar sin la pantalla de beta, añade `BETA_GATE=off` a `.env.local`.

## Beta privada

Mientras se firma la licencia de display de FMP, el sitio solo es accesible con un código de invitación (`src/proxy.ts`):

- Los códigos están en la variable `BETA_INVITE_CODES` de Vercel, separados por comas y con etiqueta opcional: `david:IEP-XXXX-XXXX-XXXX,ana:IEP-YYYY-YYYY-YYYY`.
- **Invitar a alguien:** añade un código nuevo y vuelve a desplegar.
- **Revocar un acceso:** borra su código y vuelve a desplegar; esa persona tendrá que pedir otro código.
- Sin códigos configurados, nadie puede entrar. Con `BETA_GATE=off`, el sitio es público.
- Durante la beta, el sitio no se indexa (`robots.txt` y cabecera `X-Robots-Tag`).

## Datos y servicios

| Servicio | Para qué | Variables |
| --- | --- | --- |
| Financial Modeling Prep | Cotizaciones, precios históricos, bono del Tesoro a 10 años y prima de riesgo | `FMP_API_KEY`, `FMP_DAILY_LIMIT` |
| Neon (Postgres) | Lista de valores de la SEC, búsqueda local | `STORAGE_DATABASE_URL` |
| Upstash (Redis) | Límite de solicitudes por IP, contador diario de llamadas a FMP | `KV_REST_API_URL`, `KV_REST_API_TOKEN` |
| SEC EDGAR | Lista de empresas, estados financieros (XBRL), acciones en circulación, datos sectoriales (pública) | `SEC_USER_AGENT` (con un email de contacto, como pide la SEC) |
| Web Push | Avisos en el teléfono | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (opcionales: si faltan se crean una vez en la base de datos) |
| Claude (Anthropic) | Explicaciones con IA (opcional; sin clave el panel no aparece) | `ANTHROPIC_API_KEY`, `CLAUDE_DAILY_LIMIT` |

- Cada build aplica las migraciones de `drizzle/` y carga la lista de la SEC si está vacía o tiene más de 7 días (`scripts/db-setup.ts`). Un cron diario la refresca (`/api/cron/securities`, protegido con `CRON_SECRET`).
- Datos sectoriales (ratios con percentiles): el build y un cron diario (`/api/cron/sec-metrics`) cargan cada semana los datos anuales de todas las cotizadas desde los «frames» de la SEC (`company_metrics`) y rellenan poco a poco el código SIC de cada empresa, de mayor a menor (≈ 8 consultas/s, por debajo del límite de 10/s de la SEC).
- Valoración (dentro de la beta porque usa precios de FMP): **Comps** interactivos (`/api/valuation/comps`): pares sugeridos por industria (SIC) y tamaño parecido, o elegidos por el usuario, todos sobre el mismo año fiscal de la SEC; valor de mercado = acciones de la portada del último informe a la SEC × precio (los pares usan el precio guardado de hasta un día para ahorrar consultas a FMP; sin precio, el usuario puede escribirlo y se guarda solo en su navegador); mediana, percentiles 25–75 y valor implícito por acción solo con al menos 4 pares con el dato. **Qué descuenta el precio** (`/api/valuation/[symbol]`): DCF inverso que busca el crecimiento anual de los ingresos que iguala el valor al precio de hoy, con márgenes de los últimos 12 meses y WACC por componentes (beta de 5 años frente a SPY); el modelo está verificado contra `scripts/reference/dcf_reference.py` (diferencia ≤ 0,5 % en 5 tickers). **Histórico** (mismo endpoint): P/E, EV/EBITDA, P/S, P/B y rentabilidad del FCF de cada cierre de mes de los últimos 5 años, con mediana, media ± 1 desviación típica, percentil, desviaciones frente a la media y el precio que daría volver a la mediana (en EV/EBITDA con la deuda neta de hoy fija). En el plan gratuito de FMP solo un grupo de acciones grandes tiene precio y el historial de capitalización cubre 1 mes, por eso el historial de múltiplos se reconstruye con cierres ajustados por splits × acciones de la SEC.
- Insiders (`/api/sec/insiders/[symbol]`, datos públicos): formularios 4 de la SEC leídos de forma incremental en Postgres (solo los nuevos), con compras, ventas discrecionales y ventas programadas (10b5-1) de 12 meses.
- `/stats` (para las etiquetas de `ADMIN_LABELS`) muestra el uso del producto y las llamadas a FMP del día por endpoint.
- `GET /api/health` muestra el estado de la base de datos, Redis y el uso diario de FMP (sin datos de mercado; queda fuera de la beta para monitoreo).
- Para cambiar el esquema: edita `src/db/schema.ts` y ejecuta `npm run db:generate`.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Build y servidor de producción |
| `npm run start:demo` | La app con datos de demostración en http://localhost:3123 |
| `npm test` | Tests unitarios (vitest) |
| `npm run typecheck` / `npm run lint` | Tipos y linter |
| `npm run e2e` | Recorridos en el navegador sobre datos de demostración (ver `e2e/README.md`) |

## Deploy en Vercel

1. Importa el repo en [vercel.com/new](https://vercel.com/new) y conecta Neon (Postgres) y Upstash (Redis) desde el Marketplace.
2. Añade `FMP_API_KEY`, `BETA_INVITE_CODES`, `CRON_SECRET`, `SEC_USER_AGENT` y `ADMIN_LABELS` (y, si quieres, `ANTHROPIC_API_KEY`). Marca las claves como *sensitive*.
3. Deploy. Cada build aplica las migraciones y carga los datos de la SEC.

## Estructura

```
src/app/            páginas (inicio, /stock/[ticker], /canvas, /watchlist, /screener) y rutas API
src/components/     vistas (home/, research/, canvas/, valuation/, ui.tsx con las piezas comunes)
src/lib/            datos (fmp.ts, sec*.ts, data.ts), cálculos y máquinas de estado, con sus tests
src/lib/i18n/       textos en español e inglés
src/db/             esquema de Postgres (las migraciones están en drizzle/)
e2e/                recorridos en el navegador y auditoría de accesibilidad
```

Las reglas para trabajar en el código están en `AGENTS.md` y `CLAUDE.md`.

> Solo con fines educativos. No es asesoría financiera.
