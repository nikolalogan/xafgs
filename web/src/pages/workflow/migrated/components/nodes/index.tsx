import type { NodeProps } from "@xyflow/react";
import type { DifyNode } from "../../types";
import { BlockEnum } from "../../types";
import StartNode from "./StartNode";
import LLMNode from "./LLMNode";
import IfElseNode from "./IfElseNode";
import EndNode from "./EndNode";
import InputNode from "./InputNode";
import HttpRequestNode from "./HttpRequestNode";
import CodeNode from "./CodeNode";
import FileExtractorNode from "./FileExtractorNode";
import BaseCard from "./BaseCard";

function DifyNodeRenderer(props: NodeProps<DifyNode>) {
  const nodeType = String(props.data.type);
  if (nodeType === BlockEnum.Start) return <StartNode {...props} />;
  if (nodeType === BlockEnum.LLM) return <LLMNode {...props} />;
  if (nodeType === BlockEnum.Input) return <InputNode {...props} />;
  if (nodeType === BlockEnum.IfElse) return <IfElseNode {...props} />;
  if (nodeType === BlockEnum.HttpRequest) return <HttpRequestNode {...props} />;
  if (nodeType === BlockEnum.Code) return <CodeNode {...props} />;
  if (nodeType === BlockEnum.FileExtractor) return <FileExtractorNode {...props} />;
  if (nodeType === BlockEnum.End) return <EndNode {...props} />;
  return <BaseCard id={props.id} data={props.data} blockLabel={nodeType.toUpperCase()} />;
}

export default DifyNodeRenderer;
