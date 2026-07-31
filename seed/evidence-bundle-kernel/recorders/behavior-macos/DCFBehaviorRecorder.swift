import AppKit
import ApplicationServices
import Foundation

private let sourceName = "behavior-macos"
private let secureSubrole = "AXSecureTextField"
private let textRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox"]
private let maximumTextLength = 32_768

private final class JSONLFactWriter {
    private let root: URL
    private let encoder = JSONEncoder()
    private let calendar = Calendar(identifier: .gregorian)
    private let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    init(root: URL) {
        self.root = root
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    }

    func append(kind: String, context: [String: JSONValue], payload: [String: JSONValue]) throws {
        let now = Date()
        let observedAt = isoFormatter.string(from: now)
        let day = calendar.dateComponents(in: .current, from: now)
        let date = String(format: "%04d-%02d-%02d", day.year ?? 0, day.month ?? 0, day.day ?? 0)
        let directory = root.appendingPathComponent(sourceName, isDirectory: true)
        let path = directory.appendingPathComponent("\(date).jsonl")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let fact = FactEnvelope(
            eventID: "behavior-macos:\(UUID().uuidString.lowercased())",
            source: sourceName,
            kind: kind,
            observedAt: observedAt,
            context: context,
            payload: payload
        )
        var data = try encoder.encode(fact)
        data.append(0x0A)
        if !FileManager.default.fileExists(atPath: path.path) {
            FileManager.default.createFile(atPath: path.path, contents: nil)
        }
        let handle = try FileHandle(forWritingTo: path)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
    }
}

private struct FactEnvelope: Encodable {
    let eventID: String
    let source: String
    let kind: String
    let observedAt: String
    let context: [String: JSONValue]
    let payload: [String: JSONValue]

    enum CodingKeys: String, CodingKey {
        case eventID = "event_id"
        case source
        case kind
        case observedAt = "observed_at"
        case context
        case payload
    }
}

private enum JSONValue: Encodable {
    case string(String)
    case bool(Bool)
    case integer(Int64)
    case null

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .integer(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

private struct AXSnapshot {
    let pid: pid_t
    let application: String?
    let bundleID: String?
    let windowTitle: String?
    let role: String?
    let subrole: String?
    let title: String?
    let identifier: String?
    let description: String?
    let value: String?

    var isSecure: Bool { subrole == secureSubrole }
    var isTextLike: Bool { role.map(textRoles.contains) ?? false }

    var context: [String: JSONValue] {
        [
            "pid": .integer(Int64(pid)),
            "application": application.map(JSONValue.string) ?? .null,
            "bundle_id": bundleID.map(JSONValue.string) ?? .null,
            "window_title": windowTitle.map(JSONValue.string) ?? .null
        ]
    }

    var controlPayload: [String: JSONValue] {
        [
            "role": role.map(JSONValue.string) ?? .null,
            "subrole": subrole.map(JSONValue.string) ?? .null,
            "title": title.map(JSONValue.string) ?? .null,
            "identifier": identifier.map(JSONValue.string) ?? .null,
            "description": description.map(JSONValue.string) ?? .null,
            "secure": .bool(isSecure)
        ]
    }
}

private final class BehaviorRecorder {
    private let systemWide = AXUIElementCreateSystemWide()
    private let writer: JSONLFactWriter
    private var lastTextSignature: String?
    private var eventTap: CFMachPort?

    init(evidenceRoot: URL) {
        writer = JSONLFactWriter(root: evidenceRoot)
    }

    func run() throws {
        guard AXIsProcessTrusted() else {
            throw RecorderError.accessibilityPermissionMissing
        }

        let mask = CGEventMask(1 << CGEventType.leftMouseDown.rawValue)
            | CGEventMask(1 << CGEventType.keyDown.rawValue)

        let callback: CGEventTapCallBack = { _, type, event, userInfo in
            guard let userInfo else { return Unmanaged.passUnretained(event) }
            let recorder = Unmanaged<BehaviorRecorder>.fromOpaque(userInfo).takeUnretainedValue()
            recorder.handle(type: type, event: event)
            return Unmanaged.passUnretained(event)
        }

        let pointer = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: mask,
            callback: callback,
            userInfo: pointer
        ) else {
            throw RecorderError.eventTapUnavailable
        }
        eventTap = tap

        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        CFRunLoopRun()
    }

    private func handle(type: CGEventType, event: CGEvent) {
        do {
            switch type {
            case .leftMouseDown:
                try captureFocusedText(reason: "before-control-click")
                try captureControlClick(at: event.location)
            case .keyDown:
                let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
                if keyCode == 36 || keyCode == 76 {
                    try captureFocusedText(reason: "return-key")
                } else if keyCode == 48 {
                    try captureFocusedText(reason: "tab-key")
                }
            default:
                break
            }
        } catch {
            fputs("behavior recorder error: \(error)\n", stderr)
        }
    }

    private func captureFocusedText(reason: String) throws {
        guard let element = focusedElement(), let snapshot = snapshot(element) else { return }
        guard snapshot.isTextLike else { return }
        guard !snapshot.isSecure else {
            try writer.append(
                kind: "user.text.output.excluded",
                context: snapshot.context,
                payload: ["reason": .string("secure-text-field"), "commit_reason": .string(reason)]
            )
            return
        }
        guard let fullValue = snapshot.value, !fullValue.isEmpty else { return }
        let truncated = String(fullValue.prefix(maximumTextLength))
        let signature = [snapshot.bundleID ?? "", snapshot.windowTitle ?? "", snapshot.identifier ?? "", truncated, reason].joined(separator: "\u{0}")
        guard signature != lastTextSignature else { return }
        lastTextSignature = signature
        try writer.append(
            kind: "user.text.output",
            context: snapshot.context,
            payload: [
                "text": .string(truncated),
                "text_truncated": .bool(fullValue.count > maximumTextLength),
                "commit_reason": .string(reason),
                "capture_semantics": .string("final-visible-text-at-boundary"),
                "control_role": snapshot.role.map(JSONValue.string) ?? .null,
                "control_identifier": snapshot.identifier.map(JSONValue.string) ?? .null
            ]
        )
    }

    private func captureControlClick(at point: CGPoint) throws {
        var rawElement: AXUIElement?
        guard AXUIElementCopyElementAtPosition(systemWide, Float(point.x), Float(point.y), &rawElement) == .success,
              let element = rawElement,
              let snapshot = snapshot(element) else { return }
        var payload = snapshot.controlPayload
        payload["x"] = .integer(Int64(point.x.rounded()))
        payload["y"] = .integer(Int64(point.y.rounded()))
        if snapshot.isSecure {
            payload["title"] = .null
            payload["description"] = .null
            payload["identifier"] = .null
        }
        try writer.append(kind: "user.control.click", context: snapshot.context, payload: payload)
    }

    private func focusedElement() -> AXUIElement? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(systemWide, kAXFocusedUIElementAttribute as CFString, &value) == .success else { return nil }
        return value as! AXUIElement?
    }

    private func snapshot(_ element: AXUIElement) -> AXSnapshot? {
        var pid: pid_t = 0
        guard AXUIElementGetPid(element, &pid) == .success else { return nil }
        let app = NSRunningApplication(processIdentifier: pid)
        let role = stringAttribute(element, kAXRoleAttribute)
        let subrole = stringAttribute(element, kAXSubroleAttribute)
        let window = elementAttribute(element, kAXWindowAttribute)
        return AXSnapshot(
            pid: pid,
            application: app?.localizedName,
            bundleID: app?.bundleIdentifier,
            windowTitle: window.flatMap { stringAttribute($0, kAXTitleAttribute) },
            role: role,
            subrole: subrole,
            title: stringAttribute(element, kAXTitleAttribute),
            identifier: stringAttribute(element, kAXIdentifierAttribute),
            description: stringAttribute(element, kAXDescriptionAttribute),
            value: stringAttribute(element, kAXValueAttribute)
        )
    }

    private func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as? String
    }

    private func elementAttribute(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as! AXUIElement?
    }
}

private enum RecorderError: LocalizedError {
    case accessibilityPermissionMissing
    case eventTapUnavailable

    var errorDescription: String? {
        switch self {
        case .accessibilityPermissionMissing:
            return "Accessibility permission is required. Enable the recorder in System Settings > Privacy & Security > Accessibility."
        case .eventTapUnavailable:
            return "Unable to create a listen-only CGEvent tap. Input Monitoring permission may be required."
        }
    }
}

private func main() throws {
    guard let root = ProcessInfo.processInfo.environment["DCF_EVIDENCE_ROOT"], !root.isEmpty else {
        throw NSError(domain: "DCFBehaviorRecorder", code: 2, userInfo: [NSLocalizedDescriptionKey: "DCF_EVIDENCE_ROOT is required"])
    }
    try BehaviorRecorder(evidenceRoot: URL(fileURLWithPath: root, isDirectory: true)).run()
}

do {
    try main()
} catch {
    fputs("\(error.localizedDescription)\n", stderr)
    exit(1)
}
