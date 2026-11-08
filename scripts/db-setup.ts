// Runs before `next build` (see package.json):
//  1. applies pending SQL migrations from ./drizzle — a failure stops the deploy, so code
//     never runs against an older schema;
//  2. loads the SEC securities list when the table is empty or older than 7 days — a
//     failure here only logs a warning (search falls back to FMP);
//  3. sector data: weekly peer inputs from SEC frames and up to SECTOR_BUDGET_MS of SIC
//     backfill (largest companies first); warnings only.
// Without a database URL (CI, local builds) it does nothing.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import * as schema from "../src/db/schema";
import { databaseUrl, type Db } from "../src/db/client";
import { fetchCompanyTickers } from "../src/lib/sec";
import { refreshSecurities, securitiesStatus } from "../src/lib/securities";
import { runSectorJobs } from "../src/lib/secJobs";

const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const SECTOR_BUDGET_MS = 180_000;
const log = (event: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ event: `db_setup_${event}`, ...extra }));

async function main() {
  const url = databaseUrl();
  if (!url) {
    log("skipped", { reason: "no_database_url" });
    return;
  }
  const db = drizzle(neon(url), { schema });

  await migrate(db, { migrationsFolder: "./drizzle" });
  log("migrated");

  try {
    const status = await securitiesStatus(db as unknown as Db);
    const stale = !status.updatedAt || Date.now() - status.updatedAt.getTime() > STALE_MS;
    if (status.active > 0 && !stale) {
      log("securities_fresh", { active: status.active, updatedAt: status.updatedAt });
    } else {
      const rows = await fetchCompanyTickers();
      const result = await refreshSecurities(db as unknown as Db, rows);
      log("securities_loaded", { ...result });
    }
  } catch (e) {
    log("securities_warning", { message: e instanceof Error ? e.message : String(e) });
  }

  try {
    log("sector", await runSectorJobs(db as unknown as Db, SECTOR_BUDGET_MS));
  } catch (e) {
    log("sector_warning", { message: e instanceof Error ? e.message : String(e) });
  }
}

main().catch((e) => {
  log("failed", { message: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
