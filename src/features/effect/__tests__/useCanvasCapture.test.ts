import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvasCapture } from "@/features/effect/useCanvasCapture";

// Mock MediaStream
class MockMediaStream {}

// Mock MediaRecorder
class MockMediaRecorder {
  state = "inactive" as "recording" | "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  static isTypeSupported = vi.fn(() => true);

  start() {
    this.state = "recording";
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(["test"], { type: "video/webm" }) });
    }, 10);
  }

  stop() {
    this.state = "inactive";
    setTimeout(() => {
      this.onstop?.();
    }, 10);
  }
}

describe("useCanvasCapture", () => {
  let originalMediaRecorder: typeof MediaRecorder;
  let originalMediaStream: typeof MediaStream;

  beforeEach(() => {
    originalMediaRecorder = globalThis.MediaRecorder;
    originalMediaStream = globalThis.MediaStream;
    (globalThis as any).MediaRecorder = MockMediaRecorder;
    (globalThis as any).MediaStream = MockMediaStream;
    vi.useFakeTimers();
  });

  afterEach(() => {
    (globalThis as any).MediaRecorder = originalMediaRecorder;
    (globalThis as any).MediaStream = originalMediaStream;
    vi.useRealTimers();
  });

  it("starts in non-recording state", () => {
    const { result } = renderHook(() => useCanvasCapture());
    expect(result.current.isRecording).toBe(false);
    expect(result.current.progress).toBe(0);
  });

  it("startRecording initiates recording", async () => {
    const { result } = renderHook(() => useCanvasCapture());

    const canvas = document.createElement("canvas");
    canvas.captureStream = vi.fn(() => new MockMediaStream() as any);

    let resolvedBlob: Blob | null = null;

    await act(async () => {
      const promise = result.current.startRecording(canvas, 500, 30);

      // Advance timers to trigger progress and completion
      await vi.advanceTimersByTimeAsync(600);

      resolvedBlob = await promise;
    });

    expect(resolvedBlob).toBeInstanceOf(Blob);
  });

  it("stopRecording stops the recorder early", async () => {
    const { result } = renderHook(() => useCanvasCapture());

    const canvas = document.createElement("canvas");
    canvas.captureStream = vi.fn(() => new MockMediaStream() as any);

    await act(async () => {
      result.current.startRecording(canvas, 5000, 30);
    });

    await act(async () => {
      result.current.stopRecording();
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(result.current.isRecording).toBe(false);
  });
});
