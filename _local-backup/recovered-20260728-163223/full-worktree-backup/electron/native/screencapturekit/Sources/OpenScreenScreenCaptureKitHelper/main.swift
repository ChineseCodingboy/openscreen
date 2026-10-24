import AVFoundation
import CoreGraphics
import CoreMedia
import Foundation
import ImageIO
import ScreenCaptureKit

struct Rectangle: Decodable {
	let x: Double
	let y: Double
	let width: Double
	let height: Double
}

struct RecordingRequest: Decodable {
	struct Source: Decodable {
		let type: String
		let sourceId: String
		let displayId: UInt32?
		let windowId: UInt32?
		let bounds: Rectangle?
	}

	struct Video: Decodable {
		let fps: Int
		let width: Int
		let height: Int
		let bitrate: Int?
		let hideSystemCursor: Bool
	}

	struct Audio: Decodable {
		struct SystemAudio: Decodable { let enabled: Bool }
		struct Microphone: Decodable {
			let enabled: Bool
			let deviceId: String?
			let deviceName: String?
			let gain: Double
		}

		let system: SystemAudio
		let microphone: Microphone
	}

	struct Webcam: Decodable {
		let enabled: Bool
		let deviceId: String?
		let deviceName: String?
		let width: Int
		let height: Int
		let fps: Int
	}

	struct Cursor: Decodable { let mode: String }
	struct Outputs: Decodable {
		let screenPath: String
		let manifestPath: String?
	}

	let schemaVersion: Int?
	let recordingId: Int?
	let source: Source
	let video: Video
	let audio: Audio
	let webcam: Webcam
	let cursor: Cursor
	let outputs: Outputs
}

enum HelperError: Error, CustomStringConvertible {
	case invalidArguments
	case unsupportedMacOS
	case sourceNotFound(String)
	case invalidSourceType(String)
	case permissionDenied(String)
	case recordingSetupFailed(String)
	case recordingFailed(String)

	var description: String {
		switch self {
		case .invalidArguments:
			return "Expected one JSON recording request argument."
		case .unsupportedMacOS:
			return "OpenScreen recording requires macOS 15 or newer."
		case .sourceNotFound(let message), .permissionDenied(let message),
			.recordingSetupFailed(let message), .recordingFailed(let message):
			return message
		case .invalidSourceType(let sourceType):
			return "Unsupported source type: \(sourceType)."
		}
	}
}

func emit(_ fields: [String: Any]) {
	if let data = try? JSONSerialization.data(withJSONObject: fields),
		let line = String(data: data, encoding: .utf8)
	{
		print(line)
		fflush(stdout)
	}
}

func emitError(code: String, message: String) {
	emit(["event": "error", "code": code, "message": message])
}

@available(macOS 15.0, *)
final class ScreenCaptureRecorder: NSObject, SCStreamDelegate, SCRecordingOutputDelegate {
	private struct CaptureTarget {
		let filter: SCContentFilter
		let width: Int
		let height: Int
	}

	private let request: RecordingRequest
	private let stateQueue = DispatchQueue(label: "app.openscreen.sck-helper.state")
	private var stream: SCStream?
	private var recordingOutput: SCRecordingOutput?
	private var segmentURLs: [URL] = []
	private var finishedOutputIds = Set<ObjectIdentifier>()
	private var failedOutputMessages: [ObjectIdentifier: String] = [:]
	private var pendingResumeOutputId: ObjectIdentifier?
	private var didEmitRecordingStarted = false
	private var isStopping = false
	private var isPaused = false
	private var outputWidth = 1920
	private var outputHeight = 1080

	init(request: RecordingRequest) {
		self.request = request
	}

	func start() async throws {
		try ensureRequestedPermissions()
		// onScreenWindowsOnly must stay false so windows living on other Spaces
		// (e.g. full-screen Chrome/Terminal) resolve by id; the desktop-independent
		// window filter records them regardless of the active Space.
		let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
		let target = try makeCaptureTarget(from: content)
		outputWidth = target.width
		outputHeight = target.height

		let stream = SCStream(
			filter: target.filter,
			configuration: makeStreamConfiguration(),
			delegate: self
		)
		self.stream = stream
		try prepareOutputDirectory()
		try startNewSegment(on: stream, isResume: false)
		emit(["event": "ready", "schemaVersion": 2])
		try await stream.startCapture()
	}

	func pause() async {
		let shouldPause = stateQueue.sync {
			guard !isStopping, !isPaused else { return false }
			isPaused = true
			return true
		}
		guard shouldPause else { return }
		// Removing the recording output defines the media boundary. Finalizing the segment can
		// take noticeably longer, so retain this timestamp instead of emitting Date() afterwards.
		let boundaryTimestampMs = Int(Date().timeIntervalSince1970 * 1000)

		do {
			try await finishActiveSegment()
			emit([
				"event": "recording-paused",
				"timestampMs": boundaryTimestampMs,
			])
		} catch {
			stateQueue.sync { isPaused = false }
			emitError(code: "pause-failed", message: "Unable to finish the current recording segment: \(error)")
		}
	}

	func resume() async {
		let shouldResume = stateQueue.sync {
			guard !isStopping, isPaused else { return false }
			isPaused = false
			return true
		}
		guard shouldResume, let stream else { return }

		do {
			try startNewSegment(on: stream, isResume: true)
		} catch {
			stateQueue.sync { isPaused = true }
			emitError(code: "resume-failed", message: "Unable to start a new recording segment: \(error)")
		}
	}

	func stop() async {
		let shouldStop = stateQueue.sync {
			guard !isStopping else { return false }
			isStopping = true
			return true
		}
		guard shouldStop else { return }
		let boundaryTimestampMs = Int(Date().timeIntervalSince1970 * 1000)

		do {
			if recordingOutput != nil {
				try await finishActiveSegment()
			}
			try await stream?.stopCapture()
			try await finalizeSegments()
			let diagnostics = await writeDiagnostics()
			let audioTracks = await inspectRecordedAudioTracks()
			emit(diagnostics.merging([
				"event": "recording-diagnostics",
				"segmentCount": segmentURLs.count,
			]) { _, new in new })
				emit([
					"event": "recording-stopped",
					"screenPath": request.outputs.screenPath,
					"timestampMs": boundaryTimestampMs,
					"audioTracks": audioTracks,
			])
		} catch {
			do { try await stream?.stopCapture() } catch { }
			cleanupSegments()
			emitError(code: "recording-finalize-failed", message: "Unable to finalize recording: \(error)")
		}
	}

	func stream(_ stream: SCStream, didStopWithError error: Error) {
		emitError(code: "capture-stopped-with-error", message: "\(error)")
		Task { await stop() }
	}

	func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
		let outputId = ObjectIdentifier(recordingOutput)
		let event = stateQueue.sync { () -> String? in
			if pendingResumeOutputId == outputId {
				pendingResumeOutputId = nil
				return "recording-resumed"
			}
			if !didEmitRecordingStarted {
				didEmitRecordingStarted = true
				return "recording-started"
			}
			return nil
		}
		guard let event else { return }
		emit([
			"event": event,
			"timestampMs": Int(Date().timeIntervalSince1970 * 1000),
			"width": outputWidth,
			"height": outputHeight,
		])
	}

	func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
		let outputId = ObjectIdentifier(recordingOutput)
		stateQueue.sync { failedOutputMessages[outputId] = "\(error)" }
		emitError(code: "recording-output-failed", message: "System recording output failed: \(error)")
	}

	func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
		_ = stateQueue.sync { finishedOutputIds.insert(ObjectIdentifier(recordingOutput)) }
	}

	private func prepareOutputDirectory() throws {
		let outputURL = URL(fileURLWithPath: request.outputs.screenPath)
		try FileManager.default.createDirectory(
			at: outputURL.deletingLastPathComponent(),
			withIntermediateDirectories: true
		)
		try? FileManager.default.removeItem(at: outputURL)
		cleanupSegments()
	}

	private func startNewSegment(on stream: SCStream, isResume: Bool) throws {
		let outputURL = URL(fileURLWithPath: request.outputs.screenPath)
		let baseName = outputURL.deletingPathExtension().lastPathComponent
		let segmentURL = outputURL.deletingLastPathComponent()
			.appendingPathComponent(".\(baseName).segment-\(String(format: "%03d", segmentURLs.count)).mp4")
		try? FileManager.default.removeItem(at: segmentURL)

		let configuration = SCRecordingOutputConfiguration()
		configuration.outputURL = segmentURL
		configuration.outputFileType = .mp4
		configuration.videoCodecType = .h264
		let output = SCRecordingOutput(configuration: configuration, delegate: self)
		try stream.addRecordingOutput(output)
		segmentURLs.append(segmentURL)
		recordingOutput = output
		if isResume {
			stateQueue.sync { pendingResumeOutputId = ObjectIdentifier(output) }
		}
	}

	private func finishActiveSegment() async throws {
		guard let stream, let output = recordingOutput else { return }
		let outputId = ObjectIdentifier(output)
		try stream.removeRecordingOutput(output)

		let deadline = Date().addingTimeInterval(30)
		while Date() < deadline {
			let status = stateQueue.sync {
				(finishedOutputIds.contains(outputId), failedOutputMessages[outputId])
			}
			if let failure = status.1 {
				throw HelperError.recordingFailed(failure)
			}
			if status.0 {
				recordingOutput = nil
				return
			}
			try await Task.sleep(nanoseconds: 10_000_000)
		}
		throw HelperError.recordingFailed("Timed out while finishing a recording segment.")
	}

	private func finalizeSegments() async throws {
		guard !segmentURLs.isEmpty else {
			throw HelperError.recordingFailed("No recording segments were produced.")
		}
		let finalURL = URL(fileURLWithPath: request.outputs.screenPath)
		try? FileManager.default.removeItem(at: finalURL)

		if segmentURLs.count == 1 {
			try FileManager.default.moveItem(at: segmentURLs[0], to: finalURL)
			return
		}

		let composition = AVMutableComposition()
		var videoTracks: [AVMutableCompositionTrack] = []
		var audioTracks: [AVMutableCompositionTrack] = []
		var insertionTime = CMTime.zero

		for segmentURL in segmentURLs {
			let asset = AVURLAsset(url: segmentURL)
			let duration = try await asset.load(.duration)
			let sourceRange = CMTimeRange(start: .zero, duration: duration)
			let sourceVideoTracks = try await asset.loadTracks(withMediaType: .video)
			let sourceAudioTracks = try await asset.loadTracks(withMediaType: .audio)

			for (index, sourceTrack) in sourceVideoTracks.enumerated() {
				while videoTracks.count <= index {
					guard let track = composition.addMutableTrack(
						withMediaType: .video,
						preferredTrackID: kCMPersistentTrackID_Invalid
					) else { throw HelperError.recordingFailed("Unable to create a video composition track.") }
					videoTracks.append(track)
				}
				try videoTracks[index].insertTimeRange(sourceRange, of: sourceTrack, at: insertionTime)
			}

			for (index, sourceTrack) in sourceAudioTracks.enumerated() {
				while audioTracks.count <= index {
					guard let track = composition.addMutableTrack(
						withMediaType: .audio,
						preferredTrackID: kCMPersistentTrackID_Invalid
					) else { throw HelperError.recordingFailed("Unable to create an audio composition track.") }
					audioTracks.append(track)
				}
				try audioTracks[index].insertTimeRange(sourceRange, of: sourceTrack, at: insertionTime)
			}
			insertionTime = CMTimeAdd(insertionTime, duration)
		}

		guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough) else {
			throw HelperError.recordingFailed("Unable to create the lossless segment exporter.")
		}
		try await exporter.export(to: finalURL, as: .mp4)
		cleanupSegments()
	}

	private func writeDiagnostics() async -> [String: Any] {
		let outputURL = URL(fileURLWithPath: request.outputs.screenPath)
		var values: [String: Any] = [
			"actualFrameRate": 0.0,
			"maxVideoFrameGapMs": 0.0,
			"maxAudioPacketGapMs": 0.0,
			"durationDeltaMs": 0.0,
		]
		do {
			let asset = AVURLAsset(url: outputURL)
			let video = try await timingStats(asset: asset, mediaType: .video)
			let audio = try await timingStats(asset: asset, mediaType: .audio)
			values["audioTrackCount"] = try await asset.loadTracks(withMediaType: .audio).count
			values["actualFrameRate"] = video.rate
			values["maxVideoFrameGapMs"] = video.maxGapMs
			values["maxAudioPacketGapMs"] = audio.maxGapMs
			values["durationDeltaMs"] = abs(video.durationMs - audio.durationMs)
			values["warning"] = video.maxGapMs > 67 || audio.maxGapMs > 50 || abs(video.durationMs - audio.durationMs) > 50
			values["outputBytes"] = (try? outputURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
		} catch {
			values["diagnosticsError"] = "\(error)"
		}

		if JSONSerialization.isValidJSONObject(values),
			let data = try? JSONSerialization.data(withJSONObject: values, options: [.prettyPrinted])
		{
			try? data.write(to: URL(fileURLWithPath: request.outputs.screenPath + ".diagnostics.json"), options: .atomic)
		}
		return values
	}

	private func inspectRecordedAudioTracks() async -> [[String: Any]] {
		let asset = AVURLAsset(url: URL(fileURLWithPath: request.outputs.screenPath))
		guard let tracks = try? await asset.loadTracks(withMediaType: .audio), !tracks.isEmpty else {
			return []
		}
		let systemEnabled = request.audio.system.enabled
		let microphoneEnabled = request.audio.microphone.enabled
		return tracks.indices.map { ordinal in
			let role: String
			if tracks.count == 1 && systemEnabled && microphoneEnabled {
				role = "mixed"
			} else if systemEnabled && ordinal == 0 {
				role = "system"
			} else if microphoneEnabled && ordinal == (systemEnabled ? 1 : 0) {
				role = "microphone"
			} else {
				role = "unknown"
			}
			return ["ordinal": ordinal, "role": role]
		}
	}

	private func timingStats(asset: AVAsset, mediaType: AVMediaType) async throws -> (rate: Double, maxGapMs: Double, durationMs: Double) {
		let tracks = try await asset.loadTracks(withMediaType: mediaType)
		var sampleCount = 0
		var maximumGap = 0.0
		var maximumDuration = 0.0

		for track in tracks {
			let reader = try AVAssetReader(asset: asset)
			let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
			output.alwaysCopiesSampleData = false
			guard reader.canAdd(output) else { continue }
			reader.add(output)
			guard reader.startReading() else { continue }
			var previousTime: Double?
			while let sample = output.copyNextSampleBuffer() {
				let time = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
				if time.isFinite {
					if let previousTime { maximumGap = max(maximumGap, time - previousTime) }
					previousTime = time
					sampleCount += 1
				}
			}
			let timeRange = try await track.load(.timeRange)
			maximumDuration = max(maximumDuration, CMTimeGetSeconds(timeRange.duration))
		}

		return (
			rate: maximumDuration > 0 ? Double(sampleCount) / maximumDuration : 0,
			maxGapMs: maximumGap * 1000,
			durationMs: maximumDuration * 1000
		)
	}

	private func cleanupSegments() {
		for url in segmentURLs { try? FileManager.default.removeItem(at: url) }
		let finalURL = URL(fileURLWithPath: request.outputs.screenPath)
		let directory = finalURL.deletingLastPathComponent()
		let baseName = finalURL.deletingPathExtension().lastPathComponent
		if let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
			for file in files where file.lastPathComponent.hasPrefix(".\(baseName).segment-") {
				try? FileManager.default.removeItem(at: file)
			}
		}
	}

	private func ensureRequestedPermissions() throws {
		if !CGPreflightScreenCaptureAccess(), !CGRequestScreenCaptureAccess() {
			throw HelperError.permissionDenied("Screen recording permission is required for ScreenCaptureKit capture.")
		}
		if request.audio.microphone.enabled {
			switch AVCaptureDevice.authorizationStatus(for: .audio) {
			case .authorized:
				break
			case .notDetermined:
				let semaphore = DispatchSemaphore(value: 0)
				AVCaptureDevice.requestAccess(for: .audio) { _ in semaphore.signal() }
				if semaphore.wait(timeout: .now() + 30) == .timedOut ||
					AVCaptureDevice.authorizationStatus(for: .audio) != .authorized
				{
					throw HelperError.permissionDenied("Microphone permission is required for native microphone capture.")
				}
			default:
				throw HelperError.permissionDenied("Microphone permission is required for native microphone capture.")
			}
		}
	}

	private func makeCaptureTarget(from content: SCShareableContent) throws -> CaptureTarget {
		switch request.source.type {
		case "display":
			guard let displayId = request.source.displayId,
				let display = content.displays.first(where: { $0.displayID == displayId })
			else { throw HelperError.sourceNotFound("No ScreenCaptureKit display found for the requested id.") }
			return CaptureTarget(
				filter: SCContentFilter(display: display, excludingWindows: []),
				width: clampCaptureDimension(Int(CGDisplayPixelsWide(display.displayID)), fallback: request.video.width),
				height: clampCaptureDimension(Int(CGDisplayPixelsHigh(display.displayID)), fallback: request.video.height)
			)
		case "window":
			guard let windowId = request.source.windowId,
				let window = content.windows.first(where: { $0.windowID == windowId })
			else { throw HelperError.sourceNotFound("No ScreenCaptureKit window found for the requested id.") }
			let candidateDisplay = content.displays.first {
				$0.frame.intersects(window.frame) || $0.frame.contains(CGPoint(x: window.frame.midX, y: window.frame.midY))
			}
			let scaleFactor = Self.scaleFactor(for: candidateDisplay?.displayID ?? CGMainDisplayID())
			return CaptureTarget(
				filter: SCContentFilter(desktopIndependentWindow: window),
				width: clampCaptureDimension(Int(window.frame.width) * scaleFactor, fallback: request.video.width),
				height: clampCaptureDimension(Int(window.frame.height) * scaleFactor, fallback: request.video.height)
			)
		default:
			throw HelperError.invalidSourceType(request.source.type)
		}
	}

	private func makeStreamConfiguration() -> SCStreamConfiguration {
		let configuration = SCStreamConfiguration()
		configuration.width = outputWidth
		configuration.height = outputHeight
		configuration.minimumFrameInterval = CMTime(
			value: 1,
			timescale: CMTimeScale(min(max(request.video.fps, 1), 120))
		)
		configuration.queueDepth = 8
		configuration.showsCursor = !request.video.hideSystemCursor
		// Frames go straight into SCRecordingOutput's H.264 encoder, whose output
		// is 4:2:0 regardless of the capture format. Capturing biplanar 4:2:0
		// (VideoToolbox's native input) instead of BGRA halves the memory
		// bandwidth per frame, which is what starves capture into dropping
		// frames at Retina resolutions under load.
		configuration.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
		configuration.sampleRate = 48_000
		configuration.channelCount = 2
		configuration.excludesCurrentProcessAudio = true
		configuration.capturesAudio = request.audio.system.enabled
		configuration.captureMicrophone = request.audio.microphone.enabled
		if let deviceId = resolveMicrophoneCaptureDeviceID() {
			configuration.microphoneCaptureDeviceID = deviceId
		}
		return configuration
	}

	private func resolveMicrophoneCaptureDeviceID() -> String? {
		let devices = AVCaptureDevice.devices(for: .audio)
		if let name = request.audio.microphone.deviceName?.trimmingCharacters(in: .whitespacesAndNewlines),
			let device = devices.first(where: { $0.localizedName == name })
		{ return device.uniqueID }
		if let id = request.audio.microphone.deviceId,
			devices.contains(where: { $0.uniqueID == id })
		{ return id }
		return nil
	}

	private func clampCaptureDimension(_ value: Int, fallback: Int) -> Int {
		let requested = max(2, fallback)
		let clamped = min(value > 0 ? value : requested, requested)
		return max(2, clamped - clamped % 2)
	}

	private static func scaleFactor(for displayId: CGDirectDisplayID) -> Int {
		guard let mode = CGDisplayCopyDisplayMode(displayId) else { return 1 }
		return max(1, mode.pixelWidth / max(1, mode.width))
	}
}

/// Captures a window thumbnail PNG, giving up after `timeoutSeconds`:
/// SCScreenshotManager.captureImage never returns for some off-screen windows
/// (observed with Stage Manager), and one hung capture must not stall the list.
@available(macOS 15.0, *)
func captureWindowThumbnail(
	window: SCWindow,
	directory: String,
	timeoutSeconds: Double
) async -> String? {
	let frame = window.frame
	let configuration = SCStreamConfiguration()
	let targetWidth = 1280.0
	let scale = min(2.0, targetWidth / max(1, frame.width))
	configuration.width = max(2, Int(frame.width * scale))
	configuration.height = max(2, Int(frame.height * scale))
	configuration.showsCursor = false
	let filter = SCContentFilter(desktopIndependentWindow: window)

	// Race the capture against a deadline using unstructured tasks: captureImage
	// ignores cancellation, so a task group would keep awaiting the hung child.
	// The losing task is simply abandoned; the helper exits right after emitting.
	let image: CGImage? = await withCheckedContinuation { continuation in
		let lock = NSLock()
		var resumed = false
		let resumeOnce: (CGImage?) -> Void = { result in
			lock.lock()
			let shouldResume = !resumed
			resumed = true
			lock.unlock()
			if shouldResume { continuation.resume(returning: result) }
		}
		Task {
			let captured = try? await SCScreenshotManager.captureImage(
				contentFilter: filter, configuration: configuration)
			resumeOnce(captured)
		}
		Task {
			try? await Task.sleep(nanoseconds: UInt64(timeoutSeconds * 1_000_000_000))
			resumeOnce(nil)
		}
	}
	guard let image else { return nil }

	let url = URL(fileURLWithPath: directory)
		.appendingPathComponent("window-\(window.windowID).png")
	guard
		let destination = CGImageDestinationCreateWithURL(
			url as CFURL, "public.png" as CFString, 1, nil)
	else { return nil }
	CGImageDestinationAddImage(destination, image, nil)
	return CGImageDestinationFinalize(destination) ? url.path : nil
}

/// Enumerates shareable windows across ALL Spaces (including full-screen apps that
/// Electron's desktopCapturer misses) and optionally writes PNG thumbnails.
@available(macOS 15.0, *)
func listShareableWindows(thumbnailDirectory: String?) async throws {
	// Force CoreGraphics to connect to the window server before any SCK/CG call runs
	// on a background executor. Without this the first CGS call from a concurrent
	// thread trips "Assertion failed: (did_initialize), CGS_REQUIRE_INIT" when the
	// helper is spawned by the app (the recording path initializes CG via its own
	// display queries first, which is why it never hit this).
	_ = CGMainDisplayID()
	let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
	var results: [[String: Any]] = []
	var listedWindows: [SCWindow] = []
	for window in content.windows {
		guard window.windowLayer == 0 else { continue }
		let frame = window.frame
		guard frame.width >= 120, frame.height >= 90 else { continue }
		let title = (window.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		let appName = window.owningApplication?.applicationName ?? ""
		let bundleId = window.owningApplication?.bundleIdentifier ?? ""
		guard !title.isEmpty || !appName.isEmpty else { continue }

		results.append([
			"windowId": window.windowID,
			"title": title,
			"appName": appName,
			"bundleId": bundleId,
			"isOnScreen": window.isOnScreen,
			"frame": [
				"x": frame.origin.x,
				"y": frame.origin.y,
				"width": frame.width,
				"height": frame.height,
			],
		])
		listedWindows.append(window)
	}

	// Screenshot only windows that are not on the current Space: those are the only
	// entries the renderer appends (on-screen windows already come from
	// desktopCapturer with thumbnails and get deduplicated by windowId). Captures run
	// concurrently with a per-window timeout so the whole list stays fast.
	if let directory = thumbnailDirectory {
		let thumbnailPaths = await withTaskGroup(
			of: (CGWindowID, String?).self
		) { group -> [CGWindowID: String] in
			for window in listedWindows where !window.isOnScreen {
				group.addTask {
					(
						window.windowID,
						await captureWindowThumbnail(
							window: window, directory: directory, timeoutSeconds: 2.0)
					)
				}
			}
			var paths: [CGWindowID: String] = [:]
			for await (windowId, path) in group {
				if let path { paths[windowId] = path }
			}
			return paths
		}
		for index in results.indices {
			if let windowId = results[index]["windowId"] as? CGWindowID,
				let path = thumbnailPaths[windowId]
			{
				results[index]["thumbnailPath"] = path
			}
		}
	}
	emit(["event": "windows", "windows": results])
}

@main
struct OpenScreenScreenCaptureKitHelper {
	static func main() async {
		do {
			guard #available(macOS 15.0, *) else { throw HelperError.unsupportedMacOS }
			if CommandLine.arguments.count >= 2, CommandLine.arguments[1] == "list-windows" {
				let thumbnailDirectory =
					CommandLine.arguments.count >= 3 ? CommandLine.arguments[2] : nil
				try await listShareableWindows(thumbnailDirectory: thumbnailDirectory)
				exit(0)
			}
			guard CommandLine.arguments.count == 2 else { throw HelperError.invalidArguments }
			let request = try JSONDecoder().decode(
				RecordingRequest.self,
				from: Data(CommandLine.arguments[1].utf8)
			)
			let recorder = ScreenCaptureRecorder(request: request)
			let commandTask = Task.detached {
				while let line = readLine() {
					switch line.trimmingCharacters(in: .whitespacesAndNewlines) {
					case "pause": await recorder.pause()
					case "resume": await recorder.resume()
					case "stop":
						await recorder.stop()
						exit(0)
					default: break
					}
				}
			}
			try await recorder.start()
			await commandTask.value
		} catch let error as HelperError {
			emitError(code: "helper-error", message: error.description)
			exit(1)
		} catch {
			emitError(code: "helper-error", message: "\(error)")
			exit(1)
		}
	}
}
