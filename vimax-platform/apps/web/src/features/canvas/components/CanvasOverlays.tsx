"use client";

import { ContextMenu } from "@vimax/ui";
import { Trash2, Copy, Play, LayoutTemplate } from "lucide-react";
import { VideoWorkbench } from "../../workbench/VideoWorkbench";
import { useCanvas } from "../canvas-context";

export function CanvasOverlays() {
  const {
    ctxMenu,
    setCtxMenu,
    runNode,
    isRunning,
    handleCopyNode,
    handleDeleteNode,
    handleContextAutoLayout,
    workbenchId,
    setWorkbenchId,
  } = useCanvas();

  return (
    <>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={
            ctxMenu.nodeId
              ? [
                  {
                    label: "运行节点",
                    icon: <Play className="size-3.5" />,
                    onClick: () => {
                      if (ctxMenu.nodeId) void runNode(ctxMenu.nodeId);
                    },
                    disabled: isRunning,
                  },
                  {
                    label: "复制节点",
                    icon: <Copy className="size-3.5" />,
                    onClick: () => {
                      if (ctxMenu.nodeId) handleCopyNode(ctxMenu.nodeId);
                    },
                  },
                  {
                    label: "删除节点",
                    icon: <Trash2 className="size-3.5" />,
                    onClick: () => {
                      if (ctxMenu.nodeId) handleDeleteNode(ctxMenu.nodeId);
                    },
                    danger: true,
                  },
                ]
              : [
                  {
                    label: "全部布局 (Dagre)",
                    icon: <LayoutTemplate className="size-3.5" />,
                    onClick: handleContextAutoLayout,
                  },
                ]
          }
        />
      )}

      {workbenchId && (
        <VideoWorkbench workbenchId={workbenchId} onClose={() => setWorkbenchId(null)} />
      )}
    </>
  );
}
