# Answer-key peer review

The answer keys decide what counts as right, so they are checked by readers that had no part in writing them.

## The rule

1. **Three independent readings.** Three models from three vendors (Google, Anthropic, OpenAI) each read every
   document page by page and write down every ingredient line or invoice row. None of them sees the answer key,
   the other readings, or any text extracted by our own file readers: they get the page as a person sees it.
2. **Line-by-line comparison.** Each reading is scored against the key with the same scorer the test uses.
   A key line that all three readings match is **certified**.
3. **Every disagreement is ruled on.** A disagreement is any of: a reader gives a different amount or unit; a reader
   does not list a key line; a reader lists a line the key does not have; a reader finds lines in a document the
   key says is not a recipe or invoice; a reader gives a different invoice number or date.
   A separate model then gets the document and the competing readings as lettered options in random order, without
   being told which is the key's. It must copy the printed line that settles the point and choose.
4. **The quote is checked by code.** For typed documents the quoted line must really be in the file's text;
   a ruling whose quote is not there counts for nothing and goes to the owner. For scans and photos the owner checks
   the page.
5. **Outcomes.**

   | Ruling | What happens |
   |---|---|
   | Key stands | Nothing changes; the point is listed with its printed line. |
   | Key changes | The key is corrected and the correction logged in `CHANGELOG.md`. |
   | Ambiguous in the document | The line is marked not scored (`opt`). A document with several such lines is replaced, and the replacement goes through the same review. |
   | Owner to decide | No option was right, the ruling model skipped the point, or the quote was not found. |

6. **Sign-off.** `SIGNOFF.md` lists every ruled point: file, printed line, what the key says, what the readers
   said, the ruling and the reason. The owner signs off on that list. Nothing is changed in a key without an entry.

The ruling model comes from the vendor that neither wrote the keys (the keys were drafted with Claude) nor runs the
pipelines under test (Gemini). Different models can be set with `PEER_GEMINI_MODEL`, `PEER_CLAUDE_MODEL`,
`PEER_OPENAI_MODEL` and `PEER_JUDGE=<vendor>:<model>`.

## What is not covered

- The six long documents with automatic keys (`lines=None`): their reference is every amount printed in the
  document, produced by code (`autoref.py`), not a hand-made key.
- Invoice vendor names and fee rows that a reader left out: neither is part of accuracy.
- Whether the *rules* of the key format are right (for example, that a printed range counts as its first figure).
  Those are in [ANSWER_KEYS.md](ANSWER_KEYS.md) and [TEST_PROCEDURE.md](TEST_PROCEDURE.md) and are agreed between
  the parties, not by models.

## Running it

Needs Python 3.9+, LibreOffice (`soffice`) to render pages, and API keys for the three vendors in the environment
(`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Keys are sent in request headers only and are never
written to disk or printed.

```bash
python3 tools/peer_review/render_pdfs.py out/peer/rendered --set open   # every document as pages
python3 tools/peer_review/peer_review.py write   out/peer               # three readings per document
python3 tools/peer_review/peer_review.py compare out/peer               # review.json: certified and disputed lines
python3 tools/peer_review/peer_review.py rule    out/peer               # rulings.json
python3 tools/peer_review/peer_review.py report  out/peer               # SIGNOFF.md
```

The owner reviews the blind documents the same way, in a private folder: `NEXUS_BLIND_PACK=<pack> ... render_pdfs.py <private>/rendered --set blind`.

`write` and `rule` skip what is already done, so an interrupted run can be resumed. `write --only id1,id2` reviews
single documents (a replacement, or a key that was corrected). The readings are ordinary results files, so
`python3 nexus_test.py score out/peer/readings/<reader> --runs 1` also shows how each reader scores against the keys.

## Review log

Each completed review is recorded in `CHANGELOG.md` with the date, the models, the counts from `SIGNOFF.md` and
the key lines that changed.
