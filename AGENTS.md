# Work Buddy delivery rule

After every user-requested application change, complete these deliverables before handing the work over:

1. Build the Electron app with `npm run build`.
2. Build the Chrome extension with `npm run build` from `apps/extension`.
3. Create a fresh Windows installer with `npm run release:win patch`.

Tell the user where the Windows installer was produced. For the extension, tell them to reload the unpacked extension in `chrome://extensions` before checking the update. Do not commit unless the user asks.
