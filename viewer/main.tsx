import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { HouseViewer } from '../src/viewer/HouseViewer'
import { parsePublishedHouse } from '../src/viewer/viewerProject'
import '../src/index.css'
import '../src/App.css'

class ViewerErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <div className="viewer-loading"><strong>Unable to display this house.</strong>
      <p>Try reloading the page or ask its owner for an updated link.</p></div> : this.props.children
  }
}

const root = createRoot(document.getElementById('root')!)
try {
  const response = await fetch(new URL('./house.json', window.location.href))
  if (!response.ok) throw new Error(`House request returned ${response.status}`)
  const house = parsePublishedHouse(await response.json())
  document.title = `${house.title} · House tour`
  root.render(<ViewerErrorBoundary><HouseViewer house={house} /></ViewerErrorBoundary>)
} catch (error) {
  console.error('Could not load the published house', error)
  root.render(<div className="viewer-loading"><strong>This house could not be loaded.</strong>
    <p>Ask its owner to check the published link.</p></div>)
}
