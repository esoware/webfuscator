import { Button as BaseButton } from '@base-ui/react/button'

type Variant = 'primary' | 'secondary' | 'ghost'

interface ButtonProps extends Omit<BaseButton.Props, 'className'> {
  variant?: Variant
  className?: string | undefined
}

/*
 * Disabled is spelled twice in each branch below. A disabled `Toolbar.Button`
 * never carries the attribute, because Base UI deletes it to keep the element
 * focusable and hoverable, so `:disabled` alone would leave a dead button
 * sitting at full opacity.
 */
export function Button({ variant = 'secondary', className, ...rest }: ButtonProps) {
  if (variant === 'primary') {
    return (
      <BaseButton
        // The docs navbar call to action fades its fill to 90% on hover rather
        // than lightening it, and darkens to `accent-strong` when pressed.
        className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-accent px-3.5 text-sm font-medium whitespace-nowrap text-on-accent transition-colors select-none hover:bg-accent/90 active:bg-accent-strong disabled:pointer-events-none disabled:opacity-40 data-disabled:opacity-40 ${className ?? ''}`}
        {...rest}
      />
    )
  }

  if (variant === 'ghost') {
    return (
      <BaseButton
        className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 text-sm font-medium whitespace-nowrap text-fg-muted transition-colors select-none hover:bg-fill hover:text-fg active:bg-fill-hover disabled:pointer-events-none disabled:opacity-40 data-disabled:opacity-40 ${className ?? ''}`}
        {...rest}
      />
    )
  }

  // A secondary control rests on `fill` and a ghost one hovers to it, which
  // holds the two a step apart at rest, on hover, and while pressed.
  return (
    <BaseButton
      className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-fill px-3.5 text-sm font-medium whitespace-nowrap text-fg transition-colors select-none hover:bg-fill-hover hover:text-fg-strong active:bg-fill-active disabled:pointer-events-none disabled:opacity-40 data-disabled:opacity-40 ${className ?? ''}`}
      {...rest}
    />
  )
}
