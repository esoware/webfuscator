import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/editor/editor.api'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
// `monaco.languages.typescript` is a deprecated stub in 0.56; only this path is typed.
import { javascriptDefaults } from 'monaco-editor/languages/features/typescript/register'
import { useCallback } from 'react'

// Without these two, `language="javascript"` renders as unhighlighted plain text.
import 'monaco-editor/basic-languages/monaco.contribution'
import 'monaco-editor/language/typescript/monaco.contribution'

let configured = false

function configureMonaco(): void {
  if (configured) {
    return
  }
  configured = true

  globalThis.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      const needsTypeScript = label === 'typescript' || label === 'javascript'
      return needsTypeScript ? new TsWorker() : new EditorWorker()
    },
  }
  // Without this, @monaco-editor/react fetches monaco from a CDN at runtime.
  loader.config({ monaco })

  // The config tab is a bare object literal, which the TypeScript worker reads
  // as a block and paints red. Babel already reports real errors to the banner.
  javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
  })

  // The docs highlight with Shiki's `dark-plus`, which `vs-dark` derives from,
  // so the token colors already agree and only the chrome needs setting. The
  // grays match src/index.css where a role exists. Widget borders and indent
  // guides have none. Only the caret and the selection use accent.
  monaco.editor.defineTheme('webfuscator', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0B0B0B',
      'editor.foreground': '#D4D4D4',
      'editorGutter.background': '#0B0B0B',
      'editorStickyScroll.background': '#0B0B0B',
      'editor.lineHighlightBackground': '#131313',
      'editor.lineHighlightBorder': '#00000000',
      'editorLineNumber.foreground': '#3A3A3A',
      'editorLineNumber.activeForeground': '#A3A3A3',
      'editorCursor.foreground': '#60A5FA',
      'editor.selectionBackground': '#1D4ED866',
      'editor.inactiveSelectionBackground': '#1D4ED833',
      'editor.selectionHighlightBackground': '#1D4ED826',
      'editorIndentGuide.background1': '#1F1F1F',
      'editorIndentGuide.activeBackground1': '#3A3A3A',
      'editorWidget.background': '#1F1F1F',
      'editorWidget.border': '#2E2E2E',
      'editorSuggestWidget.background': '#1F1F1F',
      'editorSuggestWidget.border': '#2E2E2E',
      'editorSuggestWidget.selectedBackground': '#2E2E2E',
      'editorHoverWidget.background': '#1F1F1F',
      'editorHoverWidget.border': '#2E2E2E',
      'scrollbarSlider.background': '#40404066',
      'scrollbarSlider.hoverBackground': '#52525280',
      'scrollbarSlider.activeBackground': '#525252CC',
    },
  })
}

configureMonaco()

// @monaco-editor/react calls `editor.updateOptions` on every new object identity.
const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  // 14px on a 24px rhythm, which is what the docs set for a code block.
  fontSize: 14,
  lineHeight: 24,
  minimap: { enabled: false },
  tabSize: 2,
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  padding: { top: 14, bottom: 24 },
  fixedOverflowWidgets: true,
  automaticLayout: true,
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  renderLineHighlightOnlyWhenFocus: true,
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  lineNumbersMinChars: 3,
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    verticalSliderSize: 6,
    horizontalSliderSize: 6,
  },
  readOnly: false,
  domReadOnly: false,
}

const READ_ONLY_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  ...EDITOR_OPTIONS,
  readOnly: true,
  domReadOnly: true,
}

interface CodeEditorProps {
  path: string
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
}

export function CodeEditor({ path, value, onChange, readOnly = false }: CodeEditorProps) {
  // Monaco drops and re-attaches its content listener on every new identity.
  const handleChange = useCallback(
    (next: string | undefined) => {
      if (next !== undefined) {
        onChange?.(next)
      }
    },
    [onChange],
  )

  return (
    <Editor
      theme="webfuscator"
      language="javascript"
      path={path}
      value={value}
      loading={<span className="p-4 text-sm text-fg-subtle">Loading editor</span>}
      options={readOnly ? READ_ONLY_OPTIONS : EDITOR_OPTIONS}
      onChange={handleChange}
    />
  )
}
