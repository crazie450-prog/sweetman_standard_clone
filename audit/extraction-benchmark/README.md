# Extraction benchmark (Milestone 3 audit)

The live test behind §5.9 of `MILESTONE_3_AUDIT_REPORT.pdf`: 17 cases built from our own documents, run 5 times
each through the delivered M3 extraction code and through the recommended evidence-first pipeline, scored line by
line against hand-made answer keys.

It is also the harness behind `EXTRACTION_OPTIMIZATION_REPORT.pdf`, which adds 10 held-out cases, the
line-reference mode and the time and cost study (see "Optimization study" below).

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
| `results/` | `results.json` (the brief's numbers) and `raw-outputs.tar.gz` (every model response that was scored); `study.json`, `cascade.json`, `costmodel.json`, `review.json` and `study-outputs.tar.gz` for the optimization study. |
| `tools/` | Helpers used to build the inputs (text dumps, workbook subset). |
| `documents/new/` | §11 of the optimization report: real files from the owner's recipe archive (`raw/`, 53 committed of 59: Word .doc/.docx, Excel .xls/.xlsx, Compass recipe-print PDFs, a photo, non-recipes, a 66k-character banquet packet), the .xls files converted to .xlsx (`conv/`), the text each file gives with the reader fixes (`fixed/`, the scoring source), and a transcription of the one image-only Word file (`transcripts/`). Never used to tune prompts. Proprietary recipes: keep this repository private. |
| `gold_new.py` | Answer keys for `documents/new/` (775 lines with the six confidential documents' keys in `gold_new_private.py`, which is not committed), plus `KEY_AUDIT`, the log of key corrections made after the first runs. |
| `new_study.py`, `audit_new.py` | §11 tables (accuracy by configuration and by document kind, the long packet), and a grouped list of every scored error for auditing the key. |
| `repair.py`, `size_route_new.py` | The two §11 experiments not adopted: a repair call on flagged lines, and routing short documents to a cheaper model. |
| `documents/holdout/` | The 10 held-out cases: six recipe documents that keep our formats with new content, three generated invoice PDFs and a photographed produce invoice (`gen_invoices.py` draws them and writes their key, `gold_invoices.json`). Never used to tune prompts. |
| `study.py`, `cascade.py` | Optimization study: accuracy (with a bootstrap interval over documents), time and cost per configuration, on dev and held-out sets; escalation simulations. |
| `costmodel.py`, `review.py` | Cost per document type and per monthly scenario (today's prices and 2027's); share of lines staff must check. |
| `group.py`, `percase.py`, `unflagged.py`, `missed_ref.py` | Split check (no line moved to another recipe), per-case breakdown, and two error inspectors. |

## Running it

Requirements: the backend's dependencies installed (`cd backend && npm ci`), Python 3 with no extra packages,
and `poppler-utils` (`pdfimages`, `pdftotext`) for the PDF photo route.

```bash
# keys live outside the repository; never commit them
export GEMINI_API_KEY=...            # Google AI Studio key
export ANTHROPIC_API_KEY=...         # optional, for Claude setups
export ANTHROPIC_WORKSPACE_ID=...    # only for user-level keys that are not scoped to a workspace

cd audit/extraction-benchmark && python3 gold.py            # writes cases.json, cases_holdout.json, cases_all.json
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

Setups: `m3-gemini:<model>`, `m3-pair`, `m3-claude:<model>`, `ef-gemini:<model>`, `ef-claude:<model>`,
`lr-gemini:<model>`, `lr-claude:<model>`, `lr-openai:<model>`, `ef-openai:<model>` (`OPENAI_API_KEY`), and `text`
(no model call: records the text the line-reference route would number, or `null` for the photo route).
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

## Optimization study

`EXTRACTION_OPTIMIZATION_REPORT.pdf` sets the bar at 98% line accuracy (with the bootstrap interval also at or
above 98%) and zero unflagged errors, then compares time and cost. Every configuration read all 27 cases
(`cases_all.json`) 3 times.

**Line-reference mode** (`lr-gemini`, `lr-claude`): the app numbers each printed line (`[12] 2 cups sugar`) and
the model answers with line numbers, which code resolves back to the printed line. Photos, PDFs that carry photos
and scans fall back to the evidence-first route. Settings, all read from the environment:

| Variable | Effect |
|---|---|
| `LR_COMPACT=1` | One-letter output keys, expanded in code (output tokens about 19% fewer). |
| `LR_OUTLINE=1` with `LR_CHUNK=4000` | Texts over about 5,200 characters: a Flash-Lite call lists where recipes begin, and the text is split only there; pieces run in parallel. `LR_OUTLINE_MODEL` overrides the outline model. |
| `LR_CHUNK=<chars>` alone | Fixed-size split at blank lines (cuts recipes in half; kept for comparison only). |
| `LR_THINK=low\|minimal` | Gemini thinking level for line-reference calls (3.8 Flash does not accept `minimal`). |
| `EF_MEDIA=MEDIUM\|HIGH` | Gemini media resolution for photos. |
| `GEMINI_TIER=flex` | Gemini Flex tier (half price, best-effort queue); `score.py` bills it at 50%. |
| `CL_CACHE=1`, `CL_THINK=disabled`, `CL_EFFORT=low` | Claude prompt caching, thinking off, effort level. |

Recommended pipeline A, as run for the report (typed text and photos are separate runs; `study.py` combines them):

```bash
cd backend
EF_SHEETS=1 EF_IMAGES=auto EF_MEDIA=HIGH LR_COMPACT=1 LR_OUTLINE=1 LR_CHUNK=4000   npx tsx ../audit/extraction-benchmark/runner.ts "lr-gemini:gemini-3.8-flash"   ../audit/extraction-benchmark/cases_all.json ../audit/extraction-benchmark/out/study/lr-g38-fast 3 3
EF_SHEETS=1 EF_IMAGES=auto EF_MEDIA=MEDIUM ONLY=pavlova_pdf,lasagna_pdf,linguine_pdf,invoice_photo,h3_produce_photo   npx tsx ../audit/extraction-benchmark/runner.ts "lr-gemini:gemini-3.8-flash"   ../audit/extraction-benchmark/cases_all.json ../audit/extraction-benchmark/out/study/photo-g38-medium 3 3
npx tsx ../audit/extraction-benchmark/runner.ts "lr-claude:claude-haiku-5-5"   ../audit/extraction-benchmark/cases_all.json ../audit/extraction-benchmark/out/study/lr-haiku 3 3   # second read on photos
```

Scoring (no model calls; unpack `results/raw-outputs.tar.gz` and `results/study-outputs.tar.gz` first to
re-score the published runs):

```bash
cd audit/extraction-benchmark
CHECKS_V2=1 STUDY_OUT=study.json python3 study.py     # Table 1 and Appendix A
CHECKS_V2=1 CASCADE_OUT=cascade.json python3 cascade.py
python3 costmodel.py && python3 review.py             # Tables 4-6
```

`CHECKS_V2=1` turns on the two checks added in the study (line accounting on shared lines, unit inside the name).
They were written after the second round of runs, so confirm them on new documents before relying on them.

**Testing a new model**: run it as above into `out/study/<name>`, add its folder to
`CONFIGS` in `study.py` and its price to `PRICE` in `score.py`, and re-run `study.py`. The report's decision
rule: at least 98% with the interval at or above 98% on both dev and held-out sets, no unflagged errors, handwriting
no worse than 3.8 Flash, and cheaper or faster than pipeline A at equal accuracy.

Gemini 4 Argon was tested this way on October 13, 2026 (`out/study/lr-g4-fast` for typed text and
`out/study/photo-g4-medium` for photos; `results/gemini4_*.json` hold the re-read and cost simulations).

OpenAI models (`lr-openai:<model>`, `OA_EFFORT=low|medium|unset`, `OA_DETAIL` for photos) were tested the same
way on October 14 (`out/study/lr-oa-*`; `results/study.json` includes them). gpt-6-luna for typed text cleared
the bar on the 27 documents at about a quarter of pipeline A's cost, but not on the new real documents below.

## New real documents (report §11)

59 files from the owner's archive, keyed from the documents before any run. `READER_FIX=1` applies fixes to
M3's file readers before extraction, so their effect can be measured: Word list numbers and line breaks rendered
as text, an image-only Word file sent to the photo route, and a PDF whose text layer holds amounts read as text
even when it carries a logo. M3 cannot read .xls at all, so `cases_new.json` points at the converted .xlsx files
and `cases_new_raw.json` at the files as received.

```bash
cd audit/extraction-benchmark && python3 gold.py       # writes cases_new.json and cases_new_raw.json too
cd ../../backend
B=../audit/extraction-benchmark; FAST="LR_COMPACT=1 LR_OUTLINE=1 LR_CHUNK=4000"
export EF_SHEETS=1 EF_IMAGES=auto
env READER_FIX=1 $FAST EF_MEDIA=MEDIUM npx tsx $B/runner.ts "lr-gemini:gemini-3.8-flash" $B/cases_new.json $B/out/new/A-fixed 3 4
env              $FAST EF_MEDIA=MEDIUM npx tsx $B/runner.ts "lr-gemini:gemini-3.8-flash" $B/cases_new_raw.json $B/out/new/A-delivered 3 4
env READER_FIX=1 $FAST EF_MEDIA=MEDIUM npx tsx $B/runner.ts "lr-gemini:gemini-3.5-flash-lite" $B/cases_new.json $B/out/new/C-fixed 3 4
env READER_FIX=1 npx tsx $B/runner.ts "lr-claude:claude-haiku-5-5" $B/cases_new.json $B/out/new/B-fixed 3 4
env READER_FIX=1 npx tsx $B/runner.ts "lr-openai:gpt-6-luna" $B/cases_new.json $B/out/new/luna-fixed 3 4

cd $B   # score (unpack results/new-outputs.tar.gz first to re-score the published runs)
CHECKS_V2=1 python3 new_study.py                         # Table 9, 10: checks as frozen before this set
CHECKS_V2=1 CHECKS_V3=1 NORMALIZE=1 python3 new_study.py # Table 11: + the two checks and the counting-word fix
```

`CHECKS_V3=1` adds two checks written after seeing this set's errors: a unit the app cannot cost (not in
`backend/src/costing/units.ts`), and a printed number with no amount read. `NORMALIZE=1` moves a leading
counting word ("cloves garlic") from the name to the unit. The scorer also handles what these documents print:
compound amounts summed in one base unit (key lines flagged `"compound"`), Word's fraction slash, "<1/8", "2 Q".
None of these changes alters a number reported for the original 27 documents.

Six documents carry a third-party confidentiality notice (the five Compass Group "Recipe Print" PDFs and Ricotta
Gnocchi, marked "Confidential Property of Wolfgang Puck Fine Dining"). They, their texts, their keys
(`gold_new_private.py`) and their raw outputs are kept out of the repository until the owner confirms they may be
stored here. The published tables include them; without those files the harness scores the other 52 documents. The banquet packet (`n_saucier`) is
scored against every amount printed in it (`autoref.ref_saucier`) and reported separately from accuracy.
