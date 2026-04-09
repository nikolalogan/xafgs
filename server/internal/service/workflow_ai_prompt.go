package service

import (
	"strings"

	"sxfgssever/server/internal/ai"
	"sxfgssever/server/internal/model"
)

type workflowAIPromptSection struct {
	Title string
	Body  string
}

func buildWorkflowAIMessages(systemBase string, sections []workflowAIPromptSection, finalInstruction string) []ai.ChatMessage {
	return []ai.ChatMessage{
		{
			Role:    model.ChatMessageRoleSystem,
			Content: buildWorkflowAISystemPrompt(systemBase),
		},
		{
			Role:    model.ChatMessageRoleUser,
			Content: buildWorkflowAIUserPrompt(sections, finalInstruction),
		},
	}
}

func buildWorkflowAISystemPrompt(systemBase string) string {
	base := strings.TrimSpace(systemBase)
	suffix := "README-AI 是 DSL、变量引用、节点配置相关约束的统一规则来源，凡涉及这些内容都必须严格遵守。"
	if base == "" {
		return suffix
	}
	return base + " " + suffix
}

func buildWorkflowAIUserPrompt(sections []workflowAIPromptSection, finalInstruction string) string {
	var builder strings.Builder

	builder.WriteString("README-AI 约束（必须严格遵守）：\n")
	builder.WriteString(loadWorkflowAIReadme())

	for _, section := range sections {
		title := strings.TrimSpace(section.Title)
		body := strings.TrimSpace(section.Body)
		if title == "" || body == "" {
			continue
		}
		builder.WriteString("\n\n")
		builder.WriteString(title)
		builder.WriteString("：\n")
		builder.WriteString(body)
	}

	trimmedFinalInstruction := strings.TrimSpace(finalInstruction)
	if trimmedFinalInstruction != "" {
		builder.WriteString("\n\n")
		builder.WriteString(trimmedFinalInstruction)
	}

	return builder.String()
}
