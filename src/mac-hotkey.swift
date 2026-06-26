import Foundation
import CoreGraphics

if CommandLine.arguments.count < 6 {
  fputs("Usage: mac-hotkey <keyCode> <cmd:0|1> <alt:0|1> <shift:0|1> <ctrl:0|1>\n", stderr)
  exit(64)
}

let keyCode = CGKeyCode(UInt16(CommandLine.arguments[1]) ?? 0)
let needCmd = CommandLine.arguments[2] == "1"
let needAlt = CommandLine.arguments[3] == "1"
let needShift = CommandLine.arguments[4] == "1"
let needCtrl = CommandLine.arguments[5] == "1"
var isHeld = false

func modifiersMatch(_ flags: CGEventFlags) -> Bool {
  let hasCmd = flags.contains(.maskCommand)
  let hasAlt = flags.contains(.maskAlternate)
  let hasShift = flags.contains(.maskShift)
  let hasCtrl = flags.contains(.maskControl)
  return hasCmd == needCmd && hasAlt == needAlt && hasShift == needShift && hasCtrl == needCtrl
}

let callback: CGEventTapCallBack = { _, type, event, _ in
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    return Unmanaged.passUnretained(event)
  }

  guard type == .keyDown || type == .keyUp else {
    return Unmanaged.passUnretained(event)
  }

  let code = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
  guard code == keyCode else {
    return Unmanaged.passUnretained(event)
  }

  if type == .keyDown && !isHeld && modifiersMatch(event.flags) {
    isHeld = true
    print("HOTKEY_DOWN")
    fflush(stdout)
    return nil
  }

  if type == .keyUp && isHeld {
    isHeld = false
    print("HOTKEY_UP")
    fflush(stdout)
    return nil
  }

  return Unmanaged.passUnretained(event)
}

let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)

guard let tap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .defaultTap,
  eventsOfInterest: CGEventMask(mask),
  callback: callback,
  userInfo: nil
) else {
  fputs("REGISTER_FAILED:Accessibility permission required\n", stderr)
  exit(2)
}

let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
print("REGISTERED")
fflush(stdout)
CFRunLoopRun()
