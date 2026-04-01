import { useEffect, useMemo, useRef, useState } from 'react'
import { parseDifyWorkflowDSL } from '../core/dsl'
import { defaultGlobalVariables } from '../core/global-variables'
import { defaultWorkflowParameters } from '../core/workflow-parameters'
import type { DifyEdge, DifyNode, DifyWorkflowDSL } from '../core/types'

const nextNodeIdSeed = (nodes: DifyNode[]) => {
  let max = 0
  const pattern = /^node-(\d+)$/
  nodes.forEach((node) => {
    const match = pattern.exec(node.id)
    if (!match)
      return
    const value = Number(match[1])
    if (Number.isFinite(value))
      max = Math.max(max, value)
  })
  return Math.max(100, max + 1)
}

export const useWorkflowCanvasState = (demoDSL: DifyWorkflowDSL) => {
  const parsed = useMemo(() => parseDifyWorkflowDSL(demoDSL), [demoDSL])
  const [nodes, setNodes] = useState<DifyNode[]>(parsed.nodes)
  const [edges, setEdges] = useState<DifyEdge[]>(parsed.edges)
  const [activeNode, setActiveNode] = useState<DifyNode | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [globalVariableOpen, setGlobalVariableOpen] = useState(false)
  const [workflowParamsOpen, setWorkflowParamsOpen] = useState(false)
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [exportText, setExportText] = useState('')
  const [globalVariables, setGlobalVariables] = useState(parsed.globalVariables ?? defaultGlobalVariables)
  const [workflowParameters, setWorkflowParameters] = useState(parsed.workflowParameters ?? defaultWorkflowParameters)
  const [workflowVariableScopes, setWorkflowVariableScopes] = useState(parsed.workflowVariableScopes ?? {})
  const canvasContainerRef = useRef<HTMLDivElement | null>(null)
  const idRef = useRef(100)

  useEffect(() => {
    setNodes(parsed.nodes)
    setEdges(parsed.edges)
    setGlobalVariables(parsed.globalVariables ?? defaultGlobalVariables)
    setWorkflowParameters(parsed.workflowParameters ?? defaultWorkflowParameters)
    setWorkflowVariableScopes(parsed.workflowVariableScopes ?? {})
    setActiveNode(null)
    idRef.current = nextNodeIdSeed(parsed.nodes)
  }, [parsed])

  return {
    parsed,
    nodes,
    edges,
    activeNode,
    importOpen,
    exportOpen,
    globalVariableOpen,
    workflowParamsOpen,
    checklistOpen,
    importText,
    exportText,
    globalVariables,
    workflowParameters,
    workflowVariableScopes,
    canvasContainerRef,
    idRef,
    setNodes,
    setEdges,
    setActiveNode,
    setImportOpen,
    setExportOpen,
    setGlobalVariableOpen,
    setWorkflowParamsOpen,
    setChecklistOpen,
    setImportText,
    setExportText,
    setGlobalVariables,
    setWorkflowParameters,
    setWorkflowVariableScopes,
  }
}
