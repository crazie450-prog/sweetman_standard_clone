"""Regenerate docs/DOCUMENTS.md from the answer keys:  python3 tools/list_documents.py"""
import os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import gold, nexus_test

KIND = {"word": "Word / text", "sheet": "Excel workbook", "pdf": "PDF with text", "handwritten": "handwritten card (PDF)",
        "photo": "scan or photo", "invoice": "invoice", "trap": "not the stated type"}
sets = [("First set (24)", [c for c in gold.OPEN if c not in gold.NEW and c not in gold.SET3]),
        ("Archive set (53)", list(gold.NEW)), ("Set 3 (53)", list(gold.SET3))]
out = ["# Test documents (open set)\n",
       "Generated from the answer keys by `tools/list_documents.py`. \"Scored lines\" is the number of required key lines"
       " (for invoices: product and credit lines).\n"]
for title, cases in sets:
    out += ["\n## %s\n" % title, "| Case id | File | Upload type | Kind | Scored lines |", "|---|---|---|---|---|"]
    for c in cases:
        v = gold.CASES[c]
        f = os.path.relpath(v.get("raw", v["path"]), gold.DOCS)
        n = nexus_test.expected_lines(gold, c)
        note = " (long document, reported separately)" if c in gold.LONG else ""
        out.append("| `%s` | `%s` | %s | %s | %s%s |" % (c, f, v["type"], KIND.get(v["kind"], v["kind"]),
                                                       n if v["kind"] != "trap" else "must return nothing", note))
open(os.path.join(ROOT, "docs", "DOCUMENTS.md"), "w").write("\n".join(out) + "\n")
print("wrote docs/DOCUMENTS.md (%d documents)" % sum(len(c) for _, c in sets))
