"""Self-tests for the scorer: run with `python3 nexus_test.py check` or `python3 -m unittest discover tests`."""
import json, os, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
for k in ("CHECKS_V2", "CHECKS_V3", "NORMALIZE"):
    os.environ.setdefault(k, "1")
import gold, score, study, nexus_test


def line(name, qty, unit, review=False):
    return dict(name=name, quantity=qty, unit=unit, needs_review=review, review_reason="test" if review else None)


def write(folder, case, run, **body):
    json.dump(dict(format="nexus-results-v1", case=case, run=run, type=gold.CASES[case]["type"], ms=1000, **body),
              open(os.path.join(folder, "%s__%d.json" % (case, run)), "w"))


def perfect(case):
    """A results body that reads every required key line of a recipe case exactly right."""
    lines = []
    for names, q, u, fl in gold.R[case]["lines"]:
        if "opt" in fl:
            continue
        q = q[0] if isinstance(q, tuple) else q
        u = u[0] if isinstance(u, tuple) else u
        lines.append(line(names[0], q, u))
    return dict(recipes=[dict(title=case, lines=lines)])


def evaluate(folder):
    return {(r["case"], r["run"]): r for r in score.evaluate(folder)}


class Amounts(unittest.TestCase):
    def test_quantities(self):
        for text, want in [("1 1/2", 1.5), ("½", 0.5), ("1-1/4", 1.25), ("11⁄4", 1.25), ("1⁄2", 0.5), ("<1/8", 0.125),
                           ("2-3", 2), ("2 or 3", 2), (".6", 0.6), ("3 ½", 3.5), ("to taste", None), (None, None)]:
            got = score.parse_qty(text)
            self.assertTrue(got == want or (got is not None and abs(got - want) < 1e-9), (text, got, want))

    def test_units(self):
        for text, want in [("T", "tbsp"), ("t", "tsp"), ("Tbl.", "tbsp"), ("TB", "tbsp"), ("c.", "cup"), ("cu", "cup"), ("C", "cup"),
                           ("#", "lb"), ("lbs.", "lb"), ("Q", "qt"), ("qts", "qt"), ("bu", "bunch"), ("ltrs", "l"), ("each", "ea"),
                           ("cloves", "clove"), ("sprigs of", "sprig"), ("14 oz cans", "can"), ("large pinch", "pinch"), ("", None)]:
            self.assertEqual(score.canon_unit(text), want, text)

    def test_compound_amounts(self):
        self.assertEqual(score.compound_total("2 lb, 4 oz"), (36.0, "oz"))
        self.assertEqual(score.compound_total("1/3 cup, 2 tbsp, 1-1/4 tsp"), (23.25, "tsp"))
        self.assertEqual(score.compound_total("1 T + 2 tsp"), (5.0, "tsp"))
        self.assertEqual(score.compound_total("9#8oz"), (152.0, "oz"))
        self.assertIsNone(score.compound_total("1 lb"))


class Scoring(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_perfect_reading_scores_100(self):
        for case in ("brown_butter", "s_demi", "n_caesar", "s_scan_lobster_stock"):
            write(self.tmp, case, 1, **perfect(case))
        for (case, _), r in evaluate(self.tmp).items():
            x = r["res"]
            self.assertEqual(x["correct_required"], x["gold_required"], case)
            self.assertFalse(any(x.get(k) for k in study.ERR + ("missed",)), case)

    def test_wrong_amount_wrong_unit_and_missed_line(self):
        body = perfect("s_demi")
        body["recipes"][0]["lines"][0]["quantity"] = 5       # veal bones 50 lb -> 5 lb
        body["recipes"][0]["lines"][1]["unit"] = "kg"        # carrots 5 lb -> 5 kg
        del body["recipes"][0]["lines"][5]                   # port wine dropped
        write(self.tmp, "s_demi", 1, **body)
        x = evaluate(self.tmp)[("s_demi", 1)]["res"]
        self.assertEqual((x["wrong_value"], x["missed"], x["correct_required"], x["err_unflagged"]), (2, 1, 3, 2))

    def test_review_flag_makes_an_error_flagged(self):
        body = perfect("s_demi")
        body["recipes"][0]["lines"][0].update(quantity=5, needs_review=True, review_reason="amount not found in the document")
        write(self.tmp, "s_demi", 1, **body)
        x = evaluate(self.tmp)[("s_demi", 1)]["res"]
        self.assertEqual((x["wrong_value"], x.get("err_unflagged", 0), x["err_flagged"]), (1, 0, 1))

    def test_invented_ingredient_is_an_error(self):
        body = perfect("s_demi")
        body["recipes"][0]["lines"].append(line("saffron threads", 2, "g"))
        write(self.tmp, "s_demi", 1, **body)
        x = evaluate(self.tmp)[("s_demi", 1)]["res"]
        self.assertEqual((x["invented"], x["err_unflagged"]), (1, 1))

    def test_optional_line_never_stands_in_for_a_required_one(self):
        body = perfect("s_cesar_dressing")
        body["recipes"][0]["lines"] = [l for l in body["recipes"][0]["lines"] if l["name"] != "egg"] + [line("dry mustard", 0.5, "tsp")]
        write(self.tmp, "s_cesar_dressing", 1, **body)
        r = evaluate(self.tmp)[("s_cesar_dressing", 1)]
        self.assertEqual(r["res"]["missed"], 1)
        self.assertEqual(study.found(r), r["res"]["gold_required"] - 1)

    def test_compound_key_line_accepts_the_total_in_any_unit(self):
        body = perfect("s_balsamic_vinaigrette")
        body["recipes"][0]["lines"][0].update(quantity=0.625, unit="cup")   # 1/2 c plus 2 Tbsp
        write(self.tmp, "s_balsamic_vinaigrette", 1, **body)
        x = evaluate(self.tmp)[("s_balsamic_vinaigrette", 1)]["res"]
        self.assertEqual(x["correct_required"], x["gold_required"])

    def test_non_recipe_must_return_nothing(self):
        write(self.tmp, "s_trap_legends_menu", 1, recipes=[])
        write(self.tmp, "s_trap_legends_menu", 2, recipes=[dict(title="Legends", lines=[line("crab cakes", None, None)])])
        got = evaluate(self.tmp)
        self.assertEqual(got[("s_trap_legends_menu", 1)]["res"]["trap_pass"], 1)
        self.assertEqual((got[("s_trap_legends_menu", 2)]["res"]["false_import"], got[("s_trap_legends_menu", 2)]["res"]["err_unflagged"]), (1, 1))

    def test_invoice_lines_fees_and_header(self):
        g = gold.INV["s_inv_bakery_xlsx"]
        lines = [dict(name=l["names"][0], sku=l["sku"], quantity=l["ok"][0][0], unit=l["ok"][0][1], unit_price=l["ok"][0][2],
                      line_total=l["total"], kind="fee" if l["kind"] == "fee" else "item", needs_review=False) for l in g["lines"]]
        lines[0]["unit_price"] = 1.0  # wrong price
        write(self.tmp, "s_inv_bakery_xlsx", 1, invoices=[dict(vendor="Baker's Mill Supply", number=g["number"], date=g["date"], lines=lines)])
        x = evaluate(self.tmp)[("s_inv_bakery_xlsx", 1)]["res"]
        self.assertEqual((x["correct"], x["wrong_value"], x["fee_separated"], x["hdr_number_ok"], x["hdr_date_ok"]), (4, 1, 1, 1, 1))

    def test_failed_and_missing_jobs_count_as_missed(self):
        write(self.tmp, "s_demi", 1, **perfect("s_demi"))
        write(self.tmp, "s_demi", 2, error="timeout")
        rows, failed, missing = nexus_test.collect(self.tmp, ["s_demi"], 3)
        s = nexus_test.summarize(rows, ["s_demi"])
        self.assertEqual((len(failed), len(missing), s["expected"], s["correct"], s["missed"]), (1, 1, 18, 6, 12))


class Keys(unittest.TestCase):
    def test_every_case_has_its_files_and_key(self):
        for k, v in gold.CASES.items():
            self.assertTrue(os.path.exists(v["path"]), k)
            self.assertTrue(v.get("src") is None or os.path.exists(v["src"]), k)
            if v["type"] == "recipe" and v["kind"] != "trap":
                self.assertTrue(k in gold.R, k)

    def test_key_names_appear_in_the_document_text(self):
        """Every required key line names something printed in the document (guards against typos in the keys)."""
        bad = []
        for k, v in gold.CASES.items():
            g = gold.R.get(k)
            if v["type"] != "recipe" or not g or not g["lines"] or not v.get("src"):
                continue
            src = open(v["src"]).read()
            for names, q, u, fl in g["lines"]:
                if "opt" in fl:
                    continue
                thirds = isinstance(q, float) and abs(q * 6 - round(q * 6)) < 1e-9 and abs(q * 2 - round(q * 2)) > 1e-9
                if not any(score.name_in(src, n) for n in names):
                    bad.append((k, names[0]))
                elif isinstance(q, (int, float)) and "compound" not in fl and "alt_none" not in fl and not thirds and not any(
                        score.near(src, n, q, window=400) for n in names):
                    bad.append((k, names[0], q))
        bad = [b for b in bad if b != ("h_roe", "ap flour", 0.5)]  # printed "2/4 c", checked by hand
        self.assertEqual(bad, [], "\n".join(map(str, bad)))


if __name__ == "__main__":
    unittest.main()
