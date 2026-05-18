// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type NativeBundleEntryRule = {
  reason: NativeBundleEntryReason
  test: (relativePath: string, segments: string[], fileName: string) => boolean
}

type NativeBundleEntryReason =
  | 'native platform directory'
  | 'native project directory'
  | 'native project file'
  | 'native source file'

export type NativeBundleEntry = {
  path: string
  reason: NativeBundleEntryReason
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const ROOT_NATIVE_DIRECTORIES = new Set([
  'android',
  'ios',
])

const NATIVE_PROJECT_DIRECTORY_SUFFIXES = [
  '.framework',
  '.xcassets',
  '.xcframework',
  '.xcodeproj',
  '.xcworkspace',
]

const NATIVE_FILE_NAMES = new Set([
  'AndroidManifest.xml',
  'Cartfile',
  'Cartfile.resolved',
  'Info.plist',
  'Package.swift',
  'Podfile',
  'Podfile.lock',
  'build.gradle',
  'build.gradle.kts',
  'gradlew',
  'gradlew.bat',
  'settings.gradle',
  'settings.gradle.kts',
])

const NATIVE_FILE_EXTENSIONS = [
  '.entitlements',
  '.gradle',
  '.java',
  '.kt',
  '.kts',
  '.m',
  '.mm',
  '.pbxproj',
  '.storyboard',
  '.swift',
  '.xib',
]

const NATIVE_BUNDLE_ENTRY_RULES: NativeBundleEntryRule[] = [
  {
    reason: 'native platform directory',
    test: (_relativePath, segments) => ROOT_NATIVE_DIRECTORIES.has(segments[0] ?? ''),
  },
  {
    reason: 'native project directory',
    test: (_relativePath, segments) => segments.some(segment => NATIVE_PROJECT_DIRECTORY_SUFFIXES.some(suffix => segment.endsWith(suffix))),
  },
  {
    reason: 'native project file',
    test: (_relativePath, _segments, fileName) => NATIVE_FILE_NAMES.has(fileName),
  },
  {
    reason: 'native source file',
    test: (_relativePath, _segments, fileName) => NATIVE_FILE_EXTENSIONS.some(extension => fileName.endsWith(extension)),
  },
]

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export function findNativeBundleEntries(relativePaths: string[]): NativeBundleEntry[] {
  return relativePaths
    .flatMap(relativePath => {
      const segments = relativePath.split('/')
      const fileName = segments.at(-1) ?? relativePath
      const rule = NATIVE_BUNDLE_ENTRY_RULES.find(candidate => candidate.test(relativePath, segments, fileName))

      return rule
        ? [{
          path: relativePath,
          reason: rule.reason,
        }]
        : []
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}

export function assertNoNativeBundleEntries(directoryPath: string, relativePaths: string[]) {
  const nativeEntries = findNativeBundleEntries(relativePaths)

  if (nativeEntries.length === 0) {
    return
  }

  const formattedEntries = nativeEntries
    .slice(0, 10)
    .map(formatNativeBundleEntry)
    .join(', ')
  const remainingCount = nativeEntries.length - 10
  const suffix = remainingCount > 0
    ? `, and ${remainingCount} more`
    : ''

  throw new Error(`Native project files were found in bundle input ${directoryPath}. OTA bundles can only contain generated web/update assets. Remove these files or point the CLI at generated web/update output only. Found: ${formattedEntries}${suffix}.`)
}

function formatNativeBundleEntry(entry: NativeBundleEntry) {
  return `${entry.path} (${entry.reason})`
}
