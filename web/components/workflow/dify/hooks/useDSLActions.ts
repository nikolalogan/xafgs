import { useCallback } from 'react'
import type { Viewport } from 'reactflow'
import { defaultGlobalVariables } from '../core/global-variables'
import { parseDifyWorkflowDSL, toDifyWorkflowDSL } from '../core/dsl'
import { defaultWorkflowParameters } from '../core/workflow-parameters'
import type { WorkflowGlobalVariable, WorkflowObjectType, WorkflowParameter } from '../core/types'
import type { WorkflowVariableScope } from '../core/types'
import type { DifyEdge, DifyNode, DifyWorkflowDSL } from '../core/types'

type UseDSLActionsParams = {
  nodes: DifyNode[]
  edges: DifyEdge[]
  importText: string
  objectTypes: WorkflowObjectType[]
  globalVariables: WorkflowGlobalVariable[]
  workflowParameters: WorkflowParameter[]
  workflowVariableScopes: Record<string, WorkflowVariableScope>
  demoDSL: DifyWorkflowDSL
  setNodes: (nodes: DifyNode[]) => void
  setEdges: (edges: DifyEdge[]) => void
  setObjectTypes: (objectTypes: WorkflowObjectType[]) => void
  setGlobalVariables: (variables: WorkflowGlobalVariable[]) => void
  setWorkflowParameters: (params: WorkflowParameter[]) => void
  setWorkflowVariableScopes: (scopes: Record<string, WorkflowVariableScope>) => void
  setImportOpen: (open: boolean) => void
  setExportOpen: (open: boolean) => void
  setImportText: (text: string) => void
  setExportText: (text: string) => void
  resetHistory: (snapshot: { nodes: DifyNode[]; edges: DifyEdge[] }) => void
  fitView: (options?: { padding?: number }) => void
  setViewport: (viewport: Viewport) => void
  getViewport: () => Viewport
}

export const useDSLActions = ({
  nodes,
  edges,
  importText,
  objectTypes,
  globalVariables,
  workflowParameters,
  workflowVariableScopes,
  demoDSL,
  setNodes,
  setEdges,
  setObjectTypes,
  setGlobalVariables,
  setWorkflowParameters,
  setWorkflowVariableScopes,
  setImportOpen,
  setExportOpen,
  setImportText,
  setExportText,
  resetHistory,
  fitView,
  setViewport,
  getViewport,
}: UseDSLActionsParams) => {
  const importDSL = useCallback(() => {
    try {
      const parsedDSL = parseDifyWorkflowDSL(importText)
      setNodes(parsedDSL.nodes)
      setEdges(parsedDSL.edges)
      setObjectTypes(parsedDSL.objectTypes ?? [])
      setGlobalVariables(parsedDSL.globalVariables ?? defaultGlobalVariables)
      setWorkflowParameters(parsedDSL.workflowParameters ?? defaultWorkflowParameters)
      setWorkflowVariableScopes(parsedDSL.workflowVariableScopes ?? {})
      if (parsedDSL.viewport)
        setViewport(parsedDSL.viewport)
      resetHistory({ nodes: parsedDSL.nodes, edges: parsedDSL.edges })
      setImportOpen(false)
      setImportText('')
    }
    catch (error) {
      const msg = error instanceof Error ? error.message : 'DSL 导入失败'
      globalThis.alert(msg)
    }
  }, [importText, resetHistory, setEdges, setGlobalVariables, setImportOpen, setImportText, setNodes, setObjectTypes, setViewport, setWorkflowParameters, setWorkflowVariableScopes])

  const exportDSL = useCallback(() => {
    const text = toDifyWorkflowDSL({
      nodes,
      edges,
      objectTypes,
      globalVariables,
      workflowParameters,
      workflowVariableScopes,
      viewport: getViewport(),
    })
    setExportText(text)
    setExportOpen(true)
  }, [edges, getViewport, globalVariables, nodes, objectTypes, setExportOpen, setExportText, workflowParameters, workflowVariableScopes])

  const reset = useCallback(() => {
    const source = parseDifyWorkflowDSL(demoDSL)
    setNodes(source.nodes)
    setEdges(source.edges)
    setObjectTypes(source.objectTypes ?? [])
    setGlobalVariables(source.globalVariables ?? defaultGlobalVariables)
    setWorkflowParameters(source.workflowParameters ?? defaultWorkflowParameters)
    setWorkflowVariableScopes(source.workflowVariableScopes ?? {})
    if (source.viewport)
      setViewport(source.viewport)
    resetHistory({ nodes: source.nodes, edges: source.edges })
    fitView({ padding: 0.2 })
  }, [demoDSL, fitView, resetHistory, setEdges, setGlobalVariables, setNodes, setObjectTypes, setViewport, setWorkflowParameters, setWorkflowVariableScopes])

  return {
    importDSL,
    exportDSL,
    reset,
  }
}
