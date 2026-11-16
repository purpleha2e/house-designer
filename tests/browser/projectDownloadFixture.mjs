// Capture serialized projects for renderer round-trip tests. File-operation
// regressions instead wait for actual browser downloads and read them from disk.
function installProjectDownloadFixture() {
  if (window.projectDownloadFixtureInstalled) return
  window.projectDownloadFixtureInstalled = true
  // Renderer round trips exercise the same serializer through Save As as well.
  window.showSaveFilePicker = async options => {
    const handle = await window.projectDownloadFixture(options)
    return { ...handle, name: handle.name ?? options.suggestedName }
  }
  const click = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (!this.download || !this.href.startsWith('blob:') || !window.projectDownloadFixture) return click.call(this)
    const fileName = this.download
    fetch(this.href).then(response => response.text()).then(async text => {
      const destination = await window.projectDownloadFixture({ suggestedName: fileName })
      const writable = await destination.createWritable()
      await writable.write(text)
      await writable.close()
    })
  }
}

export const projectDownloadFixtureSource = `(${installProjectDownloadFixture.toString()})();`
