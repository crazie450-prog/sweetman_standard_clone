import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { prepareInput, textChunks } from '../../../backend/src/modules/documents/extraction'
;(async () => {
  const f = process.argv[2]
  try {
    const parts = await textChunks(await prepareInput({ type: 'recipe', fileName: basename(f), mimeType: '', buffer: readFileSync(f) }))
    console.log(basename(f), 'parts', parts.length, parts.map((p) => p.length).join(','))
  } catch (e) { console.log(basename(f), 'ERROR', (e as Error).message) }
})()
