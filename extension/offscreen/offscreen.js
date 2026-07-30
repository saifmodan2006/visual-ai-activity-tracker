/**
 * Offscreen capture worker responsible for screenshot capture and compression.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CAPTURE_THUMBNAIL") {
    handleCapture(message)
      .then((thumbnail) => sendResponse({ thumbnail }))
      .catch((error) => sendResponse({ error: error?.message || "capture_failed" }));
    return true;
  }
  return undefined;
});

/**
 * @param {{tabId: number, maxWidth: number, maxHeight: number, quality: number}} message
 * @returns {Promise<string | null>}
 */
async function handleCapture(message) {
  const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: "jpeg", quality: 80 });
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    return dataUrl;
  }
  const scale = Math.min(message.maxWidth / image.width, message.maxHeight / image.height, 1);
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  let quality = message.quality;
  let output = await canvasToDataUrl(canvas, quality);
  while (output.length > 70 * 1024 && quality > 0.35) {
    quality = Number((quality - 0.05).toFixed(2));
    output = await canvasToDataUrl(canvas, quality);
  }
  return output;
}

/**
 * @param {string} dataUrl
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image_load_failed"));
    image.src = dataUrl;
  });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} quality
 * @returns {Promise<string>}
 */
function canvasToDataUrl(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(canvas.toDataURL("image/jpeg", quality));
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(blob);
    }, "image/jpeg", quality);
  });
}
