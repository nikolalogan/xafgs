import { selectionMenuItems, type SelectionMenuActionKey } from '../config/contextMenuPreset'
import type { SelectionMenuState } from '../core/store'

type SelectionContextMenuProps = {
  menu?: SelectionMenuState
  onCopy: () => void
  onDuplicate: () => void
  onDelete: () => void
  onAlignLeft: () => void
  onAlignCenter: () => void
  onAlignRight: () => void
  onAlignTop: () => void
  onAlignMiddle: () => void
  onAlignBottom: () => void
  onDistributeHorizontal: () => void
  onDistributeVertical: () => void
  onClose: () => void
}

export default function SelectionContextMenu({
  menu,
  onCopy,
  onDuplicate,
  onDelete,
  onAlignLeft,
  onAlignCenter,
  onAlignRight,
  onAlignTop,
  onAlignMiddle,
  onAlignBottom,
  onDistributeHorizontal,
  onDistributeVertical,
  onClose,
}: SelectionContextMenuProps) {
  if (!menu)
    return null

  const handlers: Record<SelectionMenuActionKey, () => void> = {
    alignLeft: onAlignLeft,
    alignCenter: onAlignCenter,
    alignRight: onAlignRight,
    alignTop: onAlignTop,
    alignMiddle: onAlignMiddle,
    alignBottom: onAlignBottom,
    distributeHorizontal: onDistributeHorizontal,
    distributeVertical: onDistributeVertical,
    copy: onCopy,
    duplicate: onDuplicate,
    delete: onDelete,
  }

  return (
    <div className="absolute z-20 w-44 rounded-lg border border-gray-200 bg-white p-1 shadow-lg" style={{ left: menu.left, top: menu.top }}>
      {selectionMenuItems.map((item, index) => {
        if (item.type === 'label')
          return <div key={`label-${index}`} className="px-3 py-1 text-[11px] text-gray-400">{item.label}</div>

        if (item.type === 'divider')
          return <div key={`divider-${index}`} className="my-1 h-px bg-gray-100" />

        return (
          <button
            key={item.key}
            onClick={() => { handlers[item.key](); onClose() }}
            className={item.variant === 'danger'
              ? 'flex h-8 w-full items-center rounded px-3 text-left text-xs text-red-600 hover:bg-red-50'
              : 'flex h-8 w-full items-center rounded px-3 text-left text-xs text-gray-700 hover:bg-gray-100'}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
