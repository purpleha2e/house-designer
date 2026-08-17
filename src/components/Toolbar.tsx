type ToolbarProps = {
  isAddingWall: boolean
  wallCount: number
  onToggleAddWall: () => void
}

export function Toolbar({
  isAddingWall,
  wallCount,
  onToggleAddWall,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div>
        <h1>House Designer</h1>
        <p>{wallCount} walls</p>
      </div>

      <button
        type="button"
        className={isAddingWall ? 'tool-button active' : 'tool-button'}
        aria-pressed={isAddingWall}
        onClick={onToggleAddWall}
      >
        Add Wall
      </button>
    </header>
  )
}
