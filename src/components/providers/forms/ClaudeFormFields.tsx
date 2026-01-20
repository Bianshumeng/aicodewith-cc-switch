import { useTranslation } from "react-i18next";
import { FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import EndpointSpeedTest from "./EndpointSpeedTest";
import { ApiKeySection, EndpointField } from "./shared";
import type { ProviderCategory } from "@/types";
import type { TemplateValueConfig } from "@/config/claudeProviderPresets";

interface EndpointCandidate {
  url: string;
}

interface ClaudeFormFieldsProps {
  providerId?: string;
  // API Key
  shouldShowApiKey: boolean;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  category?: ProviderCategory;
  shouldShowApiKeyLink: boolean;
  websiteUrl: string;
  isPartner?: boolean;
  partnerPromotionKey?: string;

  // Template Values
  templateValueEntries: Array<[string, TemplateValueConfig]>;
  templateValues: Record<string, TemplateValueConfig>;
  templatePresetName: string;
  onTemplateValueChange: (key: string, value: string) => void;

  // Base URL
  shouldShowSpeedTest: boolean;
  baseUrl: string;
  onBaseUrlChange: (url: string) => void;
  isEndpointModalOpen: boolean;
  onEndpointModalToggle: (open: boolean) => void;
  onCustomEndpointsChange?: (endpoints: string[]) => void;

  // Claude Plugin Integration
  pluginIntegrationEnabled: boolean;
  pluginConfigPath: string;
  isPluginConfigPathLoading: boolean;
  isPluginIntegrationDisabled: boolean;
  onPluginIntegrationToggle: (enabled: boolean) => void;

  // Speed Test Endpoints
  speedTestEndpoints: EndpointCandidate[];
}

export function ClaudeFormFields({
  providerId,
  shouldShowApiKey,
  apiKey,
  onApiKeyChange,
  category,
  shouldShowApiKeyLink,
  websiteUrl,
  isPartner,
  partnerPromotionKey,
  templateValueEntries,
  templateValues,
  templatePresetName,
  onTemplateValueChange,
  shouldShowSpeedTest,
  baseUrl,
  onBaseUrlChange,
  isEndpointModalOpen,
  onEndpointModalToggle,
  onCustomEndpointsChange,
  pluginIntegrationEnabled,
  pluginConfigPath,
  isPluginConfigPathLoading,
  isPluginIntegrationDisabled,
  onPluginIntegrationToggle,
  speedTestEndpoints,
}: ClaudeFormFieldsProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* API Key 输入框 */}
      {shouldShowApiKey && (
        <ApiKeySection
          value={apiKey}
          onChange={onApiKeyChange}
          category={category}
          shouldShowLink={shouldShowApiKeyLink}
          websiteUrl={websiteUrl}
          isPartner={isPartner}
          partnerPromotionKey={partnerPromotionKey}
        />
      )}

      {/* 模板变量输入 */}
      {templateValueEntries.length > 0 && (
        <div className="space-y-3">
          <FormLabel>
            {t("providerForm.parameterConfig", {
              name: templatePresetName,
              defaultValue: `${templatePresetName} 参数配置`,
            })}
          </FormLabel>
          <div className="space-y-4">
            {templateValueEntries.map(([key, config]) => (
              <div key={key} className="space-y-2">
                <FormLabel htmlFor={`template-${key}`}>
                  {config.label}
                </FormLabel>
                <Input
                  id={`template-${key}`}
                  type="text"
                  required
                  value={
                    templateValues[key]?.editorValue ??
                    config.editorValue ??
                    config.defaultValue ??
                    ""
                  }
                  onChange={(e) => onTemplateValueChange(key, e.target.value)}
                  placeholder={config.placeholder || config.label}
                  autoComplete="off"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Base URL 输入框 */}
      {shouldShowSpeedTest && (
        <EndpointField
          id="baseUrl"
          label={t("providerForm.apiEndpoint")}
          value={baseUrl}
          onChange={onBaseUrlChange}
          placeholder={t("providerForm.apiEndpointPlaceholder")}
          hint={t("providerForm.apiHint")}
          onManageClick={() => onEndpointModalToggle(true)}
        />
      )}

      {/* 端点测速弹窗 */}
      {shouldShowSpeedTest && isEndpointModalOpen && (
        <EndpointSpeedTest
          appId="claude"
          providerId={providerId}
          value={baseUrl}
          onChange={onBaseUrlChange}
          initialEndpoints={speedTestEndpoints}
          visible={isEndpointModalOpen}
          onClose={() => onEndpointModalToggle(false)}
          onCustomEndpointsChange={onCustomEndpointsChange}
        />
      )}

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <FormLabel>
              {t("settings.enableClaudePluginIntegration", {
                defaultValue: "应用到 Claude Code 插件",
              })}
            </FormLabel>
            <p className="text-xs text-muted-foreground">
              {t("settings.enableClaudePluginIntegrationDescription", {
                defaultValue:
                  "开启后 Vscode Claude Code 插件的供应商将随本软件切换",
              })}
            </p>
          </div>
          <Switch
            checked={pluginIntegrationEnabled}
            onCheckedChange={onPluginIntegrationToggle}
            disabled={isPluginIntegrationDisabled}
            aria-label={t("settings.enableClaudePluginIntegration", {
              defaultValue: "应用到 Claude Code 插件",
            })}
          />
        </div>

        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {t("providerForm.claudePluginConfigPath", {
                defaultValue: "配置路径",
              })}
            </p>
            <p className="text-xs font-mono break-all text-foreground/80">
              {isPluginConfigPathLoading
                ? t("providerForm.claudePluginConfigPathLoading", {
                    defaultValue: "正在读取...",
                  })
                : pluginConfigPath}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {t("providerForm.claudePluginConfigContent", {
                defaultValue: "写入内容",
              })}
            </p>
            <pre className="text-xs font-mono bg-background/80 px-3 py-2 rounded-lg border border-border/60 overflow-x-auto whitespace-pre-wrap">
{`{
  "primaryApiKey": "any"
}`}
            </pre>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("providerForm.claudePluginConfigHint", {
              defaultValue:
                "仅非官方供应商会写入该文件；官方供应商不改写；关闭开关将移除 primaryApiKey。",
            })}
          </p>
        </div>
      </div>
    </>
  );
}
