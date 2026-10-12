# Extraction benchmark (Milestone 3 audit)

The live test behind §5.9 of `MILESTONE_3_AUDIT_REPORT.pdf`: 17 cases built from our own documents, run 5 times
each through the delivered M3 extraction code and through the recommended evidence-first pipeline, scored line by
line against hand-made answer keys.

## What is here

| Path | Contents |
|---|---|
| `documents/` | The test files: recipe Word files, the Collard Greens chapter, the B&B event sheet, a 5-sheet subset of the Bond Brothers master workbook (staff sheet removed), the three Diego Salazar recipe-testing PDFs, the Matt & Nat invoice, a phone-photo version of it, and a synthetic distributor invoice (case packs, catch weight, total-only line, fuel surcharge, credit). The Brown Butter fixture is read from `backend/test/fixtures/`. |
| `gold.py` | The answer keys: every expected line with its amount and unit, accepted alternatives, method-only ingredients, and invoice line combinations. `python3 gold.py` writes `cases.json`. |
| `text/` | The text each document gives the model (as M3 extracts it), plus hand transcriptions of the handwritten cards (`*.transcript.txt`) used as the scoring source. |
| `runner.ts` | Runs one setup over all cases. M3 setups call the delivered extractors and apply the same post-processing as `documents.queue.ts`; `ef-*` setups run the evidence-first prompts. Records timing, tokens and model version per call. |
| `score.py` | Classifies every extracted line (correct, wrong value, invented, merged, unlisted, duplicate, missed) and applies the production-style code checks that flag lines. |
| `autoref.py` | Automatic answer key for the three long documents: every item printed with an amount. |
| `report.py`, `final_numbers.py`, `agree.py`, `detail.py` | Summary table, the numbers used in the brief, cross-vendor agreement, and a per-line inspector. |
| `results/` | `results.json` (the brief's numbers) and `raw-outputs.tar.gz` (every model response that was scored). |
| `tools/` | Helpers used to build the inputs (text dumps, workbook subset). |

## Running it

Requirements: the backend's dependencies installed (`cd backend && npm ci`), Python 3 with no extra packages,
and `poppler-utils` (`pdfimages`, `pdftotext`) for the PDF photo route.

```bash
# keys live outside the repository; never commit them
export GEMINI_API_KEY=...            # Google AI Studio key
export ANTHROPIC_API_KEY=...         # optional, for Claude setups
export ANTHROPIC_WORKSPACE_ID=...    # only for user-level keys that are not scoped to a workspace

cd audit/extraction-benchmark && python3 gold.py            # writes cases.json
cd ../../backend

# M3 as delivered (gemini mode, default alias)
npx tsx ../audit/extraction-benchmark/runner.ts "m3-gemini:gemini-flash-lite-latest" \
  ../audit/extraction-benchmark/cases.json ../audit/extraction-benchmark/out/m3-gemini_gemini-flash-lite-latest 5 3

# recommended pipeline (evidence-first prompt, photos at full resolution, one call per sheet)
EF_SHEETS=1 EF_IMAGES=auto EF_MEDIA=HIGH npx tsx ../audit/extraction-benchmark/runner.ts "ef-gemini:gemini-3.8-flash" \
  ../audit/extraction-benchmark/cases.json ../audit/extraction-benchmark/out/final-gemini_gemini-3.8-flash 5 3

cd ../audit/extraction-benchmark
python3 report.py out/m3-gemini_gemini-flash-lite-latest out/final-gemini_gemini-3.8-flash
```

Setups: `m3-gemini:<model>`, `m3-pair`, `m3-claude:<model>`, `ef-gemini:<model>`, `ef-claude:<model>`.
Arguments after the setup: cases file, output folder, runs per case, parallel jobs. Finished jobs are skipped, so
an interrupted run can be resumed. `ONLY=case1,case2` limits the cases.

To re-score the published run without calling any model: `tar -xzf results/raw-outputs.tar.gz` and run `report.py`
on the folders in `out/`.

## Reading the scores

- **Unflagged errors** are the ones that matter most: a wrong or invented value that reaches the review screen with
  no warning. M3 shows no warnings at all, so all its errors count as unflagged.
- The code checks in `score.py` (`ef_flag`) were tightened after the first round on these same documents, so the
  recommended pipeline's numbers are optimistic. Add new documents with answer keys before trusting a change.
- Costs use list prices of Oct 12, 2026 (`score.PRICE`); update them when prices change.
