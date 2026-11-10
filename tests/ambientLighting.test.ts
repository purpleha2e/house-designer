import assert from 'node:assert/strict'
import test from 'node:test'
import { activeAmbientTerm, ambientLightingPreferences, normalizeAmbientLightingPreferences, restoreAmbientSettings, viewportAmbientFillIntensity } from '../src/ambientLighting.ts'

test('exterior daylight sky replaces the legacy fixed fill while preserving authored ambient and night levels', () => {
  assert.equal(viewportAmbientFillIntensity(.19, true, false), .64, 'an unavailable exterior sky retains the legacy fallback')
  assert.equal(viewportAmbientFillIntensity(.19, true, true), .19, 'a ready sky must not also receive the fixed .45 fill')
  assert.equal(viewportAmbientFillIntensity(0, true, true), 0, 'zero ambient remains zero with physical sky lighting')
  for (const value of [0, .03, .18, .85]) {
    assert.equal(viewportAmbientFillIntensity(value, false, false), value)
    assert.equal(viewportAmbientFillIntensity(value, false, true), value)
  }
  assert.equal(viewportAmbientFillIntensity(.19, true, false), .64, 'turning sky lighting off restores the fallback')
})

test('sky selection persists with lighting preferences before a background calculation finishes',()=>{
  const preferences=ambientLightingPreferences({daylight:true,ambientTerm:.3,nightAmbientTerm:.03,skyMode:'overcast'})
  assert.equal(normalizeAmbientLightingPreferences(JSON.parse(JSON.stringify(preferences)))?.skyMode,'overcast')
  assert.equal(ambientLightingPreferences().skyMode,undefined,'older and new projects use the clear-sky renderer default')
})

test('new projects start in Daylight with 0.30 ambient and a separate dim 0.03 night value', () => {
  const defaults = restoreAmbientSettings()
  assert.equal(defaults.daylight, true)
  assert.equal(activeAmbientTerm(defaults), .30)
  assert.equal(activeAmbientTerm({ ...defaults, daylight: false }), .03)
  const edited = { ...defaults, ambientTerm: .61, nightAmbientTerm: .09 }
  assert.equal(activeAmbientTerm(edited), .61)
  assert.equal(activeAmbientTerm({ ...edited, daylight: false }), .09)
  assert.equal(restoreAmbientSettings().ambientTerm, .30, 'New does not inherit the previous project value')
})

test('saved day/night levels, including zero, restore exactly with the saved mode', () => {
  for (const ambientTerm of [0, .47, .85]) for (const nightAmbientTerm of [0, .07, .85]) {
    const saved = { daylight: false, ambientTerm, nightAmbientTerm, nightFill: false }
    assert.deepEqual(restoreAmbientSettings(JSON.parse(JSON.stringify(saved))), { daylight: false, ambientTerm, nightAmbientTerm })
    assert.deepEqual(normalizeAmbientLightingPreferences(ambientLightingPreferences(saved)), { daylight: false, ambientTerm, nightAmbientTerm })
    assert.equal(activeAmbientTerm(saved), nightAmbientTerm)
  }
})

test('legacy models preserve their daylight term and authored enabled Night fill', () => {
  assert.deepEqual(restoreAmbientSettings({ daylight: true, ambientTerm: .45, nightFill: false }), {
    daylight: true, ambientTerm: .45, nightAmbientTerm: .03,
  })
  const legacy = restoreAmbientSettings({ daylight: false, ambientTerm: .12, nightFill: true })
  assert.equal(activeAmbientTerm(legacy), .12)
})

test('night ambient needs no fill toggle and zero alone disables it', () => {
  for (const term of [0, .03, .07, .85]) {
    const settings = { daylight: false, ambientTerm: .30, nightAmbientTerm: term }
    assert.equal(activeAmbientTerm(settings), term)
    assert.equal(activeAmbientTerm({ ...settings, nightFill: false }), term)
    assert.equal(activeAmbientTerm({ ...settings, nightFill: true }), term)
    assert.equal('nightFill' in restoreAmbientSettings(settings), false)
  }
})

test('invalid preference data is rejected and finite levels are bounded', () => {
  for (const invalid of [undefined, null, {}, { daylight: false, ambientTerm: NaN, nightAmbientTerm: .03 },
    { daylight: false, ambientTerm: .3, nightAmbientTerm: '0.03' }]) assert.equal(normalizeAmbientLightingPreferences(invalid), undefined)
  assert.deepEqual(normalizeAmbientLightingPreferences({ daylight: false, ambientTerm: 5, nightAmbientTerm: -1 }), {
    daylight: false, ambientTerm: .85, nightAmbientTerm: 0,
  })
})


test('sky intensity persists independently of completed GI, including zero', () => {
  for (const skyStrength of [0, .5, 1, 1.5, 2, 3]) {
    const source = { daylight: true, ambientTerm: .18, nightAmbientTerm: .03, skyMode: 'overcast' as const, skyStrength }
    assert.deepEqual(normalizeAmbientLightingPreferences(JSON.parse(JSON.stringify(ambientLightingPreferences(source)))), source)
  }
  const source = { daylight: true, ambientTerm: .18, nightAmbientTerm: .03 }
  assert.equal(normalizeAmbientLightingPreferences(source)?.skyStrength ?? 1, 1)
  assert.equal(normalizeAmbientLightingPreferences({ ...source, skyStrength: NaN })?.skyStrength, 1)
  assert.equal(normalizeAmbientLightingPreferences({ ...source, skyStrength: -2 })?.skyStrength, 0)
})
