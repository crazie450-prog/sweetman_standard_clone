import { readFileSync, writeFileSync } from 'node:fs'
import { prepareInput, textChunks } from '../../../backend/src/modules/documents/extraction'
;(async () => { const p = await textChunks(await prepareInput({ type: 'recipe', fileName: 'bonds_subset.xlsx', mimeType: '', buffer: readFileSync(process.argv[2]) })); writeFileSync(process.argv[3], p.join('\n\n')) })()
