using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

internal static class DesktopState
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo { public int Size; public Rect Screen, Work; public uint Flags; }

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int length);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern uint GetWindowStyle(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attr, out Rect bounds, int size);
    [DllImport("shell32.dll")] private static extern int SHQueryUserNotificationState(out int state);

    private static bool CoversMonitor(uint owner, int notificationState)
    {
        IntPtr window = GetForegroundWindow();
        if (window == IntPtr.Zero || window == GetShellWindow() || !IsWindowVisible(window)) return false;
        uint pid;
        GetWindowThreadProcessId(window, out pid);
        if (pid == owner) return false;

        var name = new StringBuilder(96);
        GetClassName(window, name, name.Capacity);
        switch (name.ToString())
        {
            case "Shell_TrayWnd": case "Shell_SecondaryTrayWnd": case "Progman": case "WorkerW": return false;
        }

        const uint caption = 0x00C00000, thickFrame = 0x00040000;
        uint style = GetWindowStyle(window, -16);
        if (IsZoomed(window) && (style & (caption | thickFrame)) != 0) return false;
        if (notificationState == 3) return true; // Exclusive Direct3D full screen.

        var monitor = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
        if (!GetMonitorInfo(MonitorFromWindow(window, 2), ref monitor)) return false;
        Rect bounds;
        if (DwmGetWindowAttribute(window, 9, out bounds, Marshal.SizeOf(typeof(Rect))) != 0 && !GetWindowRect(window, out bounds))
            return false;
        const int tolerance = 2;
        return bounds.Left <= monitor.Screen.Left + tolerance && bounds.Top <= monitor.Screen.Top + tolerance &&
            bounds.Right >= monitor.Screen.Right - tolerance && bounds.Bottom >= monitor.Screen.Bottom - tolerance;
    }

    internal static int Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--read-login-item")
        {
            // Electron exposes startup approval by executable, so first find the registered command by name.
            using (var run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
            {
                Console.OutputEncoding = new UTF8Encoding(false);
                if (run != null) Console.WriteLine(run.GetValue(args[1]) as string);
            }
            return 0;
        }
        uint owner;
        if (args.Length != 1 || !UInt32.TryParse(args[0], out owner)) return 2;
        try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); }
        catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
        using (var finished = new ManualResetEvent(false))
        {
            new Thread(() => { try { while (Console.In.Read() != -1) {} } finally { finished.Set(); } }) { IsBackground = true }.Start();
            string previous = null;
            do
            {
                int state;
                if (SHQueryUserNotificationState(out state) != 0) state = 5;
                string value = (CoversMonitor(owner, state) ? "1" : "0") + ":" + (state == 5 ? "1" : "0");
                if (value != previous) { Console.WriteLine(value); Console.Out.Flush(); previous = value; }
            } while (!finished.WaitOne(1000));
        }
        return 0;
    }
}
