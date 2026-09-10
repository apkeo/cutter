import AppKit
import ScreenCaptureKit
import AVFoundation

func emit(_ value: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data: data, encoding: .utf8) { print(line); fflush(stdout) }
}
if CommandLine.arguments.contains("--self-test") { print("capture-helper-ok"); exit(0) }
final class Recorder: NSObject, SCStreamOutput {
  let writer: AVAssetWriter
  let input: AVAssetWriterInput
  var started = false
  let queue = DispatchQueue(label: "cutter.frames")
  init(path: String, width: Int, height: Int) throws {
    writer = try AVAssetWriter(outputURL: URL(fileURLWithPath: path), fileType: .mp4)
    input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height])
    input.expectsMediaDataInRealTime = true
    super.init()
    writer.add(input)
  }
  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, sampleBuffer.isValid, CMSampleBufferGetImageBuffer(sampleBuffer) != nil else { return }
    if !started {
      guard writer.startWriting() else { emit(["error": writer.error?.localizedDescription ?? "Cannot start video writer"]); return }
      writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
      started = true
      let age = CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock())) - CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
      emit(["ready": true, "ms": (Date().timeIntervalSince1970 - max(0, age)) * 1000])
    }
    if input.isReadyForMoreMediaData { input.append(sampleBuffer) }
  }
}
Task {
  do {
    let args = CommandLine.arguments
    guard args.count == 10 else { throw NSError(domain: "Cutter capture arguments", code: 1) }
    let displayID = UInt32(args[1])!
    let rect = CGRect(x: Double(args[2])!, y: Double(args[3])!, width: Double(args[4])!, height: Double(args[5])!)
    let fps = Int(args[6])!, scale = Double(args[7])!, cursor = args[8] == "1"
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let display = content.displays.first(where: { $0.displayID == displayID }) else { throw NSError(domain: "Display disconnected", code: 2) }
    let config = SCStreamConfiguration()
    config.sourceRect = rect
    config.width = Int(ceil(rect.width * scale / 2)) * 2
    config.height = Int(ceil(rect.height * scale / 2)) * 2
    config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
    config.showsCursor = cursor
    config.capturesAudio = false
    config.queueDepth = 5
    let recorder = try Recorder(path: args[9], width: config.width, height: config.height)
    let stream = SCStream(filter: SCContentFilter(display: display, excludingWindows: []), configuration: config, delegate: nil)
    try stream.addStreamOutput(recorder, type: .screen, sampleHandlerQueue: recorder.queue)
    try await stream.startCapture()
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      DispatchQueue.global().async { _ = readLine(); continuation.resume() }
    }
    try await stream.stopCapture()
    recorder.queue.sync { recorder.input.markAsFinished() }
    await recorder.writer.finishWriting()
    guard recorder.writer.status == .completed else { throw recorder.writer.error ?? NSError(domain: "Recording failed", code: 3) }
    emit(["finished": true]); exit(0)
  } catch { emit(["error": error.localizedDescription]); exit(1) }
}
dispatchMain()
