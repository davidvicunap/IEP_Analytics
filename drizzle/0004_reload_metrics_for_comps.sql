-- Peer inputs now include cash, short-term debt and D&A (enterprise value and EBITDA for comps).
-- Clear them so the next build or cron run reloads every company with the new fields.
DELETE FROM "company_metrics";
