package service

import (
	"os"
	"strings"
)

func loadWorkflowAIReadme() string {
	candidates := []string{
		"docs/workflow-dsl/README-AI.md",
		"../docs/workflow-dsl/README-AI.md",
		"../../docs/workflow-dsl/README-AI.md",
	}
	for _, filePath := range candidates {
		raw, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}
		text := strings.TrimSpace(string(raw))
		if text != "" {
			return text
		}
	}
	return strings.TrimSpace(`
工作流 DSL 约束：
1. 根对象必须包含 nodes，且 nodes 非空。
2. 必须存在且仅存在一个 start 节点，至少存在一个 end 节点。
3. 仅允许 start、input、llm、if-else、iteration、code、http-request、api-request、end 节点类型。
4. 变量引用必须使用真实路径，例如 {{start.query}}、{{workflow.entp.name}}。
5. llm/http-request/api-request 的 retryCount 默认 0，且必须为大于等于 0 的整数。
6. if-else 分支必须使用合法 sourceHandle；写回映射优先使用 expression + targetPath。
`)
}
