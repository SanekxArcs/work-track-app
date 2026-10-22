import { cronJobs, makeFunctionReference } from 'convex/server'
const crons = cronJobs()
crons.daily(
  'Expire personal activity',
  { hourUTC: 3, minuteUTC: 0 },
  makeFunctionReference<'mutation'>('activity:purge'),
  {}
)
export default crons
