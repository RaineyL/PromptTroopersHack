export type IconName = 'grid' | 'code' | 'inbox' | 'file' | 'compare' | 'report' | 'upload' | 'download' | 'play' | 'arrow' | 'info' | 'check' | 'shield'
const paths: Record<IconName, string> = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  code: 'm8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16',
  inbox: 'M4 4h16l2 12v4H2v-4L4 4z M2 15h6l2 3h4l2-3h6',
  file: 'M14 2H5v20h14V7l-5-5z M14 2v6h5 M8 12h8 M8 16h6',
  compare: 'M4 4h6v16H4z M14 4h6v16h-6z M8 8h2 M14 12h2 M8 16h2',
  report: 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h4',
  upload: 'M12 16V3 m-5 5 5-5 5 5 M4 15v6h16v-6',
  download: 'M12 3v13 m-5-5 5 5 5-5 M4 17v4h16v-4',
  play: 'm8 4 12 8-12 8V4z', arrow: 'M4 12h16 m-6-6 6 6-6 6',
  info: 'M12 11v6 M12 7v.1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  check: 'm5 12 4 4L19 6', shield: 'm12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4z m-4 10 3 3 5-6',
}
export function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
