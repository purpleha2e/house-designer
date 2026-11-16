// Renderer tests provide generated File objects without opening an OS dialog.
// File-picker regressions instead use CDP's real DOM.setFileInputFiles handoff.
function installProjectFileInputFixture() {
  if (window.projectFileInputFixtureInstalled) return
  window.projectFileInputFixtureInstalled = true
  const click = HTMLInputElement.prototype.click
  HTMLInputElement.prototype.click = function () {
    if (this.type !== 'file' || !window.projectFileFixture) return click.call(this)
    Promise.resolve(window.projectFileFixture()).then(async (handles) => {
      const transfer = new DataTransfer()
      if (handles[0]) transfer.items.add(await handles[0].getFile())
      this.files = transfer.files
      this.dispatchEvent(new Event(handles.length ? 'change' : 'cancel', { bubbles: true }))
    })
  }
}

export const projectFileInputFixtureSource = `(${installProjectFileInputFixture.toString()})();`
