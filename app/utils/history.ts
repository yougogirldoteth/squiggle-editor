/** A complete drag is one reversible edit, regardless of pointer event count. */
export class HashHistory {
  private past: string[] = []
  private future: string[] = []
  private start: string | null = null
  constructor(public value: string) {}
  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }
  begin() { this.start ??= this.value }
  update(value: string) { this.begin(); this.value = value }
  commit() {
    if (this.start !== null && this.start !== this.value) {
      this.past.push(this.start)
      if (this.past.length > 100) this.past.shift()
      this.future = []
    }
    this.start = null
  }
  undo() {
    this.commit()
    const previous = this.past.pop()
    if (previous !== undefined) { this.future.push(this.value); this.value = previous }
    return this.value
  }
  redo() {
    this.commit()
    const next = this.future.pop()
    if (next !== undefined) { this.past.push(this.value); this.value = next }
    return this.value
  }
}
