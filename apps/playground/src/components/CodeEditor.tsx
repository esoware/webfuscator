import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/editor/editor.api'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
// `monaco.languages.typescript` is a deprecated stub in 0.56; only this path is typed.
import { javascriptDefaults } from 'monaco-editor/languages/features/typescript/register'

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

  monaco.editor.defineTheme('webfuscator', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0F0F0F',
      'editorGutter.background': '#0F0F0F',
      'editor.lineHighlightBackground': '#17171A',
      'editor.lineHighlightBorder': '#00000000',
      'editorLineNumber.foreground': '#3F3F46',
      'editorLineNumber.activeForeground': '#A1A1AA',
      'editorCursor.foreground': '#60A5FA',
      'editor.selectionBackground': '#1D4ED866',
      'editor.inactiveSelectionBackground': '#1D4ED833',
      'editorIndentGuide.background1': '#232327',
      'editorIndentGuide.activeBackground1': '#3F3F46',
      'editorWidget.background': '#18181B',
      'editorWidget.border': '#26262C',
      'editorSuggestWidget.background': '#18181B',
      'editorSuggestWidget.selectedBackground': '#27272A',
      'scrollbarSlider.background': '#3F3F4666',
      'scrollbarSlider.hoverBackground': '#52525B80',
      'scrollbarSlider.activeBackground': '#52525BCC',
    },
  })
}

configureMonaco()

interface CodeEditorProps {
  path: string
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
}

export function CodeEditor({ path, value, onChange, readOnly = false }: CodeEditorProps) {
  return (
    <Editor
      theme="webfuscator"
      language="javascript"
      path={path}
      value={value}
      loading={<span className="p-4 text-[13px] text-zinc-600">Loading editor</span>}
      options={{
        fontSize: 13.5,
        lineHeight: 22,
        minimap: { enabled: false },
        tabSize: 2,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        padding: { top: 16, bottom: 24 },
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
        readOnly,
        domReadOnly: readOnly,
      }}
      onChange={(next) => {
        if (!readOnly && next !== undefined) {
          onChange?.(next)
        }
      }}
    />
  )
}
