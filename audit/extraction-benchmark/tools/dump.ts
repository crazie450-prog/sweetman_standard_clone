import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { prepareInput, textFor } from '../../../backend/src/modules/documents/extraction'
;(async () => {
  for (const f of process.argv.slice(2)) {
    try {
    const input = await prepareInput({ type: 'recipe', fileName: basename(f), mimeType: '', buffer: readFileSync(f) })
    const t = await textFor(input)
    writeFileSync(`${process.env.OUT}/${basename(f)}.txt`, t)
    console.log(basename(f), t.length)
    } catch (e) { console.log(basename(f), "ERROR", (e as Error).message) }
  }
})()
