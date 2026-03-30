import { NodeRunningStatus } from './types'

export const getEdgeColor = (status?: NodeRunningStatus) => {
  if (status === NodeRunningStatus.Running) return '#2970FF'
  if (status === NodeRunningStatus.Succeeded) return '#12B76A'
  if (status === NodeRunningStatus.Failed || status === NodeRunningStatus.Exception) return '#F04438'
  return '#98A2B3'
}
