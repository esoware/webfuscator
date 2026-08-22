/**
 * Renaming here keeps `IconX` and `IconSelector` out of the components, where
 * `CloseIcon` and `ChevronUpDownIcon` say what the icon is for.
 *
 * Pass a `size` at every call site. Tabler defaults to 24 and nothing here is
 * that big. src/index.css sets `flex-shrink` for all of them.
 */
export {
  IconCheck as CheckIcon,
  IconChevronRight as ChevronRightIcon,
  IconCopy as CopyIcon,
  IconDownload as DownloadIcon,
  IconExternalLink as ExternalLinkIcon,
  IconLoader2 as SpinnerIcon,
  IconMinus as MinusIcon,
  IconPlus as PlusIcon,
  IconSearch as SearchIcon,
  IconSelector as ChevronUpDownIcon,
  IconX as CloseIcon,
} from '@tabler/icons-react'
