"""Render every line-keyed test document to PDF, the way a person would see it on screen, for the reviewer that
reads pages instead of extracted text. Needs LibreOffice (soffice).

  python3 tools/peer_review/render_pdfs.py <outdir> [--set open|blind|all]
Writes <outdir>/<case id>.pdf (or a copy of the original for PDFs and images) and <outdir>/cases_rendered.json.
"""
import json, os, shutil, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
import gold

out = os.path.abspath(sys.argv[1])
which = sys.argv[sys.argv.index("--set") + 1] if "--set" in sys.argv else "open"
ids = {"open": gold.OPEN, "blind": list(gold.BLIND), "all": gold.OPEN + list(gold.BLIND)}[which]
os.makedirs(out, exist_ok=True)
cases, failed = [], []
for c in ids:
    v = gold.CASES[c]
    if v["type"] == "recipe" and v["kind"] != "trap" and gold.R[c]["lines"] is None:
        continue  # long documents are keyed automatically from their printed amounts, not line by line
    src = v.get("raw", v["path"])
    ext = os.path.splitext(src)[1].lower()
    if ext in (".pdf", ".jpg", ".jpeg", ".png"):
        dst = os.path.join(out, c + ext)
        shutil.copy2(src, dst)
    else:
        dst = os.path.join(out, c + ".pdf")
        if not os.path.exists(dst):
            with tempfile.TemporaryDirectory() as tmp:
                work = os.path.join(tmp, "doc" + ext)
                shutil.copy2(src, work)
                subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", tmp, work], capture_output=True, timeout=180)
                made = os.path.join(tmp, "doc.pdf")
                if os.path.exists(made):
                    shutil.move(made, dst)
                else:
                    failed.append(c)
                    continue
    cases.append(dict(id=c, path=dst, type=v["type"]))
json.dump(cases, open(os.path.join(out, "cases_rendered.json"), "w"), indent=1)
print("%d documents rendered to %s%s" % (len(cases), out, "; could not render: %s" % failed if failed else ""))
