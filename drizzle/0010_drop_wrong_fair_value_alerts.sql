-- Fair value alerts raised before the crossing rule fired whenever the price was on the "up" side
-- of the fair value, even when it was already there when the fair value was set (a fair value
-- below the price showed as "reached" at once). Those alerts were wrong: remove them. Theses are
-- checked again on the next visit or nightly run with the corrected rule.
DELETE FROM "thesis_alerts" WHERE "kind" = 'fairValue';
