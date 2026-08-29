type CalendarColor = { id: string; hex: string }

const calendarColors: CalendarColor[] = [
  { id: '1', hex: '#7986cb' },
  { id: '2', hex: '#33b679' },
  { id: '3', hex: '#8e24aa' },
  { id: '4', hex: '#e67c73' },
  { id: '5', hex: '#f6bf26' },
  { id: '6', hex: '#f4511e' },
  { id: '7', hex: '#039be5' },
  { id: '8', hex: '#616161' },
  { id: '9', hex: '#3f51b5' },
  { id: '10', hex: '#0b8043' },
  { id: '11', hex: '#d50000' }
]

function rgb(hex: string): readonly [number, number, number] | null {
  const normalized = hex.trim().replace(/^#/, '')
  const expanded = normalized.length === 3 ? normalized.split('').map((value) => value.repeat(2)).join('') : normalized
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16)
  ]
}

/** Maps an app project hex colour to the closest colour available in Google Calendar. */
export function googleCalendarColorId(projectColor: string | null | undefined, fallback = '8'): string {
  const source = projectColor ? rgb(projectColor) : null
  if (!source) return fallback
  return calendarColors.reduce((closest, candidate) => {
    const candidateRgb = rgb(candidate.hex) as readonly [number, number, number]
    const candidateDistance = candidateRgb.reduce((total, value, index) => total + (value - source[index]) ** 2, 0)
    const closestRgb = rgb(closest.hex) as readonly [number, number, number]
    const closestDistance = closestRgb.reduce((total, value, index) => total + (value - source[index]) ** 2, 0)
    return candidateDistance < closestDistance ? candidate : closest
  }).id
}
