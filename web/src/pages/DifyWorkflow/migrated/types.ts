import type { Edge, Node } from "@xyflow/react";

export enum BlockEnum {
  Start = "start",
  LLM = "llm",
  Tool = "tool",
  IfElse = "if-else",
  End = "end",
  Iteration = "iteration",
  Loop = "loop",
  HumanInput = "human-input",
  QuestionClassifier = "question-classifier",
  HttpRequest = "http-request",
  Code = "code",
  Input = "input"
}

export enum NodeRunningStatus {
  Idle = "idle",
  Running = "running",
  Succeeded = "succeeded",
  Failed = "failed",
  Exception = "exception"
}

export type IfElseMatchMode =
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "is_empty"
  | "is_not_empty"
  | "equals"
  | "not_equals"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

export type DifyNodeData = {
  type: BlockEnum | string;
  title: string;
  desc?: string;
  input_forms?: Array<{
    id: string;
    name: string;
    items: Array<{
      id: string;
      type: "text" | "paragraph" | "select" | "number" | "checkbox" | "file" | "file-list" | "json";
      label: string;
      field: string;
      required?: boolean;
      default?: string;
      validation_refs?: string[];
      validation_script?: string;
      visibility_refs?: string[];
      visibility_script?: string;
      options?: Array<{
        id: string;
        name: string;
        value: string;
      }>;
    }>;
  }>;
  input_config?: {
    fields: Array<{
      id: string;
      label: string;
      value_type: "string" | "number" | "integer" | "boolean" | "list" | "array" | "object" | "json" | "file";
      required?: boolean;
      default?: string;
    }>;
    forms?: Array<{
      id: string;
      name: string;
      items: Array<{
        id: string;
        type: "text" | "paragraph" | "select" | "number" | "checkbox" | "file" | "file-list" | "json";
        label: string;
        field: string;
        required?: boolean;
        default?: string;
        validation_refs?: string[];
        validation_script?: string;
        visibility_refs?: string[];
        visibility_script?: string;
        options?: Array<{
          id: string;
          name: string;
          value: string;
        }>;
      }>;
    }>;
  };
  llm_config?: {
    model: string;
    temperature: number;
    top_p: number;
    max_tokens: number;
    prompt_template?: string;
  };
  if_else_config?: {
    branches: Array<{
      id: string;
      label: string;
      condition?: string;
      is_else?: boolean;
      match_mode?: IfElseMatchMode;
      match_value?: string;
      next_node_id?: string;
    }>;
  };
  http_config?: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    timeout_ms: number;
    retry_count: number;
    headers: Array<{
      id: string;
      key: string;
      value: string;
    }>;
    query: Array<{
      id: string;
      key: string;
      value: string;
    }>;
    body_mode: "none" | "json" | "form-data" | "x-www-form-urlencoded" | "raw";
    body_text?: string;
    body_kv?: Array<{
      id: string;
      key: string;
      value: string;
    }>;
    response_config?: {
      format: "json";
      charset: {
        mode: "auto" | "manual";
        manual_value?: "utf-8" | "gbk" | "gb18030" | "latin1";
        fallback_chain?: string[];
        on_invalid: "fail" | "replace";
      };
      json: {
        parse_mode: "strict" | "tolerant";
        schema_text?: string;
        validate_schema: boolean;
        on_parse_error: "fail" | "empty_object";
      };
      output: {
        extract_rules: Array<{
          id: string;
          key: string;
          path: string;
          write_to_process_path?: string;
          required: boolean;
          default?: string;
        }>;
        keep_raw_text: boolean;
        keep_raw_json: boolean;
      };
    };
  };
  code_config?: {
    language: "javascript" | "python";
    script: string;
    timeout_ms: number;
    input_mapping?: Array<{
      id: string;
      key: string;
      source: string;
      required?: boolean;
      default?: string;
    }>;
    output_mapping?: Array<{
      id: string;
      key: string;
      target: string;
    }>;
  };
  variables?: Array<{
    variable: string;
    label?: string;
    value_type?: string;
  }>;
  error_handle?: {
    enabled: boolean;
    strategy?: "continue-on-error" | "fail-branch";
  };
  width?: number;
  height?: number;
  _connectedNodeIsHovering?: boolean;
  _waitingRun?: boolean;
  _sourceRunningStatus?: NodeRunningStatus;
  _targetRunningStatus?: NodeRunningStatus;
  _isBundled?: boolean;
};

export type DifyGlobalVariable = {
  id: string;
  name: string;
  value_type: "string" | "number" | "boolean" | "object" | "array";
  value?: string;
};

export type DifyProcessObjectNode = {
  id: string;
  name: string;
  value_type: "string" | "number" | "integer" | "boolean" | "object" | "array" | "json";
  required?: boolean;
  children?: DifyProcessObjectNode[];
};

export type DifyProcessObject = {
  schema_text?: string;
  fields: DifyProcessObjectNode[];
};

export type DifyNode = Node<DifyNodeData, "difyNode">;
export type DifyEdge = Edge;
