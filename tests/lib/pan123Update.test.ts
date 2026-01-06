import { describe, expect, it } from "vitest";
import {
  extractVersionFromFileName,
  resolvePan123LatestRelease,
  type Pan123ShareFile,
} from "@/lib/pan123Update";

const buildFile = (FileName: string, FileId = 1): Pan123ShareFile => ({
  FileId,
  FileName,
  Type: 0,
  Size: 0,
  Etag: "",
  S3KeyFlag: "",
});

describe("extractVersionFromFileName", () => {
  it("strips platform and extension from 123-pan release assets", () => {
    expect(extractVersionFromFileName("AI-Code-With-v1.0.3-Windows.msi")).toBe(
      "1.0.3",
    );
    expect(
      extractVersionFromFileName("AI-Code-With-v1.0.3-Windows-x64.msi"),
    ).toBe("1.0.3");
    expect(extractVersionFromFileName("AI-Code-With-v1.0.3-macOS.zip")).toBe(
      "1.0.3",
    );
    expect(
      extractVersionFromFileName("AI-Code-With-v1.0.3-macOS-arm64.zip"),
    ).toBe("1.0.3");
    expect(extractVersionFromFileName("AI-Code-With-v1.0.3-Linux.deb")).toBe(
      "1.0.3",
    );
    expect(
      extractVersionFromFileName("AI-Code-With-v1.0.3-Linux-x64.deb"),
    ).toBe("1.0.3");
  });
});

describe("resolvePan123LatestRelease", () => {
  it("groups same version assets by platform (Windows should not be shadowed by macOS)", () => {
    const latest = resolvePan123LatestRelease([
      buildFile("AI-Code-With-v1.0.3-Linux.deb", 1),
      buildFile("AI-Code-With-v1.0.3-Windows.msi", 2),
      buildFile("AI-Code-With-v1.0.3-macOS.zip", 3),
    ]);

    expect(latest?.latestVersion).toBe("1.0.3");
    expect(latest?.assets.windows?.file.FileName).toBe(
      "AI-Code-With-v1.0.3-Windows.msi",
    );
    expect(latest?.assets.macos?.file.FileName).toBe(
      "AI-Code-With-v1.0.3-macOS.zip",
    );
    expect(latest?.assets.linux?.file.FileName).toBe(
      "AI-Code-With-v1.0.3-Linux.deb",
    );
  });
});
