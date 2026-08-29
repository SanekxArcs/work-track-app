import assert from 'node:assert/strict'
import test from 'node:test'
import { googleCalendarColorId } from '../src/shared/google-calendar-color.ts'

test('uses the matching native Google Calendar colour for an exact project colour', () => {
  assert.equal(googleCalendarColorId('#f6bf26'), '5')
  assert.equal(googleCalendarColorId('#039be5'), '7')
})

test('maps short hex colours and safely falls back when a project has no valid colour', () => {
  assert.equal(googleCalendarColorId('#d00'), '11')
  assert.equal(googleCalendarColorId('not-a-colour'), '8')
  assert.equal(googleCalendarColorId(undefined, '5'), '5')
})
