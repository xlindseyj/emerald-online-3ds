import CryptoKit
import Foundation
import Gzip

enum EmeraldStorageError: LocalizedError {
    case invalidROM(String)
    case invalidConfig(String)
    case invalidBackup(String)
    case missingRuntime

    var errorDescription: String? {
        switch self {
        case .invalidROM(let message), .invalidConfig(let message), .invalidBackup(let message): return message
        case .missingRuntime: return "The bundled Emerald Online 3DS runtime is missing or damaged."
        }
    }
}

struct EmeraldLauncherConfig: Codable {
    var server = "live.emeraldonline3ds.com"
    var port = 443
    var transport = "wss"
    var path = "/game"
    var name = "Trainer"
    var online = true
    var page = "online"

    static let allowedPages = Set(["online", "users", "chat", "party", "bag", "map", "stats", "quest", "titles", "friends", "guild", "teleport", "update"])

    func validated() throws -> EmeraldLauncherConfig {
        var copy = self
        copy.server = server.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        copy.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.path = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !copy.server.isEmpty, copy.server.count <= 253, copy.server.range(of: #"[\s/:\\]"#, options: .regularExpression) == nil else {
            throw EmeraldStorageError.invalidConfig("Server host must be a hostname or IPv4 address without a scheme, path, or port.")
        }
        guard (1...65535).contains(copy.port) else { throw EmeraldStorageError.invalidConfig("Port must be between 1 and 65535.") }
        guard copy.transport == "wss" || copy.transport == "tcp" else { throw EmeraldStorageError.invalidConfig("Transport must be wss or tcp.") }
        guard copy.path.hasPrefix("/"), copy.path.count <= 127, copy.path.range(of: #"[?#\\\s]"#, options: .regularExpression) == nil else {
            throw EmeraldStorageError.invalidConfig("Server path contains unsupported characters.")
        }
        guard copy.name.range(of: #"^[\x20-!#-\[\]-~]{1,12}$"#, options: .regularExpression) != nil else {
            throw EmeraldStorageError.invalidConfig("Trainer name must be 1-12 printable ASCII characters without quotes or backslashes.")
        }
        guard Self.allowedPages.contains(copy.page) else { throw EmeraldStorageError.invalidConfig("Invalid starting page.") }
        return copy
    }

    var dictionary: [String: Any] {
        ["server": server, "port": port, "transport": transport, "path": path, "name": name, "online": online, "page": page]
    }
}

struct RuntimeManifest: Codable { let version: String; let sha256: String; let file: String }
private struct RuntimeState: Codable { let bundledHash: String; let policyVersion: Int }
private struct SessionState: Codable { let cleanExit: Bool; let startedAt: String }
private struct BackupFile: Codable { let path: String; let size: Int; let sha256: String; let data: String }
private struct BackupArchive: Codable {
    let format: String
    let version: Int
    let createdAt: String
    let notice: String
    let excluded: [String]
    let files: [BackupFile]
}

final class EmeraldStorage {
    static let shared = EmeraldStorage()
    static let supportedROMHash = "a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af"
    private let manager = FileManager.default
    private let maxBackupBytes = 128 * 1024 * 1024
    private let maxFileBytes = 64 * 1024 * 1024

    let appRoot: URL
    let azaharRoot: URL
    let sdRoot: URL
    let gameRoot: URL
    let configURL: URL
    let sessionURL: URL
    let diagnosticsURL: URL

    private init() {
        let support = try! manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        appRoot = support.appendingPathComponent("EmeraldOnline3DS", isDirectory: true)
        azaharRoot = appRoot.appendingPathComponent("Azahar", isDirectory: true)
        sdRoot = azaharRoot.appendingPathComponent("sdmc", isDirectory: true)
        gameRoot = sdRoot.appendingPathComponent("3ds/emerald-online-3ds", isDirectory: true)
        configURL = appRoot.appendingPathComponent("launcher-config.json")
        sessionURL = appRoot.appendingPathComponent("runtime-session.json")
        diagnosticsURL = appRoot.appendingPathComponent("diagnostics/launcher.jsonl")
        try? manager.createDirectory(at: gameRoot, withIntermediateDirectories: true)
        try? manager.createDirectory(at: diagnosticsURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var root = appRoot
        try? root.setResourceValues(values)
    }

    var romURL: URL { gameRoot.appendingPathComponent("emerald.gba") }
    var installedRuntimeURL: URL { gameRoot.appendingPathComponent("emerald-online-3ds.3dsx") }
    var bundledCoreURL: URL? { Bundle.main.privateFrameworksURL?.appendingPathComponent("azahar_libretro.dylib") }

    func ensureRuntimeInstalled() throws -> RuntimeManifest {
        guard let manifestURL = Bundle.main.url(forResource: "manifest", withExtension: "json", subdirectory: "Runtime"),
              let bundledURL = Bundle.main.url(forResource: "emerald-online-3ds", withExtension: "3dsx", subdirectory: "Runtime") else {
            throw EmeraldStorageError.missingRuntime
        }
        let manifest = try JSONDecoder().decode(RuntimeManifest.self, from: Data(contentsOf: manifestURL))
        let bundledData = try Data(contentsOf: bundledURL, options: .mappedIfSafe)
        guard bundledData.sha256Hex == manifest.sha256 else { throw EmeraldStorageError.missingRuntime }
        let stateURL = appRoot.appendingPathComponent("runtime-state.json")
        let state = (try? JSONDecoder().decode(RuntimeState.self, from: Data(contentsOf: stateURL)))
        if !manager.fileExists(atPath: installedRuntimeURL.path) || state?.bundledHash != manifest.sha256 || state?.policyVersion != 2 {
            try manager.createDirectory(at: gameRoot, withIntermediateDirectories: true)
            try bundledData.write(to: installedRuntimeURL, options: .atomic)
        }
        try JSONEncoder.pretty.encode(RuntimeState(bundledHash: manifest.sha256, policyVersion: 2)).write(to: stateURL, options: .atomic)
        return manifest
    }

    func validateROM(at url: URL) throws -> (title: String, gameCode: String) {
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        guard data.count == 16 * 1024 * 1024 else { throw EmeraldStorageError.invalidROM("Expected a 16 MiB GBA ROM.") }
        let bytes = [UInt8](data)
        let text: (Int, Int) -> String = { start, end in String(bytes: bytes[start..<end], encoding: .ascii)?.trimmingCharacters(in: CharacterSet(charactersIn: "\0 ")) ?? "" }
        var checksum = 0
        for index in 0xA0...0xBC { checksum = (checksum - Int(bytes[index])) & 0xff }
        checksum = (checksum - 0x19) & 0xff
        let title = text(0xA0, 0xAC)
        let code = text(0xAC, 0xB0)
        guard code == "BPEE", text(0xB0, 0xB2) == "01", bytes[0xBC] == 0, checksum == Int(bytes[0xBD]), data.sha256Hex == Self.supportedROMHash else {
            throw EmeraldStorageError.invalidROM("This is not the supported unmodified Pokémon Emerald (U) revision. No file was copied.")
        }
        return (title, code)
    }

    func importROM(from url: URL) throws -> (title: String, gameCode: String) {
        let result = try validateROM(at: url)
        try manager.createDirectory(at: gameRoot, withIntermediateDirectories: true)
        let temporary = gameRoot.appendingPathComponent("emerald.gba.import-tmp")
        try? manager.removeItem(at: temporary)
        try manager.copyItem(at: url, to: temporary)
        try? manager.removeItem(at: romURL)
        try manager.moveItem(at: temporary, to: romURL)
        try writeOnlineConfig(readConfig())
        appendDiagnostic(event: "rom-imported", fields: ["valid": true])
        return result
    }

    func romStatus() -> (present: Bool, valid: Bool) {
        guard manager.fileExists(atPath: romURL.path) else { return (false, false) }
        return (true, (try? validateROM(at: romURL)) != nil)
    }

    func readConfig() -> EmeraldLauncherConfig {
        guard let data = try? Data(contentsOf: configURL), let decoded = try? JSONDecoder().decode(EmeraldLauncherConfig.self, from: data), let valid = try? decoded.validated() else {
            return EmeraldLauncherConfig()
        }
        return valid
    }

    func saveConfig(_ config: EmeraldLauncherConfig) throws -> EmeraldLauncherConfig {
        let valid = try config.validated()
        try manager.createDirectory(at: appRoot, withIntermediateDirectories: true)
        try JSONEncoder.pretty.encode(valid).write(to: configURL, options: .atomic)
        try writeOnlineConfig(valid)
        return valid
    }

    func writeOnlineConfig(_ config: EmeraldLauncherConfig) throws {
        let valid = try config.validated()
        let lines = ["server=\(valid.server)", "port=\(valid.port)", "transport=\(valid.transport)", "path=\(valid.path)", "name=\(valid.name)", "online=\(valid.online ? "enabled" : "disabled")", "dynarec=disabled", "page=\(valid.page)", ""]
        try manager.createDirectory(at: gameRoot, withIntermediateDirectories: true)
        try lines.joined(separator: "\n").data(using: .utf8)!.write(to: gameRoot.appendingPathComponent("online.cfg"), options: .atomic)
    }

    func previousSessionWasUnclean() -> Bool {
        guard let data = try? Data(contentsOf: sessionURL), let state = try? JSONDecoder().decode(SessionState.self, from: data) else { return false }
        return !state.cleanExit
    }

    func markSessionStarted() { try? JSONEncoder.pretty.encode(SessionState(cleanExit: false, startedAt: ISO8601DateFormatter().string(from: Date()))).write(to: sessionURL, options: .atomic) }
    func markSessionClean() { try? JSONEncoder.pretty.encode(SessionState(cleanExit: true, startedAt: ISO8601DateFormatter().string(from: Date()))).write(to: sessionURL, options: .atomic) }

    private func backupPathAllowed(_ path: String) -> Bool {
        if path == "launcher/launcher-config.json" { return true }
        if ["sd/emerald.sav", "sd/identity.cfg", "sd/stats.cfg", "sd/display.cfg", "sd/online.cfg", "sd/avatars.t3x"].contains(path) { return true }
        return path.range(of: #"^sd/link-backups/emerald-link-[A-Za-z0-9._-]+\.sav$"#, options: .regularExpression) != nil
    }

    private func backupTarget(for path: String) throws -> URL {
        guard backupPathAllowed(path), !path.contains(".."), !path.contains("\\") else { throw EmeraldStorageError.invalidBackup("Backup contains an unsupported path.") }
        if path == "launcher/launcher-config.json" { return configURL }
        return gameRoot.appendingPathComponent(String(path.dropFirst(3)))
    }

    func createBackup() throws -> (url: URL, files: Int, includesIdentity: Bool) {
        var candidates: [(String, URL)] = [("launcher/launcher-config.json", configURL)]
        for name in ["emerald.sav", "identity.cfg", "stats.cfg", "display.cfg", "online.cfg", "avatars.t3x"] { candidates.append(("sd/\(name)", gameRoot.appendingPathComponent(name))) }
        let linkRoot = gameRoot.appendingPathComponent("link-backups", isDirectory: true)
        if let links = try? manager.contentsOfDirectory(at: linkRoot, includingPropertiesForKeys: [.isRegularFileKey]) {
            for url in links where url.lastPathComponent.range(of: #"^emerald-link-[A-Za-z0-9._-]+\.sav$"#, options: .regularExpression) != nil { candidates.append(("sd/link-backups/\(url.lastPathComponent)", url)) }
        }
        var files: [BackupFile] = []
        var total = 0
        for (path, url) in candidates where manager.fileExists(atPath: url.path) {
            let data = try Data(contentsOf: url)
            guard data.count <= maxFileBytes else { throw EmeraldStorageError.invalidBackup("\(path) is too large to back up safely.") }
            total += data.count
            files.append(BackupFile(path: path, size: data.count, sha256: data.sha256Hex, data: data.base64EncodedString()))
        }
        guard !files.isEmpty, files.count <= 256, total <= maxBackupBytes else { throw EmeraldStorageError.invalidBackup("There is no safe local data to back up, or it is too large.") }
        let archive = BackupArchive(format: "emerald-online-3ds-local-backup", version: 1, createdAt: ISO8601DateFormatter().string(from: Date()), notice: "Local-only backup. Contains private save/settings data and may contain an online identity. Never upload or share it.", excluded: ["emerald.gba", "emerald-online-3ds.3dsx", "gpsp-debug.log", "update/"], files: files)
        var json = try JSONEncoder().encode(archive)
        json.append(0x0a)
        let compressed = try json.gzipped(level: .bestCompression)
        let url = manager.temporaryDirectory.appendingPathComponent("EmeraldOnline3DS-\(Int(Date().timeIntervalSince1970)).eobackup")
        try compressed.write(to: url, options: .atomic)
        return (url, files.count, files.contains { $0.path == "sd/identity.cfg" })
    }

    func restoreBackup(from url: URL) throws -> (files: Int, includesIdentity: Bool) {
        let compressed = try Data(contentsOf: url)
        guard compressed.count <= maxBackupBytes else { throw EmeraldStorageError.invalidBackup("Backup file is too large.") }
        guard let json = try? compressed.gunzipped(), json.count <= maxBackupBytes, let archive = try? JSONDecoder().decode(BackupArchive.self, from: json), archive.format == "emerald-online-3ds-local-backup", archive.version == 1, !archive.files.isEmpty, archive.files.count <= 256 else {
            throw EmeraldStorageError.invalidBackup("This is not a valid Emerald Online 3DS backup.")
        }
        var seen = Set<String>()
        var verified: [(URL, Data)] = []
        var total = 0
        for file in archive.files {
            guard backupPathAllowed(file.path), !seen.contains(file.path), file.size >= 0, file.size <= maxFileBytes,
                  let data = Data(base64Encoded: file.data), data.count == file.size, data.sha256Hex == file.sha256 else {
                throw EmeraldStorageError.invalidBackup("Backup integrity validation failed.")
            }
            total += data.count
            guard total <= maxBackupBytes else { throw EmeraldStorageError.invalidBackup("Backup contents are too large.") }
            seen.insert(file.path)
            verified.append((try backupTarget(for: file.path), data))
        }
        for (target, data) in verified {
            try manager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: target, options: .atomic)
        }
        return (verified.count, seen.contains("sd/identity.cfg"))
    }

    func appendDiagnostic(event: String, fields: [String: Any] = [:]) {
        var record = fields
        record["event"] = event
        record["at"] = ISO8601DateFormatter().string(from: Date())
        guard JSONSerialization.isValidJSONObject(record), let data = try? JSONSerialization.data(withJSONObject: record), var line = String(data: data, encoding: .utf8) else { return }
        line = line.replacingOccurrences(of: #"(?:\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b)"#, with: "[private-address]", options: .regularExpression)
        line = line.replacingOccurrences(of: #"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#, with: "[email]", options: .regularExpression)
        try? manager.createDirectory(at: diagnosticsURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !manager.fileExists(atPath: diagnosticsURL.path) { manager.createFile(atPath: diagnosticsURL.path, contents: nil) }
        if let handle = try? FileHandle(forWritingTo: diagnosticsURL) { defer { try? handle.close() }; _ = try? handle.seekToEnd(); try? handle.write(contentsOf: Data("\(line)\n".utf8)) }
    }

    func diagnosticReport() throws -> URL {
        let events = (try? String(contentsOf: diagnosticsURL, encoding: .utf8).split(separator: "\n").suffix(100).joined(separator: "\n")) ?? "No launcher events recorded."
        let rom = romStatus()
        let text = """
        Emerald Online 3DS privacy-safe diagnostics
        App version: \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown")
        Azahar core: 2126.0
        JIT available: false
        ROM present: \(rom.present)
        ROM valid: \(rom.valid)
        This report excludes ROMs, saves, identities, configuration values, private addresses, email addresses, and user paths.

        Redacted launcher events:
        \(events)
        """
        let url = manager.temporaryDirectory.appendingPathComponent("EmeraldOnline3DS-diagnostics.txt")
        try Data(text.utf8).write(to: url, options: .atomic)
        return url
    }

    func deleteAllLocalData() throws {
        guard appRoot.path.hasPrefix(manager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].path + "/") else { throw EmeraldStorageError.invalidBackup("Refusing to delete data outside the application directory.") }
        if manager.fileExists(atPath: appRoot.path) { try manager.removeItem(at: appRoot) }
        try manager.createDirectory(at: gameRoot, withIntermediateDirectories: true)
    }
}

private extension Data {
    var sha256Hex: String { SHA256.hash(data: self).map { String(format: "%02x", $0) }.joined() }
}

private extension JSONEncoder {
    static var pretty: JSONEncoder { let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]; return encoder }
}
