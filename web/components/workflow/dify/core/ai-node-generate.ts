import { BlockEnum, type DifyNodeConfig } from './types'

export type AINodeGenerateNodeType = BlockEnum

export type AINodeGenerateRequestPayload = {
  model: string
  nodeType: AINodeGenerateNodeType
  description: string
  context?: {
    activeNodeType?: string
    selectedAPI?: {
      method: string
      path: string
      summary?: string
      auth?: string
      params?: Array<{
        name: string
        in: 'path' | 'query' | 'body'
        type: string
        description?: string
        validation?: {
          required?: boolean
          enum?: string[]
          min?: number
          max?: number
          pattern?: string
        }
      }>
      responses?: Array<{
        httpStatus: number
        code: string
        contentType?: string
        description?: string
        dataShape?: string
        example?: unknown
      }>
    }
  }
}

type APIResponse<T> = {
  message?: string
  data?: T
}

type AINodeGenerateResponse = {
  model: string
  generatedConfig: DifyNodeConfig
  suggestedTitle?: string
  suggestedDesc?: string
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

export const requestAINodeGenerate = async (payload: AINodeGenerateRequestPayload) => {
  const token = getToken()
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (token)
    headers.Authorization = `Bearer ${token}`

  const response = await fetch('/api/workflow/node-generate', {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  const result = await response.json() as APIResponse<AINodeGenerateResponse>
  if (!response.ok)
    throw new Error(result.message || '节点生成失败')

  const generatedConfig = result.data?.generatedConfig
  if (!generatedConfig || typeof generatedConfig !== 'object')
    throw new Error('AI 返回配置不合法')

  return {
    model: String(result.data?.model || payload.model),
    generatedConfig,
    suggestedTitle: String(result.data?.suggestedTitle || '').trim(),
    suggestedDesc: String(result.data?.suggestedDesc || '').trim(),
  }
}
