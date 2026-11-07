# IEP Analytics

Un "Bloomberg Terminal para dummies": análisis de acciones de EE.UU. explicado en lenguaje simple, optimizado para móvil, tablet y desktop. Interfaz en español e inglés.

*A "Bloomberg Terminal for dummies": US stock analysis in plain language, ES/EN.*

## Funciones

- **Buscador** por nombre o ticker con autocompletado (atajo `/` en desktop).
- **Gráfico interactivo** (velas o línea, 1M/6M/1A/5A) con medias móviles 50/200, Bandas de Bollinger, RSI, MACD y volumen. Cada indicador trae su explicación «¿Qué es esto?».
- **Señales técnicas** en lenguaje humano (sobrecompra/sobreventa, tendencia, cruce dorado, impulso).
- **Fundamentales para inversores a largo plazo**: las pruebas de calidad estilo Buffett sobre 10 años de 10-K de la SEC (ROIC alto y constante, margen bruto, BPA creciente, conversión a caja, capex, deuda, intereses, recompras; pruebas propias para bancos y aseguradoras), crecimiento compuesto a 3/5/10 años, lo que esperan los analistas (estimaciones de ingresos y BPA, precio objetivo y recomendaciones de FMP), 10 años de tendencias y los ratios frente al sector. Las cifras por acción se ajustan por splits.
- **«En pocas palabras»**: resumen automático de la acción en 3–5 frases.
- **Watchlist** guardada en el navegador y **noticias** por ticker.
- Tema claro/oscuro, accesible (teclado, lectores de pantalla, contraste AA) y sin scroll horizontal desde 320px.

## Stack

Next.js (App Router) · React · TypeScript · Tailwind CSS · [lightweight-charts](https://github.com/tradingview/lightweight-charts) · datos de [Financial Modeling Prep](https://site.financialmodelingprep.com/developer/docs).

La API key solo se usa en el servidor; nunca llega al navegador. Las respuestas se cachean (precios 60s, fundamentales 24h) para no agotar el plan gratuito.

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
| Financial Modeling Prep | Cotizaciones, precios históricos, capitalización de comparables, bono del Tesoro a 10 años y prima de riesgo, noticias | `FMP_API_KEY` |
| Neon (Postgres) | Lista de valores de la SEC, búsqueda local | `STORAGE_DATABASE_URL` |
| Upstash (Redis) | Límite de solicitudes por IP, contador diario de llamadas a FMP | `KV_REST_API_URL`, `KV_REST_API_TOKEN` |
| SEC EDGAR | Lista de empresas, estados financieros (XBRL), acciones en circulación, datos sectoriales (pública) | `SEC_USER_AGENT` |

- Cada build aplica las migraciones de `drizzle/` y carga la lista de la SEC si está vacía o tiene más de 7 días (`scripts/db-setup.ts`). Un cron diario la refresca (`/api/cron/securities`, protegido con `CRON_SECRET`).
- Datos sectoriales (ratios con percentiles): el build y un cron diario (`/api/cron/sec-metrics`) cargan cada semana los datos anuales de todas las cotizadas desde los «frames» de la SEC (`company_metrics`) y rellenan poco a poco el código SIC de cada empresa, de mayor a menor (≈ 8 consultas/s, por debajo del límite de 10/s de la SEC).
- Valoración (dentro de la beta porque usa precios de FMP): **Comps** interactivos (`/api/valuation/comps`): pares sugeridos por código SIC o elegidos por el usuario, todos sobre el mismo año fiscal de la SEC; capitalización de FMP y, si el plan no la incluye, escrita por el usuario (se guarda solo en su navegador); valor implícito por acción con percentiles 25–75. **DCF maker** (`/api/valuation/[symbol]`): modelo FCFF con supuestos por año, WACC por componentes (beta de 5 años frente a SPY), valor terminal por crecimiento perpetuo o múltiplo de salida, sensibilidad y escenarios guardados; verificado contra `scripts/reference/dcf_reference.py` (diferencia ≤ 0,5 % en 5 tickers). **Histórico** (mismo endpoint): P/E, EV/EBITDA, P/S, P/B y rentabilidad del FCF de cada cierre de mes de los últimos 5 años, con mediana, media ± 1 desviación típica, percentil, desviaciones frente a la media y el precio que daría volver a la mediana (en EV/EBITDA con la deuda neta de hoy fija). En el plan gratuito de FMP solo un grupo de acciones grandes tiene precio y el historial de capitalización cubre 1 mes, por eso el historial de múltiplos se reconstruye con cierres ajustados por splits × acciones de la SEC.
- Insiders (`/api/sec/insiders/[symbol]`, datos públicos): formularios 4 de la SEC leídos de forma incremental en Postgres (solo los nuevos), con compras, ventas discrecionales y ventas programadas (10b5-1) de 12 meses.
- `GET /api/health` muestra el estado de la base de datos, Redis y el uso diario de FMP (sin datos de mercado; queda fuera de la beta para monitoreo).
- Para cambiar el esquema: edita `src/db/schema.ts` y ejecuta `npm run db:generate`.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Build y servidor de producción |
| `npm test` | Tests de indicadores y del sistema de puntuación |
| `npm run typecheck` | Chequeo de tipos |

## Deploy en Vercel

1. Importa el repo en [vercel.com/new](https://vercel.com/new).
2. Añade las variables de entorno `FMP_API_KEY` y `BETA_INVITE_CODES`.
3. Deploy.

## Estructura

```
src/app/            páginas (inicio, /stock/[ticker], /watchlist) y rutas API (/api/search, /api/quotes)
src/components/     UI (gráfico, fundamentales, buscador, watchlist…)
src/lib/fmp.ts      cliente de Financial Modeling Prep
src/lib/mock.ts     datos del modo demo
src/lib/indicators.ts  SMA, EMA, RSI, MACD, Bollinger
src/lib/scoring.ts  semáforos, señales y resumen
src/lib/i18n/       textos en español e inglés
```

> Solo con fines educativos. No es asesoría financiera.
