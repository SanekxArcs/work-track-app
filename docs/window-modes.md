# Desktop window modes

The collapsed notch has drag grips on both sides; its expanded view has one grip on the right. Drag horizontally to adjust its position; drag vertically across the display midpoint to switch between the top and bottom edges. Position and edge are remembered separately for each display. A bottom notch expands upward and remains above the Windows taskbar.

Hovering or clicking the pill expands it without leaving notch mode. Header clicks, tab changes, and task editing preserve the mode. Use **Exit notch mode** to return to a normal window, or the side-collapse button to dock directly at the nearest side. Disable the notch setting to leave the mode explicitly through settings.

The notch has no native or CSS outer shadow. A shaped native Windows region follows its visible animated contour, excluding transparent margins and rounded corners from hit testing. This also excludes the invisible native minimum-height area that Windows can retain below a 30px pill. Shape sampling pauses once the animation settles and restarts on layout changes.

An open notch uses a simple dark translucent background. There is no native acrylic backdrop window or notch blur effect. The main UI stays transparent and never switches DWM materials, avoiding backdrop lag, stray blur rectangles and white backgrounds when leaving notch mode. Normal windows retain their usual appearance.

A side pill has a narrow grip for dragging and a clickable timer for reopening. Its hover hint describes leaving side mode. Mode changes suspend edge snapping while resizing, and side collapse applies its small bounds without an intermediate animated move.

Validation uses an isolated Electron profile and real native window-region inspection. Checks cover top/bottom native contours, both grips, no shadow or auxiliary blur layer, bottom anchoring, editor mode retention, direct notch-to-side collapse, restoration of the saved edge, and repeated docking from the screen centre. Cross-monitor physical mouse interaction still needs manual verification.
