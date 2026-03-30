import { edgeMenuItems, type EdgeMenuActionKey } from '../config/contextMenuPreset'
import type { EdgeMenuState } from '../core/store'

type EdgeContextMenuProps = {
  menu?: EdgeMenuState
  onDelete: () => void
  onClose: () => void
}

export default function EdgeContextMenu({ menu, onDelete, onClose }: EdgeContextMenuProps) {
  if (!menu)
    return null

  const handlers: Record<EdgeMenuActionKey, () => void> = {
    delete: onDelete,
  }

  return (
    <div className="absolute z-20 w-36 rounded-lg border border-gray-200 bg-white p-1 shadow-lg" style={{ left: menu.left, top: menu.top }}>
      {edgeMenuItems.map(item => (
        <button
          key={item.key}
          onClick={() => { handlers[item.key](); onClose() }}
          className="flex h-8 w-full items-center rounded px-3 text-left text-xs text-red-600 hover:bg-red-50"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
