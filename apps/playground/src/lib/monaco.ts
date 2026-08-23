import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

export const EDITOR_THEME = 'webfuscator'

const globals = globalThis as { MonacoEnvironment?: monaco.Environment }
globals.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    const needsTypeScript = label === 'typescript' || label === 'javascript'
    return needsTypeScript ? new TsWorker() : new EditorWorker()
  },
}

monaco.editor.defineTheme(EDITOR_THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: { 'editor.background': '#0B0B0B' },
})

monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: true,
})

monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
  allowJs: true,
  allowNonTsExtensions: true,
  target: monaco.languages.typescript.ScriptTarget.Latest,
  moduleDetection: 3,
})

monaco.editor.addKeybindingRule({
  keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
  command: null,
})

monaco.editor.addKeybindingRule({
  keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP,
  command: 'editor.action.quickCommand',
  when: 'editorFocus',
})
