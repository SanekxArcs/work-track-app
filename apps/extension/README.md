# Work Buddy Chrome extension

This is a local companion for the Windows app, not a cloud or web version.
The extension renders a matching React interface on every normal webpage and
talks only to the Work Buddy process on the same PC.

## How it works

`Chrome extension → 127.0.0.1:49837 → Work Buddy → work-buddy.sqlite`

- The desktop process is the only process that opens SQLite.
- The local bridge is loopback-only, requires an access key, and pushes data
  change events to open extension panels.
- The access key is generated on this device and is stored in Windows secure
  storage when it is available.

## Pairing and loading

1. Start Work Buddy.
2. In **Settings → Chrome extension**, verify that the server is running and
   copy the connection key.
3. Build the extension with `npm run build` in this directory.
4. In Chrome, open `chrome://extensions`, enable Developer mode, select **Load
   unpacked**, then choose `build/chrome-mv3-prod`.
5. Open any website, click the small floating Work Buddy icon, and paste the
   key once. The key and the button position stay in Chrome local storage.

## Development

- `npm run dev` builds a live development version.
- `npm run build` builds the unpacked production extension.
- The extension UI is a dedicated copy of the desktop renderer in `renderer/`
  so browser-specific behavior stays isolated. Keep it aligned with
  `src/renderer/src/` when changing shared UI components.
