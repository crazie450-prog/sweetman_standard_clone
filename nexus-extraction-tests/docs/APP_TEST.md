# Testing the running application

`adapters/nexus-app/run_app_test.py` tests a deployed Nexus application (staging, or a local backend) from the
outside, through the same API the browser uses. It is the check that counts for a delivery: it covers the upload
rules, the queue and worker, the file readers, the model calls, the parsing and the review checks together.

## What it does

For every test document and run it:

1. signs in (`POST /api/auth/login`);
2. uploads the file as a user would (`POST /api/documents`, with the location header for invoices);
3. waits for the background worker (`GET /api/documents/:id` until the document is ready for review or failed);
4. reads what the review screen would show, including every other document the same file produced;
5. writes a results file ([RESULTS_FORMAT.md](RESULTS_FORMAT.md)) and deletes its upload.

It **never confirms** a document, so no ingredient, price, stock level or recipe changes. If the application says
it reused an earlier reading of the same file, the runner asks for a fresh read (`read-again`), so the three runs
stay independent. An upload the application rejects or fails is recorded as a failed job.

## Running it

Use a **test organization**, never a customer's. The account needs permission to upload documents and, for
invoices, access to one location.

```bash
export NEXUS_APP_URL=https://<staging host>
export NEXUS_EMAIL=<test account>  NEXUS_PASSWORD=<password>
python3 nexus_test.py cases --raw
python3 adapters/nexus-app/run_app_test.py cases_open_raw.json out/app-<commit> --runs 3 --parallel 3
python3 nexus_test.py score out/app-<commit>
```

Options: `--only id1,id2`, `--timeout 300` (seconds per upload), `--location <id>`, `--keep` (leave the uploads in
the application to look at them on the review screen). Finished jobs are skipped, so a run can be resumed.
Credentials are read from the environment and are never written anywhere. Python 3.9+, no packages.

## Which lines count as flagged

The scorer needs to know which lines the review screen marks before they can be confirmed. The runner takes that
from what the application reports for the document:

| The application reports | Flagged line |
|---|---|
| a per-line review marker (`needsReview`, `reviewReason` or `warnings` on the line) | that line |
| a price jump (`priceJumps`) | the invoice line with that index |
| a match that needs accepting or conflicts (`matches[].needsAccept`, `conflict`) | the line it belongs to |
| a unit that could not be converted (`unconverted`) | the line with that name |

At the Sprint 3 commit (`8ee3112`) the application has no per-line review marker for a doubtful *reading* (an amount
that is not in the document, a total that does not add up), so a misread line is reported as unflagged. When the
team adds such a marker under another field name, `line_flag()` in the runner is the one place to map it.

## Checked against

The runner was exercised against a local copy of the Sprint 3 backend with its stub extractor: sign-in, uploads of
every file type, waiting, read-again after a reused reading, rejected uploads, and clean-up (no document left
behind). Old `.xls` workbooks are rejected at upload by that commit (`FILE_TYPE_UNSUPPORTED`) and therefore count
as failed jobs.
