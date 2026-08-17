import type { Point, Wall } from './types'
import { getRenderedWalls, getWallPolygon, type RenderedWall } from './wallGeometry'

const NODE_EPSILON_METERS = 0.25

export type WallEndpoint = 'start' | 'end'

export type WallNodeConnection = {
  endpoint: WallEndpoint
  wall: Wall
}

export type WallNode = {
  id: string
  point: Point
  connections: WallNodeConnection[]
}

export type WallTopology = {
  nodes: WallNode[]
  nodesByEndpoint: Map<string, WallNode>
  renderedWallsById: Map<string, RenderedWall>
  wallPolygonsById: Map<string, Point[]>
}

function distance(start: Point, end: Point) {
  return Math.hypot(end.x - start.x, end.y - start.y)
}

function getEndpointKey(wallId: string, endpoint: WallEndpoint) {
  return `${wallId}:${endpoint}`
}

function createNodeId(point: Point) {
  return `${Math.round(point.x / NODE_EPSILON_METERS)}:${Math.round(
    point.y / NODE_EPSILON_METERS,
  )}`
}

function findNode(nodes: WallNode[], point: Point) {
  return nodes.find((node) => distance(node.point, point) <= NODE_EPSILON_METERS)
}

export function buildWallTopology(walls: Wall[]): WallTopology {
  const nodes: WallNode[] = []
  const nodesByEndpoint = new Map<string, WallNode>()

  for (const wall of walls) {
    for (const endpoint of ['start', 'end'] as const) {
      const point = wall[endpoint]
      const existingNode = findNode(nodes, point)
      const node =
        existingNode ??
        ({
          id: createNodeId(point),
          point,
          connections: [],
        } satisfies WallNode)

      if (!existingNode) {
        nodes.push(node)
      }

      node.connections.push({ endpoint, wall })
      nodesByEndpoint.set(getEndpointKey(wall.id, endpoint), node)
    }
  }

  const renderedWalls = getRenderedWalls(walls)
  const renderedWallsById = new Map(
    renderedWalls.map((renderedWall) => [renderedWall.wall.id, renderedWall]),
  )
  const wallPolygonsById = new Map(
    renderedWalls.map((renderedWall) => [
      renderedWall.wall.id,
      getWallPolygon(renderedWall),
    ]),
  )

  return {
    nodes,
    nodesByEndpoint,
    renderedWallsById,
    wallPolygonsById,
  }
}

export function getWallEndpointNode(
  topology: WallTopology,
  wallId: string,
  endpoint: WallEndpoint,
) {
  return topology.nodesByEndpoint.get(getEndpointKey(wallId, endpoint)) ?? null
}

export function getOtherNodeConnections(
  topology: WallTopology,
  wall: Wall,
  endpoint: WallEndpoint,
) {
  return (
    getWallEndpointNode(topology, wall.id, endpoint)?.connections.filter(
      (connection) => connection.wall.id !== wall.id,
    ) ?? []
  )
}
