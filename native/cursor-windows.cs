using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

class CursorRecorder {
  [StructLayout(LayoutKind.Sequential)] struct Point { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] struct CursorInfo { public int size, flags; public IntPtr cursor; public Point point; }
  delegate IntPtr Hook(int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Hook callback, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CursorInfo info);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] static extern IntPtr LoadCursor(IntPtr instance, int cursor);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  static Hook callback = OnMouse;
  static IntPtr hook, textCursor, handCursor;
  static int buttons;
  static void Sample(string kind) {
    var info = new CursorInfo(); info.size = Marshal.SizeOf(info); GetCursorInfo(ref info);
    Point point; GetCursorPos(out point);
    string shape = info.cursor == textCursor ? "text" : info.cursor == handCursor ? "hand" : "arrow";
    Console.WriteLine("{\"ms\":" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + ",\"x\":" + point.x + ",\"y\":" + point.y + ",\"buttons\":" + buttons + ",\"shape\":\"" + shape + "\",\"event\":\"" + kind + "\"}");
  }
  static IntPtr OnMouse(int code, IntPtr message, IntPtr data) {
    if(code >= 0) {
      int m = message.ToInt32(), bit = m == 0x201 || m == 0x202 ? 1 : m == 0x204 || m == 0x205 ? 2 : m == 0x207 || m == 0x208 ? 4 : 0;
      if(bit != 0) { bool down = m == 0x201 || m == 0x204 || m == 0x207; buttons = down ? buttons | bit : buttons & ~bit; Sample(down ? "down" : "up"); }
      if(m == 0x20A || m == 0x20E) Sample("wheel");
    }
    return CallNextHookEx(hook, code, message, data);
  }
  [STAThread] static void Main(string[] args) {
    if(args.Length > 0 && args[0] == "--self-test") { Console.WriteLine("cursor-helper-ok"); return; }
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    textCursor = LoadCursor(IntPtr.Zero, 32513); handCursor = LoadCursor(IntPtr.Zero, 32649);
    buttons = (GetAsyncKeyState(1) < 0 ? 1 : 0) | (GetAsyncKeyState(2) < 0 ? 2 : 0) | (GetAsyncKeyState(4) < 0 ? 4 : 0);
    hook = SetWindowsHookEx(14, callback, IntPtr.Zero, 0);
    if(hook == IntPtr.Zero) { Console.Error.WriteLine("Cannot observe mouse events."); Environment.Exit(1); }
    Console.WriteLine("{\"ready\":true}");
    var timer = new Timer(); timer.Interval = 16; timer.Tick += (sender, e) => Sample("move"); timer.Start();
    Application.ApplicationExit += (sender, e) => UnhookWindowsHookEx(hook);
    Application.Run();
  }
}
