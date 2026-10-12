-- The dashboard compared food cost with a target the code held as a constant, and nothing in
-- the product could change it. The target belongs to the organization that set it; the default
-- keeps every existing tenant on the figure the dashboard was already printing.
ALTER TABLE "Organization" ADD COLUMN "foodCostTargetPct" DECIMAL(5,2) NOT NULL DEFAULT 30;
