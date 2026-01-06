export type DesktopPlatform = "windows" | "macos" | "linux";

function getUaDataPlatform(): string {
  try {
    const uaData = (
      navigator as unknown as { userAgentData?: { platform?: unknown } }
    ).userAgentData;
    return typeof uaData?.platform === "string" ? uaData.platform : "";
  } catch {
    return "";
  }
}

// 轻量平台检测，避免在 SSR 或无 navigator 的环境报错。
// 说明：部分 WebView/浏览器会在 UA 中包含 `like Mac OS X` 等字段，
// 仅靠 `/mac/i` 可能误判为 macOS，因此优先使用 platform / UA-CH 提示。
export const getDesktopPlatform = (): DesktopPlatform | null => {
  try {
    const ua = (navigator.userAgent || "").toLowerCase();
    const platform = (navigator.platform || "").toLowerCase();
    const uaDataPlatform = getUaDataPlatform().toLowerCase();

    const platformHint = `${platform} ${uaDataPlatform}`.trim();

    if (
      platformHint.includes("windows") ||
      platformHint.includes("win32") ||
      platformHint.includes("win64") ||
      platformHint.startsWith("win")
    ) {
      return "windows";
    }

    if (platformHint.includes("mac") || platformHint.includes("darwin")) {
      return "macos";
    }

    if (platformHint.includes("linux")) {
      return "linux";
    }

    if (/(windows|win32|win64)/i.test(ua)) return "windows";
    if (/(macintosh|mac os x|macos|darwin)/i.test(ua)) return "macos";
    if (/(linux|x11)/i.test(ua) && !/android/i.test(ua)) return "linux";

    return null;
  } catch {
    return null;
  }
};

export const isMac = (): boolean => getDesktopPlatform() === "macos";

export const isWindows = (): boolean => getDesktopPlatform() === "windows";

export const isLinux = (): boolean => getDesktopPlatform() === "linux";
