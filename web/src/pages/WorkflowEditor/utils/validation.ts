import type { NodeValidateContext, NodeValidateFn, NodeValidateResult } from "./types";
import { transformScriptPlaceholders } from "./script";

const proxyFactory = () => {
  const handler: ProxyHandler<any> = {
    get: (_target, prop) => {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === "valueOf") return () => 0;
      if (prop === "toString") return () => "0";
      return proxyFactory();
    },
    apply: () => 0
  };
  const proxy = new Proxy(function () {}, handler);
  return proxy;
};

export const defaultNodeValidate: NodeValidateFn = () => ({
  ok: true,
  messages: []
});

const findDuplicates = (values: string[]) => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  });
  return Array.from(duplicates);
};

export const validateProcessorNode = ({ data }: NodeValidateContext): NodeValidateResult => {
  const config = data.params?.jsConfig;
  if (!config) return { ok: true, messages: [] };

  const messages: string[] = [];
  const trim = (value: string) => value.trim();
  const declaredInputs = (config.inputs ?? []).map(trim).filter(Boolean);
  const declaredOutputs = (config.outputs ?? []).map((output) => ({
    id: output.id,
    field: trim(output.field),
    path: (output.path ?? "").trim()
  }));

  const duplicateInputs = findDuplicates(declaredInputs);
  if (duplicateInputs.length > 0) messages.push(`输入参数存在重复：${duplicateInputs.join(", ")}`);

  const duplicateOutputs = findDuplicates(declaredOutputs.map((item) => item.field));
  if (duplicateOutputs.length > 0) messages.push(`输出参数存在重复字段：${duplicateOutputs.join(", ")}`);

  const emptyOutputs = declaredOutputs.filter((item) => !item.field).map((item) => item.id);
  if (emptyOutputs.length > 0) messages.push("存在未填写字段标识的输出参数，请完善后重试");

  const accessedInputs = new Set<string>();
  const outputKeys = new Set<string>();
  const paramsProxy = new Proxy(
    {},
    {
      get: (_target, prop) => {
        const key = String(prop);
        accessedInputs.add(key);
        return proxyFactory();
      }
    }
  );

  try {
    const script = transformScriptPlaceholders(config.script);
    const runScript = new Function("context", script);
    const result = runScript({ params: paramsProxy });
    if (result && typeof result === "object") {
      Object.keys(result).forEach((key) => outputKeys.add(key));
    } else if (result !== undefined) {
      messages.push("脚本返回值需为对象，请返回 { 字段: 值 } 形式");
    }
  } catch (error) {
    messages.push(`脚本执行失败：${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, messages };
  }

  const usedInputs = Array.from(accessedInputs).filter(Boolean);
  const declaredInputSet = new Set(declaredInputs);
  const declaredOutputSet = new Set(declaredOutputs.map((item) => item.field));

  const missingInputDeclarations = usedInputs.filter((key) => !declaredInputSet.has(key));
  if (missingInputDeclarations.length > 0) {
    messages.push(`脚本引用但未声明的输入：${missingInputDeclarations.join(", ")}`);
  }

  const unusedInputDeclarations = declaredInputs.filter((key) => !accessedInputs.has(key));
  if (unusedInputDeclarations.length > 0) {
    messages.push(`声明但脚本未使用的输入：${unusedInputDeclarations.join(", ")}`);
  }

  const actualOutputs = Array.from(outputKeys);
  const undeclaredOutputs = actualOutputs.filter((key) => !declaredOutputSet.has(key));
  if (undeclaredOutputs.length > 0) {
    messages.push(`脚本返回但未声明的输出：${undeclaredOutputs.join(", ")}`);
  }

  const unusedDeclaredOutputs = declaredOutputs.map((item) => item.field).filter((key) => !outputKeys.has(key));
  if (unusedDeclaredOutputs.length > 0) {
    messages.push(`声明但脚本未返回的输出：${unusedDeclaredOutputs.join(", ")}`);
  }

  return { ok: messages.length === 0, messages };
};

export const validateDecisionNode = ({ data }: NodeValidateContext): NodeValidateResult => {
  const config = data.params?.decisionConfig;
  if (!config) return { ok: true, messages: [] };

  const messages: string[] = [];
  const trim = (value: string) => value.trim();
  const declaredInputs = (config.inputs ?? []).map(trim).filter(Boolean);
  const declaredBranches = (config.branches ?? []).map((branch) => ({
    id: branch.id,
    code: trim(branch.code),
    name: branch.name
  }));

  const duplicateInputs = findDuplicates(declaredInputs);
  if (duplicateInputs.length > 0) messages.push(`输入参数存在重复：${duplicateInputs.join(", ")}`);

  const duplicateBranchCodes = findDuplicates(declaredBranches.map((branch) => branch.code));
  if (duplicateBranchCodes.length > 0) messages.push(`分支编码存在重复：${duplicateBranchCodes.join(", ")}`);

  const emptyBranchCodes = declaredBranches.filter((branch) => !branch.code).map((branch) => branch.name || branch.id);
  if (emptyBranchCodes.length > 0) messages.push(`存在未填写编码的分支：${emptyBranchCodes.join(", ")}`);

  const accessedInputs = new Set<string>();
  const paramsProxy = new Proxy(
    {},
    {
      get: (_target, prop) => {
        const key = String(prop);
        accessedInputs.add(key);
        return proxyFactory();
      }
    }
  );

  let executedResult: unknown;
  try {
    const script = transformScriptPlaceholders(config.script);
    const runScript = new Function("context", script);
    executedResult = runScript({ params: paramsProxy });
    if (executedResult !== undefined && typeof executedResult !== "string") {
      messages.push("脚本需返回分支编码字符串，例如 return 'branch_code';");
    }
  } catch (error) {
    messages.push(`脚本执行失败：${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, messages };
  }

  const usedInputs = Array.from(accessedInputs).filter(Boolean);
  const declaredInputSet = new Set(declaredInputs);
  const missingInputDeclarations = usedInputs.filter((key) => !declaredInputSet.has(key));
  if (missingInputDeclarations.length > 0) {
    messages.push(`脚本引用但未声明的输入：${missingInputDeclarations.join(", ")}`);
  }

  const unusedInputDeclarations = declaredInputs.filter((key) => !accessedInputs.has(key));
  if (unusedInputDeclarations.length > 0) {
    messages.push(`声明但脚本未使用的输入：${unusedInputDeclarations.join(", ")}`);
  }

  if (typeof executedResult === "string") {
    const trimmedResult = executedResult.trim();
    const branchCodes = new Set(declaredBranches.map((branch) => branch.code));
    if (!branchCodes.has(trimmedResult)) {
      messages.push(`脚本返回分支编码（${trimmedResult}）未在分支配置中找到匹配项`);
    }
  }

  return { ok: messages.length === 0, messages };
};

const collectPlaceholders = (content?: string) => {
  const matches = new Set<string>();
  if (!content) return matches;
  const regex = /\{\{\s*([\w.-]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    matches.add(match[1]);
  }
  return matches;
};

export const validateHttpNode = ({ data }: NodeValidateContext): NodeValidateResult => {
  const config = data.params?.httpConfig;
  if (!config) return { ok: true, messages: [] };

  const messages: string[] = [];
  const trim = (value: string) => value.trim();
  const declaredInputs = (config.inputs ?? []).map(trim).filter(Boolean);
  const declaredOutputs = (config.outputs ?? []).map((output) => ({
    id: output.id,
    field: trim(output.field),
    path: trim(output.path ?? "")
  }));

  if (!config.url || !config.url.trim()) {
    messages.push("请求 URL 不能为空");
  }

  const duplicateInputs = findDuplicates(declaredInputs);
  if (duplicateInputs.length > 0) messages.push(`输入参数存在重复：${duplicateInputs.join(", ")}`);

  const duplicateOutputs = findDuplicates(declaredOutputs.map((item) => item.field));
  if (duplicateOutputs.length > 0) messages.push(`响应参数存在重复字段：${duplicateOutputs.join(", ")}`);

  const emptyOutputs = declaredOutputs.filter((item) => !item.field).map((item) => item.id);
  if (emptyOutputs.length > 0) messages.push("存在未填写字段标识的响应参数，请完善后重试");

  const emptyPaths = declaredOutputs.filter((item) => !item.path).map((item) => item.id);
  if (emptyPaths.length > 0) messages.push("存在未填写取值路径的响应参数，请完善后重试");

  const placeholderSet = new Set<string>();
  collectPlaceholders(config.url).forEach((key) => placeholderSet.add(key));
  (config.headers ?? []).forEach((header) => {
    collectPlaceholders(header.key).forEach((key) => placeholderSet.add(key));
    collectPlaceholders(header.value).forEach((key) => placeholderSet.add(key));
  });
  if (config.bodyMode !== "none") {
    collectPlaceholders(config.bodyTemplate).forEach((key) => placeholderSet.add(key));
    if (config.bodyMode === "json" && config.bodyTemplate) {
      try {
        JSON.parse(config.bodyTemplate);
      } catch (error) {
        messages.push(`请求体 JSON 模板解析失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const declaredInputSet = new Set(declaredInputs);
  const missingInputs = Array.from(placeholderSet).filter((key) => !declaredInputSet.has(key));
  if (missingInputs.length > 0) {
    messages.push(`模板中引用但未声明的输入字段：${missingInputs.join(", ")}`);
  }

  const unusedInputs = declaredInputs.filter((key) => !placeholderSet.has(key));
  if (unusedInputs.length > 0) {
    messages.push(`声明但未在请求模板中使用的输入：${unusedInputs.join(", ")}`);
  }

  return { ok: messages.length === 0, messages };
};
