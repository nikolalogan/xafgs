export type BaseNodeEvents = {
  onEnter?: () => void;
  onExecute?: () => void;
  onExit?: () => void;
};

export type FormItemType = "input" | "file" | "select" | "customForm";

export type SelectOption = {
  id: string;
  name: string;
  value: string;
};

export type CustomSchemaItem = {
  id?: string;
  name?: string;
  label?: string;
  type?: string;
};

export type FormItemConfig = {
  id: string;
  type: FormItemType;
  label: string;
  field: string;
  required?: boolean;
  html?: string;
  schema?: CustomSchemaItem[];
  options?: SelectOption[];
};

export type FormConfig = {
  id: string;
  name: string;
  items: FormItemConfig[];
};

export type JsOutputConfig = {
  id: string;
  field: string;
  label: string;
  type: FormItemType;
  path?: string;
  options?: SelectOption[];
};

export type NodeJsConfig = {
  script: string;
  inputs: string[];
  outputs: JsOutputConfig[];
};

export type DecisionBranchConfig = {
  id: string;
  name: string;
  code: string;
};

export type NodeDecisionConfig = {
  script: string;
  inputs: string[];
  branches: DecisionBranchConfig[];
};

export type HttpHeaderConfig = {
  id: string;
  key: string;
  value: string;
};

export type HttpBodyMode = "none" | "json" | "text";

export type NodeHttpConfig = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  inputs: string[];
  headers: HttpHeaderConfig[];
  bodyMode: HttpBodyMode;
  bodyTemplate?: string;
  outputs: JsOutputConfig[];
};

export type NodeEndConfig = {
  outputs: string[];
};

export type NodeParams = {
  forms?: FormConfig[];
  jsConfig?: NodeJsConfig;
  decisionConfig?: NodeDecisionConfig;
  httpConfig?: NodeHttpConfig;
  endConfig?: NodeEndConfig;
};

export type BaseNodeData = {
  name: string;
  code: string;
  events?: BaseNodeEvents;
  params?: NodeParams;
  validate?: NodeValidateFn;
};

export type GlobalParamDefinition = {
  id: string;
  name: string;
  field: string;
  type: FormItemType;
  writerNodeId: string;
  writerNodeType: string;
  writerNodeCode: string;
  options?: SelectOption[];
  consumerNodeIds: string[];
};

export type NodeValidateResult = {
  ok: boolean;
  messages: string[];
};

export type NodeValidateContext = {
  data: BaseNodeData;
  globalParams: GlobalParamDefinition[];
};

export type NodeValidateFn = (context: NodeValidateContext) => NodeValidateResult;
