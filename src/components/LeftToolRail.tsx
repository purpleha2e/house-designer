import { RoofPitchFields } from './RoofPitchFields'
import { useEffect, useState, type ReactNode } from 'react'
import { getSurfaceMaterialLabel } from '../materials/materialCatalog'
import type {
  FloorLevel,
  SelectableSurface,
  SurfaceMaterialProduct,
  SurfaceWallSide,
  WallKind,
  RoofStructure,
} from '../types'

type RailPanel = 'align' | 'floor' | 'materials' | 'roof' | 'wall'
type WallMaterialMode = 'full' | 'lower'
type ModelAlignDirection = 'bottom' | 'left' | 'right' | 'top'
type HipRoofCreateOptions = {
  floorId: string
  pitchDegrees: number
  overhangPitchDegrees?: number
  soffitColor?: string
  type: RoofStructure['type']
  width: number
}

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
  selectedModelCount: number
  selectedWallHeight: number | null
  wallCount: number
  wallHeight: number
  wallKind: WallKind
  onAddEmptyFloor: () => void
  onAddFloor: () => void
  onAddRoof: (options: HipRoofCreateOptions) => void
  onApplyMaterial: (options: {
    coverageHeight?: number
    customColor?: string
    materialId: string
    textureRotation: number
    textureScale: number
    wallMode?: WallMaterialMode
    wallSide?: SurfaceWallSide
  }) => void
  onAlignModels: (direction: ModelAlignDirection) => void
  onCopy: () => void
  onCut: () => void
  onDeleteFloor: () => void
  onInternalWallThicknessChange: (thickness: number) => void
  onOpenModelSelector: () => void
  onPaste: () => void
  onRedo: () => void
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
  children: ReactNode
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

function IconSvg({
  children,
}: {
  children: ReactNode
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
    >
      {children}
    </svg>
  )
}

function WallIcon() {
  return (
    <IconSvg>
      <path d="M4 18V7h16v11" />
      <path d="M4 10h16" />
      <path d="M4 14h16" />
      <path d="M8 7v3" />
      <path d="M13 10v4" />
      <path d="M18 14v4" />
    </IconSvg>
  )
}

function FloorIcon() {
  return (
    <IconSvg>
      <path d="M4 17h16" />
      <path d="M7 13h10" />
      <path d="M10 9h4" />
      <path d="M5 17 10 9" />
      <path d="m19 17-5-8" />
    </IconSvg>
  )
}

function RoofIcon() {
  return (
    <IconSvg>
      <path d="M3 14 12 5l9 9" />
      <path d="M6 13h12" />
      <path d="M7 13v6h10v-6" />
      <path d="M12 5v14" />
    </IconSvg>
  )
}

function ModelIcon() {
  return (
    <IconSvg>
      <path d="m12 4 7 4-7 4-7-4 7-4Z" />
      <path d="M5 8v8l7 4 7-4V8" />
      <path d="M12 12v8" />
    </IconSvg>
  )
}

function MaterialIcon() {
  return (
    <IconSvg>
      <path d="M6 4h12v16H6z" />
      <path d="M6 8h12" />
      <path d="M6 12h12" />
      <path d="M6 16h12" />
      <path d="M10 4v4" />
      <path d="M14 8v4" />
      <path d="M10 12v4" />
      <path d="M14 16v4" />
    </IconSvg>
  )
}

function AlignIcon() {
  return (
    <IconSvg>
      <path d="M5 5v14" />
      <path d="M9 7h10" />
      <path d="M9 12h7" />
      <path d="M9 17h10" />
      <path d="M5 12h2" />
    </IconSvg>
  )
}

function UndoIcon() {
  return (
    <IconSvg>
      <path d="m9 7-4 4 4 4" />
      <path d="M5 11h9a5 5 0 0 1 4.6 7" />
    </IconSvg>
  )
}

function RedoIcon() {
  return (
    <IconSvg>
      <path d="m15 7 4 4-4 4" />
      <path d="M19 11h-9a5 5 0 0 0-4.6 7" />
    </IconSvg>
  )
}

function CopyIcon() {
  return (
    <IconSvg>
      <path d="M8 8h11v11H8z" />
      <path d="M5 16V5h11" />
    </IconSvg>
  )
}

function CutIcon() {
  return (
    <IconSvg>
      <path d="m5 5 14 14" />
      <path d="m19 5-6 6" />
      <circle cx="6" cy="17" r="2" />
      <circle cx="6" cy="7" r="2" />
    </IconSvg>
  )
}

function PasteIcon() {
  return (
    <IconSvg>
      <path d="M9 4h6l1 2h3v14H5V6h3l1-2Z" />
      <path d="M9 4v4h6V4" />
    </IconSvg>
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
  selectedModelCount,
  selectedWallHeight,
  wallHeight,
  wallKind,
  onAddEmptyFloor,
  onAddFloor,
  onAddRoof,
  onApplyMaterial,
  onAlignModels,
  onCopy,
  onCut,
  onDeleteFloor,
  onInternalWallThicknessChange,
  onOpenModelSelector,
  onPaste,
  onRedo,
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
  const [roofFloorId, setRoofFloorId] = useState(activeFloorId)
  const [roofType, setRoofType] = useState<RoofStructure['type']>('hip')
  const [roofPitchDegrees, setRoofPitchDegrees] = useState(35)
  const [roofSoffitColor, setRoofSoffitColor] = useState('#ffffff')
  const [roofOverhangPitchDegrees, setRoofOverhangPitchDegrees] = useState<number | undefined>()
  const [roofWidth, setRoofWidth] = useState(8)
  const [internalWallThicknessDraft, setInternalWallThicknessDraft] = useState<
    string | null
  >(null)
  const [wallHeightDraft, setWallHeightDraft] = useState<string | null>(null)
  const [slabThicknessDraft, setSlabThicknessDraft] = useState<{
    floorId: string
    value: string
  } | null>(null)
  const activeFloor = floors.find((floor) => floor.id === activeFloorId)
  const roofTargetFloor =
    floors.find((floor) => floor.id === roofFloorId) ?? activeFloor
  const internalWallThicknessInputValue =
    internalWallThicknessDraft ?? formatMetresInputValue(internalWallThickness)
  const wallHeightInputValue =
    wallHeightDraft ?? formatMetresInputValue(wallHeight)
  const slabThicknessInputValue =
    slabThicknessDraft?.floorId === activeFloorId
      ? slabThicknessDraft.value
      : formatMetresInputValue(activeFloor?.slabThickness ?? 0)

  useEffect(() => {
    if (floors.some((floor) => floor.id === roofFloorId)) {
      return
    }

    setRoofFloorId(activeFloorId)
  }, [activeFloorId, floors, roofFloorId])

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
  const selectedSurfaceLabel =
    selectedSurface?.type === 'room-floor'
      ? 'Floor selected'
      : selectedSurface?.type === 'ceiling'
        ? 'Ceiling selected'
        : selectedSurface?.type === 'portal-floor'
          ? 'Doorway floor selected'
          : selectedSurface?.type === 'roof'
            ? 'Roof selected'
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
          active={isAddingWall || openPanel === 'wall'}
          label="Wall tools"
          onClick={() => togglePanel('wall')}
        >
          <WallIcon />
        </IconButton>
        <IconButton
          active={openPanel === 'floor'}
          label="Floor tools"
          onClick={() => togglePanel('floor')}
        >
          <FloorIcon />
        </IconButton>
        <IconButton
          active={openPanel === 'roof'}
          label="Roof tools"
          onClick={() => togglePanel('roof')}
        >
          <RoofIcon />
        </IconButton>
        <IconButton label="Add model" onClick={onOpenModelSelector}>
          <ModelIcon />
        </IconButton>
        <IconButton
          active={openPanel === 'materials'}
          label="Materials"
          onClick={() => togglePanel('materials')}
        >
          <MaterialIcon />
        </IconButton>
        <IconButton
          active={openPanel === 'align'}
          disabled={selectedModelCount < 2}
          label="Align"
          onClick={() => togglePanel('align')}
        >
          <AlignIcon />
        </IconButton>
        <div className="left-tool-rail-divider" />
        <IconButton disabled={!canUndo} label="Undo" onClick={onUndo}>
          <UndoIcon />
        </IconButton>
        <IconButton disabled={!canRedo} label="Redo" onClick={onRedo}>
          <RedoIcon />
        </IconButton>
        <IconButton disabled={!canCopy} label="Copy" onClick={onCopy}>
          <CopyIcon />
        </IconButton>
        <IconButton disabled={!canCopy} label="Cut" onClick={onCut}>
          <CutIcon />
        </IconButton>
        <IconButton disabled={!canPaste} label="Paste" onClick={onPaste}>
          <PasteIcon />
        </IconButton>
      </nav>

      {openPanel ? (
        <aside className="left-tool-flyout" aria-label={`${openPanel} tools`}>
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

          {openPanel === 'roof' ? (
            <>
              <header>
                <h2>Roof</h2>
                <p>{roofTargetFloor ? `Add to ${roofTargetFloor.name}` : 'No floor'}</p>
              </header>
              <label className="flyout-select">
                <span>Floor</span>
                <select
                  value={roofTargetFloor?.id ?? ''}
                  onChange={(event) => setRoofFloorId(event.target.value)}
                >
                  {floors.map((floor) => (
                    <option key={floor.id} value={floor.id}>
                      {floor.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flyout-select">
                <span>Type</span>
                <select
                  value={roofType}
                  onChange={(event) =>
                    setRoofType(event.target.value as RoofStructure['type'])
                  }
                >
                  <option value="flat">Flat</option>
                  <option value="hip">Hip roof</option>
                  <option value="lean-to">Lean-to</option>
                  <option value="up-and-over">Up and over</option>
                </select>
              </label>
              <RoofPitchFields
                roof={{ type: roofType, pitchDegrees: roofPitchDegrees, overhangPitchDegrees: roofOverhangPitchDegrees, soffitColor: roofSoffitColor }}
                onChange={(updates) => {
                  if (updates.pitchDegrees !== undefined) setRoofPitchDegrees(updates.pitchDegrees)
                  if (updates.soffitColor !== undefined) setRoofSoffitColor(updates.soffitColor)
                  if ('overhangPitchDegrees' in updates) setRoofOverhangPitchDegrees(updates.overhangPitchDegrees)
                }}
              />
              <label className="flyout-field">
                <span>Width</span>
                <div>
                  <input
                    type="number"
                    min="0.3"
                    step="0.1"
                    value={roofWidth}
                    onChange={(event) => {
                      const parsedValue = Number.parseFloat(event.target.value)

                      if (Number.isFinite(parsedValue)) {
                        setRoofWidth(Math.max(0.3, parsedValue))
                      }
                    }}
                  />
                  <span>m</span>
                </div>
              </label>
              <button
                type="button"
                disabled={!roofTargetFloor}
                onClick={() =>
                  onAddRoof({
                    floorId: roofTargetFloor?.id ?? activeFloorId,
                    pitchDegrees: roofPitchDegrees,
                    overhangPitchDegrees: roofOverhangPitchDegrees,
                    soffitColor: roofSoffitColor,
                    type: roofType,
                    width: roofWidth,
                  })
                }
              >
                Add roof
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

          {openPanel === 'align' ? (
            <>
              <header>
                <h2>Align</h2>
                <p>{selectedModelCount} objects selected</p>
              </header>
              <div className="flyout-grid-control" aria-label="Align selected objects">
                <button
                  type="button"
                  disabled={selectedModelCount < 2}
                  onClick={() => onAlignModels('top')}
                >
                  Top
                </button>
                <button
                  type="button"
                  disabled={selectedModelCount < 2}
                  onClick={() => onAlignModels('bottom')}
                >
                  Bottom
                </button>
                <button
                  type="button"
                  disabled={selectedModelCount < 2}
                  onClick={() => onAlignModels('left')}
                >
                  Left
                </button>
                <button
                  type="button"
                  disabled={selectedModelCount < 2}
                  onClick={() => onAlignModels('right')}
                >
                  Right
                </button>
              </div>
            </>
          ) : null}
        </aside>
      ) : null}
    </>
  )
}
