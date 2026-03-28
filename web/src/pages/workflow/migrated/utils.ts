import { NodeRunningStatus } from "./types";

export const cn = (...classNames: Array<string | false | null | undefined>) => classNames.filter(Boolean).join(" ");

export const getEdgeColor = (status?: NodeRunningStatus, isFailure = false) => {
  if (isFailure) return "#f79009";
  if (status === NodeRunningStatus.Running) return "#296dff";
  if (status === NodeRunningStatus.Succeeded) return "#17b26a";
  if (status === NodeRunningStatus.Failed || status === NodeRunningStatus.Exception) return "#f04438";
  return "#d0d5dc";
};

export const hasErrorHandleNode = (type: string) => {
  return type === "llm" || type === "http-request" || type === "code" || type === "tool";
};

