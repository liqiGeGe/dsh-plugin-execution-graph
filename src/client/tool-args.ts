/** Parse and format a tool call's raw JSON arguments for the detail panel. */

/** Parsed tool arguments as a JSON object/array, or `null` when unparseable. */
export function parseToolArgs(argsRaw: string): object | null {
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

/** Property names a shell tool uses to carry its command line. */
const COMMAND_KEYS: readonly string[] = ['command', 'cmd']

/**
 * The shell command string carried by a parsed tool-args object, if any — the
 * first non-empty string value under a known command key (`command`/`cmd`).
 *
 * @param args - Parsed tool arguments.
 * @returns The command line, or `undefined` when the args carry none.
 */
export function extractCommand(args: object): string | undefined {
  const record = args as Record<string, unknown>
  for (const commandKey of COMMAND_KEYS) {
    const value = record[commandKey]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

/**
 * Split a shell command into display lines, breaking before each top-level `&&`
 * chain operator and before each `echo` invocation, so a long one-liner reads as
 * a sequence of steps. Breaks are suppressed inside single or double quotes, so a
 * literal `&&` or `echo` in a quoted string (e.g. an `echo` banner) does not
 * force a spurious wrap. Leading/trailing whitespace per line is trimmed; empty
 * lines are dropped.
 *
 * @param command - The raw shell command line.
 * @returns One display line per detected step (at least one line).
 */
export function splitCommandLines(command: string): readonly string[] {
  const lines: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null

  const flush = (): void => {
    const trimmed = current.trim()
    if (trimmed !== '') lines.push(trimmed)
    current = ''
  }

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i] as string
    if (quote !== null) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === '\'') {
      quote = char
      current += char
      continue
    }
    // Break before a top-level `&&`, keeping the operator at the end of the prior line.
    if (char === '&' && command[i + 1] === '&') {
      current += '&&'
      flush()
      i += 1
      continue
    }
    // Break before a top-level `echo` word (start of command or after whitespace).
    if (
      (char === 'e' || char === 'E')
      && command.slice(i, i + 4).toLowerCase() === 'echo'
      && (i === 0 || /\s/.test(command[i - 1] as string))
      && (command[i + 4] === undefined || /\s/.test(command[i + 4] as string))
    ) {
      flush()
      current = command.slice(i, i + 4)
      i += 3
      continue
    }
    current += char
  }
  flush()
  return lines.length === 0 ? [command.trim()] : lines
}
