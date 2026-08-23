import AVFoundation
import GameController
import UIKit

protocol EmeraldEmulationViewControllerDelegate: AnyObject {
    func emulationViewControllerDidStop(_ controller: EmeraldEmulationViewController, error: Error?)
    func emulationViewController(_ controller: EmeraldEmulationViewController, didMeasureFPS fps: Double)
}

final class EmeraldEmulationViewController: UIViewController {
    weak var delegate: EmeraldEmulationViewControllerDelegate?
    private let storage: EmeraldStorage
    private let session: EO3DSCoreSession
    private let imageView = UIImageView()
    private let controls = UIView()
    private let audioEngine = AVAudioEngine()
    private let audioPlayer = AVAudioPlayerNode()
    private let audioQueue = DispatchQueue(label: "com.emeraldonline3ds.mobile.audio", qos: .userInteractive)
    private var fpsTimer: Timer?
    private var stopping = false
    private var startupSeconds = 0
    private var videoReadyLogged = false

    init(storage: EmeraldStorage, coreURL: URL, runtimeURL: URL) {
        self.storage = storage
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
        configureAudio()
        session.messageHandler = { [weak self] message in DispatchQueue.main.async { self?.showMessage(message) } }
        session.audioHandler = { [weak self] data, frames, sampleRate in self?.enqueueAudio(data: data, frames: Int(frames), sampleRate: sampleRate) }
        do {
            try storage.writeOnlineConfig(storage.readConfig())
            try session.start(in: imageView)
            storage.markSessionStarted()
            storage.appendDiagnostic(event: "emulator-started", fields: ["jit": false])
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
            }
        } catch {
            stop(error: error)
        }
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        session.setLandscape(size.width > size.height)
    }

    private func configureAudio() {
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playback, mode: .gameChat, options: [.mixWithOthers])
            try audioSession.setActive(true)
            audioEngine.attach(audioPlayer)
            audioEngine.connect(audioPlayer, to: audioEngine.mainMixerNode, format: nil)
            try audioEngine.start()
            audioPlayer.play()
        } catch {
            storage.appendDiagnostic(event: "audio-start-failed", fields: ["message": error.localizedDescription])
        }
    }

    private func enqueueAudio(data: Data, frames: Int, sampleRate: Double) {
        guard frames > 0, let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 2, interleaved: false),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)), let channels = buffer.floatChannelData else { return }
        buffer.frameLength = AVAudioFrameCount(frames)
        data.withUnsafeBytes { raw in
            let samples = raw.bindMemory(to: Int16.self)
            for frame in 0..<frames {
                channels[0][frame] = Float(samples[frame * 2]) / Float(Int16.max)
                channels[1][frame] = Float(samples[frame * 2 + 1]) / Float(Int16.max)
            }
        }
        audioQueue.async { [weak self] in self?.audioPlayer.scheduleBuffer(buffer, completionHandler: nil) }
    }

    private func buildControls() {
        let close = UIButton(type: .system)
        close.setTitle("Done", for: .normal)
        close.setTitleColor(.white, for: .normal)
        close.backgroundColor = UIColor.black.withAlphaComponent(0.55)
        close.layer.cornerRadius = 10
        close.addTarget(self, action: #selector(done), for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false
        controls.addSubview(close)

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
            close.topAnchor.constraint(equalTo: controls.topAnchor, constant: 8), close.trailingAnchor.constraint(equalTo: controls.trailingAnchor, constant: -8), close.widthAnchor.constraint(equalToConstant: 64), close.heightAnchor.constraint(equalToConstant: 38),
            leftShoulder.topAnchor.constraint(equalTo: controls.topAnchor, constant: 8), leftShoulder.leadingAnchor.constraint(equalTo: controls.leadingAnchor, constant: 8),
            rightShoulder.topAnchor.constraint(equalTo: controls.topAnchor, constant: 8), rightShoulder.trailingAnchor.constraint(equalTo: close.leadingAnchor, constant: -8),
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
        guard let image = imageView.image else { return }
        let point = recognizer.location(in: imageView)
        let imageRatio = image.size.width / image.size.height
        let viewRatio = imageView.bounds.width / imageView.bounds.height
        let rendered: CGRect
        if imageRatio > viewRatio {
            let height = imageView.bounds.width / imageRatio
            rendered = CGRect(x: 0, y: (imageView.bounds.height - height) / 2, width: imageView.bounds.width, height: height)
        } else {
            let width = imageView.bounds.height * imageRatio
            rendered = CGRect(x: (imageView.bounds.width - width) / 2, y: 0, width: width, height: imageView.bounds.height)
        }
        let x = min(1, max(0, (point.x - rendered.minX) / rendered.width))
        let y = min(1, max(0, (point.y - rendered.minY) / rendered.height))
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

    @objc private func pause() { session.setPaused(true); audioPlayer.pause() }
    @objc private func resume() { if session.isRunning { session.setPaused(false); audioPlayer.play() } }
    @objc private func done() { stop(error: nil) }

    func requestStop() { stop(error: nil) }

    private func stop(error: Error?) {
        guard !stopping else { return }
        stopping = true
        fpsTimer?.invalidate()
        session.stop()
        audioPlayer.stop(); audioEngine.stop(); try? AVAudioSession.sharedInstance().setActive(false)
        storage.markSessionClean()
        storage.appendDiagnostic(event: error == nil ? "emulator-stopped" : "emulator-failed", fields: error.map { ["message": $0.localizedDescription] } ?? [:])
        dismiss(animated: true) { [weak self] in guard let self else { return }; self.delegate?.emulationViewControllerDidStop(self, error: error) }
    }

    deinit { NotificationCenter.default.removeObserver(self); session.stop() }
}
