# pi-ghostty-notifier

Ghostty-first notifications for Pi with smart summaries, category-aware titles, and configurable notification levels.

## Current behavior

This extension always tries to send **terminal-side notifications** first, and then also sends **native system notifications** where currently implemented.

### macOS

When Pi finishes a turn that matches the configured notification level:

- if running in **Ghostty**:
  - sends a **bell** when the category is actionable (`question`, `error`, `warning`) unless disabled
  - sends a **Ghostty terminal notification**
- also sends a **native macOS notification** via `osascript`

So on macOS the default behavior is effectively:
- **Ghostty notification + macOS system notification**

### Linux

When Pi finishes a turn that matches the configured notification level:

- if running in **Ghostty**:
  - sends a **bell** when the category is actionable unless disabled
  - sends a **Ghostty terminal notification**
- if not in Ghostty:
  - sends terminal notification escape sequences for compatible terminals (for example Kitty-style fallback when applicable)

Important:
- **native Linux desktop notifications are not implemented yet**
- this means there is currently **no `notify-send` integration** in this version

So on Linux the current behavior is:
- **terminal notification only**
- **no native desktop notification yet**

### Windows

- native Windows notifications are sent when supported through the current implementation path
- terminal notification behavior depends on the terminal environment

## Features

- Ghostty notifications when running inside Ghostty
- Native macOS notifications
- Smart categories and short summaries for completed Pi turns
- Notification levels: `low`, `medium`, `all`
- Emoji titles for quick visual scanning

## Install

Project-local extension:

```bash
pi -e ./.pi/extensions/ghostty-notifier.ts
```

Or just keep it in `.pi/extensions/` and run:

```text
/reload
```

## Commands

- `/notify-level [low|medium|all]`

Example:

```text
/notify-level medium
```

## Settings

Global: `~/.pi/agent/settings.json`
Project: `.pi/settings.json`

```json
{
  "pi-ghostty-notifier": {
    "level": "medium",
    "includeSummary": true,
    "bell": "actionable"
  }
}
```

## Levels

- `low`: only `question` and `error`
- `medium`: `question`, `error`, `warning`, `changes`
- `all`: every completed turn
