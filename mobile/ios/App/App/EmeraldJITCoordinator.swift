import Foundation
import Darwin
import UIKit

struct EmeraldJITState {
    let supported: Bool
    let entitled: Bool
    let active: Bool
    let stikDebugInstalled: Bool
    let reason: String

    var dictionary: [String: Any] {
        [
            "jitSupported": supported,
            "jitEntitled": entitled,
            "jitAvailable": active,
            "stikDebugInstalled": stikDebugInstalled,
            "jitStatus": reason
        ]
    }
}

enum EmeraldJITError: LocalizedError {
    case unsupportedVersion
    case missingEntitlement
    case missingStikDebug
    case invalidRequest
    case openFailed
    case notActive

    var errorDescription: String? {
        switch self {
        case .unsupportedVersion:
            return "StikDebug JIT is supported here on iOS 17.4 through iOS 18. Use Compatible Interpreter on this iOS version."
        case .missingEntitlement:
            return "This installation is not debug-enabled. Reinstall Emerald Online 3DS through SideStore so get-task-allow is preserved."
        case .missingStikDebug:
            return "Install the official sideloaded StikDebug app before enabling JIT."
        case .invalidRequest:
            return "Emerald Online 3DS could not create a safe StikDebug request."
        case .openFailed:
            return "iOS could not open StikDebug. Confirm that its sideloaded app is installed."
        case .notActive:
            return "JIT is not active. Enable it with StikDebug and return to Emerald Online 3DS before playing."
        }
    }
}

final class EmeraldJITCoordinator {
    static let shared = EmeraldJITCoordinator()

    private let stikDebugScheme = "stikdebug"
    private let scriptName = "universal.js"

    private init() {}

    var state: EmeraldJITState {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        let supported = (version.majorVersion == 17 && version.minorVersion >= 4) ||
            (version.majorVersion >= 18 && version.majorVersion < 26)
        let entitled = EO3DSHasGetTaskAllow()
        let installed = supported && UIApplication.shared.canOpenURL(URL(string: "\(stikDebugScheme)://")!)
        let active = supported && entitled && EO3DSIsDebuggerAttached()
        let reason: String
        if active { reason = "active" }
        else if !supported && version.majorVersion >= 26 { reason = "ios-26-core-update-required" }
        else if !supported { reason = "unsupported-ios-version" }
        else if !entitled { reason = "missing-get-task-allow" }
        else if !installed { reason = "stikdebug-not-installed" }
        else { reason = "ready-to-enable" }
        return EmeraldJITState(supported: supported, entitled: entitled, active: active, stikDebugInstalled: installed, reason: reason)
    }

    func requestURL() throws -> URL {
        let current = state
        guard current.supported else { throw EmeraldJITError.unsupportedVersion }
        guard current.entitled else { throw EmeraldJITError.missingEntitlement }
        guard current.stikDebugInstalled else { throw EmeraldJITError.missingStikDebug }
        guard let bundleID = Bundle.main.bundleIdentifier else { throw EmeraldJITError.invalidRequest }
        var components = URLComponents()
        components.scheme = stikDebugScheme
        components.host = "enable-jit"
        components.queryItems = [
            URLQueryItem(name: "bundle-id", value: bundleID),
            URLQueryItem(name: "pid", value: String(getpid())),
            URLQueryItem(name: "script-name", value: scriptName)
        ]
        guard let url = components.url else { throw EmeraldJITError.invalidRequest }
        return url
    }

    func requireActive() throws {
        let current = state
        guard current.supported else { throw EmeraldJITError.unsupportedVersion }
        guard current.entitled else { throw EmeraldJITError.missingEntitlement }
        guard current.active else { throw EmeraldJITError.notActive }
    }
}
