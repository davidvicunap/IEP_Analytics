// Local development on real SEC data, without touching production or spending the FMP quota:
//   LOCAL_PGLITE_DIR=.local/pg npm run db:local      (fills an in-process Postgres from the SEC)
//   LOCAL_PGLITE_DIR=.local/pg BETA_GATE=off npm run start
// Applies the migrations, loads the SEC securities list and runs the sector jobs (peer inputs
// from SEC frames, SIC codes) for up to LOCAL_SECTOR_MS (default 5 minutes).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/db/schema";
import type { Db } from "../src/db/client";
import { fetchCompanyTickers } from "../src/lib/sec";
import { refreshSecurities, securitiesStatus } from "../src/lib/securities";
import { runSectorJobs } from "../src/lib/secJobs";

const log = (event: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ event: `local_db_${event}`, ...extra }));

async function main() {
  const dir = process.env.LOCAL_PGLITE_DIR;
  if (!dir) throw new Error("Set LOCAL_PGLITE_DIR (for example .local/pg)");
  const client = new PGlite(dir);
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  log("migrated", { dir });
  const status = await securitiesStatus(db);
  if (status.active === 0) log("securities_loaded", { ...(await refreshSecurities(db, await fetchCompanyTickers())) });
  else log("securities_present", { active: status.active });
  const budget = Number(process.env.LOCAL_SECTOR_MS) || 300_000;
  log("sector", await runSectorJobs(db, budget));
  await client.close();
}

main().catch((e) => {
  log("failed", { message: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
