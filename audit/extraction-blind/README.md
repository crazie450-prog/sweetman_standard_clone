# Blind extraction test set (PRIVATE)

25 documents the development team has never seen, with answer keys. **Do not copy this folder into the shared
test repository (`nexus-extraction-tests`) and do not send it to the development team.**

- `documents/raw/` the files as uploaded; `documents/conv/` .xlsx copies of the .xls files (for the reference
  pipeline only); `documents/fixed/` the text of each file (scoring source; for scans, a transcript).
- `gold_blind.py` the answer keys (15 typed recipes, 3 scanned kitchen pages, 2 non-recipes) and
  `documents/gold_invoices.json` (5 generated invoices; `tools/gen_invoices_set3.py blind` in the shared repository
  regenerates them).

## Running the blind check

From a checkout of `nexus-extraction-tests`:

```bash
export NEXUS_BLIND_PACK=<this folder>
python3 nexus_test.py check                                  # must report "blind pack loaded: 25 documents"
python3 nexus_test.py cases --set blind --raw --out $NEXUS_BLIND_PACK/cases_blind_raw.json

# run the application on the blind documents, 3 runs each (from the backend folder)
DOCUMENT_EXTRACTOR=gemini GEMINI_API_KEY=... \
  npx tsx <tests>/adapters/nexus-backend/export-results.ts $NEXUS_BLIND_PACK/cases_blind_raw.json <tests>/out/blind-<commit> 3 3

python3 nexus_test.py score out/blind-<commit> --set blind --details
```

Read the result as described in `docs/TEST_PROCEDURE.md`, section 7. When telling the team about failures, describe
the kind of line that failed, not the document.

No file here carries a confidentiality notice. Keys were written from the documents before any model read them and
pass the same consistency check as the open set.
