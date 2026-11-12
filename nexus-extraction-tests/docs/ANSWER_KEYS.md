# Answer keys

## How the keys were made

Every key was written by reading the document itself (for scans and photos, the image) before any model output was
looked at. After the first runs, every disagreement between a model and a key was checked against the document;
where the key was wrong it was corrected and the correction logged (`KEY_AUDIT` in `gold_new.py`, `CHANGELOG.md`).
Keys for the generated invoices come from the same data that draws them (`tools/gen_invoices_*.py`).

`python3 nexus_test.py check` verifies, for every required key line, that its ingredient name and its amount are
really printed in the document text.

The keys are then peer reviewed: three models from three vendors read every document without seeing the key, the
readings are compared with the key line by line, and every disagreement is ruled on from the printed line and
listed for the owner's sign-off. The procedure and its tooling are in [KEY_REVIEW.md](KEY_REVIEW.md); completed
reviews are logged in `CHANGELOG.md`.

## Where they are

| File | Documents |
|---|---|
| `gold.py` | The first 24: recipe Word files, a cookbook chapter, event sheets, a master workbook, three handwritten recipe cards, invoices (real, photographed and generated). |
| `gold_new.py` | 53 files from the owner's archive (October 2026): old Word and Excel files, an image-only Word file, non-recipes, the long banquet packet. |
| `gold_set3.py` | 53 more (November 2026): typed recipes, scanned kitchen pages, a product-label photo, non-recipes, five generated invoices. |
| `documents/*/gold_invoices.json` | Invoice keys written by the generators. |

## Recipe key format

```python
R["s_balsamic_vinaigrette"] = dict(recipes=1, lines=[
    (["olive oil"], 30, "tsp", "compound"),               # printed "1/2 c plus 2 Tbsp"
    (["balsamic vinegar"], 1 / 3, "cup", ""),
    (["minced shallots", "shallots"], 1, "tbsp", ""),
    (["salt"], None, None, ""),                           # printed with no amount
], unlisted=["oil"])
```

Each line is `(names, quantity, unit, flags)`.

- **names**: accepted spellings. A returned name matches when it shares at least half of its significant words
  with one of them, or one name contains the other (words such as "fresh", "chopped", "large" and unit words are
  ignored).
- **quantity**: a number; a tuple of accepted numbers (a printed range, or an amount printed two ways); or `None`
  when the document prints no amount.
- **unit**: the normalised unit; a tuple of accepted units; or `None`.
- **flags**: `"opt"` not scored (prose-only, a component heading, or an ambiguous printed amount); `"alt_none"` a
  missing amount is also accepted ("pinch of salt"); `"compound"` the printed amount is a sum, and quantity/unit
  hold its total in ounces or teaspoons (any unit of the same kind is accepted).
- **unlisted**: ingredients that appear only in the method text. Returning them is not scored.
- **recipes**: how many recipes the file holds (a range where a sub-recipe may or may not be split out). Reported,
  not part of accuracy.

Six long documents have `lines=None` (two cookbook chapters, two event sheets, a master workbook and the banquet
packet). They are scored against an automatic list of every amount printed in them (`autoref.py`): a printed
amount counts as found when a returned line has its ingredient, amount and unit, and every returned line must be
printed in the document. The first five count toward accuracy; the banquet packet is reported separately.

## Invoice key format

```json
{"vendor": "pacific rim seafood", "number": "PR-48817", "date": "2026-10-21", "lines": [
  {"names": ["salmon fillet atlantic", "salmon fillet"], "sku": "SF-1107", "ok": [[22.5, "lb", 11.85]], "total": 266.63, "kind": "item"},
  {"names": ["ice packing", "ice"], "sku": null, "ok": [[1, null, 12.0]], "total": 12.0, "kind": "fee"}]}
```

`ok` lists the accepted (quantity, unit, unit price) combinations. `kind` is `item`, `credit` or `fee`.

## If a key looks wrong

Keys are not edited to make a run pass. To question one:

1. Run `python3 nexus_test.py score <folder> --details` and find the line.
2. Open the document (`documents/...`; [DOCUMENTS.md](DOCUMENTS.md) gives the file for each case id) and check what
   is printed.
3. Send the owner's side the case id, the key line, what the document prints (a screenshot or the printed line),
   and the reading you believe is right.

If the document supports your reading, the key is corrected, the change is logged in `CHANGELOG.md`, and earlier
results are re-scored. If the document is genuinely ambiguous, the line is made optional. If the key is right, the
answer says why.

## Things the documents do that are deliberate

These are real files, and their quirks are the test:

- Word files that hold amounts in automatic list numbering, in tables read column by column, or in one line with
  several ingredients ("Sachet – 1 bunch thyme, 6 piece crushed garlic, 3 bay leaves").
- Old .xls workbooks; workbooks with several recipes per sheet and with units in a column header.
- Amounts printed as sums, as built-up fractions ("11⁄4" for 1¼), with "<", with units such as `#`, `Q`, `cu`,
  `bu`, `cs`, and with typos ("earscorn", "l ea").
- Lines with no amount, lists of names only, prose-only recipes (nothing is required from those).
- Scanned pages and photos with no text layer.
- Files that are not recipes, and an invoice uploaded as a recipe.
