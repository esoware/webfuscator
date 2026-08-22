const onApplePlatform = /mac|iphone|ipad/iu.test(navigator.userAgent)

export const RUN_SHORTCUT_KEYS = onApplePlatform ? ['⌘', '↩'] : ['Ctrl', '↩']

export const RUN_SHORTCUT_TITLE = onApplePlatform
  ? 'Obfuscate (Command + Enter)'
  : 'Obfuscate (Ctrl + Enter)'
