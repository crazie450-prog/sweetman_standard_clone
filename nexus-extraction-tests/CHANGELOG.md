# Changelog

Changes to documents, keys, scorer and procedure. Newest first.

## 2026-11-12 — application test and key peer review

- **Direct application test.** `adapters/nexus-app/run_app_test.py` tests a deployed application through its API
  (sign in, upload, wait, read the review payload, delete). `docs/APP_TEST.md`. A delivery is judged on this run.
- **Answer-key peer review.** Procedure (`docs/KEY_REVIEW.md`) and tooling (`tools/peer_review/`): three independent
  readings per document, line-by-line comparison with the key, rulings with a quoted printed line, sign-off list.
  The review itself has not been run yet; its result will be logged here.
- No change to documents, keys, scorer or the bar.

## 2026-11-11 — first shared version

- **Documents.** 130 open documents: 24 from the Milestone 3 audit, 53 archive files added in October, and 53
  added now (typed recipes, scanned kitchen pages, a product-label photo, two non-recipes, five generated invoices).
  Nine documents used in earlier measurements are not included because they carry, or were built from a file that
  carries, a third-party confidentiality notice: six archive files, both "Duck Pancakes" files and the held-out
  document derived from them. 25 further documents are
  held back by the owner as a blind set.
- **Scorer, three rules tightened** (earlier published figures were slightly generous in these cases):
  1. An optional key line no longer stands in for a required line that was read wrong or missed.
  2. A failed or missing job now counts all of that document's expected lines as missed.
  3. Lines returned for a non-recipe count as unflagged errors when they carry no review flag, for every pipeline.
- **Scorer, additions.** Results format `nexus-results-v1` for an application under test; unit spellings `cu`, `bu`,
  `ltrs`; one command (`nexus_test.py`) with a PASS/FAIL verdict; self-tests; a check that every key line is printed
  in its document.
- **Effect on earlier figures.** Re-scored with the tightened rules, the reference pipeline on the 52 October
  archive documents reads 99.1% (was 99.3%); its result on the first 27 documents is unchanged (99.6%). Those figures include documents that are no longer in the set.
