import { useEffect, useMemo } from "react";
import type { QueueState } from "@zcode/shared/zcode-protocol-v4";
import { matchesShortcutBinding } from "@/shortcuts/bindings.js";
import {
  useEffectiveShortcutBindings,
  useShortcutCommandLabel,
} from "@/shortcuts/useShortcutBindings.js";

export function useQueueShortcuts({
  queue,
  activeQueueItemId,
  onSendGuide,
  onSendNow,
  enabled = true,
}: {
  queue: QueueState;
  activeQueueItemId: string | null;
  onSendGuide?: (queueItemId: string) => void;
  onSendNow?: (queueItemId: string) => void;
  enabled?: boolean;
}): { guideShortcut: string; sendNowShortcut: string } {
  const effectiveBindings = useEffectiveShortcutBindings();
  const guideShortcut = useShortcutCommandLabel("queueSendGuide");
  const sendNowShortcut = useShortcutCommandLabel("queueSendNow");
  const guideTarget = useMemo(() => {
    const active = queue.items.find(
      (item) => item.queueItemId === activeQueueItemId && item.dispatch.state === "queued",
    );
    if (active?.kind === "sendText") return active;
    return queue.items.find(
      (item) => item.kind === "sendText" && item.dispatch.state === "queued",
    );
  }, [activeQueueItemId, queue.items]);
  const sendNowTarget = useMemo(() => {
    const active = queue.items.find(
      (item) => item.queueItemId === activeQueueItemId && item.dispatch.state === "queued",
    );
    return active ?? queue.items.find((item) => item.dispatch.state === "queued");
  }, [activeQueueItemId, queue.items]);

  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      if (
        guideTarget &&
        onSendGuide &&
        effectiveBindings.queueSendGuide.some((binding) => matchesShortcutBinding(event, binding))
      ) {
        event.preventDefault();
        onSendGuide(guideTarget.queueItemId);
        return;
      }
      if (
        sendNowTarget &&
        onSendNow &&
        effectiveBindings.queueSendNow.some((binding) => matchesShortcutBinding(event, binding))
      ) {
        event.preventDefault();
        onSendNow(sendNowTarget.queueItemId);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [effectiveBindings, enabled, guideTarget, onSendGuide, onSendNow, sendNowTarget]);

  return { guideShortcut, sendNowShortcut };
}
