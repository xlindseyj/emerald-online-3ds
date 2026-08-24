import Capacitor
import Foundation
import UIKit
import UniformTypeIdentifiers

@objc(EmeraldRuntimePlugin)
public final class EmeraldRuntimePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate, EmeraldEmulationViewControllerDelegate {
    public let identifier = "EmeraldRuntimePlugin"
    public let jsName = "EmeraldRuntime"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importRom", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enableJit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restoreBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportDiagnostics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteLocalData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkForUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openExternal", returnType: CAPPluginReturnPromise)
    ]

    private enum PickerMode { case rom, restore }
    private let storage = EmeraldStorage.shared
    private let jitCoordinator = EmeraldJITCoordinator.shared
    private var pickerCall: CAPPluginCall?
    private var pickerMode: PickerMode?
    private weak var emulationController: EmeraldEmulationViewController?
    private var lastFPS = 0.0
    private var lastJITActive = false

    public override func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(applicationDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    private func addingJITState(to values: [String: Any]) -> [String: Any] {
        var result = values
        result.merge(jitCoordinator.state.dictionary) { _, latest in latest }
        return result
    }

    @objc public func getStatus(_ call: CAPPluginCall) {
        do {
            let manifest = try storage.ensureRuntimeInstalled()
            let rom = storage.romStatus()
            // The build verifies the upstream hash before Xcode signs the dylib.
            // Signing changes its bytes; iOS validates the installed code signature.
            let coreReady = storage.bundledCoreURL.map { FileManager.default.fileExists(atPath: $0.path) } ?? false
            call.resolve(addingJITState(to: [
                "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
                "runtimeVersion": manifest.version,
                "coreVersion": "2126.0",
                "runtimeReady": true,
                "coreReady": coreReady,
                "romPresent": rom.present,
                "romValid": rom.valid,
                "running": emulationController != nil,
                "previousUncleanExit": storage.previousSessionWasUnclean(),
                "autoSaveAvailable": storage.autoSaveAvailable
            ]))
        } catch {
            call.resolve(addingJITState(to: [
                "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
                "runtimeVersion": "missing", "coreVersion": "2126.0", "runtimeReady": false,
                "coreReady": storage.bundledCoreURL.map { FileManager.default.fileExists(atPath: $0.path) } ?? false,
                "romPresent": storage.romStatus().present, "romValid": false, "running": false,
                "previousUncleanExit": storage.previousSessionWasUnclean(),
                "autoSaveAvailable": storage.autoSaveAvailable
            ]))
        }
    }

    @objc public func importRom(_ call: CAPPluginCall) {
        guard pickerCall == nil else { call.reject("Another document operation is already active."); return }
        let type = UTType(filenameExtension: "gba") ?? .data
        pickerCall = call; pickerMode = .rom
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [type], asCopy: true)
            picker.delegate = self; picker.allowsMultipleSelection = false
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    @objc public func enableJit(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.reject("The app is not ready to request JIT."); return }
            do {
                let current = self.jitCoordinator.state
                if current.active { call.resolve(current.dictionary); return }
                let url = try self.jitCoordinator.requestURL()
                self.storage.appendDiagnostic(event: "jit-requested", fields: ["method": "stikdebug"])
                UIApplication.shared.open(url) { opened in
                    if opened { call.resolve(self.jitCoordinator.state.dictionary) }
                    else { call.reject(EmeraldJITError.openFailed.localizedDescription) }
                }
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc public func start(_ call: CAPPluginCall) {
        guard emulationController == nil else { call.reject("The emulator is already running."); return }
        do {
            _ = try storage.ensureRuntimeInstalled()
            let rom = storage.romStatus()
            guard rom.present && rom.valid else { throw EmeraldStorageError.invalidROM("Select the supported Pokémon Emerald ROM before playing.") }
            guard let core = storage.bundledCoreURL, FileManager.default.fileExists(atPath: core.path) else { throw EmeraldStorageError.missingRuntime }
            let config = storage.readConfig()
            let jitEnabled: Bool
            if config.jitMode == "stikdebug" {
                try jitCoordinator.requireActive()
                jitEnabled = true
            } else {
                jitEnabled = false
            }
            let controller = EmeraldEmulationViewController(storage: storage, coreURL: core, runtimeURL: storage.installedRuntimeURL, config: config, jitEnabled: jitEnabled)
            controller.delegate = self
            emulationController = controller
            notifyListeners("runtimeState", data: ["state": "starting", "message": jitEnabled ? "Launching Emerald Online 3DS with JIT…" : "Launching Emerald Online 3DS in compatible interpreter mode…"])
            DispatchQueue.main.async { [weak self] in
                self?.bridge?.viewController?.present(controller, animated: true)
                self?.notifyListeners("runtimeState", data: ["state": "running", "message": "Emerald Online 3DS is running."])
                call.resolve(["started": true])
            }
        } catch { call.reject(error.localizedDescription) }
    }

    @objc public func stop(_ call: CAPPluginCall) {
        guard let controller = emulationController else { call.resolve(); return }
        DispatchQueue.main.async { controller.requestStop(); call.resolve() }
    }

    @objc public func getConfig(_ call: CAPPluginCall) { call.resolve(storage.readConfig().dictionary) }

    @objc public func saveConfig(_ call: CAPPluginCall) {
        guard let object = call.getObject("config") else { call.reject("Missing settings payload."); return }
        do {
            let config = EmeraldLauncherConfig(
                server: object["server"] as? String ?? "",
                port: object["port"] as? Int ?? 0,
                transport: object["transport"] as? String ?? "",
                path: object["path"] as? String ?? "",
                name: object["name"] as? String ?? "",
                online: object["online"] as? Bool ?? false,
                page: object["page"] as? String ?? "",
                audioEnabled: object["audioEnabled"] as? Bool ?? true,
                autoSaveState: object["autoSaveState"] as? Bool ?? false,
                equalWidthScreens: object["equalWidthScreens"] as? Bool ?? false,
                jitMode: object["jitMode"] as? String ?? "interpreter"
            )
            call.resolve(try storage.saveConfig(config).dictionary)
        } catch { call.reject(error.localizedDescription) }
    }

    @objc public func createBackup(_ call: CAPPluginCall) {
        do {
            let backup = try storage.createBackup()
            share(url: backup.url, from: call) {
                call.resolve(["exported": true, "files": backup.files, "includesIdentity": backup.includesIdentity])
            }
        } catch { call.reject(error.localizedDescription) }
    }

    @objc public func restoreBackup(_ call: CAPPluginCall) {
        guard pickerCall == nil, emulationController == nil else { call.reject("Stop the emulator and finish the current document operation first."); return }
        let type = UTType(filenameExtension: "eobackup") ?? .data
        pickerCall = call; pickerMode = .restore
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [type], asCopy: true)
            picker.delegate = self; picker.allowsMultipleSelection = false
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    @objc public func exportDiagnostics(_ call: CAPPluginCall) {
        do { share(url: try storage.diagnosticReport(), from: call) { call.resolve(["exported": true]) } }
        catch { call.reject(error.localizedDescription) }
    }

    @objc public func deleteLocalData(_ call: CAPPluginCall) {
        guard emulationController == nil else { call.reject("Stop the emulator before deleting local data."); return }
        do { try storage.deleteAllLocalData(); call.resolve(["deleted": true]) }
        catch { call.reject(error.localizedDescription) }
    }

    @objc public func checkForUpdate(_ call: CAPPluginCall) {
        let current = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
        let request = URLRequest(url: URL(string: "https://emeraldonline3ds.com/api/release")!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { call.reject("Update check failed: \(error.localizedDescription)"); return }
            guard let http = response as? HTTPURLResponse, http.statusCode == 200, let data,
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let latest = object["version"] as? String else {
                call.reject("The official release service returned an invalid response."); return
            }
            call.resolve(["currentVersion": current, "latestVersion": latest, "updateAvailable": current.compare(latest, options: .numeric) == .orderedAscending])
        }.resume()
    }

    @objc public func openExternal(_ call: CAPPluginCall) {
        let allowed = Set(["https://emeraldonline3ds.com/", "https://emeraldonline3ds.com/community", "https://emeraldonline3ds.com/status"])
        guard let raw = call.getString("url"), allowed.contains(raw), let url = URL(string: raw) else { call.reject("Rejected an untrusted external URL."); return }
        DispatchQueue.main.async { UIApplication.shared.open(url) { opened in opened ? call.resolve() : call.reject("Unable to open the URL.") } }
    }

    @objc private func applicationDidBecomeActive() {
        let current = jitCoordinator.state
        if current.active && !lastJITActive { storage.appendDiagnostic(event: "jit-active", fields: ["method": "stikdebug"]) }
        lastJITActive = current.active
        notifyListeners("jitState", data: current.dictionary, retainUntilConsumed: true)
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickerCall, let mode = pickerMode, let url = urls.first else { finishPicker(cancelled: true); return }
        defer { pickerCall = nil; pickerMode = nil }
        do {
            switch mode {
            case .rom:
                let result = try storage.importROM(from: url)
                call.resolve(["imported": true, "title": result.title, "gameCode": result.gameCode])
            case .restore:
                let result = try storage.restoreBackup(from: url)
                call.resolve(["restored": true, "files": result.files, "includesIdentity": result.includesIdentity])
            }
        } catch { call.reject(error.localizedDescription) }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finishPicker(cancelled: true) }
    private func finishPicker(cancelled: Bool) {
        guard let call = pickerCall else { return }
        switch pickerMode { case .rom: call.resolve(["imported": false]); case .restore: call.resolve(["restored": false, "files": 0, "includesIdentity": false]); case nil: call.resolve() }
        pickerCall = nil; pickerMode = nil
    }

    private func share(url: URL, from call: CAPPluginCall, completion: @escaping () -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else { call.reject("The app is not ready to present the share sheet."); return }
            let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            activity.popoverPresentationController?.sourceView = presenter.view
            activity.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
            activity.completionWithItemsHandler = { _, completed, _, _ in completed ? completion() : call.resolve(["exported": false]) }
            presenter.present(activity, animated: true)
        }
    }

    func emulationViewControllerDidStop(_ controller: EmeraldEmulationViewController, error: Error?) {
        emulationController = nil
        if let error { notifyListeners("runtimeState", data: ["state": "failed", "message": error.localizedDescription]) }
        else { notifyListeners("runtimeState", data: ["state": "stopped", "message": "Azahar closed normally."]) }
    }

    func emulationViewController(_ controller: EmeraldEmulationViewController, didMeasureFPS fps: Double) {
        lastFPS = fps
        let thermal: String
        switch ProcessInfo.processInfo.thermalState { case .nominal: thermal = "nominal"; case .fair: thermal = "fair"; case .serious: thermal = "serious"; case .critical: thermal = "critical"; @unknown default: thermal = "unknown" }
        notifyListeners("performance", data: ["framesPerSecond": fps, "audioUnderruns": 0, "thermalState": thermal])
    }
}

final class EmeraldBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(EmeraldRuntimePlugin())
    }
}
