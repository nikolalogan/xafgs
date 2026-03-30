import { useEffect, type RefObject } from 'react'

type UseKeyboardShortcutsParams = {
  canvasContainerRef: RefObject<HTMLElement | null>
  doUndo: () => void
  doRedo: () => void
  copySelection: () => void
  pasteClipboard: () => void
  duplicateSelection: () => void
  deleteSelection: () => void
}

export const useKeyboardShortcuts = ({
  canvasContainerRef,
  doUndo,
  doRedo,
  copySelection,
  pasteClipboard,
  duplicateSelection,
  deleteSelection,
}: UseKeyboardShortcutsParams) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (!target)
        return

      if (!canvasContainerRef.current?.contains(target))
        return

      const isInput = !!target && (
        target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.tagName === 'SELECT'
        || target.tagName === 'OPTION'
        || target.tagName === 'BUTTON'
        || target.isContentEditable
      )
      if (isInput)
        return

      const modKey = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (key === 'delete' || key === 'backspace') {
        event.preventDefault()
        deleteSelection()
      }
      if (modKey && key === 'c') {
        event.preventDefault()
        copySelection()
      }
      if (modKey && key === 'v') {
        event.preventDefault()
        pasteClipboard()
      }
      if (modKey && key === 'd') {
        event.preventDefault()
        duplicateSelection()
      }
      if (modKey && key === 'z') {
        event.preventDefault()
        doUndo()
      }
      if (modKey && (key === 'y' || (event.shiftKey && key === 'z'))) {
        event.preventDefault()
        doRedo()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [canvasContainerRef, copySelection, deleteSelection, doRedo, doUndo, duplicateSelection, pasteClipboard])
}
