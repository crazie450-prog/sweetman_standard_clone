# Test procedure

This document says how the extraction test is run and how its numbers are produced. The commercial terms that
depend on the result are in the Statement of Work; where the two differ, the Statement of Work governs.

## 1. What is tested

The path from an uploaded file to the lines on the review screen: file reading, the model call or calls, the
application's parsing and unit mapping, and its review flags. Matching lines to catalogue ingredients, costing and
confirmation are out of scope.

| Set | Documents | Who has it | Purpose |
|---|---|---|---|
| Open set | 130 (this repository) | Development team and owner | Development and regression gate |
| Blind set | 25 | Owner only | Confirms the open-set result holds on documents the team has not seen |

The open set holds 117 recipe-type uploads and 13 invoice-type uploads: Word files (.doc and .docx), Excel
workbooks (.xls and .xlsx), PDFs, handwritten recipe cards, scanned kitchen pages, photos, a CSV, one
66,000-character banquet packet, and nine files that are not what the upload says they are (menus, a product sheet,
a blank template, a dish photo, an invoice uploaded as a recipe, a recipe uploaded as an invoice). The blind set has
the same mix on a smaller scale. [DOCUMENTS.md](DOCUMENTS.md) lists every open document.

## 2. Running a test

1. `python3 nexus_test.py check` must print `CHECK: OK`.
2. `python3 nexus_test.py cases --raw` writes `cases_open_raw.json`: id, file path and upload type for each document.
   Files are given exactly as a user would upload them, including old .xls workbooks.
3. Upload every document to the application under test **3 times** (3 independent runs; no result may be reused
   from an earlier run, so any "same file seen before" cache must be off or cleared between runs). Write one results
   file per document and run ([RESULTS_FORMAT.md](RESULTS_FORMAT.md)). `adapters/nexus-backend/export-results.ts` does this for the
   Nexus backend.
4. `python3 nexus_test.py score <folder>` prints the report and `RESULT: PASS` or `RESULT: FAIL`. Exit code 0 means pass.

Record with every reported run: the commit of the application, the model IDs, the date, and the full output of step 4.
Keep the results folder; the owner may ask for it.

A full run is 390 uploads. With the reference pipeline it takes about 15 minutes at 4 uploads in parallel and costs
a few dollars of model usage.

## 3. The bar

| Check | Passes when |
|---|---|
| Line accuracy | at least 98.0% over all scored documents and runs |
| Interval | the low end of the 95% interval is also at least 98.0% |
| Unflagged errors | none, in any document, in any run |
| Jobs | none failed or missing |

The interval is a bootstrap over documents (whole documents are resampled, all their runs together), so it says how
much the result depends on which documents were tested. An accuracy of 98.2% with an interval of 96.5–99.4 does not
pass: it means a different batch of documents could well land below the bar.

## 4. How a line is judged

Each line the application returns is compared with the key for that document.

| Outcome | Meaning | Effect |
|---|---|---|
| **Correct** | Same ingredient, same amount, same unit as printed. | Counts toward accuracy. |
| **Wrong value** | Right ingredient, wrong amount or unit (a missing amount or unit counts as wrong when one is printed, and the reverse). | Error. |
| **Invented** | An ingredient that is not printed in the document, or an amount that is not printed near it. | Error. |
| **Merged** | Two ingredients with their own amounts returned as one line. | Error. |
| **False import** | Any line returned for a file that is not what the upload says it is. | Error. |
| **Missed** | A key line with no matching line returned. | Lowers accuracy (it is in the denominator) but is not an "error", so it needs no flag. |
| Method-only ingredient | An ingredient that appears only in the method text, returned as a line. | Not scored. |
| Duplicate | A second line for an ingredient already matched. | Not scored; listed in the report. |
| Optional key line | A line the document prints ambiguously, or only in prose. | Not scored either way. |

**Accuracy** = correct required lines ÷ (required key lines + errors). Both missing a line and adding a wrong one
lower it, so returning less cannot raise the score.

**Amounts.** Fractions, mixed numbers and decimals are equal when their values are (1 1/2 = 1.5). A printed range
("2-3") accepts either end. A printed sum ("1 lb, 2 oz"; "1/2 c plus 2 Tbsp") must be returned as its total, in
either unit. "To taste", "as needed" and a bare ingredient name have no amount: the quantity must be `null`.

**Units.** Compared after normalising spelling (`T`, `Tbsp`, `Tbl.` → tbsp; `#`, `lbs` → lb; `C`, `c.`, `cu` → cup;
`Q` → qt). No unit and `ea` are the same. A different unit is wrong even if it could be converted: the application
must not convert units while reading.

**Invoices.** A product line is correct when quantity, unit and unit price all match the key (for a catch-weight
line, either the weight with its price per pound or the case count with the case price). Fees, deposits and
delivery charges must not be returned as stock items. Credit lines must carry a negative quantity, price or total.
The header (invoice number and date) is reported but is not part of the accuracy figure.

**Non-recipes and wrong-type uploads.** The right answer is no lines at all.

**The long packet** (`n_saucier`, about 100 recipes) is scored against every amount printed in it and reported on
its own line. It is not part of the accuracy figure, but an unflagged error in it fails the run.

## 5. Flagged and unflagged errors

No reader is perfect, so the test asks a second question of every error: *did the application warn the reviewer?*
An error is **flagged** when the application marks that line for review (`needs_review: true`) before it can be
confirmed. It is **unflagged** when the line looks as trustworthy as any other. One unflagged error fails the run,
because it is a wrong number that reaches food cost with nobody the wiser.

Flags cost reviewer time, so the report also prints the share of all lines that carry a flag. Flagging everything
would pass this check and make the review screen useless; the reference pipeline flags about 3% of lines. A flag
must come from a check the application really runs on that line (the amount is not in the document text, the unit
is not one the app can cost, a line total does not equal quantity × price, a second read disagrees), not from the
document's id or type.

## 6. When to run it

- Before any change to prompts, model IDs or settings, file readers, parsing or review checks is merged.
- When a model provider changes a model or its alias, and at least monthly.
- Before each delivery. The delivery note states the commit and includes the `score` output.

## 7. The blind check

After the team reports a pass on the open set, the owner runs the same commit on the open set and on the 25 blind
documents (`nexus_test.py score <folder> --set blind`, with the private pack present). The blind set is small, so
its interval is wide; it is read as a check on the open result:

- the same unflagged-error and failed-job rules apply in full;
- blind accuracy well below the open-set figure means the open result does not generalise, and the owner shares the
  failing *kinds* of line (not the documents) so the cause can be fixed.

Blind documents are never sent to the team. From time to time some are moved into the open set and replaced.

## 8. Changing the test

Keys, documents, the scorer and the bar are changed only by the owner's side, with an entry in `CHANGELOG.md`. The
team proposes changes through the process in [ANSWER_KEYS.md](ANSWER_KEYS.md). After any change to keys or scorer,
earlier results are re-scored so numbers stay comparable; saved results folders make that possible.
