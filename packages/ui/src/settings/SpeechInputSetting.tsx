import { useCallback, useEffect, useState } from "react";
import type {
  IPlatformService,
  SpeechAssetStatus,
  SpeechPrepareProgress,
} from "@zcode/shared";
import {
  TID_SETTINGS_SPEECH_DOWNLOAD,
  TID_SETTINGS_SPEECH_SWITCH,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const ERROR_MESSAGE_IDS: Record<string, string> = {
  runtime_download_failed: "settings.speech.error.runtimeDownload",
  model_download_failed: "settings.speech.error.modelDownload",
  runtime_extract_failed: "settings.speech.error.runtimeExtract",
  speech_download_failed: "settings.speech.error.download",
  unsupported_platform: "settings.speech.unsupported",
};

export function SpeechInputSetting({
  enabled,
  onEnabledChange,
  platform,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void | Promise<void>;
  platform?: IPlatformService;
}) {
  const { intl } = useZCodeIntl();
  const supported = typeof platform?.speechGetStatus === "function";
  const [status, setStatus] = useState<SpeechAssetStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<SpeechPrepareProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!platform?.speechGetStatus) {
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      setStatus(await platform.speechGetStatus());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "speech_status_failed");
    } finally {
      setChecking(false);
    }
  }, [platform]);

  useEffect(() => {
    if (!supported) {
      setChecking(false);
      return;
    }
    void refreshStatus();
    return platform?.onSpeechProgress?.((next) => setProgress(next));
  }, [platform, refreshStatus, supported]);

  const handleDownload = useCallback(async () => {
    if (!platform?.speechEnsureAssets || downloading) return;
    setDownloading(true);
    setError(null);
    setProgress(null);
    try {
      const next = await platform.speechEnsureAssets();
      setStatus(next);
      if (!next.ready) setError(next.reason ?? "speech_assets_not_ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "speech_assets_not_ready");
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  }, [downloading, platform]);

  const ready = status?.ready === true;
  const statusTextId = checking
    ? "settings.speech.checking"
    : ready
      ? "settings.speech.ready"
      : status?.runtimeReady
        ? "settings.speech.modelMissing"
        : status?.modelReady
          ? "settings.speech.runtimeMissing"
          : "settings.speech.notReady";
  const percent = progress?.percent;
  const downloadLabel = downloading
    ? percent === undefined
      ? intl.formatMessage({ id: "settings.speech.downloading" })
      : intl.formatMessage({ id: "settings.speech.downloadingPercent" }, { percent })
    : intl.formatMessage({ id: "settings.speech.download" });
  const errorMessageId = error ? (ERROR_MESSAGE_IDS[error] ?? "settings.speech.error.generic") : null;

  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.speech.title" })}
        description={intl.formatMessage({ id: "settings.speech.description" })}
        control={
          <Switch
            aria-label={intl.formatMessage({ id: "settings.speech.title" })}
            data-testid={TID_SETTINGS_SPEECH_SWITCH}
            checked={enabled}
            disabled={!supported || checking || (!ready && !enabled)}
            onCheckedChange={(checked) => {
              void onEnabledChange(checked);
            }}
          />
        }
        detail={
          <div className="space-y-2 text-ui-base text-foreground-subtle">
            {supported ? (
              <>
                <p>{intl.formatMessage({ id: statusTextId })}</p>
                {!ready ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      data-testid={TID_SETTINGS_SPEECH_DOWNLOAD}
                      disabled={downloading}
                      onClick={() => void handleDownload()}
                    >
                      {downloadLabel}
                    </Button>
                    <span>{intl.formatMessage({ id: "settings.speech.downloadSourceHint" })}</span>
                  </div>
                ) : null}
              </>
            ) : (
              <p>{intl.formatMessage({ id: "settings.speech.unsupported" })}</p>
            )}
            {errorMessageId ? (
              <p role="alert" className="text-[var(--color-warning)]">
                {intl.formatMessage({ id: errorMessageId })}
              </p>
            ) : null}
            <p className="text-ui-sm text-foreground-subtlest">
              {intl.formatMessage({ id: "settings.speech.privacy" })}
            </p>
          </div>
        }
      />
    </SettingsGroupCard>
  );
}
