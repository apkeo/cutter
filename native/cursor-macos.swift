import AppKit
import CoreGraphics

func emit(_ value: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data: data, encoding: .utf8) { print(line); fflush(stdout) }
}
if CommandLine.arguments.contains("--self-test") { print("cursor-helper-ok"); exit(0) }
_ = NSApplication.shared
var buttons = (CGEventSource.buttonState(.combinedSessionState, button: .left) ? 1 : 0) | (CGEventSource.buttonState(.combinedSessionState, button: .right) ? 2 : 0) | (CGEventSource.buttonState(.combinedSessionState, button: .center) ? 4 : 0)
var installedTap: CFMachPort?
let textImage = NSCursor.iBeam.image.tiffRepresentation
let handImage = NSCursor.pointingHand.image.tiffRepresentation
func sample(_ kind: String, _ event: CGEvent? = nil) {
  guard let point = (event ?? CGEvent(source: nil))?.location else { return }
  let image = NSCursor.currentSystem?.image.tiffRepresentation
  let shape = image != nil && image == textImage ? "text" : image != nil && image == handImage ? "hand" : "arrow"
  emit(["ms": Date().timeIntervalSince1970 * 1000, "x": point.x, "y": point.y, "buttons": buttons, "shape": shape, "event": kind])
}
let types: [CGEventType] = [.leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp, .scrollWheel]
let mask = types.reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: { _, type, event, _ in
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { if let tap = installedTap { CGEvent.tapEnable(tap: tap, enable: true) }; return Unmanaged.passUnretained(event) }
  let bit = type == .leftMouseDown || type == .leftMouseUp ? 1 : type == .rightMouseDown || type == .rightMouseUp ? 2 : 4
  if type == .scrollWheel { sample("wheel", event) }
  else if type == .leftMouseDown || type == .rightMouseDown || type == .otherMouseDown { buttons |= bit; sample("down", event) }
  else if type == .leftMouseUp || type == .rightMouseUp || type == .otherMouseUp { buttons &= ~bit; sample("up", event) }
  return Unmanaged.passUnretained(event)
}, userInfo: nil) else {
  emit(["error": "Allow Cutter in System Settings → Privacy & Security → Input Monitoring, then restart Cutter."])
  exit(1)
}
installedTap = tap
CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0), .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
emit(["ready": true])
let timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { _ in sample("move") }
RunLoop.main.add(timer, forMode: .common)
RunLoop.main.run()
