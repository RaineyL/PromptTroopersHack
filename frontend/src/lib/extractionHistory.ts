import { parseExtraction, type ExtractionResult } from './api.ts'

const STORAGE_KEY = 'prompt-troopers.extractions.v1'
const MAX_RESULTS = 20
export interface SavedExtraction {
  id: string
  source: 'Pipeline' | 'Extraction Debug'
  savedAt: string
  result: ExtractionResult
}
export interface ExtractionHistory { entries: SavedExtraction[]; warning: string }
type HistoryStorage = Pick<Storage, 'getItem' | 'setItem'>

export function loadExtractionHistory(storage: HistoryStorage): ExtractionHistory {
  try {
    const text = storage.getItem(STORAGE_KEY)
    if (!text) return { entries: [], warning: '' }
    const data: unknown = JSON.parse(text)
    if (!Array.isArray(data) || data.length > MAX_RESULTS) throw new Error('Invalid history')
    const entries = data.map((entry: unknown): SavedExtraction => {
      if (!entry || typeof entry !== 'object' || !('source' in entry) ||
          (entry.source !== 'Pipeline' && entry.source !== 'Extraction Debug') ||
          !('savedAt' in entry) || typeof entry.savedAt !== 'string' || !Number.isFinite(Date.parse(entry.savedAt)) ||
          !('id' in entry) || typeof entry.id !== 'string' || !('result' in entry)) throw new Error('Invalid saved extraction')
      const result = parseExtraction(entry.result)[0]
      if (entry.id !== `${entry.source}:${result.email.email_id}`) throw new Error('Invalid saved ID')
      return { id: entry.id, source: entry.source, savedAt: entry.savedAt, result }
    })
    if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Duplicate history')
    return { entries, warning: '' }
  } catch {
    return { entries: [], warning: 'Saved extractions could not be loaded. Run extraction again or import an extraction JSON download.' }
  }
}

export function saveExtractionHistory(storage: HistoryStorage, entries: SavedExtraction[]): ExtractionHistory {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries))
    return { entries, warning: '' }
  } catch {
    return { entries, warning: 'Browser storage is unavailable or full. These results are available for this session only; download extraction JSON to keep them.' }
  }
}

export function rememberExtraction(entries: SavedExtraction[], result: ExtractionResult, source: SavedExtraction['source']): SavedExtraction[] {
  const snapshot = structuredClone(result)
  const id = `${source}:${result.email.email_id}`
  return [{ id, source, savedAt: new Date().toISOString(), result: snapshot }, ...entries.filter(entry => entry.id !== id)].slice(0, MAX_RESULTS)
}
