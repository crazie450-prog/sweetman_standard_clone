#!/usr/bin/env python3
"""Test the running Nexus application directly, through its API, the way the browser does.

For every test document and run it signs in, uploads the file (POST /api/documents), waits for the background
worker, reads what the review screen would show (GET /api/documents/:id, plus every other document the same file
produced) and writes a results file the scorer reads (docs/RESULTS_FORMAT.md). It never confirms anything, so no
ingredient, price, stock or recipe changes; and it deletes its uploads afterwards unless --keep is given.

  export NEXUS_APP_URL=https://staging.example.com      # the API origin; http://localhost:8000 for a local backend
  export NEXUS_EMAIL=...  NEXUS_PASSWORD=...            # a staff, manager or owner account in a TEST organization
  python3 nexus_test.py cases --raw
  python3 adapters/nexus-app/run_app_test.py cases_open_raw.json out/app-<commit> --runs 3 --parallel 3
  python3 nexus_test.py score out/app-<commit>

Options: --only id1,id2   --timeout 300 (seconds per upload)   --keep (leave the uploads in the application)
         --location <id> (location for invoices; default: the account's first location)
Credentials are read from the environment and are never written anywhere. Python 3.9+, no packages needed.
Finished jobs are skipped, so an interrupted run can be resumed.
"""
import argparse, http.cookiejar, json, mimetypes, os, sys, threading, time, urllib.error, urllib.request, uuid
from concurrent.futures import ThreadPoolExecutor

DONE = {"requires_review", "failed", "confirmed", "partially_processed"}
MIME = {".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".csv": "text/csv",
        ".txt": "text/plain"}


class App:
    def __init__(self, base, email, password):
        self.base, self.email, self.password = base.rstrip("/"), email, password
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.lock = threading.Lock()
        self.me = self.login()

    def login(self):
        req = urllib.request.Request(self.base + "/api/auth/login", data=json.dumps({"email": self.email, "password": self.password}).encode(),
                                     headers={"content-type": "application/json"})
        return json.load(self.opener.open(req, timeout=60))

    def call(self, method, path, body=None, headers=None, tries=6):
        """JSON request; signs in again when the session has expired and waits out rate limits."""
        for attempt in range(tries):
            req = urllib.request.Request(self.base + path, data=body, method=method, headers=headers or {})
            try:
                raw = self.opener.open(req, timeout=180).read()
                return json.loads(raw) if raw else None
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf8", "replace")[:300]
                if e.code == 401 and attempt < tries - 1:
                    with self.lock:
                        self.login()
                elif e.code in (429, 502, 503, 504) and attempt < tries - 1:
                    time.sleep(min(60, 5 * 2 ** attempt))
                else:
                    raise RuntimeError("%s %s -> HTTP %d: %s" % (method, path, e.code, detail))
            except urllib.error.URLError as e:
                if attempt == tries - 1:
                    raise RuntimeError("%s %s -> %s" % (method, path, e.reason))
                time.sleep(3 * (attempt + 1))

    def upload(self, path, doc_type, location):
        boundary = uuid.uuid4().hex
        name = os.path.basename(path)
        ctype = MIME.get(os.path.splitext(name)[1].lower()) or mimetypes.guess_type(name)[0] or "application/octet-stream"
        body = (("--%s\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\n%s\r\n" % (boundary, doc_type)).encode()
                + ("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\nContent-Type: %s\r\n\r\n" % (
                    boundary, name.replace('"', ""), ctype)).encode()
                + open(path, "rb").read() + ("\r\n--%s--\r\n" % boundary).encode())
        headers = {"content-type": "multipart/form-data; boundary=" + boundary}
        if location:
            headers["x-location-id"] = location
        return self.call("POST", "/api/documents", body, headers), headers.get("x-location-id")

    def wait(self, doc_id, location, deadline):
        h = {"x-location-id": location} if location else {}
        while True:
            d = self.call("GET", "/api/documents/" + doc_id, headers=h)
            if d["status"] in DONE:
                return d
            if time.time() > deadline:
                raise RuntimeError("still %s after the time limit" % d["status"])
            time.sleep(1.5)


def review_reasons(detail):
    """Lines the review screen marks, by line index and by name, from what the application reports today.
    When the application adds its own per-line review marker, lines carry it directly (see line_flag)."""
    by_index, by_name = {}, {}
    for j in detail.get("priceJumps") or []:
        by_index[j.get("line")] = "price jump: stated %s, now %s" % (j.get("stated"), j.get("now"))
    for m in detail.get("matches") or []:
        if m.get("needsAccept") or m.get("conflict"):
            by_index.setdefault(m.get("line"), "match must be accepted" if m.get("needsAccept") else "match conflict")
    for u in detail.get("unconverted") or []:
        by_name[(u.get("rawName") or "").strip().lower()] = "unit %s cannot be converted to %s" % (u.get("from"), u.get("to"))
    return by_index, by_name


def line_flag(line, index, by_index, by_name):
    own = line.get("needsReview") or line.get("needs_review") or line.get("reviewReason") or line.get("warnings")
    if own:
        return str(line.get("reviewReason") or line.get("warnings") or "marked for review")[:120]
    return by_index.get(index) or by_name.get((line.get("rawName") or "").strip().lower())


def to_result(doc_type, details):
    recipes, invoices = [], []
    for d in details:
        p = d.get("extraction") or {}
        by_index, by_name = review_reasons(d)
        if doc_type == "recipe" and p.get("kind") == "recipe":
            items = list(p.get("items") or []) + [l for s in p.get("subRecipes") or [] for l in s.get("items") or []]
            lines = []
            for i, l in enumerate(items):
                why = line_flag(l, i, by_index, by_name)
                lines.append(dict(name=l.get("rawName"), quantity=None if l.get("amountMissing") else l.get("quantity"),
                                  unit=None if l.get("amountMissing") else (l.get("unit") or None), quantity_text=l.get("quantityText"),
                                  needs_review=bool(why), review_reason=why))
            recipes.append(dict(title=p.get("name"), lines=lines))
        elif doc_type == "invoice" and p.get("kind") == "invoice":
            lines = []
            for i, l in enumerate(p.get("items") or []):
                why = line_flag(l, i, by_index, by_name)
                lines.append(dict(name=l.get("rawName"), sku=l.get("sku"), quantity=l.get("quantity"), unit=l.get("unit") or None,
                                  unit_price=l.get("unitPrice"), line_total=l.get("lineTotal"),
                                  kind={"charge": "fee", "credit": "credit"}.get(l.get("kind"), "item"), needs_review=bool(why), review_reason=why))
            invoices.append(dict(vendor=p.get("vendorName"), number=p.get("number"), date=p.get("invoiceDate"), lines=lines))
    return dict(recipes=recipes) if doc_type == "recipe" else dict(invoices=invoices)


def job(app, case, run, a, location):
    out = os.path.join(a.outdir, "%s__%d.json" % (case["id"], run))
    if os.path.exists(out):
        return
    rec = dict(format="nexus-results-v1", case=case["id"], run=run, type=case["type"], via="app-api")
    t0, ids, loc = time.time(), [], None
    try:
        created, loc = app.upload(case["path"], case["type"], location if case["type"] in ("invoice", "sales") else None)
        ids.append(created["id"])
        deadline = t0 + a.timeout
        d = app.wait(created["id"], loc, deadline)
        if d.get("reusedFrom") and d["status"] == "requires_review":  # the same file was uploaded before: force a fresh read
            app.call("POST", "/api/documents/%s/read-again" % d["id"], headers={"x-location-id": loc} if loc else {})
            d = app.wait(created["id"], loc, deadline)
            rec["read_again"] = True
        details = [d]
        for s in d.get("siblings") or []:  # one file can become several documents
            ids.append(s["id"])
            details.append(app.wait(s["id"], loc, deadline))
        rec["ms"] = int(1000 * (time.time() - t0))
        rec["app_status"] = [x["status"] for x in details]
        failed = [x for x in details if x["status"] == "failed"]
        if failed:  # the application shows "could not be read": nothing is imported, which is right only for a non-document
            rec["refused"] = "; ".join(str(x.get("error"))[:160] for x in failed)
        rec.update(to_result(case["type"], [x for x in details if x["status"] != "failed"]))
    except Exception as e:  # a crash, a rejected upload or a timeout fails the job
        rec["error"] = str(e)[:500]
        rec["ms"] = int(1000 * (time.time() - t0))
    if not a.keep:
        for i in ids:
            try:
                app.call("DELETE", "/api/documents/" + i, headers={"x-location-id": loc} if loc else {}, tries=2)
            except Exception:
                rec.setdefault("not_deleted", []).append(i)
    json.dump(rec, open(out, "w"), indent=1)
    print("%s#%d %s %dms" % (case["id"], run, "ERR " + rec["error"][:110] if rec.get("error") else "ok", rec["ms"]), flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("cases"); p.add_argument("outdir")
    p.add_argument("--runs", type=int, default=3); p.add_argument("--parallel", type=int, default=3)
    p.add_argument("--timeout", type=int, default=300); p.add_argument("--only"); p.add_argument("--location")
    p.add_argument("--keep", action="store_true")
    a = p.parse_args()
    missing = [k for k in ("NEXUS_APP_URL", "NEXUS_EMAIL", "NEXUS_PASSWORD") if not os.environ.get(k)]
    if missing:
        sys.exit("Set " + ", ".join(missing) + " in the environment.")
    app = App(os.environ["NEXUS_APP_URL"], os.environ["NEXUS_EMAIL"], os.environ["NEXUS_PASSWORD"])
    locations = app.me.get("locations") or []
    location = a.location or (locations[0]["id"] if locations else None)
    print("Signed in to %s as %s (%s, %s); invoices go to location %s" % (app.base, app.me.get("email"), app.me.get("role"),
          app.me.get("organizationName"), next((l["name"] for l in locations if l["id"] == location), location)))
    cases = json.load(open(a.cases))
    if a.only:
        cases = [c for c in cases if c["id"] in set(a.only.split(","))]
    os.makedirs(a.outdir, exist_ok=True)
    jobs = [(c, r) for r in range(1, a.runs + 1) for c in cases]  # run by run, so the same file is not in flight twice
    with ThreadPoolExecutor(a.parallel) as ex:
        list(ex.map(lambda cr: job(app, cr[0], cr[1], a, location), jobs))
    print("done: %d jobs in %s" % (len(jobs), a.outdir))


if __name__ == "__main__":
    main()
