import { useCallback, useEffect, useState } from "react";
import {
  Copy,
  Loader2,
  RefreshCw,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Download,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { settingsApi } from "@/lib/api";
import { motion } from "framer-motion";
import { getCurrentVersion } from "@/lib/updater";
import { confirm } from "@tauri-apps/plugin-dialog";
import { exit } from "@tauri-apps/plugin-process";
import type { Pan123ReleaseAsset } from "@/lib/pan123Update";
import {
  compareSemver,
  fetchPan123DownloadUrl,
  fetchPan123LatestRelease,
  getCurrentPan123Platform,
  getPan123SharePageUrl,
} from "@/lib/pan123Update";

interface ToolVersion {
  name: string;
  version: string | null;
  latest_version: string | null;
  error: string | null;
}

const ONE_CLICK_INSTALL_COMMANDS = `npm i -g @anthropic-ai/claude-code@latest --registry=https://registry.npmmirror.com/
npm i -g @openai/codex@latest --registry=https://registry.npmmirror.com/
npm i -g @google/gemini-cli@latest --registry=https://registry.npmmirror.com/`;

export function AboutSection() {
  const { t } = useTranslation();
  const [toolVersions, setToolVersions] = useState<ToolVersion[]>([]);
  const [isLoadingTools, setIsLoadingTools] = useState(true);
  const [appVersion, setAppVersion] = useState("");
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [platformAsset, setPlatformAsset] = useState<Pan123ReleaseAsset | null>(
    null,
  );
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(false);

  const loadToolVersions = useCallback(async () => {
    setIsLoadingTools(true);
    try {
      const tools = await settingsApi.getToolVersions();
      setToolVersions(tools);
    } catch (error) {
      console.error("[AboutSection] Failed to load tool versions", error);
    } finally {
      setIsLoadingTools(false);
    }
  }, []);

  useEffect(() => {
    void loadToolVersions();
  }, [loadToolVersions]);

  const checkPanUpdate = useCallback(async () => {
    setIsCheckingUpdate(true);
    setUpdateError(null);

    try {
      const [current, latest] = await Promise.all([
        getCurrentVersion(),
        fetchPan123LatestRelease({ timeoutMs: 15000 }),
      ]);

      setAppVersion(current);
      if (!latest) {
        setLatestVersion(null);
        setPlatformAsset(null);
        setHasUpdate(false);
        setUpdateError(t("settings.panUpdateNoAssets"));
        return;
      }

      setLatestVersion(latest.latestVersion);

      const platform = await settingsApi
        .getRuntimePlatform()
        .catch(() => getCurrentPan123Platform());
      setPlatformAsset(platform ? (latest.assets[platform] ?? null) : null);

      if (!current) {
        setHasUpdate(false);
        return;
      }
      setHasUpdate(compareSemver(current, latest.latestVersion) < 0);
    } catch (error) {
      console.error("[AboutSection] Failed to check pan update", error);
      setHasUpdate(false);
      setUpdateError(
        error instanceof Error
          ? error.message
          : t("settings.checkUpdateFailed"),
      );
    } finally {
      setIsCheckingUpdate(false);
    }
  }, [t]);

  useEffect(() => {
    void checkPanUpdate();
  }, [checkPanUpdate]);

  const handleCopyInstallCommands = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(ONE_CLICK_INSTALL_COMMANDS);
      toast.success(t("settings.installCommandsCopied"), { closeButton: true });
    } catch (error) {
      console.error("[AboutSection] Failed to copy install commands", error);
      toast.error(t("settings.installCommandsCopyFailed"));
    }
  }, [t]);

  const handleOpenPanShare = useCallback(async () => {
    try {
      await settingsApi.openExternal(getPan123SharePageUrl());
    } catch (error) {
      console.error("[AboutSection] Failed to open pan share page", error);
      toast.error(t("settings.openPanShareFailed"));
    }
  }, [t]);

  const handleDirectDownload = useCallback(async () => {
    if (!platformAsset) {
      toast.error(t("settings.panUpdateNoPlatformAsset"));
      return;
    }

    try {
      const downloadUrl = await fetchPan123DownloadUrl(platformAsset.file, {
        timeoutMs: 15000,
      });
      await settingsApi.openExternal(downloadUrl);
    } catch (error) {
      console.error("[AboutSection] Failed to open pan download url", error);
      toast.error(t("settings.openPanDownloadFailed"));
    }
  }, [platformAsset, t]);

  const handleDownloadAndInstall = useCallback(async () => {
    if (!platformAsset) {
      toast.error(t("settings.panUpdateNoPlatformAsset"));
      return;
    }

    const isWindowsMsi =
      platformAsset.file.FileName.toLowerCase().endsWith(".msi");
    if (isWindowsMsi) {
      const ok = await confirm(t("settings.panInstallConfirmBody"), {
        title: t("settings.panInstallConfirmTitle"),
        kind: "warning",
      });
      if (!ok) return;
    }

    setIsInstalling(true);
    try {
      const downloadUrl = await fetchPan123DownloadUrl(platformAsset.file, {
        timeoutMs: 15000,
      });
      const result = await settingsApi.downloadAndOpenUpdatePackage({
        url: downloadUrl,
        fileName: platformAsset.file.FileName,
      });
      toast.success(t("settings.panInstallStarted"), {
        closeButton: true,
        description: result.filePath,
      });

      if (isWindowsMsi) {
        toast.message(t("settings.panInstallExitHint"), { closeButton: true });
        setTimeout(() => {
          void exit(0);
        }, 800);
      }
    } catch (error) {
      console.error("[AboutSection] Failed to download/install update", error);
      toast.error(t("settings.panInstallFailed"));
    } finally {
      setIsInstalling(false);
    }
  }, [platformAsset, t]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{t("common.about")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("settings.aboutHint")}
        </p>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-4 space-y-2 shadow-sm"
      >
        <h4 className="text-sm font-medium">
          {t("settings.openSourceNoticeTitle")}
        </h4>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("settings.openSourceNoticeBody")}
        </p>
      </motion.div>

      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm font-medium">
            {t("settings.panUpdateTitle")}
          </h3>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={checkPanUpdate}
            disabled={isCheckingUpdate}
          >
            <RefreshCw
              className={
                isCheckingUpdate ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"
              }
            />
            {isCheckingUpdate
              ? t("settings.checking")
              : t("settings.checkForUpdates")}
          </Button>
        </div>

        <div className="rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {t("settings.currentAppVersion")}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">
                {appVersion ? `v${appVersion}` : t("common.unknown")}
              </span>
              {!updateError && latestVersion ? (
                hasUpdate ? (
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                )
              ) : updateError ? (
                <AlertCircle className="h-4 w-4 text-red-500" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {t("settings.panLatestVersion")}
            </div>
            <div className="text-xs font-mono text-muted-foreground">
              {latestVersion ? `v${latestVersion}` : t("common.unknown")}
            </div>
          </div>

          {platformAsset ? (
            <div className="text-[10px] text-muted-foreground font-mono truncate">
              {platformAsset.file.FileName}
            </div>
          ) : null}

          {updateError ? (
            <p className="text-xs text-red-500">{updateError}</p>
          ) : hasUpdate ? (
            <p className="text-xs text-muted-foreground">
              {t("settings.updateAvailable", { version: latestVersion })}
            </p>
          ) : latestVersion ? (
            <p className="text-xs text-muted-foreground">
              {t("settings.upToDate")}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={handleOpenPanShare}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("settings.openPanShare")}
            </Button>

            {platformAsset ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={handleDirectDownload}
                  disabled={!latestVersion}
                >
                  <Download className="h-3.5 w-3.5" />
                  {t("settings.panDirectDownload")}
                </Button>

                <Button
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={handleDownloadAndInstall}
                  disabled={isInstalling || !latestVersion}
                >
                  {isInstalling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {t("settings.panDownloadAndInstall")}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm font-medium">{t("settings.localEnvCheck")}</h3>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={loadToolVersions}
            disabled={isLoadingTools}
          >
            <RefreshCw
              className={
                isLoadingTools ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"
              }
            />
            {isLoadingTools ? t("common.refreshing") : t("common.refresh")}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {["claude", "codex", "gemini"].map((toolName, index) => {
            const tool = toolVersions.find((item) => item.name === toolName);
            const displayName = tool?.name ?? toolName;
            const title = tool?.version || tool?.error || t("common.unknown");

            return (
              <motion.div
                key={toolName}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.15 + index * 0.05 }}
                whileHover={{ scale: 1.02 }}
                className="flex flex-col gap-2 rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-4 shadow-sm transition-colors hover:border-primary/30"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium capitalize">
                      {displayName}
                    </span>
                  </div>
                  {isLoadingTools ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : tool?.version ? (
                    <div className="flex items-center gap-1.5">
                      {tool.latest_version &&
                        tool.version !== tool.latest_version && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20">
                            {tool.latest_version}
                          </span>
                        )}
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </div>
                  ) : (
                    <AlertCircle className="h-4 w-4 text-yellow-500" />
                  )}
                </div>
                <div
                  className="text-xs font-mono text-muted-foreground truncate"
                  title={title}
                >
                  {isLoadingTools
                    ? t("common.loading")
                    : tool?.version
                      ? tool.version
                      : tool?.error || t("common.notInstalled")}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.3 }}
        className="space-y-3"
      >
        <h3 className="text-sm font-medium px-1">
          {t("settings.oneClickInstall")}
        </h3>
        <div className="rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {t("settings.oneClickInstallHint")}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopyInstallCommands}
              className="h-7 gap-1.5 text-xs"
            >
              <Copy className="h-3.5 w-3.5" />
              {t("common.copy")}
            </Button>
          </div>
          <pre className="text-xs font-mono bg-background/80 px-3 py-2.5 rounded-lg border border-border/60 overflow-x-auto">
            {ONE_CLICK_INSTALL_COMMANDS}
          </pre>
        </div>
      </motion.div>
    </motion.section>
  );
}
