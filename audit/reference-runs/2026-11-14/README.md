# Reference pipeline on the blind set, 14 November 2026

PRIVATE. The same run as `results/2026-11-14-reference/` in `nexus-extraction-tests`, for the 25 blind documents
(75 jobs), scored with the package at the commit after `a459db5` that holds the sum fixes.

Result: accuracy 97.10% (95% interval 93.0-100.0), 0 unflagged errors, 0 failed jobs, 13 of 13 choice lines flagged.
All 9 wrong lines are flagged and sit in two documents: `b_turkey_brine` ("8 med. white onions", "2 Med Carrots":
"med" read as the unit) and `b_basil_aioli` (". 1/2 Gal" water: a stray dot, amount not parsed).

Before the sum fix this set also showed 3 unflagged errors on `b_corn_bread` ("2# 8oz" read as 2 oz). That fix was
made after seeing this result, so `b_corn_bread` is no longer an unseen document for the reference pipeline.
