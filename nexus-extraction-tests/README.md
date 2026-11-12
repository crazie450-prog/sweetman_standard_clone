# Nexus extraction tests

The acceptance test for document extraction in the Nexus Restaurant Management Platform: 130 test documents with
hand-made answer keys, a scorer, and one command that prints PASS or FAIL.

The development team runs it during development. The product owner runs the same test, plus 25 blind documents
that are not in this repository, to check a delivery.

## What it measures

A document goes into the application; the ingredient lines (recipes) or line items (invoices) the application
would show on its review screen come out. The scorer compares them with the answer key, line by line.

| The bar | |
|---|---|
| **Line accuracy** | at least **98.0%**, with the low end of its 95% interval also at or above 98.0% |
| **Unflagged errors** | **zero**: every wrong or invented line must carry a review flag |
| **Failed or missing jobs** | **zero** |

Accuracy = lines read exactly right ÷ (lines expected + wrong, invented or falsely imported lines). A line is right
when its ingredient, amount and unit all match the document. Details: [docs/TEST_PROCEDURE.md](docs/TEST_PROCEDURE.md).

## Quick start

Needs Python 3.9+ (no packages) and, to run the application, the backend with its dependencies installed.

```bash
# 1. Check this checkout: documents present, keys consistent, scorer self-tests
python3 nexus_test.py check

# 2. Write the case lists (absolute paths for this checkout)
python3 nexus_test.py cases --raw          # cases_open_raw.json: the files exactly as a user would upload them

# 3. Run the application's extraction on every document, 3 runs each (from the backend folder)
cd <the_sweetman_standard>/backend
DOCUMENT_EXTRACTOR=gemini GEMINI_API_KEY=... \
  npx tsx <tests>/adapters/nexus-backend/export-results.ts <tests>/cases_open_raw.json <tests>/out/my-run 3 3

# 4. Score it
cd <tests> && python3 nexus_test.py score out/my-run            # add --details to list every wrong line
```

Step 3 is an adapter around the backend's own extraction code. It writes one small JSON file per document and run
in the format described in [docs/RESULTS_FORMAT.md](docs/RESULTS_FORMAT.md). Any other way of producing those files
(an API export, an end-to-end test) works just as well. **The adapter must report what the review screen would
show, including which lines are flagged for review.**

API keys are read from the environment and are never written to disk. Do not commit keys or `out/`.

### Testing a deployed application

To test staging (or any running backend) from the outside, through the API the browser uses, replace step 3 with:

```bash
export NEXUS_APP_URL=https://<staging host>  NEXUS_EMAIL=<test account>  NEXUS_PASSWORD=<password>
python3 adapters/nexus-app/run_app_test.py cases_open_raw.json out/app-run --runs 3 --parallel 3
```

It uploads each document, waits for the worker, reads what the review screen would show and deletes its uploads.
It never confirms anything. Use a test organization. Details: [docs/APP_TEST.md](docs/APP_TEST.md).

## What is in the repository

| Path | Contents |
|---|---|
| `nexus_test.py` | The test command: `check`, `cases`, `score`. |
| `documents/` | The 130 test documents: recipes in Word (.doc, .docx), Excel (.xls, .xlsx), PDF, scans and photos; invoices in PDF, photo, Excel and CSV; and 9 files that are not what they claim to be and must produce nothing. [docs/DOCUMENTS.md](docs/DOCUMENTS.md) lists them. |
| `gold.py`, `gold_new.py`, `gold_set3.py` | The answer keys. [docs/ANSWER_KEYS.md](docs/ANSWER_KEYS.md) explains the format and how to question a key. |
| `score.py`, `study.py`, `autoref.py` | The scorer. |
| `tests/` | Self-tests for the scorer and consistency checks for the keys. |
| `adapters/nexus-backend/` | Export script for the Nexus backend's extraction code (the team owns and maintains it). |
| `adapters/nexus-app/` | Runner for a deployed application, through its API. [docs/APP_TEST.md](docs/APP_TEST.md). |
| `reference/` | A working reference pipeline that meets the bar, with its prompts and code checks. [docs/REFERENCE_PIPELINE.md](docs/REFERENCE_PIPELINE.md). |
| `docs/` | Test procedure, results format, key rules and their peer review, the application test, document list, reference pipeline, and the optimization study report. |
| `tools/` | Generators for the synthetic invoices; the answer-key peer review (`tools/peer_review/`, [docs/KEY_REVIEW.md](docs/KEY_REVIEW.md)). |

## Rules of the road

- **Do not tune on single documents.** Fix causes (a reader, a prompt rule, a check), then re-run everything.
- **Do not edit keys or the scorer to make a run pass.** If a key looks wrong, follow the process in
  [docs/ANSWER_KEYS.md](docs/ANSWER_KEYS.md); corrections are made by the product owner's side and logged.
- **Run all 130 documents, 3 runs each,** before any change to prompts, models, file readers or checks ships.
- The documents are the owner's working recipes. Keep this repository private.
