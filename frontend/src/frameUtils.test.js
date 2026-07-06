import { describe, expect, it, vi } from "vitest";
import { createFrameUrl } from "./frameUtils";

describe("createFrameUrl", () => {
  it("keeps base64 data URLs ready for img src", () => {
    const frame = "data:image/jpeg;base64,abc123";

    expect(createFrameUrl(frame)).toEqual({
      url: frame,
      objectUrl: null,
    });
  });

  it("converts binary frames to object URLs", () => {
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:test-frame");

    expect(createFrameUrl(new Uint8Array([1, 2, 3]))).toEqual({
      url: "blob:test-frame",
      objectUrl: "blob:test-frame",
    });
    expect(URL.createObjectURL).toHaveBeenCalledOnce();

    URL.createObjectURL = originalCreateObjectURL;
  });
});
