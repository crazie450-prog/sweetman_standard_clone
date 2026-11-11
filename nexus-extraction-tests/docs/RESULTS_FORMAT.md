# Results format (`nexus-results-v1`)

One JSON file per document and run, named `<case id>__<run>.json`, all in one folder. `nexus_test.py score <folder>`
reads them. Case ids and file paths come from `cases_open_raw.json` (`python3 nexus_test.py cases --raw`).

The file must describe **what the application would show on its review screen for that upload**, after all of the
application's own parsing, unit mapping and checks, and before a person edits anything.

## Recipe document

```json
{
  "format": "nexus-results-v1",
  "case": "s_demi",
  "run": 1,
  "type": "recipe",
  "ms": 2300,
  "recipes": [
    {
      "title": "demi glace",
      "lines": [
        { "name": "veal bones", "quantity": 50, "unit": "lb", "needs_review": false, "review_reason": null },
        { "name": "salt", "quantity": null, "unit": null, "needs_review": false, "review_reason": null },
        { "name": "olive oil", "quantity": 0.625, "unit": "cup", "needs_review": true,
          "review_reason": "amount printed as a sum" }
      ]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `format` | Always `"nexus-results-v1"`. |
| `case`, `run` | The case id and the run number (1, 2, 3). |
| `ms` | Wall-clock time for this upload in milliseconds (optional; used for the timing lines). |
| `recipes` | Every recipe the application would create from the file. Lines of sub-recipes and components go in the `lines` of the recipe that holds them, or in a recipe entry of their own; both score the same. An empty list means the application imports nothing. |
| `name` | The ingredient as the application shows it. |
| `quantity` | The amount as a number, or `null` when the document prints none ("to taste"). Never `0` or a default. A printed range ("2-3") is its first figure. A printed sum ("1 lb, 2 oz") is the total, in either unit. |
| `quantity_text` | Optional. The amount as printed; used only when `quantity` is `null` and this is given. |
| `unit` | The unit as the application stores it (`cup`, `tbsp`, `lb`, `ea`, ...) or as printed. Common spellings are accepted (`T`, `Tbl.`, `c.`, `#`, `qts`, `each`). Do not convert to another unit, except for a printed sum. `null` and `ea` both mean a count. |
| `needs_review` | `true` when the application marks this line so that a person must look at it before it can be confirmed. |
| `review_reason` | Optional short reason shown to the reviewer. |

## Invoice document

```json
{
  "format": "nexus-results-v1",
  "case": "s_inv_seafood",
  "run": 1,
  "type": "invoice",
  "ms": 1900,
  "invoices": [
    {
      "vendor": "Pacific Rim Seafood Co.",
      "number": "PR-48817",
      "date": "2026-10-21",
      "lines": [
        { "name": "Salmon Fillet Atlantic PBO", "sku": "SF-1107", "quantity": 22.5, "unit": "lb",
          "unit_price": 11.85, "line_total": 266.63, "kind": "item", "needs_review": false },
        { "name": "Ice & packing", "sku": null, "quantity": 1, "unit": null,
          "unit_price": 12.0, "line_total": 12.0, "kind": "fee", "needs_review": false }
      ]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `vendor`, `number`, `date` | Invoice header; `date` as `YYYY-MM-DD`. |
| `quantity`, `unit`, `unit_price` | What will be used for stock and price: the shipped quantity, its unit, and the price per that unit. For a catch-weight line either the weight with the price per pound, or the case count with the price per case, is accepted. |
| `line_total` | The printed line total. |
| `kind` | `item` (a product that goes to stock), `credit` (a returned or credited product: negative quantity, price or total), or `fee` / `deposit` / `discount` / `other` (never a stock item). The backend's `product` and `charge` are accepted as `item` and `fee`. |
| `needs_review`, `review_reason` | As for recipes. |

## Failures and refusals

- The application refuses the file as "not this type" or finds nothing: write the file with empty `recipes` /
  `invoices`. For the nine documents that are not what they claim to be, that is the right answer.
- The job crashes or times out: write `{"format": "nexus-results-v1", "case": ..., "run": ..., "type": ..., "error": "what happened"}`.
  A failed or missing job fails the run, and all its expected lines count as missed.
