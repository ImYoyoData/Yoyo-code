import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { ReactNode } from "react";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import { modelEditorControlStyle } from "@/settings/model-provider-section/modelEditorControlStyle.js";
import type { ProviderSettingsModelListResult } from "@zcode/services";

type CatalogStatus = "idle" | "loading" | "ready" | "error";

/**
 * 模型 ID 输入框。可选地接入供应商目录：聚焦即按供应商 Base URL 拉取一次模型列表，
 * 供用户点选复填。手写 ID 始终可用，目录只是候选来源，不是唯一写入路径。
 *
 * 目录刻意渲染成弹窗内的内联区块而不是浮层：模态 Dialog 的 RemoveScroll 只把 dialog content
 * 当作可滚动区域，挂在 body 上的浮层会被拦掉滚轮事件，导致"能点不能滚"。
 */
export function ProviderModelIdField({
  value,
  readOnly = false,
  autoFocus = false,
  placeholder,
  onListModelIds,
  onChange,
  onBlur,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
}: {
  value: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  /** 未注入时不展示目录入口（例如编辑态或未装配拉取能力的宿主）。 */
  onListModelIds?: () => Promise<ProviderSettingsModelListResult>;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}) {
  const { intl } = useZCodeIntl();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const optionIdPrefix = useId();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CatalogStatus>("idle");
  const [modelIds, setModelIds] = useState<readonly string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  // 连续聚焦或手动刷新会并发请求，旧响应不能覆盖新结果。
  const requestTokenRef = useRef(0);

  const catalogAvailable = Boolean(onListModelIds) && !readOnly;
  const expanded = open && catalogAvailable;
  const keyword = value.trim().toLowerCase();
  const visibleModelIds =
    status === "ready" && keyword
      ? modelIds.filter((modelId) => modelId.toLowerCase().includes(keyword))
      : modelIds;

  const loadModelIds = useCallback(async () => {
    if (!onListModelIds) {
      return;
    }
    const token = requestTokenRef.current + 1;
    requestTokenRef.current = token;
    setStatus("loading");
    setErrorMessage(null);
    try {
      const result = await onListModelIds();
      if (requestTokenRef.current !== token) return;
      if (result.success) {
        setModelIds(result.modelIds);
        setStatus("ready");
        // 目录默认不预选：手写 ID 时回车必须仍然是保存，而不是落到第一项。
        setHighlightedIndex(-1);
        return;
      }
      setModelIds([]);
      setHighlightedIndex(-1);
      setStatus("error");
      setErrorMessage(resolveCatalogErrorMessage(intl, result.error));
    } catch (error) {
      if (requestTokenRef.current !== token) return;
      setModelIds([]);
      setHighlightedIndex(-1);
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [intl, onListModelIds]);

  useEffect(() => {
    if (!expanded) return;
    // 目录是内联区块，点输入框以外的任何地方都应收起，避免一直占着表单高度。
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [expanded]);

  const handleFocus = () => {
    if (!catalogAvailable) return;
    setOpen(true);
    // 聚焦即拉取一次；已经拿到的目录不重复请求，需要刷新时用列表头部的刷新按钮。
    if (status === "idle" || status === "error") {
      void loadModelIds();
    }
  };

  const selectModelId = (modelId: string) => {
    onChange(modelId);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (expanded) {
      if (event.key === "ArrowDown" && visibleModelIds.length > 0) {
        event.preventDefault();
        setHighlightedIndex((index) => (index + 1) % visibleModelIds.length);
        return;
      }
      if (event.key === "ArrowUp" && visibleModelIds.length > 0) {
        event.preventDefault();
        setHighlightedIndex(
          (index) => (index - 1 + visibleModelIds.length) % visibleModelIds.length,
        );
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      // 只有用户主动用方向键选中的候选才接管 Enter；目录默认没有高亮项，
      // 手写模型 ID 后回车仍然是原来的保存语义，不会被目录里的第一项顶掉。
      if (event.key === "Enter" && highlightedIndex >= 0) {
        const highlighted = visibleModelIds[highlightedIndex];
        if (highlighted) {
          event.preventDefault();
          selectModelId(highlighted);
          return;
        }
      }
    }
    onKeyDown?.(event);
  };

  return (
    <div ref={containerRef} className="space-y-1.5">
      <Input
        {...TECHNICAL_INPUT_ATTRIBUTES}
        ref={inputRef}
        type="text"
        autoFocus={autoFocus}
        size="lg"
        role={catalogAvailable ? "combobox" : undefined}
        aria-expanded={catalogAvailable ? expanded : undefined}
        aria-controls={expanded ? listboxId : undefined}
        aria-autocomplete={catalogAvailable ? "list" : undefined}
        aria-activedescendant={
          expanded && highlightedIndex >= 0 ? `${optionIdPrefix}-${highlightedIndex}` : undefined
        }
        className={cn("font-mono", modelEditorControlStyle(false))}
        readOnly={readOnly}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          // 改动关键字会让过滤结果变化，键盘高亮必须重置，
          // 否则回车可能选中一条已经不在视野里的候选。
          if (highlightedIndex >= 0) setHighlightedIndex(-1);
          onChange(event.target.value);
        }}
        onFocus={handleFocus}
        onBlur={(event) => {
          // Tab 到目录之外的字段时也要收起；点选候选项不会换焦点（mousedown 被阻止），不受影响。
          const nextFocus = event.relatedTarget as Node | null;
          if (!nextFocus || !containerRef.current?.contains(nextFocus)) {
            setOpen(false);
          }
          onBlur?.();
        }}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={handleKeyDown}
      />
      {expanded ? (
        <div className="overflow-hidden rounded-lg border border-input-border bg-input">
          <CatalogHeader
            status={status}
            count={visibleModelIds.length}
            onRefresh={() => void loadModelIds()}
            refreshLabel={intl.formatMessage({
              id: "settings.modelProvider.modelIdCatalog.refresh",
            })}
          />
          {status === "loading" ? (
            <CatalogNotice>
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
              {intl.formatMessage({ id: "settings.modelProvider.modelIdCatalog.loading" })}
            </CatalogNotice>
          ) : status === "error" ? (
            <div className="space-y-2 p-2">
              <p className="text-ui-base text-warning">
                {intl.formatMessage({ id: "settings.modelProvider.modelIdCatalog.failed" })}
              </p>
              {errorMessage ? (
                <p className="break-all text-ui-sm text-foreground-subtlest">{errorMessage}</p>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => void loadModelIds()}>
                {intl.formatMessage({ id: "common.retry" })}
              </Button>
            </div>
          ) : visibleModelIds.length === 0 ? (
            <CatalogNotice>
              {intl.formatMessage({
                id:
                  status === "ready" && keyword
                    ? "settings.modelProvider.modelIdCatalog.filteredEmpty"
                    : "settings.modelProvider.modelIdCatalog.empty",
              })}
            </CatalogNotice>
          ) : (
            <ul
              id={listboxId}
              role="listbox"
              aria-label={intl.formatMessage({
                id: "settings.modelProvider.modelIdCatalog.title",
              })}
              className="max-h-56 overflow-y-auto py-1"
            >
              {visibleModelIds.map((modelId, index) => (
                <li key={modelId}>
                  <button
                    type="button"
                    id={`${optionIdPrefix}-${index}`}
                    role="option"
                    aria-selected={index === highlightedIndex}
                    data-model-id-option={modelId}
                    // 指针按下不抢输入框焦点，避免刚展开就因失焦关闭列表。
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectModelId(modelId)}
                    className={cn(
                      "flex w-full items-center truncate rounded-md px-2 py-1.5 text-left font-mono text-ui-base",
                      // 悬停只做视觉反馈，不改键盘高亮：否则鼠标划过一项后回车会误选它。
                      index === highlightedIndex
                        ? "bg-hover text-foreground"
                        : "text-foreground-subtle hover:bg-hover/60 hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{modelId}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CatalogHeader({
  status,
  count,
  refreshLabel,
  onRefresh,
}: {
  status: CatalogStatus;
  count: number;
  refreshLabel: string;
  onRefresh: () => void;
}) {
  const { intl } = useZCodeIntl();
  if (status !== "ready") {
    return null;
  }
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1">
      <span className="truncate text-ui-sm text-foreground-subtlest">
        {intl.formatMessage({ id: "settings.modelProvider.modelIdCatalog.count" }, { count })}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={refreshLabel}
        title={refreshLabel}
        onClick={onRefresh}
      >
        <RefreshCwIcon className="size-3.5" />
      </Button>
    </div>
  );
}

function CatalogNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-2 py-3 text-ui-base text-foreground-subtle">
      {children}
    </div>
  );
}

/** 已知失败码映射成本地化文案；其余情况直接展示服务层细节，避免"拉取失败"后再无线索。 */
function resolveCatalogErrorMessage(
  intl: ReturnType<typeof useZCodeIntl>["intl"],
  error: { code: string; message: string },
): string {
  if (error.code === "provider-credentials-required") {
    return intl.formatMessage({ id: "settings.modelProvider.modelIdCatalog.credentialsRequired" });
  }
  if (error.code === "provider-not-found") {
    return intl.formatMessage({ id: "settings.modelProvider.modelIdCatalog.providerMissing" });
  }
  return error.message.trim();
}
