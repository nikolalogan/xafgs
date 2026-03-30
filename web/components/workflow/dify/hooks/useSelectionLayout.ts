import { useCallback } from 'react'
import type { DifyEdge, DifyNode } from '../core/types'

export type AlignDirection =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom'
  | 'distributeHorizontal'
  | 'distributeVertical'

type UseSelectionLayoutParams = {
  nodes: DifyNode[]
  edges: DifyEdge[]
  setNodes: (nodes: DifyNode[]) => void
  record: (snapshot: { nodes: DifyNode[]; edges: DifyEdge[] }) => void
}

export const useSelectionLayout = ({ nodes, edges, setNodes, record }: UseSelectionLayoutParams) => {
  return useCallback((direction: AlignDirection) => {
    const selected = nodes.filter(node => node.selected)
    if (selected.length < 2)
      return

    const minX = Math.min(...selected.map(node => node.position.x))
    const maxX = Math.max(...selected.map(node => node.position.x + (node.width ?? 240)))
    const minY = Math.min(...selected.map(node => node.position.y))
    const maxY = Math.max(...selected.map(node => node.position.y + (node.height ?? 80)))

    let nextNodes = [...nodes]

    if (direction === 'distributeHorizontal' || direction === 'distributeVertical') {
      if (selected.length < 3)
        return

      const isHorizontal = direction === 'distributeHorizontal'
      const sorted = [...selected].sort((a, b) =>
        isHorizontal ? a.position.x - b.position.x : a.position.y - b.position.y,
      )

      const first = sorted[0]
      const last = sorted[sorted.length - 1]

      const totalSpan = isHorizontal
        ? (last.position.x + (last.width ?? 240) - first.position.x)
        : (last.position.y + (last.height ?? 80) - first.position.y)

      const totalSize = sorted.reduce((sum, node) =>
        sum + (isHorizontal ? (node.width ?? 240) : (node.height ?? 80)), 0)

      const spacing = (totalSpan - totalSize) / (sorted.length - 1)
      if (spacing <= 0)
        return

      const idToPosition = new Map<string, { x: number; y: number }>()
      let cursor = isHorizontal
        ? first.position.x + (first.width ?? 240)
        : first.position.y + (first.height ?? 80)

      for (let index = 1; index < sorted.length - 1; index++) {
        const node = sorted[index]
        if (isHorizontal) {
          const nextX = cursor + spacing
          idToPosition.set(node.id, { x: nextX, y: node.position.y })
          cursor = nextX + (node.width ?? 240)
        }
        else {
          const nextY = cursor + spacing
          idToPosition.set(node.id, { x: node.position.x, y: nextY })
          cursor = nextY + (node.height ?? 80)
        }
      }

      nextNodes = nodes.map((node) => {
        const mapped = idToPosition.get(node.id)
        if (!mapped)
          return node
        return {
          ...node,
          position: mapped,
        }
      })
    }
    else {
      nextNodes = nodes.map((node) => {
        if (!node.selected)
          return node

        const width = node.width ?? 240
        const height = node.height ?? 80
        const nextPosition = { ...node.position }

        if (direction === 'left')
          nextPosition.x = minX
        if (direction === 'center')
          nextPosition.x = minX + (maxX - minX - width) / 2
        if (direction === 'right')
          nextPosition.x = maxX - width
        if (direction === 'top')
          nextPosition.y = minY
        if (direction === 'middle')
          nextPosition.y = minY + (maxY - minY - height) / 2
        if (direction === 'bottom')
          nextPosition.y = maxY - height

        return {
          ...node,
          position: nextPosition,
        }
      })
    }

    setNodes(nextNodes)
    record({ nodes: nextNodes, edges })
  }, [edges, nodes, record, setNodes])
}
