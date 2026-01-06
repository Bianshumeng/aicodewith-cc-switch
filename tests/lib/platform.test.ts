import { afterEach, describe, expect, it, vi } from "vitest";
import { getDesktopPlatform } from "@/lib/platform";
import { getCurrentPan123Platform } from "@/lib/pan123Update";

type NavigatorStub = {
  userAgent?: string;
  platform?: string;
  userAgentData?: { platform?: string };
};

const stubNavigator = (stub: NavigatorStub) => {
  vi.stubGlobal("navigator", stub as unknown as Navigator);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getDesktopPlatform", () => {
  it("detects Windows by navigator.platform even if UA looks like macOS", () => {
    stubNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      platform: "Win32",
    });

    expect(getDesktopPlatform()).toBe("windows");
  });

  it("detects Windows by UA-CH platform hint", () => {
    stubNavigator({
      userAgent: "",
      platform: "",
      userAgentData: { platform: "Windows" },
    });

    expect(getDesktopPlatform()).toBe("windows");
  });

  it("detects macOS", () => {
    stubNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      platform: "MacIntel",
    });

    expect(getDesktopPlatform()).toBe("macos");
  });

  it("detects Linux", () => {
    stubNavigator({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)",
      platform: "Linux x86_64",
    });

    expect(getDesktopPlatform()).toBe("linux");
  });
});

describe("getCurrentPan123Platform", () => {
  it("delegates to getDesktopPlatform", () => {
    stubNavigator({ platform: "Win32" });
    expect(getCurrentPan123Platform()).toBe("windows");
  });
});
