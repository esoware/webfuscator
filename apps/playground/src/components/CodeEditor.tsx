import * as monaco from 'monaco-editor'
import { useEffect, useRef } from 'react'

import { EDITOR_THEME } from '../lib/monaco'

// Outlives the editor, so returning to the config tab keeps its scroll position.
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState>()

function openModel(path: string, value: string): monaco.editor.ITextModel {
  const uri = monaco.Uri.parse(path)
  const existing = monaco.editor.getModel(uri)
  if (existing === null) {
    return monaco.editor.createModel(value, 'javascript', uri)
  }
  if (existing.getValue() !== value) {
    existing.setValue(value)
  }
  return existing
}

interface CodeEditorProps {
  path: string
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
}

export function CodeEditor({ path, value, onChange, readOnly = false }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  // Both are refs so the create effect below depends on neither. Depending on
  // `value` would rebuild the editor on every keystroke.
  const onChangeRef = useRef(onChange)
  const initialValueRef = useRef(value)
  const writingRef = useRef(false)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const container = containerRef.current
    if (container === null) {
      return
    }

    const editor = monaco.editor.create(container, {
      model: openModel(path, initialValueRef.current),
      theme: EDITOR_THEME,
      automaticLayout: true,
      wordWrap: 'on',
      tabSize: 2,
      readOnly,
    })
    editorRef.current = editor
    editor.restoreViewState(viewStates.get(path) ?? null)

    const content = editor.onDidChangeModelContent(() => {
      if (!writingRef.current) {
        onChangeRef.current?.(editor.getValue())
      }
    })

    return () => {
      const state = editor.saveViewState()
      if (state !== null) {
        viewStates.set(path, state)
      }
      content.dispose()
      editor.dispose()
      editorRef.current = null
    }
  }, [path, readOnly])

  useEffect(() => {
    const editor = editorRef.current
    if (editor === null) {
      return
    }
    const model = editor.getModel()
    if (model === null || model.getValue() === value) {
      return
    }
    // An edit rather than `setValue`, so undo still reaches the previous text.
    writingRef.current = true
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: value }], () => null)
    editor.pushUndoStop()
    writingRef.current = false
  }, [value])

  return <div ref={containerRef} className="h-full w-full" />
}
