# Work Buddy delivery rule

After every user-requested application change, complete these deliverables before handing the work over:

1. Build the Electron app with `npm run build`.
2. Create a fresh Windows installer with `npm run release:win patch`.

Tell the user where the Windows installer was produced. Do not commit unless the user asks.

# Chrome extension is frozen

Do not touch, build or mention `apps/extension` unless the user explicitly asks for a change in the extension. Maintenance of the Chrome extension stopped at commit `9595441` (2026-10-29, "feat(activity): add automatic tracking feature with configuration and UI integration"), the last commit that changed it. Only when the user asks for extension work: make the change, build it with `npm run build` from `apps/extension`, and tell them to reload the unpacked extension in `chrome://extensions`.
