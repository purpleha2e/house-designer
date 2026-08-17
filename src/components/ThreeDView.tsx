import { Edges, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { EffectComposer, N8AO } from '@react-three/postprocessing'
import { Color, DirectionalLight, Object3D, Shape } from 'three'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FloorLevel, Point, Wall } from '../types'
import { getRenderedWalls, type RenderedWall } from '../wallGeometry'

type ThreeDViewProps = {
  activeFloorId: string
  floors: FloorLevel[]
}

type RenderOptions = {
  ambientOcclusion: boolean
  floorSlabs: boolean
  groundPlane: boolean
  referenceFloors: boolean
  shadows: boolean
}

const ambientOcclusionColor = new Color('black')
const FLOOR_PLANE_MARGIN = 5
const SHADOW_MARGIN = 8
const FOOTPRINT_EPSILON = 0.04

type FootprintEdge = {
  wall: Wall
  startKey: string
  endKey: string
}

type FootprintCandidate = {
  edge: FootprintEdge
  nextKey: string
}

function getFloorPlaneBounds(floor: FloorLevel) {
  if (floor.walls.length === 0) {
    return null
  }

  const points = floor.walls.flatMap((wall) => [wall.start, wall.end])
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minZ = Math.min(...points.map((point) => point.y))
  const maxZ = Math.max(...points.map((point) => point.y))
  const width = maxX - minX + FLOOR_PLANE_MARGIN * 2
  const depth = maxZ - minZ + FLOOR_PLANE_MARGIN * 2
  const size = Math.max(width, depth, FLOOR_PLANE_MARGIN * 2)

  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    size,
  }
}

function getPointKey(point: Point) {
  return `${Math.round(point.x / FOOTPRINT_EPSILON)}:${Math.round(point.y / FOOTPRINT_EPSILON)}`
}

function getSignedArea(points: Point[]) {
  return (
    points.reduce((area, point, index) => {
      const nextPoint = points[(index + 1) % points.length]
      return area + point.x * nextPoint.y - nextPoint.x * point.y
    }, 0) / 2
  )
}

function normalizeAngleRadians(angle: number) {
  const fullCircle = Math.PI * 2
  let normalized = angle % fullCircle

  if (normalized < 0) {
    normalized += fullCircle
  }

  return normalized
}

function getLineIntersection(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
) {
  const x1 = firstStart.x
  const y1 = firstStart.y
  const x2 = firstEnd.x
  const y2 = firstEnd.y
  const x3 = secondStart.x
  const y3 = secondStart.y
  const x4 = secondEnd.x
  const y4 = secondEnd.y
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)

  if (Math.abs(denominator) < 0.0001) {
    return null
  }

  const firstDeterminant = x1 * y2 - y1 * x2
  const secondDeterminant = x3 * y4 - y3 * x4

  return {
    x:
      (firstDeterminant * (x3 - x4) - (x1 - x2) * secondDeterminant) /
      denominator,
    y:
      (firstDeterminant * (y3 - y4) - (y1 - y2) * secondDeterminant) /
      denominator,
  }
}

function getExternalWallLoop(walls: Wall[]) {
  const externalWalls = walls.filter((wall) => wall.kind !== 'internal')

  if (externalWalls.length < 3) {
    return null
  }

  const edges = externalWalls.map((wall) => ({
    wall,
    startKey: getPointKey(wall.start),
    endKey: getPointKey(wall.end),
  }))
  const connections = new Map<string, FootprintEdge[]>()
  const pointGroups = new Map<string, Point[]>()

  for (const edge of edges) {
    connections.set(edge.startKey, [...(connections.get(edge.startKey) ?? []), edge])
    connections.set(edge.endKey, [...(connections.get(edge.endKey) ?? []), edge])
    pointGroups.set(edge.startKey, [
      ...(pointGroups.get(edge.startKey) ?? []),
      edge.wall.start,
    ])
    pointGroups.set(edge.endKey, [
      ...(pointGroups.get(edge.endKey) ?? []),
      edge.wall.end,
    ])
  }

  const pointsByKey = new Map(
    [...pointGroups.entries()].map(([key, points]) => [
      key,
      {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      },
    ]),
  )
  const loops: Point[][] = []

  for (const edge of edges) {
    for (const [startKey, endKey] of [
      [edge.startKey, edge.endKey],
      [edge.endKey, edge.startKey],
    ] as const) {
      const rightTurnLoop = traceWallLoop(
        edge,
        startKey,
        endKey,
        connections,
        pointsByKey,
        true,
      )

      if (rightTurnLoop) {
        loops.push(rightTurnLoop)
      }

      const leftTurnLoop = traceWallLoop(
        edge,
        startKey,
        endKey,
        connections,
        pointsByKey,
        false,
      )

      if (leftTurnLoop) {
        loops.push(leftTurnLoop)
      }
    }
  }

  return loops.reduce<Point[] | null>((bestLoop, loop) => {
    const area = Math.abs(getSignedArea(loop))

    if (area < 0.01 || loop.length < 3) {
      return bestLoop
    }

    return !bestLoop || area > Math.abs(getSignedArea(bestLoop)) ? loop : bestLoop
  }, null)
}

function traceWallLoop(
  firstEdge: FootprintEdge,
  startKey: string,
  endKey: string,
  connections: Map<string, FootprintEdge[]>,
  pointsByKey: Map<string, Point>,
  preferRightTurn: boolean,
) {
  const loopKeys = [startKey]
  const visitedStates = new Set<string>()
  let previousKey = startKey
  let currentKey = endKey
  let currentEdge = firstEdge
  const maxSteps = connections.size * 4

  for (let step = 0; step < maxSteps; step += 1) {
    const stateKey = `${currentEdge.wall.id}:${previousKey}:${currentKey}`

    if (visitedStates.has(stateKey)) {
      return null
    }

    visitedStates.add(stateKey)
    loopKeys.push(currentKey)

    if (currentKey === startKey) {
      const uniqueKeys = new Set(loopKeys.slice(0, -1))

      return uniqueKeys.size >= 3
        ? loopKeys.slice(0, -1).map((key) => pointsByKey.get(key)!)
        : null
    }

    const candidates = (connections.get(currentKey) ?? [])
      .map((edge): FootprintCandidate => {
        const nextKey = edge.startKey === currentKey ? edge.endKey : edge.startKey
        return { edge, nextKey }
      })
      .filter(
        (candidate) =>
          candidate.edge.wall.id !== currentEdge.wall.id ||
          candidate.nextKey !== previousKey,
      )

    if (candidates.length === 0) {
      return null
    }

    const nextCandidate = chooseNextFootprintEdge(
      previousKey,
      currentKey,
      candidates,
      pointsByKey,
      preferRightTurn,
    )

    previousKey = currentKey
    currentKey = nextCandidate.nextKey
    currentEdge = nextCandidate.edge
  }

  return null
}

function chooseNextFootprintEdge(
  previousKey: string,
  currentKey: string,
  candidates: FootprintCandidate[],
  pointsByKey: Map<string, Point>,
  preferRightTurn: boolean,
) {
  const previousPoint = pointsByKey.get(previousKey)!
  const currentPoint = pointsByKey.get(currentKey)!
  const incomingAngle = Math.atan2(
    currentPoint.y - previousPoint.y,
    currentPoint.x - previousPoint.x,
  )

  return candidates.reduce((bestCandidate, candidate) => {
    const bestPoint = pointsByKey.get(bestCandidate.nextKey)!
    const candidatePoint = pointsByKey.get(candidate.nextKey)!
    const bestOutgoingAngle = Math.atan2(
      bestPoint.y - currentPoint.y,
      bestPoint.x - currentPoint.x,
    )
    const candidateOutgoingAngle = Math.atan2(
      candidatePoint.y - currentPoint.y,
      candidatePoint.x - currentPoint.x,
    )
    const bestTurn = preferRightTurn
      ? normalizeAngleRadians(incomingAngle - bestOutgoingAngle)
      : normalizeAngleRadians(bestOutgoingAngle - incomingAngle)
    const candidateTurn = preferRightTurn
      ? normalizeAngleRadians(incomingAngle - candidateOutgoingAngle)
      : normalizeAngleRadians(candidateOutgoingAngle - incomingAngle)

    return candidateTurn < bestTurn ? candidate : bestCandidate
  }, candidates[0])
}

function getOffsetFootprint(loop: Point[], offset: number) {
  const isCounterClockwise = getSignedArea(loop) > 0

  return loop.map((point, index) => {
    const previousPoint = loop[(index - 1 + loop.length) % loop.length]
    const nextPoint = loop[(index + 1) % loop.length]
    const previousDirection = {
      x: point.x - previousPoint.x,
      y: point.y - previousPoint.y,
    }
    const nextDirection = {
      x: nextPoint.x - point.x,
      y: nextPoint.y - point.y,
    }
    const previousLength = Math.hypot(previousDirection.x, previousDirection.y)
    const nextLength = Math.hypot(nextDirection.x, nextDirection.y)

    if (previousLength === 0 || nextLength === 0) {
      return point
    }

    const previousUnit = {
      x: previousDirection.x / previousLength,
      y: previousDirection.y / previousLength,
    }
    const nextUnit = {
      x: nextDirection.x / nextLength,
      y: nextDirection.y / nextLength,
    }
    const getOutwardNormal = (unit: Point) =>
      isCounterClockwise
        ? { x: unit.y, y: -unit.x }
        : { x: -unit.y, y: unit.x }
    const previousNormal = getOutwardNormal(previousUnit)
    const nextNormal = getOutwardNormal(nextUnit)
    const previousOffsetStart = {
      x: previousPoint.x + previousNormal.x * offset,
      y: previousPoint.y + previousNormal.y * offset,
    }
    const previousOffsetEnd = {
      x: point.x + previousNormal.x * offset,
      y: point.y + previousNormal.y * offset,
    }
    const nextOffsetStart = {
      x: point.x + nextNormal.x * offset,
      y: point.y + nextNormal.y * offset,
    }
    const nextOffsetEnd = {
      x: nextPoint.x + nextNormal.x * offset,
      y: nextPoint.y + nextNormal.y * offset,
    }

    return (
      getLineIntersection(
        previousOffsetStart,
        previousOffsetEnd,
        nextOffsetStart,
        nextOffsetEnd,
      ) ?? {
        x: point.x + (previousNormal.x + nextNormal.x) * offset,
        y: point.y + (previousNormal.y + nextNormal.y) * offset,
      }
    )
  })
}

function getFloorFootprint(floor: FloorLevel) {
  const loop = getExternalWallLoop(floor.walls)
  const externalThickness =
    floor.walls.find((wall) => wall.kind !== 'internal')?.thickness ?? 0

  return loop ? getOffsetFootprint(loop, externalThickness / 2) : null
}

function getNearestFloorFootprint(floor: FloorLevel, floors: FloorLevel[]) {
  const ownFootprint = getFloorFootprint(floor)

  if (ownFootprint) {
    return ownFootprint
  }

  for (const candidateFloor of [...floors]
    .filter((candidateFloor) => candidateFloor.elevation < floor.elevation)
    .sort((firstFloor, secondFloor) => secondFloor.elevation - firstFloor.elevation)) {
    const candidateFootprint = getFloorFootprint(candidateFloor)

    if (candidateFootprint) {
      return candidateFootprint
    }
  }

  return null
}

function getSceneBounds(floors: FloorLevel[]) {
  const walls = floors.flatMap((floor) => floor.walls)

  if (walls.length === 0) {
    return {
      centerX: 0,
      centerZ: 0,
      size: 20,
      maxElevation: 8,
    }
  }

  const points = walls.flatMap((wall) => [wall.start, wall.end])
  const maxTop = Math.max(
    ...floors.flatMap((floor) =>
      floor.walls.map((wall) => floor.elevation + wall.height),
    ),
    8,
  )
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minZ = Math.min(...points.map((point) => point.y))
  const maxZ = Math.max(...points.map((point) => point.y))
  const size = Math.max(maxX - minX, maxZ - minZ, maxTop) + SHADOW_MARGIN * 2

  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    size,
    maxElevation: maxTop,
  }
}

function SunLight({
  sceneBounds,
  shadows,
}: {
  sceneBounds: ReturnType<typeof getSceneBounds>
  shadows: boolean
}) {
  const lightRef = useRef<DirectionalLight>(null)
  const targetRef = useRef<Object3D>(null)

  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current
      lightRef.current.target.updateMatrixWorld()
    }
  }, [sceneBounds])

  return (
    <>
      <object3D
        ref={targetRef}
        position={[sceneBounds.centerX, 0, sceneBounds.centerZ]}
      />
      <directionalLight
        ref={lightRef}
        position={[
          sceneBounds.centerX + 4,
          sceneBounds.maxElevation + 8,
          sceneBounds.centerZ + 6,
        ]}
        intensity={1.3}
        castShadow={shadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-sceneBounds.size / 2}
        shadow-camera-right={sceneBounds.size / 2}
        shadow-camera-top={sceneBounds.size / 2}
        shadow-camera-bottom={-sceneBounds.size / 2}
        shadow-camera-near={0.5}
        shadow-camera-far={sceneBounds.maxElevation + 30}
        shadow-bias={-0.0001}
        shadow-normalBias={0.02}
      />
    </>
  )
}

function WallMesh({
  castsShadow,
  elevation,
  isActive,
  renderedWall,
}: {
  castsShadow: boolean
  elevation: number
  isActive: boolean
  renderedWall: RenderedWall
}) {
  const { wall, startExtension, endExtension } = renderedWall
  const dx = wall.end.x - wall.start.x
  const dz = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dz)
  const renderedLength = length + startExtension + endExtension
  const unitX = length === 0 ? 0 : dx / length
  const unitZ = length === 0 ? 0 : dz / length
  const centerX =
    (wall.start.x + wall.end.x) / 2 + unitX * ((endExtension - startExtension) / 2)
  const centerZ =
    (wall.start.y + wall.end.y) / 2 + unitZ * ((endExtension - startExtension) / 2)
  const rotationY = -Math.atan2(dz, dx)

  return (
    <mesh
      position={[centerX, elevation + wall.height / 2, centerZ]}
      rotation={[0, rotationY, 0]}
      castShadow={castsShadow}
      receiveShadow={castsShadow}
      renderOrder={isActive ? 2 : 1}
    >
      <boxGeometry args={[renderedLength, wall.height, wall.thickness]} />
      {isActive ? (
        <meshStandardMaterial
          color={wall.kind === 'external' ? '#d7dde5' : '#cbd5e1'}
          roughness={0.72}
        />
      ) : (
        <>
          <meshBasicMaterial
            color="#94a3b8"
            depthWrite={false}
            opacity={0.015}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
            transparent
          />
          <Edges color="#64748b" threshold={15} />
        </>
      )}
    </mesh>
  )
}

function FloorSlab({
  floor,
  floors,
  isSolid,
}: {
  floor: FloorLevel
  floors: FloorLevel[]
  isSolid: boolean
}) {
  const footprint = getNearestFloorFootprint(floor, floors)
  const slabShape = useMemo(() => {
    if (!footprint) {
      return null
    }

    const [firstPoint, ...remainingPoints] = footprint
    const shape = new Shape()
    shape.moveTo(firstPoint.x, -firstPoint.y)

    for (const point of remainingPoints) {
      shape.lineTo(point.x, -point.y)
    }

    shape.closePath()
    return shape
  }, [footprint])

  if (!slabShape) {
    return null
  }

  return (
    <mesh
      position={[0, floor.elevation + floor.roomHeight, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow={isSolid}
      renderOrder={isSolid ? 1 : 0}
    >
      <extrudeGeometry
        args={[
          slabShape,
          {
            bevelEnabled: false,
            depth: floor.slabThickness,
          },
        ]}
      />
      <meshStandardMaterial
        color="#e2e8f0"
        opacity={isSolid ? 1 : 0.18}
        transparent={!isSolid}
        depthWrite={isSolid}
        roughness={0.82}
      />
    </mesh>
  )
}

export function ThreeDView({ activeFloorId, floors }: ThreeDViewProps) {
  const [isRenderMenuOpen, setIsRenderMenuOpen] = useState(false)
  const [renderOptions, setRenderOptions] = useState<RenderOptions>({
    ambientOcclusion: true,
    floorSlabs: true,
    groundPlane: true,
    referenceFloors: true,
    shadows: true,
  })
  const sceneBounds = getSceneBounds(floors)
  const activeFloor = floors.find((floor) => floor.id === activeFloorId) ?? null
  const floorBelowActive = activeFloor
    ? floors
        .filter((floor) => floor.elevation < activeFloor.elevation)
        .sort((firstFloor, secondFloor) => secondFloor.elevation - firstFloor.elevation)[0] ??
      null
    : null
  const visibleFloors = renderOptions.referenceFloors
    ? floors
    : floors.filter(
        (floor) => floor.id === activeFloorId || floor.id === floorBelowActive?.id,
      )

  const updateRenderOption = (option: keyof RenderOptions) => {
    setRenderOptions((currentOptions) => ({
      ...currentOptions,
      [option]: !currentOptions[option],
    }))
  }

  return (
    <section className="editor-pane">
      <div className="pane-header">
        <h2>3D View</h2>
        <span>Orbit enabled</span>
        <div className="render-options">
          <button
            type="button"
            aria-expanded={isRenderMenuOpen}
            onClick={() => setIsRenderMenuOpen((value) => !value)}
          >
            Render
          </button>
          {isRenderMenuOpen ? (
            <div className="render-options-menu">
              <label>
                <input
                  type="checkbox"
                  checked={renderOptions.ambientOcclusion}
                  onChange={() => updateRenderOption('ambientOcclusion')}
                />
                Ambient occlusion
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={renderOptions.shadows}
                  onChange={() => updateRenderOption('shadows')}
                />
                Shadows
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={renderOptions.referenceFloors}
                  onChange={() => updateRenderOption('referenceFloors')}
                />
                Reference floors
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={renderOptions.groundPlane}
                  onChange={() => updateRenderOption('groundPlane')}
                />
                Ground plane
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={renderOptions.floorSlabs}
                  onChange={() => updateRenderOption('floorSlabs')}
                />
                Floor slabs
              </label>
            </div>
          ) : null}
        </div>
      </div>

      <div className="three-host">
        <Canvas
          shadows={renderOptions.shadows}
          camera={{ position: [6, 5, 8], fov: 45 }}
          gl={{ antialias: true }}
        >
          <color attach="background" args={['#eef2f7']} />
          <ambientLight intensity={0.55} />
          <SunLight sceneBounds={sceneBounds} shadows={renderOptions.shadows} />

          {visibleFloors.map((floor) => {
            const isActive = floor.id === activeFloorId
            const slabIsSolid = floor.id === floorBelowActive?.id
            const hasShadowSurface = renderOptions.shadows && isActive
            const floorPlane =
              renderOptions.groundPlane && isActive
                ? getFloorPlaneBounds(floor)
                : null
            const shouldRenderSlab =
              renderOptions.floorSlabs && floor.id === floorBelowActive?.id

            return (
              <group key={floor.id}>
                {shouldRenderSlab ? (
                  <FloorSlab floor={floor} floors={floors} isSolid={slabIsSolid} />
                ) : null}
                {floorPlane ? (
                  <>
                    <gridHelper
                      args={[
                        floorPlane.size,
                        Math.max(2, Math.round(floorPlane.size)),
                        isActive ? '#94a3b8' : '#cbd5e1',
                        isActive ? '#cbd5e1' : '#f1f5f9',
                      ]}
                      position={[
                        floorPlane.centerX,
                        0,
                        floorPlane.centerZ,
                      ]}
                    />
                    <mesh
                      position={[
                        floorPlane.centerX,
                        -0.01,
                        floorPlane.centerZ,
                      ]}
                      rotation={[-Math.PI / 2, 0, 0]}
                      receiveShadow={hasShadowSurface}
                      renderOrder={isActive ? 0 : -1}
                    >
                      <planeGeometry args={[floorPlane.size, floorPlane.size]} />
                      <meshStandardMaterial
                        color={isActive ? '#f8fafc' : '#eef2f7'}
                        depthWrite={isActive}
                        opacity={isActive ? 1 : 0.035}
                        polygonOffset={!isActive}
                        polygonOffsetFactor={2}
                        polygonOffsetUnits={2}
                        transparent={!isActive}
                      />
                    </mesh>
                  </>
                ) : null}
                {getRenderedWalls(floor.walls).map((renderedWall) => (
                  <WallMesh
                    key={renderedWall.wall.id}
                    castsShadow={hasShadowSurface}
                    elevation={floor.elevation}
                    isActive={isActive}
                    renderedWall={renderedWall}
                  />
                ))}
              </group>
            )
          })}

          <OrbitControls makeDefault target={[3, 1.2, 3]} />
          {renderOptions.ambientOcclusion ? (
            <EffectComposer multisampling={0}>
              <N8AO
                aoRadius={0.75}
                distanceFalloff={0.45}
                intensity={3.2}
                quality="high"
                aoSamples={32}
                denoiseSamples={8}
                denoiseRadius={8}
                color={ambientOcclusionColor}
              />
            </EffectComposer>
          ) : null}
        </Canvas>
      </div>
    </section>
  )
}
