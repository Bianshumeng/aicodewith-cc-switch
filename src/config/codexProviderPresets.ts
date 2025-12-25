/**
 * Codex 预设供应商配置模板
 */
import { ProviderCategory } from "../types";
import type { PresetTheme } from "./claudeProviderPresets";

export interface CodexProviderPreset {
  name: string;
  websiteUrl: string;
  // 第三方供应商可提供单独的获取 API Key 链接
  apiKeyUrl?: string;
  auth: Record<string, any>; // 将写入 ~/.codex/auth.json
  config: string; // 将写入 ~/.codex/config.toml（TOML 字符串）
  isOfficial?: boolean; // 标识是否为官方预设
  isPartner?: boolean; // 标识是否为商业合作伙伴
  partnerPromotionKey?: string; // 合作伙伴促销信息的 i18n key
  category?: ProviderCategory; // 新增：分类
  isCustomTemplate?: boolean; // 标识是否为自定义模板
  // 新增：请求地址候选列表（用于地址管理/测速）
  endpointCandidates?: string[];
  // 新增：视觉主题配置
  theme?: PresetTheme;
  // 图标配置
  icon?: string; // 图标名称
  iconColor?: string; // 图标颜色
}

/**
 * 生成第三方供应商的 auth.json
 */
export function generateThirdPartyAuth(apiKey: string): Record<string, any> {
  return {
    OPENAI_API_KEY: apiKey || "",
  };
}

/**
 * 生成第三方供应商的 config.toml
 */
export function generateThirdPartyConfig(
  providerName: string,
  baseUrl: string,
  modelName = "gpt-5.1-codex",
): string {
  // 清理供应商名称，确保符合TOML键名规范
  const cleanProviderName =
    providerName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/^_+|_+$/g, "") || "custom";

  return `model_provider = "${cleanProviderName}"
model = "${modelName}"
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.${cleanProviderName}]
name = "${cleanProviderName}"
base_url = "${baseUrl}"
wire_api = "responses"
requires_openai_auth = true`;
}

export const codexProviderPresets: CodexProviderPreset[] = [
  {
    name: "AI Code With",
    websiteUrl: "https://aicodewith.com",
    apiKeyUrl: "https://aicodewith.com/dashboard/api-keys",
    category: "aggregator",
    auth: generateThirdPartyAuth(""),
    config: `model_provider = "aicodewith"
model = "gpt-5.2"
model_reasoning_effort = "high"
disable_response_storage = true
preferred_auth_method = "apikey"
requires_openai_auth = true

[model_providers.aicodewith]
name = "aicodewith"
base_url = "https://api.aicodewith.com/chatgpt/v1"
wire_api = "responses"`,
    endpointCandidates: ["https://api.aicodewith.com/chatgpt/v1"],
    icon: "aicodewith",
    iconColor: "#111111",
  },
];

