import { useCallback, useRef, useState } from "react";
import type { ModelConfigObject, ModelConfigResolution } from "@zcode/provider";
import type { ProviderSettingsFormModel } from "@/lib/providerSettingsFormTypes.js";
import {
  createProviderModelDraftValues,
  resolveProviderModelDraftCommit,
  type ProviderModelDraftCommitResult,
  type ProviderModelDraftValues,
} from "@/settings/model-provider-section/ProviderModelMetadata.js";
import {
  modelDraftOverrides,
  projectModelDraft,
  updateModelDraft,
  restoreModelDraft,
} from "@/settings/model-provider-section/ProviderModelDraftState.js";
import {
  applyCatalogPersonalConfig,
  mergeCatalogConfig,
  unverifiedCapabilityFields,
  withFallbackCapabilities,
} from "@/settings/model-provider-section/ProviderModelCatalogDraft.js";
import { useModelConfigResolution } from "@/settings/model-provider-section/useModelConfigResolution.js";

/** 添加和编辑共享推荐生命周期；业务入口仅保留初始化、权限与各自的保存事务。 */
export function useProviderModelDraft({
  model,
  open,
  scopeKey,
  resolve,
  catalogConfig,
}: {
  model: ProviderSettingsFormModel;
  open: boolean;
  scopeKey: string;
  resolve?: (modelId: string, personalConfig: ModelConfigObject) => Promise<ModelConfigResolution>;
  /** Provider 端点 `/models` 为当前模型声明的能力；压在规则目录结果之上。 */
  catalogConfig?: ModelConfigObject | null;
}) {
  const [rawDraft, setRawDraft] = useState(() => createProviderModelDraftValues(model));
  const [draftScope, setDraftScope] = useState(scopeKey);
  const editGeneration = useRef(0);
  if (draftScope !== scopeKey) {
    // 切换供应商必须同时丢弃旧草稿和旧请求，不能把上一供应商的用户意图带到新目标。
    setDraftScope(scopeKey);
    setRawDraft(createProviderModelDraftValues(model));
  }
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const resolveRecommended = useCallback(
    (id: string) => {
      if (!resolveRef.current) throw new Error("Model Config Resolution 未配置");
      // 公共草稿持有个人意图；只向 Host 取推荐基线，不用半有效表单拼装第二份 Overlay。
      return resolveRef.current(id, {});
    },
    [scopeKey],
  );
  const smart = rawDraft.useRecommendedConfigValue !== false;
  const originalModelId =
    model.useRecommendedConfig !== false && !rawDraft.clearPersonalConfigValue
      ? model.modelId
      : undefined;
  const config = useModelConfigResolution({
    open,
    enabled: smart,
    modelId: rawDraft.idValue,
    originalModelId,
    resolve: resolve ? resolveRecommended : undefined,
  });
  const modelWithResolution = (
    resolution: ModelConfigResolution | null | undefined,
  ): ProviderSettingsFormModel => {
    if (resolution) {
      // 合成后再投影：控件、校验和提交必须看到同一份基线，
      // 否则会出现"界面显示端点声明值、保存后按目录值生效"。
      const merged = mergeCatalogConfig(resolution.inheritedConfig, catalogConfig);
      return { ...model, inheritedConfig: merged, config: merged };
    }
    if (rawDraft.idValue.trim() === model.modelId) return model;
    return { ...model, config: {}, inheritedConfig: undefined };
  };
  const currentModel = modelWithResolution(config.resolution);
  const draft = projectModelDraft(rawDraft, currentModel);
  const change = (patch: Partial<ProviderModelDraftValues>) => {
    editGeneration.current += 1;
    setRawDraft(updateModelDraft(draft, patch, currentModel));
  };
  const reset = (nextModel: ProviderSettingsFormModel) => {
    editGeneration.current += 1;
    config.cancel();
    setRawDraft(createProviderModelDraftValues(nextModel));
  };
  const restore = async () => {
    const generation = ++editGeneration.current;
    const apply = (resolvedModel: ProviderSettingsFormModel) =>
      setRawDraft(restoreModelDraft(draft, resolvedModel));
    if (!draft.idValue.trim() || !resolve) {
      config.cancel();
      apply(currentModel);
      return;
    }
    await config.restore({
      isCurrent: () => editGeneration.current === generation,
      apply: (resolution) => apply(modelWithResolution(resolution)),
    });
  };
  const unverifiedFields = unverifiedCapabilityFields({
    catalogConfig,
    hasModelSpecificRule: config.resolution?.hasModelSpecificRule ?? false,
  });
  const commit = async () => {
    editGeneration.current += 1;
    const requiresResolution = smart && resolve && rawDraft.idValue.trim() !== originalModelId;
    const resolution = requiresResolution
      ? (config.resolution ?? (await config.flush()))
      : config.resolution;
    if (requiresResolution && !resolution) throw new Error("Model Config Resolution 尚未就绪");
    const resolvedModel = modelWithResolution(resolution);
    const committed = resolveProviderModelDraftCommit({
      currentModel: resolvedModel,
      draft: projectModelDraft(rawDraft, resolvedModel),
    });
    // 端点声明必须落进个人配置：只改显示层会让运行时继续按规则目录的推断值执行。
    // 固定配置模式下 effective 已被整体物化，无需再补。
    if (committed.status !== "commit" || !smart) return committed;
    // 没有可靠来源的能力项写默认兜底参数，让用户看到的是确定值而不是隐式推断。
    const unverified = unverifiedCapabilityFields({
      catalogConfig,
      hasModelSpecificRule: resolution?.hasModelSpecificRule ?? false,
    });
    const seedConfig = withFallbackCapabilities(catalogConfig, unverified);
    if (!seedConfig) return committed;
    const personalConfig = applyCatalogPersonalConfig({
      personalConfig: committed.model.personalConfig,
      catalog: seedConfig,
      draft: projectModelDraft(rawDraft, resolvedModel),
    });
    return {
      status: "commit",
      model: {
        ...committed.model,
        personalConfig,
        hasPersonalConfig: Object.keys(personalConfig).length > 0,
      },
    } satisfies ProviderModelDraftCommitResult;
  };
  return {
    draft,
    change,
    reset,
    restore,
    commit,
    overrides: modelDraftOverrides(draft),
    inheritedConfig: currentModel.inheritedConfig,
    /** 没有可靠来源、需要用户确认的能力项；非空时界面必须提示。 */
    unverifiedFields,
    pending:
      smart &&
      Boolean(resolve) &&
      rawDraft.idValue.trim() !== originalModelId &&
      !config.resolution,
    defaultsLoaded: smart && config.defaultsLoaded,
    flush: config.flush,
    cancel: config.cancel,
  };
}
