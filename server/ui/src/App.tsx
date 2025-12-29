import { useEffect, useMemo, useState } from "react";

const TOKEN_STORAGE_KEY = "aicodewith_admin_token";

type DeviceSummary = {
  deviceId: string;
  fingerprintHash: string | null;
  lastSeen: string | null;
  lastIp: string | null;
  geoCountry: string | null;
  geoRegion: string | null;
  geoCity: string | null;
  appVersion: string | null;
  createdAt: string | null;
  snapshotCount: number;
  lastSnapshotAt: string | null;
  adminVersion: number | null;
  adminUpdatedAt: string | null;
};

type Snapshot = {
  id: number;
  createdAt: string;
  snapshot: unknown;
};

type AdminConfig = {
  version: number;
  updatedAt: string;
  config: unknown;
};

type ProviderView = {
  id: string;
  name: string;
  category?: string;
  websiteUrl?: string;
  icon?: string;
  iconColor?: string;
  inFailoverQueue?: boolean;
  settingsConfig?: unknown;
  raw: Record<string, unknown>;
};

type AppSnapshotView = {
  currentId?: string;
  providers: ProviderView[];
};

type DeviceConfigSnapshotView = {
  claude: AppSnapshotView | null;
  codex: AppSnapshotView | null;
  gemini: AppSnapshotView | null;
};

type DeviceDetail = {
  device: DeviceSummary;
  snapshots: Snapshot[];
  adminConfig: AdminConfig | null;
};

type BatchResponse = {
  ok: boolean;
  updated: number;
};

async function apiFetch<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token.trim()) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function normalizeRegion(device: DeviceSummary) {
  return (
    [device.geoCountry, device.geoRegion, device.geoCity]
      .filter(Boolean)
      .join(" / ") || "-"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeProvider(value: unknown, fallbackId: string): ProviderView {
  const raw = isRecord(value) ? value : {};
  const id =
    typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : fallbackId;
  const name =
    typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
  return {
    id,
    name,
    category: typeof raw.category === "string" ? raw.category : undefined,
    websiteUrl: typeof raw.websiteUrl === "string" ? raw.websiteUrl : undefined,
    icon: typeof raw.icon === "string" ? raw.icon : undefined,
    iconColor: typeof raw.iconColor === "string" ? raw.iconColor : undefined,
    inFailoverQueue:
      typeof raw.inFailoverQueue === "boolean"
        ? raw.inFailoverQueue
        : undefined,
    settingsConfig: raw.settingsConfig,
    raw: { ...raw, id },
  };
}

function normalizeAppSnapshot(value: unknown): AppSnapshotView | null {
  if (!isRecord(value)) return null;
  const providersRaw = isRecord(value.providers) ? value.providers : {};
  const providers = Object.entries(providersRaw).map(([id, provider]) =>
    normalizeProvider(provider, id),
  );
  const currentId =
    typeof value.currentId === "string" ? value.currentId : undefined;

  if (!currentId && providers.length === 0) {
    return null;
  }

  return { currentId, providers };
}

function normalizeSnapshot(value: unknown): DeviceConfigSnapshotView {
  const root = isRecord(value) ? value : {};
  return {
    claude: normalizeAppSnapshot(root.claude),
    codex: normalizeAppSnapshot(root.codex),
    gemini: normalizeAppSnapshot(root.gemini),
  };
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => undefined);
}

const PLATFORM_LABELS = [
  { key: "claude", label: "Claude" },
  { key: "codex", label: "Codex" },
  { key: "gemini", label: "Gemini" },
] as const;

export default function App() {
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState("");
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<DeviceDetail | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [configText, setConfigText] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
    setToken(saved);
    setTokenInput(saved);
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [token]);

  async function refreshDevices() {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<{ devices: DeviceSummary[] }>(
        "/api/v1/admin/devices",
        token,
      );
      setDevices(data.devices);
      if (data.devices.length > 0 && !selectedId) {
        setSelectedId(data.devices[0].deviceId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedId) return;
    void (async () => {
      try {
        const data = await apiFetch<DeviceDetail>(
          `/api/v1/admin/devices/${selectedId}`,
          token,
        );
        setDetail(data);
      } catch (err) {
        setDetail(null);
        setError(err instanceof Error ? err.message : "加载失败");
      }
    })();
  }, [selectedId, token]);

  const filteredDevices = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return devices;
    return devices.filter((device) => {
      const haystack = [
        device.deviceId,
        device.lastIp,
        device.geoCountry,
        device.geoRegion,
        device.geoCity,
        device.appVersion,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [devices, search]);

  function toggleSelect(deviceId: string) {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) {
        next.delete(deviceId);
      } else {
        next.add(deviceId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedSet((prev) => {
      if (prev.size === devices.length) {
        return new Set();
      }
      return new Set(devices.map((device) => device.deviceId));
    });
  }

  async function applyBatch() {
    try {
      setError(null);
      const config = JSON.parse(configText);
      const ids = Array.from(selectedSet);
      if (ids.length === 0) {
        setError("请先选择设备");
        return;
      }
      const result = await apiFetch<BatchResponse>(
        "/api/v1/admin/devices/config/batch",
        token,
        {
          method: "POST",
          body: JSON.stringify({ deviceIds: ids, config }),
        },
      );
      if (result.ok) {
        setModalOpen(false);
        await refreshDevices();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    }
  }

  const latestSnapshotRaw = detail?.snapshots[0]?.snapshot;
  const adminConfigRaw = detail?.adminConfig?.config;
  const snapshotText = latestSnapshotRaw
    ? JSON.stringify(latestSnapshotRaw, null, 2)
    : "";
  const adminConfigText = adminConfigRaw
    ? JSON.stringify(adminConfigRaw, null, 2)
    : "";
  const snapshotView = useMemo(
    () => normalizeSnapshot(latestSnapshotRaw),
    [latestSnapshotRaw],
  );
  const adminConfigView = useMemo(
    () => normalizeSnapshot(adminConfigRaw),
    [adminConfigRaw],
  );

  function renderSnapshotSection(
    title: string,
    snapshot: DeviceConfigSnapshotView,
    rawText: string,
    emptyLabel: string,
  ) {
    return (
      <div className="snapshot-block">
        <div className="actions">
          <h2>{title}</h2>
          {rawText ? (
            <button className="copy-btn" onClick={() => copyText(rawText)}>
              复制 JSON
            </button>
          ) : null}
        </div>
        {rawText ? (
          <div className="snapshot-sections">
            {PLATFORM_LABELS.map((platform) => {
              const appSnapshot = snapshot[platform.key];
              const providers = appSnapshot?.providers ?? [];
              const currentId = appSnapshot?.currentId;
              const currentProvider = providers.find(
                (provider) => provider.id === currentId,
              );
              const currentLabel = currentProvider?.name ?? currentId ?? "-";

              return (
                <section className="platform-card" key={platform.key}>
                  <div className="platform-header">
                    <div>
                      <div className="platform-title">{platform.label}</div>
                      <div className="platform-meta">
                        当前使用：<strong>{currentLabel}</strong>
                        <span> · {providers.length} 个配置</span>
                      </div>
                    </div>
                    <span className="platform-badge">{platform.label}</span>
                  </div>
                  {providers.length > 0 ? (
                    <div className="provider-grid">
                      {providers.map((provider) => {
                        const providerJson = JSON.stringify(
                          provider.raw,
                          null,
                          2,
                        );
                        const isCurrent = currentId === provider.id;

                        return (
                          <div
                            key={provider.id}
                            className={
                              isCurrent
                                ? "provider-card current"
                                : "provider-card"
                            }
                          >
                            <div className="provider-header">
                              <div className="provider-title">
                                <span className="provider-dot" />
                                <div>
                                  <div className="provider-name">
                                    {provider.name}
                                  </div>
                                  <div className="provider-id">
                                    {provider.id}
                                  </div>
                                </div>
                                {isCurrent ? (
                                  <span className="status-pill">当前使用</span>
                                ) : null}
                              </div>
                              <button
                                className="copy-btn light"
                                onClick={() => copyText(providerJson)}
                              >
                                复制配置
                              </button>
                            </div>
                            <div className="provider-meta">
                              <span>类别：{provider.category ?? "-"}</span>
                              <span>站点：{provider.websiteUrl ?? "-"}</span>
                              <span>
                                故障转移：
                                {provider.inFailoverQueue ? "启用" : "关闭"}
                              </span>
                            </div>
                            <pre className="code-block">{providerJson}</pre>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="helper">暂无配置</div>
                  )}
                </section>
              );
            })}

            <details className="raw-toggle">
              <summary>查看原始 JSON</summary>
              <pre className="json-block">{rawText}</pre>
            </details>
          </div>
        ) : (
          <div className="helper">{emptyLabel}</div>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-title">AI Code With 管理台</div>
          <div className="brand-subtitle">
            员工端静默同步配置，管理端集中下发与查看
          </div>
          <span className="badge">每日 04:00 静默同步</span>
        </div>
        <div className="token-bar">
          <div>
            <div className="badge">管理员 Token</div>
          </div>
          <input
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            placeholder="输入 ADMIN_TOKEN"
          />
          <button
            onClick={() => {
              localStorage.setItem(TOKEN_STORAGE_KEY, tokenInput.trim());
              setToken(tokenInput.trim());
            }}
          >
            保存
          </button>
        </div>
      </header>

      {error ? <div className="helper">{error}</div> : null}

      <div className="content">
        <section className="panel">
          <h2>设备列表</h2>
          <div className="search-row">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索设备 ID / IP / 地区 / 版本"
            />
            <button className="action-btn secondary" onClick={refreshDevices}>
              {loading ? "刷新中..." : "刷新"}
            </button>
          </div>

          <div className="actions">
            <button className="action-btn" onClick={() => setModalOpen(true)}>
              批量下发配置
            </button>
            <button className="action-btn secondary" onClick={toggleSelectAll}>
              {selectedSet.size === devices.length ? "取消全选" : "全选"}
            </button>
            <span className="helper">已选 {selectedSet.size} 台</span>
          </div>

          <div className="list">
            {filteredDevices.map((device) => (
              <div
                key={device.deviceId}
                className={
                  device.deviceId === selectedId
                    ? "device-card selected"
                    : "device-card"
                }
                onClick={() => setSelectedId(device.deviceId)}
              >
                <div className="device-top">
                  <div className="device-id">{device.deviceId}</div>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(device.deviceId)}
                    onChange={() => toggleSelect(device.deviceId)}
                    onClick={(event) => event.stopPropagation()}
                  />
                </div>
                <div className="device-meta">
                  地区：{normalizeRegion(device)}
                </div>
                <div className="device-meta">
                  最近同步：{formatDate(device.lastSeen)}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>设备详情</h2>
          {!detail ? (
            <div className="helper">请选择设备查看详情</div>
          ) : (
            <div className="detail-grid">
              <div className="detail-row">
                <span>设备 ID</span>
                <strong>{detail.device.deviceId}</strong>
              </div>
              <div className="detail-row">
                <span>硬件指纹</span>
                <strong>{detail.device.fingerprintHash ?? "-"}</strong>
              </div>
              <div className="detail-row">
                <span>应用版本</span>
                <strong>{detail.device.appVersion ?? "-"}</strong>
              </div>
              <div className="detail-row">
                <span>IP</span>
                <strong>{detail.device.lastIp ?? "-"}</strong>
              </div>
              <div className="detail-row">
                <span>地区</span>
                <strong>{normalizeRegion(detail.device)}</strong>
              </div>
              <div className="detail-row">
                <span>最近同步</span>
                <strong>{formatDate(detail.device.lastSeen)}</strong>
              </div>
              <div className="detail-row">
                <span>配置快照数</span>
                <strong>{detail.device.snapshotCount}</strong>
              </div>
              <div className="detail-row">
                <span>最后快照时间</span>
                <strong>{formatDate(detail.device.lastSnapshotAt)}</strong>
              </div>
              <div className="detail-row">
                <span>入库时间</span>
                <strong>{formatDate(detail.device.createdAt)}</strong>
              </div>
              <div className="detail-row">
                <span>下发版本</span>
                <strong>{detail.device.adminVersion ?? "-"}</strong>
              </div>
              <div className="detail-row">
                <span>下发更新时间</span>
                <strong>{formatDate(detail.device.adminUpdatedAt)}</strong>
              </div>

              {renderSnapshotSection(
                "最新配置快照",
                snapshotView,
                snapshotText,
                "暂无快照",
              )}

              {renderSnapshotSection(
                "已下发配置",
                adminConfigView,
                adminConfigText,
                "暂无下发配置",
              )}
            </div>
          )}
        </section>
      </div>

      {modalOpen ? (
        <div className="modal" onClick={() => setModalOpen(false)}>
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>批量下发配置</h2>
            <div className="helper">
              请粘贴 JSON 配置，将覆盖所选设备本地配置。
            </div>
            <textarea
              value={configText}
              onChange={(event) => setConfigText(event.target.value)}
            />
            <div className="modal-actions">
              <button
                className="action-btn secondary"
                onClick={() => setModalOpen(false)}
              >
                取消
              </button>
              <button className="action-btn" onClick={applyBatch}>
                应用到 {selectedSet.size} 台设备
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
