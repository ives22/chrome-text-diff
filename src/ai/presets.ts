import type { ModelProvider } from "./types";

export interface ModelPreset {
  id: "openai" | "deepseek" | "qwen-cn" | "qwen-intl" | "custom";
  name: string;
  provider: ModelProvider;
  baseUrl: string;
  modelPlaceholder: string;
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    modelPlaceholder: "输入 OpenAI 模型 ID",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    modelPlaceholder: "例如 deepseek-chat",
  },
  {
    id: "qwen-cn",
    name: "Qwen 中国",
    provider: "qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelPlaceholder: "输入 Qwen 模型 ID",
  },
  {
    id: "qwen-intl",
    name: "Qwen 国际",
    provider: "qwen",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    modelPlaceholder: "输入 Qwen 模型 ID",
  },
  {
    id: "custom",
    name: "自定义兼容接口",
    provider: "custom",
    baseUrl: "",
    modelPlaceholder: "输入模型 ID",
  },
];
