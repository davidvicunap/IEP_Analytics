# IEP Analytics

Un "Bloomberg Terminal para dummies": análisis de acciones de EE.UU. explicado en lenguaje simple, optimizado para móvil, tablet y desktop. Interfaz en español e inglés.

*A "Bloomberg Terminal for dummies": US stock analysis in plain language, ES/EN.*

## Funciones

- **Buscador** por nombre o ticker con autocompletado (atajo `/` en desktop).
- **Gráfico interactivo** (velas o línea, 1M/6M/1A/5A) con medias móviles 50/200, Bandas de Bollinger, RSI, MACD y volumen. Cada indicador trae su explicación «¿Qué es esto?».
- **Señales técnicas** en lenguaje humano (sobrecompra/sobreventa, tendencia, cruce dorado, impulso).
- **Fundamentales con semáforo** (verde/amarillo/rojo): P/E, P/S, P/B, crecimiento de ventas, márgenes, ROE, deuda, liquidez, dividendo, más un gráfico de ingresos y beneficio a 5 años.
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
