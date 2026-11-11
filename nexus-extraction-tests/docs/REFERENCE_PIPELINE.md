# Reference pipeline

`reference/runner.ts` is a working extraction pipeline that meets the bar. It is here so the team can see one
way of doing it, read its prompts and checks, and compare outputs document by document. The application does not
have to work this way; it has to pass the test.

Background, measurements and the reasoning behind each choice: `docs/reports/EXTRACTION_OPTIMIZATION_REPORT.pdf`
(sections 9 and 11, and Appendix B for the prompts).

## What it does

| Step | What happens | Model |
|---|---|---|
| 1. Read the file | Word, workbooks and PDFs with a usable text layer become text. Images, scans, and PDFs whose text layer holds no amounts go to the photo route. | none |
| 2a. Typed text | **Line-reference mode.** Every printed line is numbered (`[12] 2 cups sugar`) and the model answers with line numbers plus the name, amount and unit as printed. Code resolves the numbers back to the printed lines, so every entry is tied to its evidence. Texts over about 5,200 characters are first split at recipe starts and read in parallel. | Gemini 3.8 Flash, thinking low |
| 2b. Photos and scans | **Evidence-first mode.** The model copies each printed line as evidence beside the name, amount and unit. | Gemini 3.8 Flash, medium resolution |
| 3. Check | Code checks on every line; any failure turns the line amber (flagged for review). | none |

The model is a transcriber. It never converts, computes or fills in a default; code does that.

## Code checks (in `score.py`, `ef_flag` and `ef_recipe_lines`)

A line is flagged when:

- its amount, unit or name is not found in the printed line it points to, or that line is not in the document;
- the amount cannot be parsed;
- the printed line shows an amount but the entry has none, or shows more amounts than were read ("2 lb, 4 oz" read as "2 lb");
- the name holds a second ingredient with its own amount, or starts with a unit word and no unit was read ("cloves garlic");
- the unit is not one the application can cost (not in `backend/src/costing/units.ts`);
- the line shows a number but no amount was read ("Juice of 1 orange");
- the model marked the line hard to read;
- there is no text to check against (photos and scans): the line stays flagged unless a second, independent read agrees.

Code also sums printed sums ("1 lb, 2 oz" → 18 oz) and moves a leading counting word from the name to the unit.

## File-reader fixes it applies (`READER_FIX=1`)

Measured on the archive documents, these mattered more than the choice of model (report §11):

1. Old **.xls** workbooks are not read by the backend. The reference run uses converted .xlsx copies
   (`documents/*/conv/`, listed in `cases_open.json`). The application must accept the .xls files themselves
   (`cases_open_raw.json`).
2. Word **automatic list numbers** are rendered as text, so "1 cup" does not become "cup".
3. Manual **line breaks** inside a Word paragraph start a new line.
4. A Word file that holds **only an image** goes to the photo route.
5. A PDF whose **text layer holds amounts** is read as text even when it carries images such as a logo.

## Running it

It uses the backend's own readers (`prepareInput`, `textChunks`), so point it at a backend checkout with its
dependencies installed. It runs against both the Sprint 3 commit and the October 26 branch.

```bash
python3 nexus_test.py cases                      # cases_open.json (.xls files as converted .xlsx)
cd <backend> && export NEXUS_BACKEND=$PWD GEMINI_API_KEY=...
export READER_FIX=1 EF_SHEETS=1 EF_IMAGES=auto EF_MEDIA=MEDIUM LR_COMPACT=1 LR_OUTLINE=1 LR_CHUNK=4000
npx tsx <tests>/reference/runner.ts "lr-gemini:gemini-3.8-flash" <tests>/cases_open.json <tests>/out/reference 3 4
cd <tests> && python3 nexus_test.py score out/reference
```

Other arms: `lr-claude:<model>`, `lr-openai:<model>`, `ef-gemini:<model>`, `ef-claude:<model>`, `ef-openai:<model>`,
and `text` (no model call; writes the text the pipeline would number, which is useful for debugging a file reader).
`ONLY=case1,case2` limits the cases. Finished jobs are skipped, so a run can be resumed.

| Setting | Effect |
|---|---|
| `LR_COMPACT=1` | One-letter output keys, expanded in code (about 19% fewer output tokens). |
| `LR_OUTLINE=1`, `LR_CHUNK=4000` | Long texts: a small call lists where recipes begin; the text is split only there. |
| `EF_MEDIA=MEDIUM\|HIGH` | Image resolution for photos. |
| `EF_SHEETS=1` | One call per workbook sheet. |
| `READER_FIX=1` | The reader fixes above. |

The scorer applies the reference checks to reference outputs (`CHECKS_V2`, `CHECKS_V3`, `NORMALIZE`, all on by default
in `nexus_test.py`). Results written in the `nexus-results-v1` format are scored on the flags the application itself
reports.

## Measured results

See `results/` for the latest reference run on this document set and `CHANGELOG.md` for its date. Earlier
measurements on parts of the set are in the report.
