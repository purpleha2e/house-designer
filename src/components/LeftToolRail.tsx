import { useState } from 'react'
import {
  getSurfaceMaterialLabel,
  isCustomPaintMaterialId,
} from '../materials/materialCatalog'
import type {
  FloorLevel,
  SelectableSurface,
  SurfaceMaterialProduct,
  SurfaceWallSide,
  WallKind,
} from '../types'

type RailPanel = 'floor' | 'materials' | 'project' | 'wall'
type WallMaterialMode = 'full' | 'lower'

const MIN_INTERNAL_WALL_THICKNESS = 0.05
const MAX_INTERNAL_WALL_THICKNESS = 0.3
const MIN_WALL_HEIGHT = 0.05
const MIN_TEXTURE_SCALE = 0.001
const MIN_SLAB_THICKNESS = 0.05
const MAX_SLAB_THICKNESS = 1

const clampInternalWallThickness = (thickness: number) =>
  Math.min(
    MAX_INTERNAL_WALL_THICKNESS,
    Math.max(MIN_INTERNAL_WALL_THICKNESS, thickness),
  )

const formatMetresInputValue = (value: number) =>
  Number.isFinite(value)
    ? value.toFixed(3).replace(/\.?0+$/, '')
    : ''

const formatDecimalInputValue = (value: number) =>
  Number.isFinite(value)
    ? value.toString()
    : ''

const parseTextureScaleInput = (value: string) => {
  const parsedValue = Number.parseFloat(value)

  return Number.isFinite(parsedValue) && parsedValue >= MIN_TEXTURE_SCALE
    ? parsedValue
    : null
}

type LeftToolRailProps = {
  activeFloorId: string
  canCopy: boolean
  canPaste: boolean
  canRedo: boolean
  canUndo: boolean
  floors: FloorLevel[]
  internalWallThickness: number
  isAddingWall: boolean
  materials: SurfaceMaterialProduct[]
  selectedSurface: SelectableSurface | null
  selectedFloorViewId: string
  selectedWallHeight: number | null
  wallCount: number
  wallHeight: number
  wallKind: WallKind
  onAddEmptyFloor: () => void
  onAddFloor: () => void
  onApplyMaterial: (options: {
    coverageHeight?: number
    customColor?: string
    materialId: string
    textureRotation: number
    textureScale: number
    wallMode?: WallMaterialMode
    wallSide?: SurfaceWallSide
  }) => void
  onCopy: () => void
  onCut: () => void
  onDeleteFloor: () => void
  onInternalWallThicknessChange: (thickness: number) => void
  onLoadProject: () => void
  onOpenModelSelector: () => void
  onPaste: () => void
  onRedo: () => void
  onSaveProject: () => void
  onSelectFloor: (floorId: string) => void
  onSlabThicknessChange: (thickness: number) => void
  onToggleAddWall: () => void
  onUndo: () => void
  onWallHeightChange: (height: number) => void
  onWallKindChange: (wallKind: WallKind) => void
}

function IconButton({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
}: {
  active?: boolean
  children: string
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={active ? 'active' : ''}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function LeftToolRail({
  activeFloorId,
  canCopy,
  canPaste,
  canRedo,
  canUndo,
  floors,
  internalWallThickness,
  isAddingWall,
  materials,
  selectedSurface,
  selectedFloorViewId,
  selectedWallHeight,
  wallHeight,
  wallKind,
  onAddEmptyFloor,
  onAddFloor,
  onApplyMaterial,
  onCopy,
  onCut,
  onDeleteFloor,
  onInternalWallThicknessChange,
  onLoadProject,
  onOpenModelSelector,
  onPaste,
  onRedo,
  onSaveProject,
  onSelectFloor,
  onSlabThicknessChange,
  onToggleAddWall,
  onUndo,
  onWallHeightChange,
  onWallKindChange,
}: LeftToolRailProps) {
  const [openPanel, setOpenPanel] = useState<RailPanel | null>(null)
  const [materialManufacturer, setMaterialManufacturer] = useState('')
  const [materialType, setMaterialType] = useState('')
  const [materialFinish, setMaterialFinish] = useState('')
  const [selectedMaterialId, setSelectedMaterialId] = useState('')
  const [wallMaterialMode, setWallMaterialMode] =
    useState<WallMaterialMode>('full')
  const [wallCoverageHeight, setWallCoverageHeight] = useState(1.2)
  const [textureScale, setTextureScale] = useState(1)
  const [textureScaleInput, setTextureScaleInput] = useState('1')
  const [textureRotation, setTextureRotation] = useState(0)
  const [customPaintColor, setCustomPaintColor] = useState('#f4d7dd')
  const [internalWallThicknessDraft, setInternalWallThicknessDraft] = useState<
    string | null
  >(null)
  const [wallHeightDraft, setWallHeightDraft] = useState<string | null>(null)
  const [slabThicknessDraft, setSlabThicknessDraft] = useState<{
    floorId: string
    value: string
  } | null>(null)
  const activeFloor = floors.find((floor) => floor.id === activeFloorId)
  const internalWallThicknessInputValue =
    internalWallThicknessDraft ?? formatMetresInputValue(internalWallThickness)
  const wallHeightInputValue =
    wallHeightDraft ?? formatMetresInputValue(wallHeight)
  const slabThicknessInputValue =
    slabThicknessDraft?.floorId === activeFloorId
      ? slabThicknessDraft.value
      : formatMetresInputValue(activeFloor?.slabThickness ?? 0)

  const updateInternalWallThickness = (value: string) => {
    setInternalWallThicknessDraft(value)

    const parsedValue = Number.parseFloat(value)

    if (
      !Number.isFinite(parsedValue) ||
      parsedValue < MIN_INTERNAL_WALL_THICKNESS ||
      parsedValue > MAX_INTERNAL_WALL_THICKNESS
    ) {
      return
    }

    onInternalWallThicknessChange(parsedValue)
  }
  const commitInternalWallThickness = () => {
    if (internalWallThicknessDraft === null) {
      return
    }

    const parsedValue = Number.parseFloat(internalWallThicknessDraft)

    if (!Number.isFinite(parsedValue)) {
      setInternalWallThicknessDraft(null)
      return
    }

    const clampedValue = clampInternalWallThickness(parsedValue)
    onInternalWallThicknessChange(clampedValue)
    setInternalWallThicknessDraft(null)
  }
  const commitWallHeight = () => {
    if (wallHeightDraft === null || !activeFloor) {
      return
    }

    const parsedValue = Number.parseFloat(wallHeightDraft)

    if (!Number.isFinite(parsedValue)) {
      setWallHeightDraft(null)
      return
    }

    const height = Math.min(
      activeFloor.roomHeight,
      Math.max(MIN_WALL_HEIGHT, parsedValue),
    )
    onWallHeightChange(height)
    setWallHeightDraft(null)
  }
  const commitSlabThickness = () => {
    if (slabThicknessDraft?.floorId !== activeFloorId || !activeFloor) {
      return
    }

    const parsedValue = Number.parseFloat(slabThicknessDraft.value)

    if (!Number.isFinite(parsedValue)) {
      setSlabThicknessDraft(null)
      return
    }

    const thickness = Math.min(
      MAX_SLAB_THICKNESS,
      Math.max(MIN_SLAB_THICKNESS, parsedValue),
    )

    setSlabThicknessDraft(null)
    if (Math.abs(thickness - activeFloor.slabThickness) > 0.000001) {
      onSlabThicknessChange(thickness)
    }
  }
  const togglePanel = (panel: RailPanel) => {
    setOpenPanel((currentPanel) => (currentPanel === panel ? null : panel))
  }
  const manufacturers = Array.from(
    new Set(materials.map((material) => material.manufacturer)),
  ).sort((first, second) => first.localeCompare(second))
  const materialTypes = Array.from(
    new Set(
      materials.map((material) => material.materialType ?? material.category),
    ),
  ).sort((first, second) => first.localeCompare(second))
  const finishes = Array.from(
    new Set(materials.flatMap((material) => (material.finish ? [material.finish] : []))),
  ).sort((first, second) => first.localeCompare(second))
  const filteredMaterials = materials.filter((material) => {
    const type = material.materialType ?? material.category

    return (
      (!materialManufacturer || material.manufacturer === materialManufacturer) &&
      (!materialType || type === materialType) &&
      (!materialFinish || material.finish === materialFinish)
    )
  })
  const selectedMaterialIsVisible = filteredMaterials.some(
    (material) => material.id === selectedMaterialId,
  )
  const materialToApply = selectedMaterialIsVisible
    ? selectedMaterialId
    : filteredMaterials[0]?.id ?? ''
  const materialIsCustomPaint = materialToApply
    ? isCustomPaintMaterialId(materialToApply)
    : false
  const selectedSurfaceLabel =
    selectedSurface?.type === 'room-floor'
      ? 'Floor selected'
      : selectedSurface?.type === 'ceiling'
        ? 'Ceiling selected'
        : selectedSurface?.type === 'portal-floor'
          ? 'Doorway floor selected'
        : selectedSurface?.type === 'wall-face' ||
            selectedSurface?.type === 'wall-surface-fragment'
          ? 'Wall selected'
          : selectedSurface?.type === 'floor-slab-edge'
            ? 'Slab edge selected'
          : 'Select a wall, floor or ceiling in 3D'
  const applySelectedMaterial = () => {
    if (!selectedSurface || !materialToApply) {
      return
    }

    const parsedTextureScale = parseTextureScaleInput(textureScaleInput)
    const scaleToApply = parsedTextureScale ?? textureScale

    onApplyMaterial({
      coverageHeight:
        (selectedSurface.type === 'wall-face' ||
          selectedSurface.type === 'wall-surface-fragment') &&
        wallMaterialMode === 'lower'
          ? Math.min(
              selectedWallHeight ?? wallCoverageHeight,
              Math.max(0.05, wallCoverageHeight),
            )
          : selectedWallHeight ?? undefined,
      customColor: materialIsCustomPaint ? customPaintColor : undefined,
      materialId: materialToApply,
      textureRotation,
      textureScale: scaleToApply,
      wallMode:
        selectedSurface.type === 'wall-face' ||
        selectedSurface.type === 'wall-surface-fragment'
          ? wallMaterialMode
          : undefined,
      wallSide:
        selectedSurface.type === 'wall-face' ||
        selectedSurface.type === 'wall-surface-fragment'
          ? selectedSurface.side
          : undefined,
    })

    if (parsedTextureScale !== null) {
      setTextureScale(parsedTextureScale)
      setTextureScaleInput(formatDecimalInputValue(parsedTextureScale))
    }
  }

  return (
    <>
      <nav className="left-tool-rail" aria-label="Editor tools">
        <IconButton
          active={openPanel === 'project'}
          label="Project"
          onClick={() => togglePanel('project')}
        >
          P
        </IconButton>
        <IconButton
          active={isAddingWall || openPanel === 'wall'}
          label="Wall tools"
          onClick={() => togglePanel('wall')}
        >
          W
        </IconButton>
        <IconButton
          active={openPanel === 'floor'}
          label="Floor tools"
          onClick={() => togglePanel('floor')}
        >
          F
        </IconButton>
        <IconButton label="Add model" onClick={onOpenModelSelector}>
          M
        </IconButton>
        <IconButton
          active={openPanel === 'materials'}
          label="Materials"
          onClick={() => togglePanel('materials')}
        >
          A
        </IconButton>
        <div className="left-tool-rail-divider" />
        <IconButton disabled={!canUndo} label="Undo" onClick={onUndo}>
          U
        </IconButton>
        <IconButton disabled={!canRedo} label="Redo" onClick={onRedo}>
          R
        </IconButton>
        <IconButton disabled={!canCopy} label="Copy" onClick={onCopy}>
          C
        </IconButton>
        <IconButton disabled={!canCopy} label="Cut" onClick={onCut}>
          X
        </IconButton>
        <IconButton disabled={!canPaste} label="Paste" onClick={onPaste}>
          V
        </IconButton>
      </nav>

      {openPanel ? (
        <aside className="left-tool-flyout" aria-label={`${openPanel} tools`}>
          {openPanel === 'project' ? (
            <>
              <header>
                <h2>Project</h2>
              </header>
              <button type="button" onClick={onLoadProject}>
                Load project
              </button>
              <button type="button" onClick={onSaveProject}>
                Save project
              </button>
            </>
          ) : null}

          {openPanel === 'wall' ? (
            <>
              <header>
                <h2>Walls</h2>
                <p>{isAddingWall ? 'Click start, click end' : 'Choose wall type'}</p>
              </header>
              <button
                type="button"
                className={isAddingWall ? 'active' : ''}
                onClick={onToggleAddWall}
              >
                {isAddingWall ? 'Stop adding walls' : 'Add wall'}
              </button>
              <div className="flyout-segmented-control" aria-label="Wall type">
                <button
                  type="button"
                  className={wallKind === 'external' ? 'active' : ''}
                  onClick={() => onWallKindChange('external')}
                >
                  External
                </button>
                <button
                  type="button"
                  className={wallKind === 'internal' ? 'active' : ''}
                  onClick={() => onWallKindChange('internal')}
                >
                  Internal
                </button>
              </div>
              <label className="flyout-field">
                <span>Wall height</span>
                <div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={wallHeightInputValue}
                    onChange={(event) => setWallHeightDraft(event.target.value)}
                    onBlur={commitWallHeight}
                    onFocus={() =>
                      setWallHeightDraft(formatMetresInputValue(wallHeight))
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur()
                      }
                    }}
                  />
                  <span>m</span>
                </div>
              </label>
              <label className="flyout-field">
                <span>Internal thickness</span>
                <div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={internalWallThicknessInputValue}
                    onChange={(event) =>
                      updateInternalWallThickness(event.target.value)
                    }
                    onBlur={commitInternalWallThickness}
                    onFocus={() =>
                      setInternalWallThicknessDraft(
                        formatMetresInputValue(internalWallThickness),
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur()
                      }
                    }}
                  />
                  <span>m</span>
                </div>
              </label>
            </>
          ) : null}

          {openPanel === 'floor' ? (
            <>
              <header>
                <h2>Floors</h2>
                <p>{activeFloor ? `Editing ${activeFloor.name}` : 'No active floor'}</p>
              </header>
              <label className="flyout-select">
                <span>View / edit</span>
                <select
                  value={selectedFloorViewId}
                  onChange={(event) => onSelectFloor(event.target.value)}
                >
                  <option value="all">All floors</option>
                  {floors.map((floor) => (
                    <option key={floor.id} value={floor.id}>
                      {floor.id === activeFloorId
                        ? `${floor.name} (editing)`
                        : floor.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flyout-field">
                <span>Slab thickness</span>
                <div>
                  <input
                    type="text"
                    inputMode="decimal"
                    disabled={!activeFloor}
                    value={slabThicknessInputValue}
                    onChange={(event) =>
                      setSlabThicknessDraft({
                        floorId: activeFloorId,
                        value: event.target.value,
                      })
                    }
                    onBlur={commitSlabThickness}
                    onFocus={() =>
                      setSlabThicknessDraft({
                        floorId: activeFloorId,
                        value: formatMetresInputValue(
                          activeFloor?.slabThickness ?? 0,
                        ),
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur()
                      }
                    }}
                  />
                  <span>m</span>
                </div>
              </label>
              <button type="button" onClick={onAddFloor}>
                Add floor from external walls
              </button>
              <button type="button" onClick={onAddEmptyFloor}>
                Add empty floor
              </button>
              <button type="button" disabled={floors.length <= 1} onClick={onDeleteFloor}>
                Delete current floor
              </button>
            </>
          ) : null}

          {openPanel === 'materials' ? (
            <>
              <header>
                <h2>Materials</h2>
                <p>{selectedSurfaceLabel}</p>
              </header>
              <label className="flyout-select">
                <span>Manufacturer</span>
                <select
                  value={materialManufacturer}
                  onChange={(event) => setMaterialManufacturer(event.target.value)}
                >
                  <option value="">All</option>
                  {manufacturers.map((manufacturer) => (
                    <option key={manufacturer} value={manufacturer}>
                      {manufacturer}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flyout-select">
                <span>Type</span>
                <select
                  value={materialType}
                  onChange={(event) => setMaterialType(event.target.value)}
                >
                  <option value="">All</option>
                  {materialTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flyout-select">
                <span>Finish</span>
                <select
                  value={materialFinish}
                  onChange={(event) => setMaterialFinish(event.target.value)}
                >
                  <option value="">All</option>
                  {finishes.map((finish) => (
                    <option key={finish} value={finish}>
                      {finish}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flyout-select">
                <span>Product</span>
                <select
                  value={materialToApply}
                  onChange={(event) => setSelectedMaterialId(event.target.value)}
                >
                  {filteredMaterials.length > 0 ? (
                    filteredMaterials.map((material) => (
                      <option key={material.id} value={material.id}>
                        {getSurfaceMaterialLabel(material)}
                      </option>
                    ))
                  ) : (
                    <option value="">No matches</option>
                  )}
                </select>
              </label>
              {materialIsCustomPaint ? (
                <label className="flyout-colour-field">
                  <span>Paint colour</span>
                  <div>
                    <input
                      type="color"
                      value={customPaintColor}
                      onChange={(event) => setCustomPaintColor(event.target.value)}
                    />
                    <input
                      type="text"
                      value={customPaintColor}
                      onChange={(event) => setCustomPaintColor(event.target.value)}
                    />
                  </div>
                </label>
              ) : null}
              <label className="flyout-field">
                <span>Texture scale</span>
                <div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={textureScaleInput}
                    onChange={(event) => {
                      const nextValue = event.target.value

                      setTextureScaleInput(nextValue)

                      const parsedValue = parseTextureScaleInput(nextValue)
                      if (parsedValue !== null) {
                        setTextureScale(parsedValue)
                      }
                    }}
                    onBlur={() => {
                      const parsedValue = parseTextureScaleInput(textureScaleInput)

                      if (parsedValue === null) {
                        setTextureScaleInput(formatDecimalInputValue(textureScale))
                        return
                      }

                      setTextureScale(parsedValue)
                      setTextureScaleInput(formatDecimalInputValue(parsedValue))
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur()
                      }
                    }}
                  />
                  <span>x</span>
                </div>
              </label>
              <label className="flyout-select">
                <span>Orientation</span>
                <select
                  value={textureRotation}
                  onChange={(event) => setTextureRotation(Number(event.target.value))}
                >
                  <option value={0}>0 deg</option>
                  <option value={90}>90 deg</option>
                  <option value={180}>180 deg</option>
                  <option value={270}>270 deg</option>
                </select>
              </label>
              {selectedSurface?.type === 'wall-face' ||
              selectedSurface?.type === 'wall-surface-fragment' ? (
                <>
                  <div className="flyout-segmented-control" aria-label="Wall finish area">
                    <button
                      type="button"
                      className={wallMaterialMode === 'full' ? 'active' : ''}
                      onClick={() => setWallMaterialMode('full')}
                    >
                      Wall
                    </button>
                    <button
                      type="button"
                      className={wallMaterialMode === 'lower' ? 'active' : ''}
                      onClick={() => setWallMaterialMode('lower')}
                    >
                      Lower wall
                    </button>
                  </div>
                  {wallMaterialMode === 'lower' ? (
                    <label className="flyout-field">
                      <span>Height</span>
                      <div>
                        <input
                          type="number"
                          min="0.05"
                          max={selectedWallHeight ?? 3}
                          step="0.05"
                          value={wallCoverageHeight}
                          onChange={(event) => {
                            const parsedValue = Number.parseFloat(event.target.value)

                            if (Number.isFinite(parsedValue)) {
                              setWallCoverageHeight(parsedValue)
                            }
                          }}
                        />
                        <span>m</span>
                      </div>
                    </label>
                  ) : null}
                </>
              ) : null}
              <button
                type="button"
                disabled={!selectedSurface || !materialToApply}
                onClick={applySelectedMaterial}
              >
                Apply material
              </button>
            </>
          ) : null}
        </aside>
      ) : null}
    </>
  )
}
