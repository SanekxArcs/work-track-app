param([long]$WindowHandle)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WorkBuddyWindowRegion {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr h,IntPtr r);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int a,int b,int c,int d);
 [DllImport("gdi32.dll")] public static extern int GetRgnBox(IntPtr r,out RECT rect);
 [DllImport("gdi32.dll")] public static extern bool PtInRegion(IntPtr r,int x,int y);
 [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr r);
 [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h,int attribute,out int value,int size);
}
"@
$window=[IntPtr]$WindowHandle
$region=[WorkBuddyWindowRegion]::CreateRectRgn(0,0,0,0)
try {
 $kind=[WorkBuddyWindowRegion]::GetWindowRgn($window,$region)
 $rect=New-Object WorkBuddyWindowRegion+RECT
 [void][WorkBuddyWindowRegion]::GetRgnBox($region,[ref]$rect)
 $material=0
 [void][WorkBuddyWindowRegion]::DwmGetWindowAttribute($window,38,[ref]$material,4)
 $scale=[WorkBuddyWindowRegion]::GetDpiForWindow($window)/96.0
 @{kind=$kind;x=$rect.Left;y=$rect.Top;width=$rect.Right-$rect.Left;height=$rect.Bottom-$rect.Top;corner=[WorkBuddyWindowRegion]::PtInRegion($region,0,0);bottomCorner=[WorkBuddyWindowRegion]::PtInRegion($region,0,$rect.Bottom-1);middle=[WorkBuddyWindowRegion]::PtInRegion($region,[int](($rect.Left+$rect.Right)/2),[int](($rect.Top+$rect.Bottom)/2));material=$material;scale=$scale}|ConvertTo-Json -Compress
} finally {[void][WorkBuddyWindowRegion]::DeleteObject($region)}
