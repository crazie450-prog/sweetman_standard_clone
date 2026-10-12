import { Workbook } from '../../../backend/node_modules/exceljs'
;(async () => {
  const keep = new Set(['Sysco Order Guide - Kitchen', 'Recipe Bible Table of Contents', 'Prep Sheets', 'Pantry', 'GrillPlancha'])
  const wb = new Workbook()
  await wb.xlsx.readFile(process.argv[3] /* path to 'Bonds Brother Master Sheets 2024.xlsx' (nexus_restaurant_manager/example_docs) */)
  for (const ws of [...wb.worksheets]) if (!keep.has(ws.name)) wb.removeWorksheet(ws.id)
  await wb.xlsx.writeFile(process.argv[2])
  console.log(wb.worksheets.map((w) => w.name))
})()
