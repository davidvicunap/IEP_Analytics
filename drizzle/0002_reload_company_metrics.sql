-- Revenue now takes the largest SEC total and flags competing totals (see secFinancials.ts).
-- Clear the stored peer inputs so the next build or cron run reloads them with the new rule.
DELETE FROM "company_metrics";
