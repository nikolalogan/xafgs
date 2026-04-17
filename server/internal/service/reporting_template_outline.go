package service

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"sxfgssever/server/internal/model"
)

var markdownHeadingRegexp = regexp.MustCompile(`^(#{1,6})\s+(.+)$`)

func buildReportTemplateOutline(markdown string) []model.ReportTemplateOutlineNode {
	lines := strings.Split(markdown, "\n")
	nodes := make([]model.ReportTemplateOutlineNode, 0)
	type stackItem struct {
		level int
		path  []int
	}
	stack := make([]stackItem, 0)
	sequence := 1

	for lineNumber, line := range lines {
		matches := markdownHeadingRegexp.FindStringSubmatch(strings.TrimSpace(line))
		if len(matches) != 3 {
			continue
		}
		level := len(matches[1])
		title := strings.TrimSpace(matches[2])
		if level <= 1 || title == "" {
			continue
		}
		node := model.ReportTemplateOutlineNode{
			ID:       fmt.Sprintf("heading-%d", sequence),
			Title:    title,
			Level:    level,
			Line:     lineNumber + 1,
			Children: []model.ReportTemplateOutlineNode{},
		}
		sequence++

		for len(stack) > 0 && stack[len(stack)-1].level >= level {
			stack = stack[:len(stack)-1]
		}
		if len(stack) == 0 {
			nodes = append(nodes, node)
			stack = append(stack, stackItem{level: level, path: []int{len(nodes) - 1}})
			continue
		}

		parentPath := stack[len(stack)-1].path
		path := append(append([]int{}, parentPath...), appendNodeAtPath(&nodes, parentPath, node))
		stack = append(stack, stackItem{level: level, path: path})
	}
	return nodes
}

func appendNodeAtPath(root *[]model.ReportTemplateOutlineNode, path []int, node model.ReportTemplateOutlineNode) int {
	if len(path) == 0 {
		*root = append(*root, node)
		return len(*root) - 1
	}

	current := (*root)[path[0]]
	current.Children = appendNodeAtPathRecursive(current.Children, path[1:], node)
	(*root)[path[0]] = current
	return len(current.Children) - 1
}

func appendNodeAtPathRecursive(nodes []model.ReportTemplateOutlineNode, path []int, node model.ReportTemplateOutlineNode) []model.ReportTemplateOutlineNode {
	if len(path) == 0 {
		return append(nodes, node)
	}
	current := nodes[path[0]]
	current.Children = appendNodeAtPathRecursive(current.Children, path[1:], node)
	nodes[path[0]] = current
	return nodes
}

func buildOutlineJSON(markdown string) json.RawMessage {
	nodes := buildReportTemplateOutline(markdown)
	raw, _ := json.Marshal(nodes)
	return raw
}

func buildMarkdownFromDOCX(raw []byte) string {
	documentXML := readZipEntry(raw, "word/document.xml")
	if len(documentXML) == 0 {
		return ""
	}
	blocks := parseDOCXBlocks(documentXML)
	parts := make([]string, 0, len(blocks))
	for _, block := range blocks {
		switch block.Kind {
		case "section":
			level := block.TitleLevel
			if level <= 0 {
				level = 2
			}
			if level > 6 {
				level = 6
			}
			parts = append(parts, fmt.Sprintf("%s %s", strings.Repeat("#", level), strings.TrimSpace(block.Title)))
		case "paragraph":
			text := strings.TrimSpace(block.Text)
			if text != "" {
				parts = append(parts, text)
			}
		case "table":
			tableMarkdown := rowsToMarkdownTable(block.Rows)
			if tableMarkdown != "" {
				parts = append(parts, tableMarkdown)
			}
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}

func rowsToMarkdownTable(rows [][]string) string {
	normalized := normalizeRows(rows)
	if len(normalized) == 0 {
		return ""
	}
	header := normalized[0]
	if len(header) == 0 {
		return ""
	}
	var builder strings.Builder
	builder.WriteString("| ")
	builder.WriteString(strings.Join(escapeMarkdownRow(header), " | "))
	builder.WriteString(" |\n| ")
	divider := make([]string, len(header))
	for i := range divider {
		divider[i] = "---"
	}
	builder.WriteString(strings.Join(divider, " | "))
	builder.WriteString(" |")

	for _, row := range normalized[1:] {
		current := row
		if len(current) < len(header) {
			padded := make([]string, len(header))
			copy(padded, current)
			current = padded
		}
		if len(current) > len(header) {
			current = current[:len(header)]
		}
		builder.WriteString("\n| ")
		builder.WriteString(strings.Join(escapeMarkdownRow(current), " | "))
		builder.WriteString(" |")
	}
	return builder.String()
}

func escapeMarkdownRow(row []string) []string {
	out := make([]string, 0, len(row))
	for _, item := range row {
		cell := strings.TrimSpace(strings.ReplaceAll(item, "\n", "<br/>"))
		cell = strings.ReplaceAll(cell, "|", "\\|")
		out = append(out, cell)
	}
	return out
}
