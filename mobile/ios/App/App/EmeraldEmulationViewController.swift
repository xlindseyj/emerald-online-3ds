import AVFoundation
import GameController
import UIKit

protocol EmeraldEmulationViewControllerDelegate: AnyObject {
    func emulationViewControllerDidStop(_ controller: EmeraldEmulationViewController, error: Error?)
    func emulationViewController(_ controller: EmeraldEmulationViewController, didMeasureFPS fps: Double)
}

private final class EmeraldScreenView: UIImageView {
    private let topScreen = UIImageView()
    private let bottomScreen = UIImageView()
    private var sourceImage: UIImage?
    private(set) var bottomScreenFrame = CGRect.zero
    var equalWidthScreens = false {
        didSet { updatePresentation(); setNeedsLayout() }
    }

    override var image: UIImage? {
        get { sourceImage }
        set { sourceImage = newValue; updatePresentation() }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        contentMode = .scaleAspectFit
        clipsToBounds = true
        for screen in [topScreen, bottomScreen] {
            screen.contentMode = .scaleToFill
            screen.clipsToBounds = true
            screen.isHidden = true
            addSubview(screen)
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func updatePresentation() {
        guard equalWidthScreens, let cgImage = sourceImage?.cgImage,
              cgImage.width * 6 == cgImage.height * 5 else {
            super.image = sourceImage
            topScreen.isHidden = true
            bottomScreen.isHidden = true
            return
        }
        let scale = CGFloat(cgImage.width) / 400
        let topRect = CGRect(x: 0, y: 0, width: 400 * scale, height: 240 * scale)
        let bottomRect = CGRect(x: 40 * scale, y: 240 * scale, width: 320 * scale, height: 240 * scale)
        guard let top = cgImage.cropping(to: topRect), let bottom = cgImage.cropping(to: bottomRect) else {
            super.image = sourceImage
            topScreen.isHidden = true
            bottomScreen.isHidden = true
            return
        }
        super.image = nil
        topScreen.image = UIImage(cgImage: top)
        bottomScreen.image = UIImage(cgImage: bottom)
        topScreen.isHidden = false
        bottomScreen.isHidden = false
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard equalWidthScreens, !topScreen.isHidden else { bottomScreenFrame = .zero; return }
        let scale = min(bounds.width / 400, bounds.height / 540)
        let width = 400 * scale
        let topHeight = 240 * scale
        let bottomHeight = 300 * scale
        let originX = (bounds.width - width) / 2
        let originY = (bounds.height - topHeight - bottomHeight) / 2
        topScreen.frame = CGRect(x: originX, y: originY, width: width, height: topHeight)
        bottomScreen.frame = CGRect(x: originX, y: originY + topHeight, width: width, height: bottomHeight)
        bottomScreenFrame = bottomScreen.frame
    }

    func normalizedTouch(at point: CGPoint) -> CGPoint? {
        if equalWidthScreens, !bottomScreenFrame.isEmpty {
            guard bottomScreenFrame.contains(point) else { return nil }
            let localX = (point.x - bottomScreenFrame.minX) / bottomScreenFrame.width
            let localY = (point.y - bottomScreenFrame.minY) / bottomScreenFrame.height
            return CGPoint(x: (40 + 320 * localX) / 400, y: (240 + 240 * localY) / 480)
        }
        guard let sourceImage else { return nil }
        let imageRatio = sourceImage.size.width / sourceImage.size.height
        let viewRatio = bounds.width / bounds.height
        let rendered: CGRect
        if imageRatio > viewRatio {
            let height = bounds.width / imageRatio
            rendered = CGRect(x: 0, y: (bounds.height - height) / 2, width: bounds.width, height: height)
        } else {
            let width = bounds.height * imageRatio
            rendered = CGRect(x: (bounds.width - width) / 2, y: 0, width: width, height: bounds.height)
        }
        guard rendered.contains(point) else { return nil }
        return CGPoint(x: (point.x - rendered.minX) / rendered.width, y: (point.y - rendered.minY) / rendered.height)
    }
}

final class EmeraldEmulationViewController: UIViewController {
    weak var delegate: EmeraldEmulationViewControllerDelegate?
    private let storage: EmeraldStorage
    private let session: EO3DSCoreSession
    private let imageView = EmeraldScreenView()
    private let controls = UIView()
    private let audioEngine = AVAudioEngine()
    private let audioPlayer = AVAudioPlayerNode()
    private let audioQueue = DispatchQueue(label: "com.emeraldonline3ds.mobile.audio", qos: .userInteractive)
    private let audioFormat = AVAudioFormat(standardFormatWithSampleRate: 32_768, channels: 2)!
    private var config: EmeraldLauncherConfig
    private var audioConfigured = false
    private var fpsTimer: Timer?
    private var stopping = false
    private var startupSeconds = 0
    private var videoReadyLogged = false
    private var audioReadyLogged = false

    init(storage: EmeraldStorage, coreURL: URL, runtimeURL: URL, config: EmeraldLauncherConfig) {
        self.storage = storage
        self.config = config
        // Azahar's LibRetro Default policy appends Azahar/sdmc to this root.
        session = EO3DSCoreSession(coreURL: coreURL, runtimeURL: runtimeURL, userRootURL: storage.appRoot)
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        imageView.contentMode = .scaleAspectFit
        imageView.equalWidthScreens = config.equalWidthScreens
        imageView.backgroundColor = UIColor(red: 0.02, green: 0.08, blue: 0.055, alpha: 1)
        imageView.isUserInteractionEnabled = true
        imageView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(imageView)
        controls.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(controls)
        NSLayoutConstraint.activate([
            imageView.leadingAnchor.constraint(equalTo: view.leadingAnchor), imageView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            imageView.topAnchor.constraint(equalTo: view.topAnchor), imageView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            controls.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor), controls.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            controls.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), controls.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])
        buildControls()
        imageView.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(handleTouch(_:))))
        imageView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(handleTouch(_:))))
        NotificationCenter.default.addObserver(self, selector: #selector(pause), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(resume), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(controllerConnected), name: .GCControllerDidConnect, object: nil)
        configureConnectedControllers()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if config.audioEnabled { configureAudio() }
        session.messageHandler = { [weak self] message in DispatchQueue.main.async { self?.showMessage(message) } }
        session.audioHandler = { [weak self] data, frames, sampleRate in self?.enqueueAudio(data: data, frames: Int(frames), sampleRate: sampleRate) }
        do {
            try storage.writeOnlineConfig(storage.readConfig())
            session.setPaused(true)
            try session.start(in: imageView)
            if config.autoSaveState && storage.autoSaveAvailable {
                do {
                    try session.loadState(from: storage.autoSaveURL)
                    storage.appendDiagnostic(event: "autosave-restored")
                    showMessage("Previous resume point restored.")
                } catch {
                    storage.removeAutoSave()
                    storage.appendDiagnostic(event: "autosave-restore-failed", fields: ["message": error.localizedDescription])
                    showMessage("The old resume point was incompatible and was removed. Your normal game save is unchanged.")
                }
            }
            session.setPaused(false)
            storage.markSessionStarted()
            storage.appendDiagnostic(event: "emulator-started", fields: ["jit": false, "audio": config.audioEnabled, "equalWidthScreens": config.equalWidthScreens, "autoSaveState": config.autoSaveState])
            fpsTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                guard let self else { return }
                self.delegate?.emulationViewController(self, didMeasureFPS: self.session.framesPerSecond)
                self.startupSeconds += 1
                if self.session.hasNonBlackVideoFrame && !self.videoReadyLogged {
                    self.videoReadyLogged = true
                    self.storage.appendDiagnostic(event: "emulator-video-ready", fields: ["seconds": self.startupSeconds, "frames": self.session.videoFramesReceived])
                } else if self.startupSeconds == 10 && self.session.videoFramesReceived == 0 {
                    self.storage.appendDiagnostic(event: "emulator-no-video-frames", fields: ["seconds": self.startupSeconds, "coreFPS": self.session.framesPerSecond])
                    self.showMessage("Azahar is still waiting for its first video frame…")
                } else if self.startupSeconds == 15 && !self.session.hasNonBlackVideoFrame {
                    self.storage.appendDiagnostic(event: "emulator-black-video", fields: ["seconds": self.startupSeconds, "frames": self.session.videoFramesReceived, "coreFPS": self.session.framesPerSecond])
                    self.showMessage("Azahar is running but has not produced a visible frame. Export diagnostics after closing.")
                }
                if self.session.audioFramesReceived > 0 && !self.audioReadyLogged {
                    self.audioReadyLogged = true
                    self.storage.appendDiagnostic(event: "emulator-audio-ready", fields: ["seconds": self.startupSeconds, "frames": self.session.audioFramesReceived])
                } else if self.startupSeconds == 10 && self.config.audioEnabled && self.session.audioFramesReceived == 0 {
                    self.storage.appendDiagnostic(event: "emulator-no-audio-frames", fields: ["seconds": self.startupSeconds])
                    self.showMessage("Azahar has not produced audio yet. Export diagnostics after closing.")
                }
            }
        } catch {
            stop(error: error)
        }
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        session.setLandscape(size.width > size.height)
        coordinator.animate(alongsideTransition: { [weak self] _ in self?.imageView.setNeedsLayout() })
    }

    private func configureAudio() {
        guard !audioConfigured else {
            audioPlayer.volume = config.audioEnabled ? 1 : 0
            if config.audioEnabled && !audioPlayer.isPlaying { audioPlayer.play() }
            return
        }
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try audioSession.setPreferredSampleRate(audioFormat.sampleRate)
            try audioSession.setPreferredIOBufferDuration(0.01)
            try audioSession.setActive(true)
            audioEngine.attach(audioPlayer)
            audioEngine.connect(audioPlayer, to: audioEngine.mainMixerNode, format: audioFormat)
            audioEngine.prepare()
            try audioEngine.start()
            audioPlayer.play()
            audioConfigured = true
            storage.appendDiagnostic(event: "audio-session-ready", fields: ["coreSampleRate": audioFormat.sampleRate, "outputSampleRate": audioSession.sampleRate])
        } catch {
            storage.appendDiagnostic(event: "audio-start-failed", fields: ["message": error.localizedDescription])
            showMessage("Audio could not start. Export diagnostics after closing.")
        }
    }

    private func enqueueAudio(data: Data, frames: Int, sampleRate: Double) {
        guard frames > 0 else { return }
        audioQueue.async { [weak self] in
            guard let self, self.config.audioEnabled,
                  let buffer = AVAudioPCMBuffer(pcmFormat: self.audioFormat, frameCapacity: AVAudioFrameCount(frames)),
                  let channels = buffer.floatChannelData else { return }
            buffer.frameLength = AVAudioFrameCount(frames)
            data.withUnsafeBytes { raw in
                let samples = raw.bindMemory(to: Int16.self)
                guard samples.count >= frames * 2 else { return }
                for frame in 0..<frames {
                    channels[0][frame] = Float(samples[frame * 2]) / 32_768
                    channels[1][frame] = Float(samples[frame * 2 + 1]) / 32_768
                }
            }
            self.audioPlayer.scheduleBuffer(buffer, completionHandler: nil)
            if !self.audioPlayer.isPlaying { self.audioPlayer.play() }
        }
    }

    private func buildControls() {
        let menu = UIButton(type: .system)
        menu.setTitle("☰ Menu", for: .normal)
        menu.setTitleColor(.white, for: .normal)
        menu.backgroundColor = UIColor.black.withAlphaComponent(0.68)
        menu.layer.cornerRadius = 10
        menu.addTarget(self, action: #selector(openMenu(_:)), for: .touchUpInside)
        menu.translatesAutoresizingMaskIntoConstraints = false
        controls.addSubview(menu)

        let dpad = UIStackView()
        dpad.axis = .vertical; dpad.spacing = 3; dpad.alignment = .center
        dpad.addArrangedSubview(holdButton("▲", 4))
        let middle = UIStackView(arrangedSubviews: [holdButton("◀", 6), holdButton("▼", 5), holdButton("▶", 7)])
        middle.spacing = 3
        dpad.addArrangedSubview(middle)
        dpad.translatesAutoresizingMaskIntoConstraints = false
        controls.addSubview(dpad)

        let face = UIStackView()
        face.axis = .vertical; face.spacing = 3; face.alignment = .center
        face.addArrangedSubview(holdButton("X", 9))
        let faceMiddle = UIStackView(arrangedSubviews: [holdButton("Y", 1), holdButton("B", 0), holdButton("A", 8)])
        faceMiddle.spacing = 3
        face.addArrangedSubview(faceMiddle)
        face.translatesAutoresizingMaskIntoConstraints = false
        controls.addSubview(face)

        let center = UIStackView(arrangedSubviews: [holdButton("Select", 2, compact: true), holdButton("Start", 3, compact: true)])
        center.spacing = 8; center.translatesAutoresizingMaskIntoConstraints = false
        controls.addSubview(center)
        let leftShoulder = holdButton("L", 10, compact: true); leftShoulder.translatesAutoresizingMaskIntoConstraints = false; controls.addSubview(leftShoulder)
        let rightShoulder = holdButton("R", 11, compact: true); rightShoulder.translatesAutoresizingMaskIntoConstraints = false; controls.addSubview(rightShoulder)

        NSLayoutConstraint.activate([
            menu.topAnchor.constraint(equalTo: controls.topAnchor, constant: 8), menu.trailingAnchor.constraint(equalTo: controls.trailingAnchor, constant: -8), menu.widthAnchor.constraint(equalToConstant: 88), menu.heightAnchor.constraint(equalToConstant: 38),
            leftShoulder.topAnchor.constraint(equalTo: controls.topAnchor, constant: 8), leftShoulder.leadingAnchor.constraint(equalTo: controls.leadingAnchor, constant: 8),
            rightShoulder.topAnchor.constraint(equalTo: controls.topAnchor, constant: 8), rightShoulder.trailingAnchor.constraint(equalTo: menu.leadingAnchor, constant: -8),
            dpad.leadingAnchor.constraint(equalTo: controls.leadingAnchor, constant: 10), dpad.bottomAnchor.constraint(equalTo: controls.bottomAnchor, constant: -10),
            face.trailingAnchor.constraint(equalTo: controls.trailingAnchor, constant: -10), face.bottomAnchor.constraint(equalTo: controls.bottomAnchor, constant: -10),
            center.centerXAnchor.constraint(equalTo: controls.centerXAnchor), center.bottomAnchor.constraint(equalTo: controls.bottomAnchor, constant: -12)
        ])
    }

    private func holdButton(_ title: String, _ button: Int, compact: Bool = false) -> UIButton {
        let control = UIButton(type: .system)
        control.setTitle(title, for: .normal)
        control.setTitleColor(.white, for: .normal)
        control.backgroundColor = UIColor.black.withAlphaComponent(0.5)
        control.layer.borderColor = UIColor(red: 0, green: 0.66, blue: 0.42, alpha: 0.65).cgColor
        control.layer.borderWidth = 1
        control.layer.cornerRadius = compact ? 10 : 24
        control.widthAnchor.constraint(equalToConstant: compact ? 58 : 48).isActive = true
        control.heightAnchor.constraint(equalToConstant: compact ? 36 : 48).isActive = true
        control.accessibilityIdentifier = "libretro-button-\(button)"
        control.addAction(UIAction { [weak self] _ in self?.session.setButton(button, pressed: true) }, for: .touchDown)
        for event in [UIControl.Event.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit] {
            control.addAction(UIAction { [weak self] _ in self?.session.setButton(button, pressed: false) }, for: event)
        }
        return control
    }

    @objc private func handleTouch(_ recognizer: UIGestureRecognizer) {
        let point = recognizer.location(in: imageView)
        guard let normalized = imageView.normalizedTouch(at: point) else {
            session.setTouchX(0, y: 0, pressed: false)
            return
        }
        let x = min(1, max(0, normalized.x))
        let y = min(1, max(0, normalized.y))
        let pressed = recognizer.state == .began || recognizer.state == .changed
        session.setTouchX(x, y: y, pressed: pressed)
        if recognizer.state == .ended || recognizer.state == .cancelled { session.setTouchX(x, y: y, pressed: false) }
    }

    @objc private func controllerConnected() { configureConnectedControllers() }
    private func configureConnectedControllers() {
        for controller in GCController.controllers() {
            guard let gamepad = controller.extendedGamepad else { continue }
            let bind: (GCControllerButtonInput, Int) -> Void = { [weak self] input, button in input.pressedChangedHandler = { _, _, pressed in self?.session.setButton(button, pressed: pressed) } }
            bind(gamepad.buttonA, 8); bind(gamepad.buttonB, 0); bind(gamepad.buttonX, 9); bind(gamepad.buttonY, 1)
            bind(gamepad.leftShoulder, 10); bind(gamepad.rightShoulder, 11); bind(gamepad.buttonMenu, 3); bind(gamepad.buttonOptions ?? gamepad.buttonMenu, 2)
            bind(gamepad.dpad.up, 4); bind(gamepad.dpad.down, 5); bind(gamepad.dpad.left, 6); bind(gamepad.dpad.right, 7)
        }
    }

    private func showMessage(_ message: String) {
        let label = UILabel()
        label.text = message; label.textColor = .white; label.backgroundColor = UIColor.black.withAlphaComponent(0.78); label.numberOfLines = 0; label.textAlignment = .center; label.layer.cornerRadius = 10; label.clipsToBounds = true
        label.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(label)
        NSLayoutConstraint.activate([label.centerXAnchor.constraint(equalTo: view.centerXAnchor), label.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 54), label.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, multiplier: 0.82)])
        UIView.animate(withDuration: 0.25, delay: 3, options: [], animations: { label.alpha = 0 }, completion: { _ in label.removeFromSuperview() })
    }

    private func persistPreferences() {
        do { config = try storage.saveConfig(config) }
        catch { storage.appendDiagnostic(event: "settings-save-failed", fields: ["message": error.localizedDescription]) }
    }

    private func resumeEmulation() {
        session.setPaused(false)
        if config.audioEnabled {
            configureAudio()
            audioPlayer.volume = 1
            if !audioPlayer.isPlaying { audioPlayer.play() }
        }
    }

    private func saveResumePoint(manual: Bool) {
        do {
            try session.saveState(to: storage.autoSaveURL)
            storage.appendDiagnostic(event: manual ? "autosave-created-manually" : "autosave-created")
            if manual { showMessage("Resume point saved. Keep using Emerald's normal in-game save too.") }
        } catch {
            storage.appendDiagnostic(event: "autosave-create-failed", fields: ["message": error.localizedDescription])
            if manual { showMessage("Could not create a resume point. Your normal game save is unchanged.") }
        }
    }

    @objc private func openMenu(_ sender: UIButton) {
        session.setPaused(true)
        audioPlayer.pause()
        let menu = UIAlertController(title: "Emerald Online 3DS", message: "Game paused", preferredStyle: .actionSheet)
        menu.addAction(UIAlertAction(title: "Resume", style: .cancel) { [weak self] _ in self?.resumeEmulation() })
        menu.addAction(UIAlertAction(title: config.equalWidthScreens ? "Use native-width stacked screens" : "Make both screens equal width", style: .default) { [weak self] _ in
            guard let self else { return }
            self.config.equalWidthScreens.toggle()
            self.imageView.equalWidthScreens = self.config.equalWidthScreens
            self.persistPreferences()
            self.resumeEmulation()
        })
        menu.addAction(UIAlertAction(title: config.audioEnabled ? "Mute audio" : "Enable audio", style: .default) { [weak self] _ in
            guard let self else { return }
            self.config.audioEnabled.toggle()
            self.persistPreferences()
            if self.config.audioEnabled { self.configureAudio() }
            else { self.audioPlayer.volume = 0; self.audioPlayer.pause() }
            self.resumeEmulation()
        })
        menu.addAction(UIAlertAction(title: "Save Resume Point", style: .default) { [weak self] _ in
            self?.saveResumePoint(manual: true)
            self?.resumeEmulation()
        })
        if storage.autoSaveAvailable {
            menu.addAction(UIAlertAction(title: "Delete Resume Point", style: .destructive) { [weak self] _ in
                self?.storage.removeAutoSave()
                self?.showMessage("Resume point deleted. Your normal game save is unchanged.")
                self?.resumeEmulation()
            })
        }
        menu.addAction(UIAlertAction(title: "Restart to Game Title", style: .destructive) { [weak self] _ in
            guard let self else { return }
            self.storage.removeAutoSave()
            self.session.resetGame()
            self.resumeEmulation()
        })
        menu.addAction(UIAlertAction(title: "Exit to Launcher", style: .destructive) { [weak self] _ in self?.stop(error: nil) })
        menu.popoverPresentationController?.sourceView = sender
        menu.popoverPresentationController?.sourceRect = sender.bounds
        present(menu, animated: true)
    }

    @objc private func pause() {
        session.setPaused(true)
        audioPlayer.pause()
        guard config.autoSaveState, session.isRunning else { return }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in self?.saveResumePoint(manual: false) }
    }
    @objc private func resume() { if session.isRunning { resumeEmulation() } }

    func requestStop() { stop(error: nil) }

    private func stop(error: Error?) {
        guard !stopping else { return }
        stopping = true
        fpsTimer?.invalidate()
        if error == nil && config.autoSaveState && session.isRunning { saveResumePoint(manual: false) }
        session.stop()
        audioPlayer.stop(); audioEngine.stop(); try? AVAudioSession.sharedInstance().setActive(false)
        storage.markSessionClean()
        storage.appendDiagnostic(event: error == nil ? "emulator-stopped" : "emulator-failed", fields: error.map { ["message": $0.localizedDescription] } ?? [:])
        dismiss(animated: true) { [weak self] in guard let self else { return }; self.delegate?.emulationViewControllerDidStop(self, error: error) }
    }

    deinit { NotificationCenter.default.removeObserver(self); session.stop() }
}
