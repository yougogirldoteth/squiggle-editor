import { describe, expect, it } from 'vitest'
import { HashHistory } from '../app/utils/history'

describe('hash history', () => {
  it('groups a gesture into one undo step and restores redo exactly', () => {
    const h = new HashHistory('a')
    h.begin(); h.update('b'); h.update('c'); h.commit()
    expect(h.undo()).toBe('a')
    expect(h.canUndo).toBe(false)
    expect(h.redo()).toBe('c')
  })
  it('preserves redo after a no-op and discards redo after a new edit', () => {
    const h = new HashHistory('a')
    h.update('b'); h.commit(); h.undo()
    h.update('a'); h.commit()
    expect(h.canRedo).toBe(true)
    h.update('c'); h.commit()
    expect(h.canRedo).toBe(false)
    expect(h.undo()).toBe('a')
  })
})
