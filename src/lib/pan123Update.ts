import { getDesktopPlatform } from "@/lib/platform";

export type Pan123Platform = "windows" | "macos" | "linux";

export interface Pan123ShareFile {
  FileId: number;
  FileName: string;
  Type: number;
  Size: number;
  Etag: string;
  S3KeyFlag: string;
}

interface Pan123ShareGetResponse {
  code: number;
  message: string;
  data: {
    InfoList?: Pan123ShareFile[];
  } | null;
}

interface Pan123DownloadInfoResponse {
  code: number;
  message: string;
  data: {
    dispatchList: Array<{ prefix: string; isp: string }>;
    downloadPath: string;
    fileId: number;
  } | null;
}

export interface Pan123ReleaseAsset {
  platform: Pan123Platform;
  version: string;
  file: Pan123ShareFile;
}

export interface Pan123LatestRelease {
  latestVersion: string;
  assets: Partial<Record<Pan123Platform, Pan123ReleaseAsset>>;
  allFiles: Pan123ShareFile[];
}

const PAN123_SOURCE = {
  shareKey: "ztf6jv-HUc0A",
  sharePwd: "3FyF",
  apiBaseUrl: "https://www.123865.com/b/api",
  sharePageUrl: "https://www.123865.com/s/ztf6jv-HUc0A?pwd=3FyF#",
} as const;

export function getPan123SharePageUrl(): string {
  return PAN123_SOURCE.sharePageUrl;
}

function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  if (timeoutMs <= 0) {
    return { signal: controller.signal, cleanup: () => undefined };
  }

  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => globalThis.clearTimeout(timeout),
  };
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const res = await fetch(input, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchPan123ShareFiles(options?: {
  timeoutMs?: number;
}): Promise<Pan123ShareFile[]> {
  const url = new URL(`${PAN123_SOURCE.apiBaseUrl}/share/get`);
  url.search = new URLSearchParams({
    limit: "100",
    next: "0",
    orderBy: "file_name",
    orderDirection: "asc",
    ParentFileId: "0",
    Page: "1",
    OrderId: "",
    SharePwd: PAN123_SOURCE.sharePwd,
    shareKey: PAN123_SOURCE.shareKey,
  }).toString();

  const timeoutMs = options?.timeoutMs ?? 15000;
  const { signal, cleanup } = createTimeoutSignal(timeoutMs);

  let json: Pan123ShareGetResponse;
  try {
    json = await fetchJson<Pan123ShareGetResponse>(url, {
      method: "GET",
      headers: {
        "Content-type": "application/json",
        "Pan-User-Real-IP": "",
      },
      signal,
    });
  } finally {
    cleanup();
  }

  if (json.code !== 0) {
    throw new Error(json.message || "网盘接口返回异常");
  }

  const list = json.data?.InfoList;
  return Array.isArray(list) ? list : [];
}

export async function fetchPan123DownloadUrl(
  file: Pan123ShareFile,
  options?: { timeoutMs?: number },
): Promise<string> {
  const url = `${PAN123_SOURCE.apiBaseUrl}/v2/share/download/info`;
  const timeoutMs = options?.timeoutMs ?? 15000;
  const { signal, cleanup } = createTimeoutSignal(timeoutMs);

  let json: Pan123DownloadInfoResponse;
  try {
    json = await fetchJson<Pan123DownloadInfoResponse>(url, {
      method: "POST",
      headers: {
        "Content-type": "application/json",
        "Pan-User-Real-IP": "",
      },
      body: JSON.stringify({
        ShareKey: PAN123_SOURCE.shareKey,
        FileID: file.FileId,
        S3keyFlag: file.S3KeyFlag,
        Size: file.Size,
        Etag: file.Etag,
        OrderId: "",
      }),
      signal,
    });
  } finally {
    cleanup();
  }

  if (json.code !== 0) {
    throw new Error(json.message || "获取下载链接失败");
  }
  if (!json.data?.dispatchList?.length || !json.data.downloadPath) {
    throw new Error("下载链接返回为空");
  }

  return `${json.data.dispatchList[0].prefix}${json.data.downloadPath}`;
}

// 说明：网盘文件名通常类似：`AI-Code-With-v1.0.3-Windows.msi` / `...-macOS.zip`。
// 这里的 `-Windows/.msi` 属于“平台/产物信息”，不是 SemVer 的 prerelease。
// 因此先粗略截取 `v...` 后的片段，再做清洗（去平台/去扩展名），最终得到纯 SemVer 版本号。
const VERSION_IN_FILENAME_RE = /\bv(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/i;

export function extractVersionFromFileName(fileName: string): string | null {
  const match = fileName.match(VERSION_IN_FILENAME_RE);
  if (!match?.[1]) return null;

  let version = match[1];

  // 先去掉常见扩展名（包含多段扩展名）
  version = version.replace(/\.tar\.gz$/i, "");
  version = version.replace(/\.(msi|exe|zip|dmg|pkg|deb|appimage)$/i, "");

  // 再去掉文件名中紧随版本号的“平台/架构标识”（例如 `-Windows` / `-Windows-x64`）。
  // 这里不强依赖特定命名模板，只要后缀以平台名结尾即可。
  version = version.replace(/-(windows|macos|linux)(?:[-._][0-9a-z]+)*$/i, "");

  return version;
}

function parseSemver(version: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
} | null {
  const match = version
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    if (ai === bi) continue;

    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return diff > 0 ? 1 : -1;
      continue;
    }
    if (aNum !== bNum) return aNum ? -1 : 1;
    return ai > bi ? 1 : -1;
  }

  return 0;
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return a === b ? 0 : a > b ? 1 : -1;

  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

export function getCurrentPan123Platform(): Pan123Platform | null {
  return getDesktopPlatform();
}

function inferPlatformFromFileName(fileName: string): Pan123Platform | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".msi") || lower.includes("windows")) return "windows";
  if (
    lower.endsWith(".dmg") ||
    lower.endsWith(".pkg") ||
    lower.includes("macos")
  ) {
    return "macos";
  }
  if (
    lower.endsWith(".deb") ||
    lower.endsWith(".appimage") ||
    lower.includes("linux")
  ) {
    return "linux";
  }
  return null;
}

function pickPreferredAsset(
  assets: Pan123ReleaseAsset[],
  platform: Pan123Platform,
): Pan123ReleaseAsset | null {
  const extPreference: Record<Pan123Platform, string[]> = {
    windows: [".msi", ".exe", ".zip"],
    macos: [".dmg", ".zip"],
    linux: [".deb", ".appimage", ".tar.gz"],
  };

  const preference = extPreference[platform];
  const scored = assets
    .map((asset) => {
      const lower = asset.file.FileName.toLowerCase();
      const idx = preference.findIndex((ext) => lower.endsWith(ext));
      return { asset, score: idx === -1 ? preference.length : idx };
    })
    .sort((a, b) => a.score - b.score);

  return scored[0]?.asset ?? null;
}

export function resolvePan123LatestRelease(
  files: Pan123ShareFile[],
): Pan123LatestRelease | null {
  const versioned = files
    .filter((item) => item.Type === 0 && typeof item.FileName === "string")
    .map((file) => {
      const version = extractVersionFromFileName(file.FileName);
      const platform = inferPlatformFromFileName(file.FileName);
      if (!version || !platform) return null;
      return { file, version, platform };
    })
    .filter(Boolean) as Array<{
    file: Pan123ShareFile;
    version: string;
    platform: Pan123Platform;
  }>;

  if (versioned.length === 0) return null;

  const latestVersion = versioned
    .map((item) => item.version)
    .reduce((acc, cur) => (compareSemver(cur, acc) > 0 ? cur : acc));

  const assetsByPlatform: Partial<Record<Pan123Platform, Pan123ReleaseAsset>> =
    {};
  (["windows", "macos", "linux"] as const).forEach((platform) => {
    const candidates = versioned
      .filter(
        (item) => item.version === latestVersion && item.platform === platform,
      )
      .map(
        (item): Pan123ReleaseAsset => ({
          platform,
          version: latestVersion,
          file: item.file,
        }),
      );
    const preferred = pickPreferredAsset(candidates, platform);
    if (preferred) assetsByPlatform[platform] = preferred;
  });

  return {
    latestVersion,
    assets: assetsByPlatform,
    allFiles: files,
  };
}

export async function fetchPan123LatestRelease(options?: {
  timeoutMs?: number;
}): Promise<Pan123LatestRelease | null> {
  const files = await fetchPan123ShareFiles({ timeoutMs: options?.timeoutMs });
  return resolvePan123LatestRelease(files);
}
