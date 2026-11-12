"""The answer-key peer review: comparison, anonymised options, rulings and the sign-off list (no model calls)."""
import contextlib, io, json, os, sys, tempfile, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools", "peer_review"))
import gold, score
import peer_review as pr

first = lambda x: next((v for v in (x if isinstance(x, tuple) else (x,)) if v is not None), None)


def reading(case):
    """What a reader that agrees with the key on every line would return."""
    if gold.CASES[case]["type"] == "invoice":
        g = gold.INV[case]
        return dict(format=score.RESULTS_FORMAT, case=case, run=1, type="invoice", invoices=[dict(
            vendor=g["vendor"], number=g["number"], date=g["date"], lines=[dict(
                name=l["names"][0], sku=l["sku"], quantity=l["ok"][0][0], unit=l["ok"][0][1], unit_price=l["ok"][0][2],
                line_total=l["total"], kind=l["kind"]) for l in g["lines"]])])
    return dict(format=score.RESULTS_FORMAT, case=case, run=1, type="recipe", recipes=[dict(title="x", lines=[
        dict(name=names[0], quantity=first(q), unit=first(u)) for names, q, u, fl in gold.R[case]["lines"]])])


def three(case, change=None):
    rs = {r: reading(case) for r in ("claude", "gemini", "openai")}
    if change:
        change(rs["gemini"])
    return rs


class Compare(unittest.TestCase):
    def test_all_agree_certifies_every_line(self):
        for case in ("s_demi", "s_inv_seafood", "s_coleslaw"):
            lines, disputes = pr.review_case(case, three(case))
            self.assertEqual(disputes, [], case)
            self.assertTrue(lines and all(l["certified"] for l in lines), case)

    def test_one_reader_differs_on_an_amount(self):
        def change(r):
            r["recipes"][0]["lines"][0]["quantity"] = 55
        lines, disputes = pr.review_case("s_demi", three("s_demi", change))
        self.assertEqual([d["kind"] for d in disputes], ["value"])
        self.assertEqual(sum(1 for l in lines if not l["certified"]), 1)
        opts = pr.options(disputes[0])
        self.assertEqual(len(opts), 2)
        self.assertEqual(sorted(h for _a, _t, hs in opts for h in hs), ["claude", "gemini", "key", "openai"])
        self.assertEqual(next(hs for _a, t, hs in opts if "55" in t), ["gemini"])
        self.assertEqual(opts, pr.options(disputes[0]))  # the order is fixed per point, not per call

    def test_one_reader_leaves_a_line_out_and_adds_one(self):
        def change(r):
            r["recipes"][0]["lines"].pop(1)
            r["recipes"][0]["lines"].append(dict(name="black truffle oil", quantity=2, unit="tbsp"))
        _lines, disputes = pr.review_case("s_demi", three("s_demi", change))
        self.assertEqual(sorted(d["kind"] for d in disputes), ["absent", "extra"])
        absent = next(d for d in disputes if d["kind"] == "absent")
        self.assertIn(["gemini"], [hs for _a, t, hs in pr.options(absent) if t == pr.NOT_PRINTED])
        extra = next(d for d in disputes if d["kind"] == "extra")
        self.assertEqual(sorted(next(hs for _a, t, hs in pr.options(extra) if t == pr.NOT_PRINTED)), ["claude", "key", "openai"])

    def test_non_recipe_read_as_a_recipe(self):
        rs = {r: dict(format=score.RESULTS_FORMAT, case="s_trap_legends_menu", run=1, type="recipe", recipes=[]) for r in ("claude", "gemini", "openai")}
        self.assertEqual(pr.review_case("s_trap_legends_menu", rs)[1], [])
        rs["openai"]["recipes"] = [dict(title="soup", lines=[dict(name="lobster", quantity=1, unit="lb")])]
        self.assertEqual([d["kind"] for d in pr.review_case("s_trap_legends_menu", rs)[1]], ["trap"])

    def test_invoice_price_and_header(self):
        def change(r):
            r["invoices"][0]["lines"][0]["unit_price"] = 1.0
            r["invoices"][0]["number"] = "X-1"
        _lines, disputes = pr.review_case("s_inv_seafood", three("s_inv_seafood", change))
        self.assertEqual(sorted(d["kind"] for d in disputes), ["header", "value"])


class Writing(unittest.TestCase):
    def test_printed_sum_is_left_to_the_scorer(self):
        answer = dict(is_recipe=True, recipes=[dict(title="t", lines=[
            dict(printed_line="1 lb 2 oz butter", name="butter", amount_text="1 lb 2 oz", amount=1, unit=""),
            dict(printed_line="2 cups milk", name="milk", amount_text="2", amount=2, unit="cups"),
            dict(printed_line="salt", name="salt", amount_text="", amount=None, unit="")])])
        lines = score.v1_recipe_lines(pr.to_results("c", "recipe", answer, "m"))[0]
        self.assertEqual([(l["name"], l["qty"], l["unit"]) for l in lines], [("butter", 18, "oz"), ("milk", 2, "cup"), ("salt", None, None)])
        self.assertEqual(pr.to_results("c", "recipe", dict(is_recipe=False, recipes=[]), "m")["recipes"], [])

    def test_gemini_schema(self):
        g = pr.gemini_schema(pr.RECIPE_SCHEMA)
        line = g["properties"]["recipes"]["items"]["properties"]["lines"]["items"]
        self.assertEqual((g["type"], line["properties"]["amount"]), ("OBJECT", {"type": "NUMBER", "nullable": True}))
        self.assertNotIn("additionalProperties", json.dumps(g))


class Ruling(unittest.TestCase):
    def setUp(self):
        def change(r):
            r["recipes"][0]["lines"][0]["quantity"] = 55
        self.d = pr.review_case("s_demi", three("s_demi", change))[1][0]
        self.key = next(a for a, _t, hs in pr.options(self.d) if "key" in hs)
        self.other = next(a for a, _t, hs in pr.options(self.d) if "key" not in hs)

    def test_outcomes(self):
        quote = "50 lbs. veal bones"
        rule = lambda **kw: pr.decide(self.d, dict(dict(id=self.d["id"], printed_line=quote, choice=self.key, ambiguous=False, reason="r"), **kw), "s_demi")
        self.assertEqual((rule()["outcome"], rule()["quote_in_file_text"]), ("key stands", True))
        self.assertEqual(rule(choice=self.other)["outcome"], "key changes")
        self.assertEqual(rule(ambiguous=True)["outcome"], "not scored")
        self.assertEqual(rule(choice="none")["outcome"], "owner to decide")
        self.assertEqual(rule(printed_line="55 lbs. veal bones")["outcome"], "owner to decide")  # a quote the file does not hold
        self.assertEqual(pr.decide(self.d, {}, "s_demi")["outcome"], "owner to decide")  # the model skipped the point

    def test_rule_and_report_end_to_end(self):
        with tempfile.TemporaryDirectory() as out:
            os.makedirs(os.path.join(out, "rendered"))
            pr.save([dict(id="s_demi", path="/nowhere/s_demi.pdf", type="recipe")], os.path.join(out, "rendered", "cases_rendered.json"))
            def change(r):
                r["recipes"][0]["lines"][0]["quantity"] = 55
            for reader, r in three("s_demi", change).items():
                os.makedirs(os.path.join(out, "readings", reader))
                pr.save(r, os.path.join(out, "readings", reader, "s_demi__1.json"))
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(pr.cmd_compare(out, []), 0)
                seen = {}
                def fake(vendor, model, system, path, question, schema):
                    seen["q"] = question
                    return dict(rulings=[dict(id="s_demi#1", printed_line="50 lbs. veal bones", choice=self.key, ambiguous=False, reason="printed 50")]), "judge-1"
                self.assertEqual(pr.cmd_rule(out, [], ask=fake), 0)
                self.assertNotIn("gemini", seen["q"])  # the ruling model is not told whose reading is whose
                self.assertNotIn("key", seen["q"].lower().replace("turkey", ""))
                self.assertEqual(pr.cmd_report(out, []), 0)
            with open(os.path.join(out, "SIGNOFF.md")) as f:
                md = f.read()
            self.assertIn("## Key confirmed (1)", md)
            self.assertIn("50 lbs. veal bones (found in the file text)", md)


if __name__ == "__main__":
    unittest.main()
