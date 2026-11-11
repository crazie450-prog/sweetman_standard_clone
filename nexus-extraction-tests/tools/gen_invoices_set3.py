"""Generate invoices whose answer keys come from the same data that draws them.

Usage: python3 gen_invoices_set3.py open <pack dir>     (the five invoices in documents/set3)
       python3 gen_invoices_set3.py blind <pack dir>    (five different invoices for a private blind pack)
Needs reportlab, Pillow, openpyxl, python-docx and pdftoppm. Writes raw/<file> and gold_invoices.json.
"""
import csv, json, os, subprocess, sys
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from PIL import Image, ImageEnhance, ImageFilter

WHICH, PACK = sys.argv[1], sys.argv[2]
OUT = os.path.join(PACK, "raw")
os.makedirs(OUT, exist_ok=True)
W, H = letter
gold = {}
money = lambda x: f"{x:,.2f}"


def table_pdf(path, title, sub, cols, rows, totals, font="Helvetica", size=9, per_page=99, note=None):
    c = canvas.Canvas(path, pagesize=letter)
    reg, obl = ("Times-Roman", "Times-Italic") if font == "Times" else (font, font + "-Oblique")
    pages = [rows[i:i + per_page] for i in range(0, len(rows), per_page)]
    for pn, chunk in enumerate(pages):
        c.setFont(font + "-Bold", 15); c.drawString(45, H - 55, title)
        c.setFont(reg, size); c.drawString(45, H - 72, sub + ("   Page %d of %d" % (pn + 1, len(pages)) if len(pages) > 1 else ""))
        y = H - 105; c.setFont(font + "-Bold", size)
        for x, t, _ in cols:
            c.drawString(x, y, t)
        c.line(45, y - 4, W - 45, y - 4); c.setFont(reg, size)
        for r in chunk:
            y -= 16
            for (x, _, right), v in zip(cols, r):
                (c.drawRightString if right else c.drawString)(x + (45 if right else 0), y, str(v))
            if len(r) > len(cols):  # extra note line under the row (catch weight)
                y -= 11; c.setFont(obl, size - 1); c.drawString(cols[1][0], y, r[-1]); c.setFont(reg, size)
        if pn == len(pages) - 1:
            y -= 28; c.setFont(font + "-Bold", size)
            for k, v in totals:
                c.drawRightString(W - 150, y, k); c.drawRightString(W - 50, y, v); y -= 14
            if note:
                c.setFont(reg, size - 1); c.drawString(45, y - 10, note)
        c.showPage()
    c.save()


def photo(pdf, jpg, angle, bg=(88, 80, 70), crop=0.6, blur=0.9, bright=0.9):
    subprocess.run(["pdftoppm", "-r", "100", "-png", "-singlefile", pdf, pdf[:-4]], check=True)
    im = Image.open(pdf[:-4] + ".png").convert("RGB")
    im = im.crop((0, 0, im.width, int(im.height * crop)))
    im = ImageEnhance.Contrast(ImageEnhance.Brightness(im).enhance(bright)).enhance(0.85)
    canvas_ = Image.new("RGB", (int(im.width * 1.1), int(im.height * 1.12)), bg)
    canvas_.paste(im, (int(im.width * 0.05), int(im.height * 0.06)))
    canvas_.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=bg).filter(ImageFilter.GaussianBlur(blur)).save(jpg, quality=66)
    os.remove(pdf); os.remove(pdf[:-4] + ".png")


def item(names, sku, ok, total, kind="item"):
    return dict(names=names, sku=sku, ok=ok, total=total, kind=kind)


def xlsx(path, head, header, rows, tail):
    import openpyxl
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Invoice"
    for h in head:
        ws.append(h)
    ws.append([]); ws.append(header)
    for r in rows:
        ws.append(r)
    ws.append([])
    for t in tail:
        ws.append(t)
    wb.save(path)


COLS = [(45, "ITEM #", False), (105, "DESCRIPTION", False), (330, "QTY", False), (370, "U/M", False), (410, "PRICE", True), (500, "AMOUNT", True)]

if WHICH == "open":
    # 1. seafood house, weights and an ice fee
    rows = [("SF-1107", "Salmon Fillet Atlantic PBO", "22.5", "LB", "11.85", "266.63"), ("SF-2210", "Shrimp 16/20 P&D IQF 5x2 LB", "2", "CS", "89.00", "178.00"),
            ("SF-3301", "Mussels PEI 10 LB bag", "3", "BAG", "24.50", "73.50"), ("SF-0420", "Halibut Fillet Fresh", "8.2", "LB", "24.90", "204.18"),
            ("", "Ice & packing", "1", "", "12.00", "12.00")]
    table_pdf(f"{OUT}/inv_pacific_rim_seafood.pdf", "PACIFIC RIM SEAFOOD CO.", "Invoice PR-48817   Date 10/21/2026   Terms Net 14   Ship to: Golden Fork - Harbor",
              COLS, rows, [("Subtotal", "734.31"), ("Tax", "0.00"), ("Total", "734.31")])
    gold["s_inv_seafood"] = dict(vendor="pacific rim seafood", number="PR-48817", date="2026-10-21", lines=[
        item(["salmon fillet atlantic", "salmon fillet"], "SF-1107", [(22.5, "lb", 11.85)], 266.63),
        item(["shrimp 16/20", "shrimp"], "SF-2210", [(2, "case", 89.00)], 178.00),
        item(["mussels pei", "mussels"], "SF-3301", [(3, "bag", 24.50)], 73.50),
        item(["halibut fillet fresh", "halibut fillet"], "SF-0420", [(8.2, "lb", 24.90)], 204.18),
        item(["ice packing", "ice"], None, [(1, None, 12.00)], 12.00, "fee")])
    # 2. dairy, two pages, deposit and a returned-crate credit
    rows = [("D100", "Milk Whole 4/1 GAL", "6", "CS", "17.20", "103.20"), ("D114", "Half & Half 12/1 QT", "2", "CS", "31.40", "62.80"),
            ("D231", "Butter Unsalted 36/1 LB", "1", "CS", "118.00", "118.00"), ("D305", "Eggs Large Grade A 15 DZ", "4", "CS", "42.75", "171.00"),
            ("D412", "Yogurt Greek Plain 4/5 LB", "2", "CS", "38.60", "77.20"), ("D518", "Cream Cheese 6/3 LB", "1", "CS", "64.90", "64.90"),
            ("D777", "Sour Cream 4/5 LB", "3", "CS", "29.15", "87.45"), ("D802", "Buttermilk 6/0.5 GAL", "1", "CS", "22.30", "22.30"),
            ("", "Crate deposit", "8", "EA", "2.50", "20.00")]
    table_pdf(f"{OUT}/inv_sierra_dairy.pdf", "SIERRA DAIRY & PROVISIONS", "Invoice No. 2026-331904   Invoice Date: Oct 19, 2026   Customer 4410",
              COLS, rows, [("Subtotal", "726.85"), ("Total due", "726.85")], font="Times", size=10, per_page=6)
    gold["s_inv_dairy"] = dict(vendor="sierra dairy", number="2026-331904", date="2026-10-19", lines=[
        item(["milk whole"], "D100", [(6, "case", 17.20)], 103.20), item(["half & half", "half half"], "D114", [(2, "case", 31.40)], 62.80),
        item(["butter unsalted"], "D231", [(1, "case", 118.00)], 118.00), item(["eggs large grade a", "eggs large"], "D305", [(4, "case", 42.75)], 171.00),
        item(["yogurt greek plain", "yogurt greek"], "D412", [(2, "case", 38.60)], 77.20), item(["cream cheese"], "D518", [(1, "case", 64.90)], 64.90),
        item(["sour cream"], "D777", [(3, "case", 29.15)], 87.45), item(["buttermilk"], "D802", [(1, "case", 22.30)], 22.30),
        item(["crate deposit", "deposit"], None, [(8, "ea", 2.50)], 20.00, "fee")])
    # 3. farm ticket as a phone photo
    rows = [("", "Baby Kale 3 LB", "4", "CS", "13.50", "54.00"), ("", "Carrots Rainbow bunch", "12", "BU", "2.10", "25.20"),
            ("", "Strawberries flat 8x1 LB", "2", "FLAT", "26.00", "52.00"), ("", "Yukon Gold Potatoes", "50", "LB", "0.78", "39.00"),
            ("", "Delivery", "1", "", "10.00", "10.00")]
    table_pdf(f"{OUT}/_p.pdf", "Greenleaf Farms", "Ticket GL-7720      Date 10/23/2026", COLS, rows, [("Total", "180.20")], font="Times", size=12)
    photo(f"{OUT}/_p.pdf", f"{OUT}/inv_greenleaf_photo.jpg", 2.6)
    gold["s_inv_farm_photo"] = dict(vendor="greenleaf farms", number="GL-7720", date="2026-10-23", lines=[
        item(["baby kale"], None, [(4, "case", 13.50)], 54.00), item(["carrots rainbow bunch", "carrots rainbow"], None, [(12, "bunch", 2.10), (12, "bu", 2.10)], 25.20),
        item(["strawberries flat", "strawberries"], None, [(2, "flat", 26.00)], 52.00), item(["yukon gold potatoes"], None, [(50, "lb", 0.78)], 39.00),
        item(["delivery"], None, [(1, None, 10.00)], 10.00, "fee")])
    # 4. workbook invoice
    xlsx(f"{OUT}/inv_bakers_mill.xlsx", [["Baker's Mill Supply"], ["Invoice", "BM-10552", "Date", "2026-10-20"]],
         ["Code", "Product", "Pack", "Qty", "Unit", "Unit price", "Line total"],
         [["BM-01", "Flour All Purpose", "50 LB", 4, "BAG", 19.75, 79.00], ["BM-07", "Sugar Granulated", "50 LB", 2, "BAG", 34.10, 68.20],
          ["BM-12", "Yeast Instant Dry", "20/1 LB", 1, "CS", 71.50, 71.50], ["BM-19", "Chocolate Chips Semi-Sweet", "25 LB", 1, "CS", 96.40, 96.40],
          ["BM-23", "Vanilla Extract Pure", "1 QT", 3, "EA", 28.95, 86.85], ["", "Fuel surcharge", "", 1, "", 4.75, 4.75]],
         [["", "", "", "", "", "Total", 406.70]])
    gold["s_inv_bakery_xlsx"] = dict(vendor="baker's mill", number="BM-10552", date="2026-10-20", lines=[
        item(["flour all purpose", "flour"], "BM-01", [(4, "bag", 19.75)], 79.00), item(["sugar granulated", "sugar"], "BM-07", [(2, "bag", 34.10)], 68.20),
        item(["yeast instant dry", "yeast"], "BM-12", [(1, "case", 71.50)], 71.50), item(["chocolate chips semi-sweet", "chocolate chips"], "BM-19", [(1, "case", 96.40)], 96.40),
        item(["vanilla extract pure", "vanilla extract"], "BM-23", [(3, "ea", 28.95)], 86.85), item(["fuel surcharge"], None, [(1, None, 4.75)], 4.75, "fee")])
    # 5. CSV export
    with open(f"{OUT}/inv_metro_supply.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerows([["Vendor", "Metro Restaurant Supply"], ["Invoice", "MRS-2026-8841"], ["Date", "10/22/2026"], [],
                     ["sku", "description", "qty", "uom", "unit_price", "extended"],
                     ["88120", "Olive Oil Extra Virgin 6/1 GAL", 1, "CS", "142.00", "142.00"], ["88344", "Kosher Salt 12/3 LB", 2, "CS", "31.25", "62.50"],
                     ["88901", "Black Peppercorns Whole 5 LB", 1, "EA", "46.80", "46.80"], ["88410", "Canola Oil 35 LB", 3, "EA", "38.90", "116.70"],
                     ["", "Delivery charge", 1, "", "8.00", "8.00"], [], ["", "", "", "", "Total", "376.00"]])
    gold["s_inv_supply_csv"] = dict(vendor="metro restaurant supply", number="MRS-2026-8841", date="2026-10-22", lines=[
        item(["olive oil extra virgin", "olive oil"], "88120", [(1, "case", 142.00)], 142.00), item(["kosher salt"], "88344", [(2, "case", 31.25)], 62.50),
        item(["black peppercorns whole", "black peppercorns"], "88901", [(1, "ea", 46.80)], 46.80), item(["canola oil"], "88410", [(3, "ea", 38.90)], 116.70),
        item(["delivery charge", "delivery"], None, [(1, None, 8.00)], 8.00, "fee")])
else:
    rows = [("40112", "BEEF SHORT RIB BNLS CHOICE", "1", "CS", "9.45/LB", "301.46", "CATCH WEIGHT 31.9 LB"), ("40377", "LAMB RACK FRENCHED 16/20 OZ", "2", "CS", "212.00", "424.00"),
            ("40510", "CHICKEN THIGH BNLS 4/10 LB", "2", "CS", "74.80", "149.60"), ("40688", "PORK SHOULDER BONE-IN", "1", "CS", "2.35/LB", "140.06", "CATCH WEIGHT 59.6 LB"),
            ("40902", "BACON APPLEWOOD 15 LB", "3", "CS", "61.25", "183.75"), ("", "FUEL SURCHARGE", "1", "", "7.25", "7.25")]
    table_pdf(f"{OUT}/inv_atlantic_meat.pdf", "ATLANTIC MEAT COMPANY", "Invoice 00618842   Inv Date 10/26/26   Cust 2207   Route 3", COLS, rows,
              [("Subtotal", "1,206.12"), ("Tax", "0.00"), ("Total", "1,206.12")], size=8)
    gold["b_inv_meat"] = dict(vendor="atlantic meat", number="00618842", date="2026-10-26", lines=[
        item(["beef short rib bnls", "beef short rib"], "40112", [(31.9, "lb", 9.45), (1, "case", 301.46)], 301.46),
        item(["lamb rack frenched", "lamb rack"], "40377", [(2, "case", 212.00)], 424.00), item(["chicken thigh bnls", "chicken thigh"], "40510", [(2, "case", 74.80)], 149.60),
        item(["pork shoulder bone-in", "pork shoulder"], "40688", [(59.6, "lb", 2.35), (1, "case", 140.06)], 140.06),
        item(["bacon applewood", "bacon"], "40902", [(3, "case", 61.25)], 183.75), item(["fuel surcharge"], None, [(1, None, 7.25)], 7.25, "fee")])
    rows = [("D305", "Eggs Large Grade A 15 DZ", "-1", "CS", "42.75", "-42.75"), ("D412", "Yogurt Greek Plain 4/5 LB", "-2", "CS", "38.60", "-77.20"),
            ("", "Handling fee", "1", "", "6.00", "6.00")]
    table_pdf(f"{OUT}/inv_sierra_credit.pdf", "SIERRA DAIRY & PROVISIONS  -  CREDIT MEMO", "Credit Memo CR-55120   Date 10/27/2026   Ref. Invoice 2026-331904", COLS, rows,
              [("Total credit", "-113.95")], font="Times", size=10)
    gold["b_inv_credit"] = dict(vendor="sierra dairy", number="CR-55120", date="2026-10-27", lines=[
        item(["eggs large grade a", "eggs large"], "D305", [(-1, "case", 42.75), (1, "case", -42.75), (-1, "case", -42.75)], -42.75, "credit"),
        item(["yogurt greek plain", "yogurt greek"], "D412", [(-2, "case", 38.60), (2, "case", -38.60), (-2, "case", -38.60)], -77.20, "credit"),
        item(["handling fee"], None, [(1, None, 6.00)], 6.00, "fee")])
    rows = [("", "Shiitake Mushrooms", "6", "LB", "9.25", "55.50"), ("", "Oyster Mushrooms 3 LB", "3", "CS", "21.00", "63.00"),
            ("", "King Trumpet", "4.5", "LB", "11.40", "51.30"), ("", "Maitake clusters", "2", "LB", "14.75", "29.50"), ("", "Box deposit", "3", "EA", "1.50", "4.50")]
    table_pdf(f"{OUT}/_p.pdf", "Hillside Mushroom Growers", "Delivery ticket HM-3391      10/28/2026", COLS, rows, [("Total", "203.80")], font="Times", size=12)
    photo(f"{OUT}/_p.pdf", f"{OUT}/inv_hillside_photo.jpg", -3.4, bg=(70, 74, 82), bright=0.85)
    gold["b_inv_mushroom_photo"] = dict(vendor="hillside mushroom", number="HM-3391", date="2026-10-28", lines=[
        item(["shiitake mushrooms", "shiitake"], None, [(6, "lb", 9.25)], 55.50), item(["oyster mushrooms"], None, [(3, "case", 21.00)], 63.00),
        item(["king trumpet"], None, [(4.5, "lb", 11.40)], 51.30), item(["maitake clusters", "maitake"], None, [(2, "lb", 14.75)], 29.50),
        item(["box deposit", "deposit"], None, [(3, "ea", 1.50)], 4.50, "fee")])
    import docx
    d = docx.Document(); d.add_heading("Olive Branch Imports", 1); d.add_paragraph("Invoice OB-90417    Date: 29 October 2026    Bill to: Golden Fork - Midtown")
    data = [("Item", "Qty", "Unit", "Price", "Amount"), ("Olives Castelvetrano 2/5 KG", "2", "CS", "64.00", "128.00"), ("Capers Nonpareil 6/32 OZ", "1", "CS", "58.20", "58.20"),
            ("Anchovy Fillets in Oil 12/28 OZ", "1", "CS", "133.00", "133.00"), ("Sherry Vinegar Reserva 12/750 ML", "1", "CS", "97.50", "97.50"),
            ("Saffron Spanish 1 OZ tin", "2", "EA", "74.00", "148.00"), ("Shipping", "1", "", "18.00", "18.00"), ("", "", "", "Total", "582.70")]
    t = d.add_table(rows=len(data), cols=5)
    for i, r in enumerate(data):
        for j, v in enumerate(r):
            t.cell(i, j).text = v
    d.save(f"{OUT}/inv_olive_branch.docx")
    gold["b_inv_import_docx"] = dict(vendor="olive branch", number="OB-90417", date="2026-10-29", lines=[
        item(["olives castelvetrano", "olives"], None, [(2, "case", 64.00)], 128.00), item(["capers nonpareil", "capers"], None, [(1, "case", 58.20)], 58.20),
        item(["anchovy fillets in oil", "anchovy fillets"], None, [(1, "case", 133.00)], 133.00), item(["sherry vinegar reserva", "sherry vinegar"], None, [(1, "case", 97.50)], 97.50),
        item(["saffron spanish", "saffron"], None, [(2, "ea", 74.00)], 148.00), item(["shipping"], None, [(1, None, 18.00)], 18.00, "fee")])
    xlsx(f"{OUT}/inv_coastal_dry_goods.xlsx", [["Coastal Dry Goods Inc."], ["Invoice #", "CDG-77203"], ["Invoice date", "10/30/2026"]],
         ["Item", "Description", "Ordered", "Shipped", "UOM", "Price", "Extension"],
         [["C-210", "Rice Jasmine 50 LB", 3, 3, "BAG", 41.20, 123.60], ["C-355", "Lentils Green 25 LB", 2, 1, "BAG", 36.90, 36.90],
          ["C-402", "Quinoa White 25 LB", 1, 1, "BAG", 68.40, 68.40], ["C-518", "Panko Breadcrumbs 25 LB", 2, 2, "CS", 29.75, 59.50],
          ["", "Pallet fee", "", 1, "", 5.00, 5.00]], [["", "", "", "", "", "Total", 293.40]])
    gold["b_inv_drygoods_xlsx"] = dict(vendor="coastal dry goods", number="CDG-77203", date="2026-10-30", lines=[
        item(["rice jasmine", "rice"], "C-210", [(3, "bag", 41.20)], 123.60), item(["lentils green", "lentils"], "C-355", [(1, "bag", 36.90)], 36.90),
        item(["quinoa white", "quinoa"], "C-402", [(1, "bag", 68.40)], 68.40), item(["panko breadcrumbs", "panko"], "C-518", [(2, "case", 29.75)], 59.50),
        item(["pallet fee"], None, [(1, None, 5.00)], 5.00, "fee")])

json.dump(gold, open(os.path.join(PACK, "gold_invoices.json"), "w"), indent=1)
print("wrote", sorted(gold))
