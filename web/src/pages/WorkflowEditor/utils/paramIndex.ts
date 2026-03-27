import type { Edge, Node } from "@xyflow/react";
import type { BaseNodeData, GlobalParamDefinition } from "./types";
import { composeCustomFieldCode, resolveFormIdentifier, resolveSchemaFieldIdentifier } from "./formKeys";
import { getAncestorNodeIDs, hasWorkflowCycle } from "./workflowGraph";

export type ParamUsage = {
  paramKey: string;
  paramField: string;
  readerNodeId: string;
  readerFieldPath: string;
};

export type ParamRemovalImpact = {
  paramKey: string;
  paramField: string;
  readerNodeId: string;
  readerNodeName: string;
  readerFieldPath: string;
};

const normalizeField = (field?: string, fallback?: string) => {
  const trimmed = (field ?? "").trim();
  return trimmed || fallback || "";
};

const toParamKey = (writerNodeID: string, field: string) => `${writerNodeID}::${field}`;

type ParamDefinitionMap = Map<string, GlobalParamDefinition>;

export function buildParamDefinitions(nodes: Node<BaseNodeData, "baseNode">[]) {
  const definitions: ParamDefinitionMap = new Map<string, GlobalParamDefinition>();

  const ensureDefinition = (
    writerNode: Node<BaseNodeData, "baseNode">,
    payload: {
      id: string;
      name: string;
      field: string;
      type: GlobalParamDefinition["type"];
      options?: GlobalParamDefinition["options"];
    }
  ) => {
    const field = normalizeField(payload.field);
    if (!field) return;
    const paramKey = toParamKey(writerNode.id, field);
    definitions.set(paramKey, {
      id: payload.id,
      name: payload.name || field,
      field,
      type: payload.type,
      options: payload.options,
      writerNodeId: writerNode.id,
      writerNodeType: writerNode.type ?? "-",
      writerNodeCode: writerNode.data?.code ?? "",
      consumerNodeIds: []
    });
  };

  nodes.forEach((node) => {
    const forms = node.data?.params?.forms ?? [];
    forms.forEach((form, formIndex) => {
      const formIdentifier = resolveFormIdentifier(form, formIndex);
      (form.items ?? []).forEach((item, itemIndex) => {
        if (item.type === "customForm") {
          const schemaList = Array.isArray(item.schema) ? item.schema : [];
          schemaList.forEach((schemaItem, schemaIndex) => {
            if (!schemaItem || schemaItem.type === "divider") return;
            const fieldIdentifier = resolveSchemaFieldIdentifier(schemaItem, schemaIndex);
            const combinedField = composeCustomFieldCode(formIdentifier, fieldIdentifier);
            ensureDefinition(node, {
              id: `${node.id}:${form.id ?? formIdentifier}:${schemaItem.id ?? fieldIdentifier}`,
              name: schemaItem.label || schemaItem.name || combinedField,
              field: combinedField,
              type: "customForm"
            });
          });
          return;
        }

        ensureDefinition(node, {
          id: `${node.id}:${item.id}`,
          name: item.label || item.field || "未命名参数",
          field: normalizeField(item.field, item.id),
          type: item.type,
          options: item.options
        });
      });
    });

    (node.data?.params?.jsConfig?.outputs ?? []).forEach((output) => {
      ensureDefinition(node, {
        id: `${node.id}:${output.id}`,
        name: output.label || output.field || "未命名参数",
        field: normalizeField(output.field, output.id),
        type: output.type,
        options: output.options
      });
    });

    (node.data?.params?.httpConfig?.outputs ?? []).forEach((output) => {
      ensureDefinition(node, {
        id: `${node.id}:${output.id}`,
        name: output.label || output.field || "未命名参数",
        field: normalizeField(output.field, output.id),
        type: output.type,
        options: output.options
      });
    });
  });

  return definitions;
}

function gatherReaderFieldUsages(node: Node<BaseNodeData, "baseNode">) {
  const usages: Array<{ field: string; fieldPath: string }> = [];
  (node.data?.params?.jsConfig?.inputs ?? []).forEach((field, index) => {
    const normalized = normalizeField(field);
    if (!normalized) return;
    usages.push({ field: normalized, fieldPath: `jsConfig.inputs[${index}]` });
  });
  (node.data?.params?.decisionConfig?.inputs ?? []).forEach((field, index) => {
    const normalized = normalizeField(field);
    if (!normalized) return;
    usages.push({ field: normalized, fieldPath: `decisionConfig.inputs[${index}]` });
  });
  (node.data?.params?.httpConfig?.inputs ?? []).forEach((field, index) => {
    const normalized = normalizeField(field);
    if (!normalized) return;
    usages.push({ field: normalized, fieldPath: `httpConfig.inputs[${index}]` });
  });
  return usages;
}

export function buildParamUsages(
  nodes: Node<BaseNodeData, "baseNode">[],
  edges: Edge[],
  definitions: ParamDefinitionMap
) {
  const usages: ParamUsage[] = [];
  const definitionsByField = new Map<string, GlobalParamDefinition[]>();
  definitions.forEach((definition) => {
    const list = definitionsByField.get(definition.field) ?? [];
    list.push(definition);
    definitionsByField.set(definition.field, list);
  });

  nodes.forEach((node) => {
    const ancestors = getAncestorNodeIDs(node.id, edges);
    const fieldUsages = gatherReaderFieldUsages(node);
    fieldUsages.forEach((usage) => {
      const candidates = (definitionsByField.get(usage.field) ?? []).filter((definition) => ancestors.has(definition.writerNodeId));
      candidates.forEach((candidate) => {
        usages.push({
          paramKey: toParamKey(candidate.writerNodeId, candidate.field),
          paramField: candidate.field,
          readerNodeId: node.id,
          readerFieldPath: usage.fieldPath
        });
      });
    });
  });

  return usages;
}

export function buildParamGraphIndex(nodes: Node<BaseNodeData, "baseNode">[], edges: Edge[]) {
  const definitions = buildParamDefinitions(nodes);
  const usages = buildParamUsages(nodes, edges, definitions);
  const nodeNameMap = new Map(nodes.map((node) => [node.id, node.data?.name || node.id]));

  const usageMap = new Map<string, ParamUsage[]>();
  usages.forEach((usage) => {
    const list = usageMap.get(usage.paramKey) ?? [];
    list.push(usage);
    usageMap.set(usage.paramKey, list);
  });

  const params = Array.from(definitions.entries()).map(([key, definition]) => ({
    ...definition,
    consumerNodeIds: Array.from(new Set((usageMap.get(key) ?? []).map((usage) => usage.readerNodeId)))
  }));

  return {
    params,
    definitions,
    usages,
    hasCycle: hasWorkflowCycle(nodes, edges),
    findImpactsByNodeDelete(nodeID: string): ParamRemovalImpact[] {
      const impacts: ParamRemovalImpact[] = [];
      definitions.forEach((definition, key) => {
        if (definition.writerNodeId !== nodeID) return;
        const list = usageMap.get(key) ?? [];
        list.forEach((usage) => {
          impacts.push({
            paramKey: usage.paramKey,
            paramField: usage.paramField,
            readerNodeId: usage.readerNodeId,
            readerNodeName: nodeNameMap.get(usage.readerNodeId) ?? usage.readerNodeId,
            readerFieldPath: usage.readerFieldPath
          });
        });
      });
      return impacts;
    },
    findImpactsByParamDelete(writerNodeID: string, paramField: string): ParamRemovalImpact[] {
      const key = toParamKey(writerNodeID, normalizeField(paramField));
      const list = usageMap.get(key) ?? [];
      return list.map((usage) => ({
        paramKey: usage.paramKey,
        paramField: usage.paramField,
        readerNodeId: usage.readerNodeId,
        readerNodeName: nodeNameMap.get(usage.readerNodeId) ?? usage.readerNodeId,
        readerFieldPath: usage.readerFieldPath
      }));
    },
    getAvailableParamsForNode(nodeID: string): GlobalParamDefinition[] {
      const ancestors = getAncestorNodeIDs(nodeID, edges);
      return params.filter((param) => ancestors.has(param.writerNodeId));
    },
    validateResolvableReferences() {
      const errors: string[] = [];
      if (hasWorkflowCycle(nodes, edges)) {
        errors.push("流程存在环路，无法保证参数时序，请先移除循环连线。");
      }

      nodes.forEach((node) => {
        const availableSet = new Set(this.getAvailableParamsForNode(node.id).map((param) => param.field));
        const fieldUsages = gatherReaderFieldUsages(node);
        fieldUsages.forEach((usage) => {
          if (!availableSet.has(usage.field)) {
            const nodeName = node.data?.name || node.id;
            errors.push(`节点「${nodeName}」引用了不可用参数「${usage.field}」（${usage.fieldPath}）`);
          }
        });
      });
      return errors;
    }
  };
}
