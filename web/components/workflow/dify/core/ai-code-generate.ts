import type { WorkflowVariableOption } from './variables'

export type AICodeGenerateTargetType = 'visibleWhen' | 'validateWhen' | 'code'
export type AICodeGenerateNodeType = 'start' | 'input' | 'code'

export type AICodeGenerateRequestPayload = {
  model: string
  targetType: AICodeGenerateTargetType
  nodeType: AICodeGenerateNodeType
  language?: 'javascript' | 'python3'
  description: string
  selectedVariables: Array<Pick<WorkflowVariableOption, 'key' | 'placeholder' | 'valueType'>>
  currentCode?: string
  context?: {
    nodeId?: string
    fieldName?: string
  }
}

type APIResponse<T> = {
  message?: string
  data?: T
}

type AICodeGenerateResponse = {
  generatedCode: string
  model: string
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

export const requestAICodeGenerate = async (payload: AICodeGenerateRequestPayload) => {
  const token = getToken()
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (token)
    headers.Authorization = `Bearer ${token}`

  const response = await fetch('/api/workflow/code-generate', {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  const result = await response.json() as APIResponse<AICodeGenerateResponse>
  if (!response.ok)
    throw new Error(result.message || '代码生成失败')

  const generatedCode = String(result.data?.generatedCode || '').trim()
  if (!generatedCode)
    throw new Error('未获取到有效代码')

  return {
    generatedCode,
    model: String(result.data?.model || payload.model),
  }
}
