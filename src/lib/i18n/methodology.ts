// The methodology page's text (only loaded by /methodology). Every figure here mirrors a
// constant in the code; when one changes, change it here too (see the comments in brackets).

export type Block = string | { list: string[] };
export interface MethodSection {
  id: string;
  title: string;
  body: Block[];
}
export interface MethodologyText {
  title: string;
  intro: string;
  contents: string;
  updated: string;
  sections: MethodSection[];
}

const es: MethodologyText = {
  title: "Metodología",
  intro:
    "De dónde sale cada número de Investment Edge Platform (IEP) y cómo se calcula. La regla general: cada cifra muestra su fuente y su fecha, un fallo se muestra como fallo (nunca se rellena con datos inventados) y los datos de demostración nunca se mezclan con los reales. Es una herramienta educativa: describe, no recomienda comprar ni vender.",
  contents: "Contenido",
  updated: "Refleja el funcionamiento de la app a noviembre de 2026.",
  sections: [
    {
      id: "sources",
      title: "Fuentes de datos",
      body: [
        {
          list: [
            "SEC EDGAR (dominio público): estados financieros etiquetados en XBRL de cada 10-K y 10-Q, la lista de presentaciones, los formularios 4 de directivos, los documentos 10-K y los «frames» (un dato para todas las empresas a la vez).",
            "Financial Modeling Prep (FMP, con licencia): cotizaciones, precios históricos, valor de mercado, perfil, consenso de analistas, fechas de resultados, bono a 10 años y prima de riesgo. El plan gratuito permite 250 consultas al día.",
            "TradingView: el gráfico interactivo y los titulares de noticias, servidos directamente por TradingView dentro de la página.",
          ],
        },
        "Las secciones que usan FMP están detrás del acceso de la beta; las de la SEC son públicas.",
      ],
    },
    {
      id: "glance",
      title: "De un vistazo",
      body: [
        "Cinco frases en el resumen de cada acción, cada una medida igual que en el resto de la app, nunca con reglas fijas del tipo «un PER bajo es bueno»:",
        {
          list: [
            "Calidad: las pruebas de Buffett (alta, media o baja; ver más abajo).",
            "Crecimiento, rentabilidad y deuda: el último año fiscal frente a su industria (mismo código SIC de la SEC). Tercio superior, medio o inferior. Crecimiento = ingresos (BPA en bancos y aseguradoras); rentabilidad = ROIC (ROE en financieras); deuda = deuda a largo plazo ÷ patrimonio (patrimonio ÷ activos en financieras).",
            "Valoración: el PER de hoy (precio/ventas si no hay beneficios; precio/valor contable en financieras) frente a su propia historia de 5 años. Por debajo o por encima de su media significa a más de una desviación estándar.",
          ],
        },
        "Si falta un dato para juzgar algo, esa frase no aparece y se dice cuál falta.",
      ],
    },
    {
      id: "prices",
      title: "Precios y el límite diario",
      body: [
        "La cotización se guarda en caché 15 minutos con el mercado abierto, 60 minutos cuando ya se usó el 80 % de las consultas del día y 6 horas con el mercado cerrado. Los históricos se guardan 1 hora; perfil, fechas de resultados y datos de empresa, 24 horas; tipos de interés, 12 horas.",
        "Si FMP no puede dar un precio (límite diario, acción fuera del plan), la ficha se abre igual y muestra, en este orden: el último precio guardado, el último cierre diario o «sin precio», siempre diciendo cuál es y por qué.",
        "Cuando FMP responde que se alcanzó el límite, la app deja de preguntar 10 minutos. Una acción fuera del plan se recuerda 24 horas y un símbolo inexistente 6 horas, para no gastar consultas repitiendo la misma pregunta.",
      ],
    },
    {
      id: "statements",
      title: "Estados financieros",
      body: [
        "Salen de los datos XBRL que cada empresa presenta a la SEC: hasta 10 años y sus trimestres. El cuarto trimestre no se presenta por separado: se calcula como el año fiscal menos los nueve meses acumulados, y las cifras calculadas se marcan. Los datos por acción (BPA) nunca se calculan restando.",
        "TTM = suma de los últimos cuatro trimestres (los saldos del balance son los del último trimestre). Las cifras por acción y el número de acciones se reexpresan tras un split, solo cuando la propia SEC confirma el split.",
        "Comprobaciones automáticas: beneficio bruto = ingresos − costo de ventas, y activos ≈ pasivos + patrimonio. Cada columna enlaza al documento original y al visor XBRL de la SEC.",
      ],
    },
    {
      id: "ratios",
      title: "Ratios",
      body: [
        {
          list: [
            "Márgenes: beneficio bruto, operativo, neto y flujo de caja libre, cada uno ÷ ingresos.",
            "Flujo de caja libre = flujo de caja operativo − inversiones en activo fijo (capex).",
            "ROIC = beneficio operativo × (1 − 21 %) ÷ (patrimonio + deuda a largo plazo). El 21 % es el tipo federal de EE. UU., para comparar empresas con el mismo criterio.",
            "ROE = beneficio neto ÷ patrimonio; ROA = beneficio neto ÷ activos; deuda/patrimonio = deuda ÷ patrimonio.",
          ],
        },
        "Una empresa con patrimonio negativo no tiene ROE, ROIC ni deuda/patrimonio (se muestran como «—»). En bancos y aseguradoras los márgenes y la deuda no son comparables y no se muestran.",
        "Las comparaciones con el sector usan las empresas del mismo grupo industrial de la SEC (los dos primeros dígitos del código SIC) con datos del mismo año.",
      ],
    },
    {
      id: "quality",
      title: "Calidad: las pruebas de Buffett",
      body: [
        "Se usan los últimos 10 años de informes anuales; una prueba necesita al menos 5 años, si no queda «sin datos». Para empresas en general:",
        {
          list: [
            "ROIC de al menos 15 % en el 80 % de los años.",
            "Margen bruto mediano de al menos 40 %, con el último año como mucho 5 puntos por debajo.",
            "BPA que crece en al menos el 70 % de los años.",
            "Flujo de caja libre de al menos el 80 % del beneficio neto, sumando los años.",
            "Capex de como mucho el 50 % del beneficio neto, sumando los años.",
            "Deuda a largo plazo que se paga con 4 años o menos del beneficio medio de los últimos 3.",
            "Intereses de como mucho el 15 % del beneficio operativo.",
            "Al menos un 1 % menos de acciones diluidas que al principio del periodo (recompras).",
          ],
        },
        "Bancos: ROE ≥ 12 % y ROA ≥ 1 % en el 80 % de los años, crecimiento del BPA y del valor contable por acción, y recompras. Aseguradoras: lo mismo sin el ROA. Los REIT no se puntúan: por la depreciación, su beneficio no refleja la caja que generan.",
        "Nivel: «alta» si supera al menos el 75 % de las pruebas que se pudieron juzgar, «media» desde el 50 %, «baja» por debajo; «pocos datos» si se juzgaron menos de 4.",
      ],
    },
    {
      id: "valuation",
      title: "Valoración",
      body: [
        "Múltiplos de hoy = valor de mercado (FMP) ÷ la última cifra TTM presentada a la SEC. Su historia de 5 años usa el valor de mercado a fin de cada mes (precio de cierre ajustado × acciones de la SEC); solo se muestra si las acciones de la SEC están a menos de un 10 % de las de la cotización (si no, suele haber varias clases de acciones). «Barato/caro frente a sí misma» significa más de una desviación estándar por debajo o por encima de su media de 5 años, nunca frente a otras empresas.",
        "DCF: 5 años de proyección. El crecimiento parte del crecimiento anual de los ingresos de los últimos 5 años (limitado entre −5 % y 25 %) y baja hasta el 2,5 % perpetuo; márgenes y proporciones son los TTM de hoy; el capex converge a la depreciación; el impuesto es el tipo efectivo (máximo 35 %, o 21 % si no hay dato). El coste de capital usa el bono a 10 años y la prima de riesgo de FMP, una beta frente al S&P 500 (SPY, mensual) y el coste de la deuda = intereses ÷ deuda. El valor terminal es de crecimiento perpetuo o un múltiplo EV/EBITDA (el de hoy, entre 4 y 40). Todo valor por defecto que no sale de datos se marca como convención y se puede cambiar.",
        "DCF inverso: busca el crecimiento anual de los ingresos que hace que el DCF dé exactamente el precio de hoy, con el resto de supuestos por defecto, y lo compara con lo que la empresa creció de verdad.",
        "Comparables: empresas cotizadas de la misma industria (código SIC de tres dígitos) con ingresos dentro de 10 veces los de la empresa; luego las de la misma industria hasta 100 veces, y después el grupo SIC de dos dígitos; o las que elijas. Valor de mercado = acciones en circulación de la portada del último informe a la SEC × precio (si la empresa no publica un total, beneficio neto ÷ BPA diluido del año fiscal). Solo damos la mediana, el rango P25–P75 y el valor implícito de un múltiplo cuando al menos 4 comparables tienen el dato.",
      ],
    },
    {
      id: "analysts",
      title: "Analistas y próximos resultados",
      body: [
        "El consenso de analistas (precio objetivo, estimaciones de ingresos y BPA) viene de FMP. El crecimiento esperado de los ingresos parte del último año presentado a la SEC; el del BPA parte de la cifra de los propios analistas, porque suelen estimar un BPA «ajustado» distinto del contable.",
        "Próximos resultados: la fecha que lista FMP (puede ser provisional hasta que la empresa la anuncie). Si FMP no puede responder, se estima con la SEC: 52 semanas después de la publicación de resultados (8-K, apartado 2.02) del mismo trimestre del año anterior, y se indica como estimación.",
      ],
    },
    {
      id: "quarter",
      title: "El trimestre en resumen",
      body: [
        "El último trimestre se compara con el mismo trimestre del año anterior (lo justo en negocios estacionales) y con el trimestre anterior. Los márgenes cambian en puntos; las cifras en porcentaje, y solo entre dos cifras positivas: desde o hacia pérdidas se muestra «—», porque un porcentaje ahí no significa nada. Enlaza al informe y a la nota de resultados (el primer 8-K con apartado 2.02 en los 75 días siguientes al cierre).",
      ],
    },
    {
      id: "insiders",
      title: "Directivos (formulario 4)",
      body: [
        "Se leen los formularios 4 de los últimos 12 meses (las enmiendas se ignoran para no contar dos veces). Compras = compras en el mercado (código P). Ventas discrecionales = ventas (código S) fuera de un plan 10b5-1; las ventas planificadas se muestran aparte. Concesiones, ejercicios de opciones, retenciones y regalos se cuentan como «otras». El valor = acciones × precio, cuando el formulario lo indica.",
        "Los formularios se leen poco a poco (con un límite de tiempo por visita); mientras quedan por leer, la cifra se marca como «parcial». Se revisa de nuevo cada 6 horas.",
      ],
    },
    {
      id: "screener",
      title: "Buscador de acciones",
      body: [
        "Un año completo de cifras por empresa (el último año natural con datos en los «frames» de la SEC), con las mismas fórmulas que en cada acción. El tamaño es la posición de la empresa en la lista de la SEC, ordenada por valor de mercado. Los datos se renuevan a diario y se guardan 6 horas.",
      ],
    },
    {
      id: "reader",
      title: "Lector de informes",
      body: [
        "Se descarga el documento 10-K de la SEC y se extrae su texto: se descarta el contenido oculto (XBRL), los encabezados y pies de página y el índice. Cada sección (Item 1 Negocio, Item 1A Riesgos, Item 7 Análisis de la dirección) se localiza por su encabezado; como el índice y las referencias también lo nombran, se elige el encabezado seguido de más texto. Las secciones muy largas se cortan y lo dicen.",
        "Comparación de riesgos: se comparan los títulos en negrita o cursiva de cada riesgo con los del 10-K anterior. Igual = mismo texto; reformulado = la mayoría de las palabras en común; nuevo = sin parecido; retirado = del año anterior sin pareja. Un riesgo «nuevo» puede ser un tema antiguo redactado de otra forma.",
      ],
    },
    {
      id: "ai",
      title: "Explicado con IA",
      body: [
        "Claude (Anthropic) escribe tres apartados (el último trimestre, a favor y en contra) a partir de una lista numerada de datos que ya mostramos: el trimestre frente al año anterior (10-Q o 10-K de la SEC) y las cinco líneas de «De un vistazo». No recibe noticias ni otras fuentes.",
        "Cada frase debe citar los números de los datos en los que se apoya; las que no citan ninguno de los datos dados se descartan. La explicación se escribe una vez por empresa, idioma y conjunto de datos, y se vuelve a escribir solo cuando una nueva presentación cambia los datos. La IA puede equivocarse: cada cifra enlaza a su fuente para comprobarla. No es una recomendación.",
      ],
    },
    {
      id: "chart",
      title: "Soportes y resistencias",
      body: [
        "Zonas de precio donde la acción giró varias veces en los últimos 2 años (máximos y mínimos locales agrupados), más las referencias que muchos siguen: rango de 52 semanas y medias de 50 y 200 sesiones. Son descriptivas: dicen dónde pasó algo, no dónde va a pasar.",
      ],
    },
    {
      id: "yours",
      title: "Tus datos",
      body: [
        {
          list: [
            "Mi análisis (tesis, puntos a favor y en contra, valor razonable, notas): se guarda en la base de datos, ligado a tu invitación de la beta. Cada cambio de valor razonable queda registrado con el precio de ese momento.",
            "Tesis vivas: una tesis abierta con stop, objetivo, valor razonable, fecha de revisión o condiciones propias se vigila al abrir la app, tres veces con el mercado abierto y una después del cierre, en días hábiles (precio de Financial Modeling Prep con su hora; «De un vistazo», informes y fechas de resultados de la SEC). El stop y el objetivo se juzgan según lo que esperas (que suba o que baje); el valor razonable, cuando el precio lo cruza desde el lado en que estaba al guardarlo (si lo pusiste por debajo del precio, te avisamos si baja hasta él). Una alerta salta una vez mientras su condición se cumple, no se repite en 24 horas y se apaga cuando deja de cumplirse. Si un dato no está disponible, lo decimos y no apagamos ni inventamos alertas. Al cerrar una tesis se guardan el resultado, lo aprendido y el precio de ese momento. Si activas los avisos en un teléfono o navegador, cada alerta nueva te llega también allí (Web Push; no guardamos más que la dirección que da tu navegador para recibirlos).",
            "Lista, etiquetas, columnas, indicadores del gráfico y búsquedas guardadas: en tu cuenta, iguales en todos tus dispositivos. La primera vez que un dispositivo se sincroniza, lo que ya tenía guardado se suma a lo de tu cuenta, sin perder nada. Sin conexión se guardan en el navegador y se suben después.",
            "En cada navegador: acciones vistas recientemente, escenarios del DCF, proyecciones de los estados, pares elegidos en Comparables y la vista del gráfico.",
          ],
        },
      ],
    },
    {
      id: "limits",
      title: "Límites",
      body: [
        "Los datos XBRL a veces faltan o cambian de etiqueta entre años; cuando no hay dato se muestra «—» y nunca se rellena. El texto de los informes se extrae automáticamente: ante cualquier duda, manda el documento original, enlazado en cada sección. Nada de esto es una recomendación de inversión.",
      ],
    },
  ],
};

const en: MethodologyText = {
  title: "Methodology",
  intro:
    "Where every number in Investment Edge Platform (IEP) comes from and how it's calculated. The general rule: every figure shows its source and time, a failure is shown as a failure (never filled with made-up data) and demo data is never mixed with real data. It's an educational tool: it describes, it doesn't recommend buying or selling.",
  contents: "Contents",
  updated: "Describes how the app works as of November 2026.",
  sections: [
    {
      id: "sources",
      title: "Data sources",
      body: [
        {
          list: [
            "SEC EDGAR (public domain): XBRL-tagged financial statements from every 10-K and 10-Q, the list of filings, insiders' Form 4s, 10-K documents and “frames” (one figure for every company at once).",
            "Financial Modeling Prep (FMP, licensed): quotes, price history, market value, profile, analyst consensus, earnings dates, the 10-year Treasury and the equity risk premium. The free plan allows 250 calls a day.",
            "TradingView: the interactive chart and news headlines, served by TradingView directly inside the page.",
          ],
        },
        "Sections that use FMP sit behind the beta access; SEC ones are public.",
      ],
    },
    {
      id: "glance",
      title: "At a glance",
      body: [
        "Five sentences at the top of every stock, each measured the same way as everywhere else in the app, never with fixed rules like “a low P/E is good”:",
        {
          list: [
            "Quality: the Buffett tests (high, mixed or low; see below).",
            "Growth, profitability and debt: the latest fiscal year against its industry (same SEC SIC code). Top, middle or bottom third. Growth = revenue (EPS for banks and insurers); profitability = ROIC (ROE for financials); debt = long-term debt ÷ equity (equity ÷ assets for financials).",
            "Valuation: today's P/E (price/sales without profits; price/book for financials) against its own 5-year history. Below or above its average means by more than one standard deviation.",
          ],
        },
        "When a figure needed to judge something is missing, that sentence isn't shown and the card says which one.",
      ],
    },
    {
      id: "prices",
      title: "Prices and the daily limit",
      body: [
        "A quote is cached for 15 minutes while the market is open, 60 minutes once 80% of the day's calls are used and 6 hours when the market is closed. Price history is kept for 1 hour; profile, earnings dates and company data for 24 hours; interest rates for 12 hours.",
        "If FMP can't give a price (daily limit, stock not in the plan), the page still opens and shows, in this order: the last saved price, the last daily close or “no price”, always saying which one and why.",
        "When FMP answers that the limit is reached, the app stops asking for 10 minutes. A stock outside the plan is remembered for 24 hours and an unknown symbol for 6 hours, so calls aren't spent asking the same question again.",
      ],
    },
    {
      id: "statements",
      title: "Financial statements",
      body: [
        "They come from the XBRL data each company files with the SEC: up to 10 years and their quarters. The fourth quarter isn't filed on its own: it's the fiscal year minus the nine-month year-to-date, and calculated figures are flagged. Per-share data (EPS) is never derived by subtraction.",
        "TTM = the sum of the last four quarters (balance-sheet items are the latest quarter's). Per-share figures and share counts are restated after a stock split, only when the SEC data confirms the split.",
        "Automatic checks: gross profit = revenue − cost of revenue, and assets ≈ liabilities + equity. Every column links to the original document and to the SEC's XBRL viewer.",
      ],
    },
    {
      id: "ratios",
      title: "Ratios",
      body: [
        {
          list: [
            "Margins: gross, operating and net profit and free cash flow, each ÷ revenue.",
            "Free cash flow = operating cash flow − capital expenditure (capex).",
            "ROIC = operating income × (1 − 21%) ÷ (equity + long-term debt). 21% is the US federal rate, so companies are compared on the same basis.",
            "ROE = net income ÷ equity; ROA = net income ÷ assets; debt/equity = debt ÷ equity.",
          ],
        },
        "A company with negative equity has no ROE, ROIC or debt/equity (shown as “—”). For banks and insurers, margins and debt aren't comparable and aren't shown.",
        "Sector comparisons use companies in the same SEC industry group (the first two digits of the SIC code) with data for the same year.",
      ],
    },
    {
      id: "quality",
      title: "Quality: the Buffett tests",
      body: [
        "They use the last 10 years of annual reports; a test needs at least 5 years, otherwise it's “no data”. For companies in general:",
        {
          list: [
            "ROIC of at least 15% in 80% of the years.",
            "Median gross margin of at least 40%, with the latest year at most 5 points below.",
            "EPS growing in at least 70% of the years.",
            "Free cash flow of at least 80% of net income, summed over the years.",
            "Capex of at most 50% of net income, summed over the years.",
            "Long-term debt that 4 years or less of the last 3 years' average net income would repay.",
            "Interest of at most 15% of operating income.",
            "At least 1% fewer diluted shares than at the start of the period (buybacks).",
          ],
        },
        "Banks: ROE ≥ 12% and ROA ≥ 1% in 80% of the years, growth in EPS and book value per share, and buybacks. Insurers: the same without ROA. REITs aren't scored: because of depreciation, their net income doesn't reflect the cash they earn.",
        "Level: “high” when it passes at least 75% of the tests that could be judged, “mixed” from 50%, “low” below that; “little data” when fewer than 4 were judged.",
      ],
    },
    {
      id: "valuation",
      title: "Valuation",
      body: [
        "Today's multiples = market value (FMP) ÷ the latest TTM figure filed with the SEC. Their 5-year history uses month-end market value (adjusted close × SEC share count); it's only shown when the SEC share count is within 10% of the quote's (otherwise there are usually several share classes). “Cheap/expensive against itself” means more than one standard deviation below or above its own 5-year mean, never against other companies.",
        "DCF: 5 years projected. Growth starts from the last 5 years' revenue growth rate (kept between −5% and 25%) and fades to 2.5% forever; margins and ratios are today's TTM; capex converges to depreciation; tax is the effective rate (at most 35%, or 21% without data). The cost of capital uses FMP's 10-year Treasury and equity risk premium, a beta against the S&P 500 (SPY, monthly) and cost of debt = interest ÷ debt. The terminal value is perpetual growth or an EV/EBITDA multiple (today's, between 4 and 40). Every default that doesn't come from data is flagged as a convention and can be changed.",
        "Reverse DCF: finds the yearly revenue growth that makes the DCF equal today's price, with the other assumptions at their defaults, and puts it next to what the company actually grew.",
        "Comps: listed companies in the same industry (three-digit SIC code) with revenue within 10 times the company's; then the same industry up to 100 times, then the two-digit SIC group; or the ones you choose. Market value = shares outstanding from the cover of the latest SEC filing × price (when a company doesn't report a total, net income ÷ diluted EPS for the fiscal year). We give the median, the P25–P75 range and an implied value for a multiple only when at least 4 peers have the figure.",
      ],
    },
    {
      id: "analysts",
      title: "Analysts and next results",
      body: [
        "Analyst consensus (price target, revenue and EPS estimates) comes from FMP. Expected revenue growth starts from the last year filed with the SEC; EPS growth starts from the analysts' own figure, because they usually estimate an “adjusted” EPS that differs from the reported one.",
        "Next results: the date FMP lists (it may be provisional until the company announces it). If FMP can't answer, it's estimated from the SEC: 52 weeks after last year's results release (8-K, item 2.02) for the same quarter, and labelled as an estimate.",
      ],
    },
    {
      id: "quarter",
      title: "Quarter in review",
      body: [
        "The latest quarter is compared with the same quarter a year earlier (the fair comparison for seasonal businesses) and with the quarter before. Margins change in points; amounts in percent, and only between two positive figures: from or into a loss it's “—”, because a percentage there means nothing. It links to the report and to the results release (the first 8-K with item 2.02 in the 75 days after the quarter ended).",
      ],
    },
    {
      id: "insiders",
      title: "Insiders (Form 4)",
      body: [
        "Form 4s from the last 12 months are read (amendments are skipped so nothing counts twice). Purchases = open-market purchases (code P). Discretionary sales = sales (code S) outside a 10b5-1 plan; planned sales are shown separately. Grants, option exercises, withholding and gifts count as “other”. Value = shares × price, where the form reports one.",
        "Forms are read gradually (with a time limit per visit); while some are left, the figure is marked “partial”. It's checked again every 6 hours.",
      ],
    },
    {
      id: "screener",
      title: "Screener",
      body: [
        "One full year of figures per company (the latest calendar year with data in the SEC “frames”), with the same formulas as on each stock. Size is the company's position in the SEC list, ordered by market value. The data is refreshed daily and kept for 6 hours.",
      ],
    },
    {
      id: "reader",
      title: "Filing reader",
      body: [
        "The 10-K document is downloaded from the SEC and its text extracted: hidden content (XBRL), page headers and footers and the table of contents are dropped. Each section (Item 1 Business, Item 1A Risk factors, Item 7 Management's discussion) is found by its heading; since the table of contents and cross-references also name it, the heading followed by the most text is chosen. Very long sections are cut and say so.",
        "Risk comparison: each risk's bold or italic title is compared with those in the previous 10-K. Unchanged = same text; reworded = most words in common; new = nothing similar; removed = last year's with no match. A “new” risk may be an old topic worded differently.",
      ],
    },
    {
      id: "ai",
      title: "Explained by AI",
      body: [
        "Claude (Anthropic) writes three sections (the latest quarter, for and against) from a numbered list of facts we already show: the quarter against a year earlier (the SEC 10-Q or 10-K) and the five lines of \"At a glance\". It is given no news or other sources.",
        "Every sentence must cite the numbers of the facts it rests on; sentences that cite none of the given facts are dropped. An explanation is written once per company, language and set of facts, and written again only when a new filing changes the facts. AI can be wrong: every figure links to its source so you can check it. Not a recommendation.",
      ],
    },
    {
      id: "chart",
      title: "Support and resistance",
      body: [
        "Price zones where the stock turned around several times over the last 2 years (local highs and lows grouped together), plus the references many people watch: the 52-week range and the 50- and 200-day averages. They're descriptive: they say where something happened, not where it will.",
      ],
    },
    {
      id: "yours",
      title: "Your data",
      body: [
        {
          list: [
            "Research (thesis, points for and against, fair value, notes): saved in the database, tied to your beta invite. Every fair-value change is logged with the price at that moment.",
            "Live theses: an open thesis with a stop, target, fair value, review date or conditions of your own is checked when you open the app, three times while the market is open and once after the close, on weekdays (price from Financial Modeling Prep with its time; \"At a glance\", reports and results dates from the SEC). The stop and target follow what you expect (a rise or a fall); the fair value alerts when the price crosses it from the side it was on when you saved it (set below the price, it alerts if the price falls to it). An alert fires once while its condition holds, doesn't repeat within 24 hours and clears when the condition no longer holds. When some data is unavailable we say so, and we neither clear nor invent alerts. Closing a thesis records its outcome, what you learned and the price at that moment. If you turn alerts on for a phone or browser, each new alert also reaches you there (Web Push; we keep only the address your browser gives us to receive them).",
            "Watchlist, tags, columns, chart indicators and saved screens: in your account, the same on all your devices. The first time a device syncs, what it already had is added to your account, so nothing is lost. Offline, they are kept in the browser and saved later.",
            "Kept in each browser: recently viewed stocks, DCF scenarios, statement projections, chosen comps peers and the chart view.",
          ],
        },
      ],
    },
    {
      id: "limits",
      title: "Limits",
      body: [
        "XBRL data is sometimes missing or changes tags between years; when there's no figure, “—” is shown and nothing is filled in. Filing text is extracted automatically: if in doubt, the original document prevails, and it's linked from every section. None of this is investment advice.",
      ],
    },
  ],
};

export const methodology = { es, en };
