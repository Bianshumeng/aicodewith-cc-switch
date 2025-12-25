import { useCallback, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AppId } from "@/lib/api";
import type { CustomEndpoint, Provider } from "@/types";
import { providerPresets } from "@/config/claudeProviderPresets";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { geminiProviderPresets } from "@/config/geminiProviderPresets";
import { ProviderIcon } from "@/components/ProviderIcon";
import ApiKeyInput from "@/components/providers/forms/ApiKeyInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type QuickPreset = {
  name: string;
  websiteUrl: string;
  apiKeyUrl?: string;
  settingsConfig: Record<string, any>;
  category?: Provider["category"];
  icon?: string;
  iconColor?: string;
  endpointCandidates?: string[];
};

interface ProviderEmptyStateProps {
  appId: AppId;
  onCreate?: () => void;
  onQuickApply?: (provider: Omit<Provider, "id">) => Promise<void>;
}

interface ProviderQuickSetupCardProps {
  appId: AppId;
  onQuickApply?: (provider: Omit<Provider, "id">) => Promise<void>;
  className?: string;
}

const normalizeUrl = (url?: string) => (url || "").trim().replace(/\/+$/, "");

const buildCustomEndpoints = (
  urls?: string[],
): Record<string, CustomEndpoint> | undefined => {
  if (!urls || urls.length === 0) return undefined;

  const urlSet = new Set<string>();
  urls.map(normalizeUrl).filter(Boolean).forEach((url) => urlSet.add(url));
  if (urlSet.size === 0) return undefined;

  const now = Date.now();
  const endpoints: Record<string, CustomEndpoint> = {};
  urlSet.forEach((url) => {
    endpoints[url] = {
      url,
      addedAt: now,
      lastUsed: undefined,
    };
  });
  return endpoints;
};

const getQuickPreset = (appId: AppId): QuickPreset | null => {
  if (appId === "claude") {
    const preset = providerPresets[0];
    if (!preset) return null;
    return {
      name: preset.name,
      websiteUrl: preset.websiteUrl,
      apiKeyUrl: preset.apiKeyUrl,
      settingsConfig: preset.settingsConfig as Record<string, any>,
      category: preset.category,
      icon: preset.icon,
      iconColor: preset.iconColor,
      endpointCandidates: preset.endpointCandidates,
    };
  }

  if (appId === "codex") {
    const preset = codexProviderPresets[0];
    if (!preset) return null;
    return {
      name: preset.name,
      websiteUrl: preset.websiteUrl,
      apiKeyUrl: preset.apiKeyUrl,
      settingsConfig: {
        auth: preset.auth,
        config: preset.config,
      },
      category: preset.category,
      icon: preset.icon,
      iconColor: preset.iconColor,
      endpointCandidates: preset.endpointCandidates,
    };
  }

  if (appId === "gemini") {
    const preset = geminiProviderPresets[0];
    if (!preset) return null;
    return {
      name: preset.name,
      websiteUrl: preset.websiteUrl,
      apiKeyUrl: preset.apiKeyUrl,
      settingsConfig: preset.settingsConfig as Record<string, any>,
      category: preset.category,
      icon: preset.icon,
      iconColor: preset.iconColor,
      endpointCandidates: preset.endpointCandidates,
    };
  }

  return null;
};

const applyApiKey = (
  appId: AppId,
  settingsConfig: Record<string, any>,
  apiKey: string,
) => {
  if (appId === "claude") {
    const env = { ...(settingsConfig.env ?? {}) };
    env.ANTHROPIC_AUTH_TOKEN = apiKey.trim();
    return { ...settingsConfig, env };
  }

  if (appId === "codex") {
    const auth = { ...(settingsConfig.auth ?? {}) };
    auth.OPENAI_API_KEY = apiKey.trim();
    return { ...settingsConfig, auth };
  }

  if (appId === "gemini") {
    const env = { ...(settingsConfig.env ?? {}) };
    env.GEMINI_API_KEY = apiKey.trim();
    return { ...settingsConfig, env };
  }

  return settingsConfig;
};

const resolveBaseUrl = (appId: AppId, preset: QuickPreset) => {
  const candidates = preset.endpointCandidates
    ?.map(normalizeUrl)
    .filter(Boolean);
  if (candidates && candidates.length > 0) {
    return candidates[0];
  }

  const env = preset.settingsConfig?.env as Record<string, any> | undefined;
  if (appId === "claude") {
    return normalizeUrl(env?.ANTHROPIC_BASE_URL);
  }

  if (appId === "gemini") {
    return normalizeUrl(env?.GOOGLE_GEMINI_BASE_URL);
  }

  if (appId === "codex") {
    const configText = preset.settingsConfig?.config;
    if (typeof configText === "string") {
      const match = configText.match(/base_url\s*=\s*["']([^"']+)["']/);
      if (match?.[1]) {
        return normalizeUrl(match[1]);
      }
    }
  }

  return "";
};

export function ProviderQuickSetupCard({
  appId,
  onQuickApply,
  className,
}: ProviderQuickSetupCardProps) {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState("");
  const [isApplying, setIsApplying] = useState(false);

  const preset = useMemo(() => getQuickPreset(appId), [appId]);
  const baseUrl = useMemo(
    () => (preset ? resolveBaseUrl(appId, preset) : ""),
    [appId, preset],
  );
  const apiKeyHint =
    appId === "codex"
      ? t("providerForm.codexApiKeyAutoFill")
      : t("providerForm.apiKeyAutoFill");
  const apiKeyLink = (preset?.apiKeyUrl || preset?.websiteUrl || "").trim();

  const canApply = Boolean(onQuickApply) && apiKey.trim() && !isApplying;

  const handleApply = useCallback(async () => {
    if (!preset || !onQuickApply) return;
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) return;

    setIsApplying(true);
    try {
      const clonedConfig = JSON.parse(
        JSON.stringify(preset.settingsConfig ?? {}),
      ) as Record<string, any>;
      const settingsConfig = applyApiKey(appId, clonedConfig, trimmedKey);
      const customEndpoints = buildCustomEndpoints(preset.endpointCandidates);
      const provider: Omit<Provider, "id"> = {
        name: preset.name,
        websiteUrl: preset.websiteUrl,
        settingsConfig,
        category: preset.category,
        icon: preset.icon,
        iconColor: preset.iconColor,
        ...(customEndpoints
          ? { meta: { custom_endpoints: customEndpoints } }
          : {}),
      };

      await onQuickApply(provider);
    } finally {
      setIsApplying(false);
    }
  }, [apiKey, appId, onQuickApply, preset]);

  if (!preset) return null;

  const cardClassName = [
    "w-full max-w-2xl rounded-lg border bg-card p-6 text-left shadow-sm",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cardClassName}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-muted">
            <ProviderIcon
              icon={preset.icon}
              name={preset.name}
              color={preset.iconColor}
              size={28}
            />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">
              {preset.name}
            </div>
            <div className="text-xs text-muted-foreground">
              {preset.websiteUrl}
            </div>
          </div>
        </div>
        <Button onClick={handleApply} disabled={!canApply}>
          {t("provider.applyConfiguration")}
        </Button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <ApiKeyInput value={apiKey} onChange={setApiKey} required />
          {apiKeyLink && (
            <a
              href={apiKeyLink}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              {t("providerForm.getApiKey")}
            </a>
          )}
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            {t("providerForm.apiEndpoint")}
          </label>
          <Input value={baseUrl} readOnly className="bg-muted/40" />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{apiKeyHint}</p>
    </div>
  );
}

export function ProviderEmptyState({
  appId,
  onCreate,
  onQuickApply,
}: ProviderEmptyStateProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center gap-6 rounded-lg border border-dashed border-border p-10 text-center">
      <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Users className="h-7 w-7 text-muted-foreground" />
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{t("provider.noProviders")}</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          {t("provider.noProvidersDescription")}
        </p>
      </div>

      <ProviderQuickSetupCard appId={appId} onQuickApply={onQuickApply} />

      {onCreate && (
        <Button className="mt-2" onClick={onCreate} variant="outline">
          {t("provider.addProvider")}
        </Button>
      )}
    </div>
  );
}
