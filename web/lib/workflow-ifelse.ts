export const IF_ELSE_HANDLE_PREFIX = 'if-branch-'
export const IF_ELSE_FALLBACK_HANDLE = 'if-else'

export const buildIfElseBranchHandleId = (index: number) => `${IF_ELSE_HANDLE_PREFIX}${index}`

export const parseIfElseBranchIndex = (handleId?: string | null) => {
  if (!handleId || !handleId.startsWith(IF_ELSE_HANDLE_PREFIX))
    return -1
  const raw = handleId.slice(IF_ELSE_HANDLE_PREFIX.length)
  const index = Number(raw)
  if (Number.isNaN(index) || index < 0)
    return -1
  return index
}
