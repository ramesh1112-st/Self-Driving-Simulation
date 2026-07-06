export function createFrameUrl(frameData) {
  if (typeof frameData === "string") {
    return {
      url: frameData,
      objectUrl: null,
    };
  }

  const bytes = ArrayBuffer.isView(frameData)
    ? frameData
    : frameData?.data
      ? new Uint8Array(frameData.data)
      : frameData;

  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));

  return {
    url: objectUrl,
    objectUrl,
  };
}
