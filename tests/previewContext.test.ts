import { describe, expect, it } from 'vitest'
import originalScript from '../app/data/snowfro-script.formatted.js?raw'
import { managedPreviewInputs } from '../app/utils/previewContext'

const managed = { speed: true, playing: true, background: true }

describe('custom sketch view ownership', () => {
  it('keeps original inputs available with unrelated drawing edits', () => {
    expect(managedPreviewInputs(originalScript)).toEqual(managed)
    expect(managedPreviewInputs(originalScript.replace('let wt = 2;', 'let wt = 3;'))).toEqual(managed)
    expect(managedPreviewInputs(originalScript + '\nconsole.log(speed, loops, backgroundArray[0]);')).toEqual(managed)
    expect(managedPreviewInputs(originalScript + '\nconsole.log(speed.toFixed(1), loops.toString(), backgroundArray.join(","), backgroundArray["includes"](255));')).toEqual(managed)
  })

  it.each([
    ['speed = 1;', 'speed'],
    ['loops = false;', 'playing'],
    ['backgroundIndex = 0;', 'background'],
    ['backgroundArray[0] = 255;', 'background'],
  ] as const)('respects an explicit default-value assignment: %s', (assignment, input) => {
    expect(managedPreviewInputs(originalScript + '\n' + assignment)).toEqual({ ...managed, [input]: false })
  })

  it('respects changed declarations and writes inside custom functions', () => {
    expect(managedPreviewInputs(originalScript.replace('let speed = 1;', 'let speed = 3;'))).toEqual({ ...managed, speed: false })
    expect(managedPreviewInputs(originalScript + '\nfunction customSpeed() { speed = 1; }')).toEqual({ ...managed, speed: false })
    expect(managedPreviewInputs(originalScript + '\nfunction localSpeed() { let speed = 1; }')).toEqual({ ...managed, speed: false })
  })

  it('does not mistake comments, strings, formatting, or reads for assignments', () => {
    const source = originalScript.replace('let speed = 1;', 'let speed /* current speed */ =\n 1;')
      + '\n// loops = false; speed = 1; backgroundArray[0] = 255;'
      + '\nconst example = "speed = 1; loops = false;";'
      + '\nconst text = `backgroundIndex = 0;`;'
    expect(managedPreviewInputs(source)).toEqual(managed)
  })

  it.each(['speed += 1;', '++speed;', 'speed++;', '[speed] = [1];', '({speed} = {speed: 1});'])('respects additional updates: %s', assignment => {
    expect(managedPreviewInputs(originalScript + '\n' + assignment).speed).toBe(false)
  })

  it('lets custom array mutations own the background', () => {
    expect(managedPreviewInputs(originalScript + '\nbackgroundArray.splice(0, 1, 255);')).toEqual({ ...managed, background: false })
  })
})
