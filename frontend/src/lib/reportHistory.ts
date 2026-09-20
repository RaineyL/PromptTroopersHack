import { parseClassificationReport, parseComparisonReport } from './report.ts'

const STORAGE_KEY = 'prompt-troopers.report-runs.v1'
const MAX_RUNS = 20

export interface SavedReportRun {
  id: number
  savedAt: string
  classificationJson: string
  comparisonJson: string
}

export interface ReportHistory {
  runs: SavedReportRun[]
  nextId: number
  warning: string
}

type ReportStorage = Pick<Storage, 'getItem' | 'setItem'>

export function loadReportHistory(storage: ReportStorage): ReportHistory {
  try {
    const text = storage.getItem(STORAGE_KEY)
    if (!text) return { runs: [], nextId: 1, warning: '' }
    const data: unknown = JSON.parse(text)
    if (!data || typeof data !== 'object' || !('runs' in data) || !('nextId' in data) ||
        !Array.isArray(data.runs) || data.runs.length > MAX_RUNS ||
        !Number.isSafeInteger(data.nextId) || (data.nextId as number) < 1) throw new Error('Invalid saved runs')
    const runs: SavedReportRun[] = data.runs.map((item: unknown) => {
      if (!item || typeof item !== 'object' || !('id' in item) || !Number.isSafeInteger(item.id) ||
          (item.id as number) < 1 || (item.id as number) >= (data.nextId as number) ||
          !('savedAt' in item) || typeof item.savedAt !== 'string' || !Number.isFinite(Date.parse(item.savedAt)) ||
          !('classificationJson' in item) || typeof item.classificationJson !== 'string' ||
          !('comparisonJson' in item) || typeof item.comparisonJson !== 'string') throw new Error('Invalid saved run')
      parseClassificationReport(JSON.parse(item.classificationJson))
      parseComparisonReport(JSON.parse(item.comparisonJson))
      return item as SavedReportRun
    })
    if (new Set(runs.map(run => run.id)).size !== runs.length) throw new Error('Duplicate saved run')
    return { runs, nextId: data.nextId as number, warning: '' }
  } catch {
    return { runs: [], nextId: 1, warning: 'Saved report runs could not be loaded. Paste the exported JSON again.' }
  }
}

export function rememberReportRun(history: ReportHistory, classificationJson: string, comparisonJson: string, savedAt = new Date().toISOString()): ReportHistory {
  const run = { id: history.nextId, savedAt, classificationJson, comparisonJson }
  return { runs: [run, ...history.runs].slice(0, MAX_RUNS), nextId: history.nextId + 1, warning: history.warning }
}

export function saveReportHistory(storage: ReportStorage, history: ReportHistory): ReportHistory {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ runs: history.runs, nextId: history.nextId }))
    return { ...history, warning: '' }
  } catch {
    return { ...history, warning: 'Browser storage is unavailable or full. Report runs are available for this session only; keep the original JSON exports.' }
  }
}
