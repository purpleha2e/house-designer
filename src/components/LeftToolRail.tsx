type LeftToolRailProps = {
  onOpenModelSelector: () => void
}

export function LeftToolRail({ onOpenModelSelector }: LeftToolRailProps) {
  return (
    <nav className="left-tool-rail" aria-label="Building tools">
      <button
        type="button"
        aria-label="Add model"
        title="Add model"
        onClick={onOpenModelSelector}
      >
        3D
      </button>
    </nav>
  )
}
