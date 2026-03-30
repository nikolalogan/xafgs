import { nodeMenuItems, type NodeMenuActionKey } from '../config/contextMenuPreset'
import type { NodeMenuState } from '../core/store'

type NodeContextMenuProps = {
  menu?: NodeMenuState
  onCopy: () => void
  onDuplicate: () => void
  onDelete: () => void
  onClose: () => void
}

export default function NodeContextMenu({ menu, onCopy, onDuplicate, onDelete, onClose }: NodeContextMenuProps) {
  if (!menu)
    return null

  const handlers: Record<NodeMenuActionKey, () => void> = {
    copy: onCopy,
    duplicate: onDuplicate,
    delete: onDelete,
  }

  return (
    <div className="absolute z-20 w-44 rounded-lg border border-gray-200 bg-white p-1 shadow-lg" style={{ left: menu.left, top: menu.top }}>
      {nodeMenuItems.map(item => (
        <button
          key={item.key}
          onClick={() => { handlers[item.key](); onClose() }}
          className={item.variant === 'danger'
            ? 'flex h-8 w-full items-center rounded px-3 text-left text-xs text-red-600 hover:bg-red-50'
            : 'flex h-8 w-full items-center rounded px-3 text-left text-xs text-gray-700 hover:bg-gray-100'}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
