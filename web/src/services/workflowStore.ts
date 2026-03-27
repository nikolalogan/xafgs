import type { Edge, Node } from "@xyflow/react";
import type { BaseNodeData } from "../pages/WorkflowEditor/utils/types";

export type WorkflowRecord = {
  id: number;
  workflow_code: string;
  name: string;
  version?: string;
  status?: string;
  is_public?: boolean;
  summary?: string;
  workflow_description?: string;
  owner?: string;
  tags?: string[];
  metadata_json?: string;
  definition_json: {
    nodes: Node<BaseNodeData, "baseNode">[];
    edges: Edge[];
  };
  updated_at: string;
};

const STORAGE_KEY = "workflow:records";

function readRecords(): WorkflowRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as WorkflowRecord[];
  } catch {
    return [];
  }
}

function writeRecords(records: WorkflowRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function getWorkflowByCode(code: string) {
  const records = readRecords();
  return records.find((item) => item.workflow_code === code) ?? null;
}

export function saveWorkflow(record: Omit<WorkflowRecord, "id" | "updated_at"> & { id?: number }) {
  const records = readRecords();
  const now = new Date().toISOString();
  const existed = records.find((item) => item.workflow_code === record.workflow_code);

  if (existed) {
    const merged: WorkflowRecord = {
      ...existed,
      ...record,
      id: existed.id,
      updated_at: now
    };
    const next = records.map((item) => (item.workflow_code === merged.workflow_code ? merged : item));
    writeRecords(next);
    return merged;
  }

  const created: WorkflowRecord = {
    ...record,
    id: record.id ?? Date.now(),
    updated_at: now
  };
  writeRecords([created, ...records]);
  return created;
}

export function saveRunnerPayload(payload: unknown) {
  const key = `flow_payload_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(key, JSON.stringify(payload));
  return key;
}

export function getRunnerPayload(key: string) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
