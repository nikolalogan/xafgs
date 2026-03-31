package service

import (
	"bytes"
	"fmt"

	"github.com/nikolalohinski/gonja/v2"
	"github.com/nikolalohinski/gonja/v2/exec"
)

type TemplateRenderer interface {
	Render(content string, context map[string]any) (string, error)
}

type GonjaTemplateRenderer struct{}

func NewGonjaTemplateRenderer() TemplateRenderer {
	return &GonjaTemplateRenderer{}
}

func (renderer *GonjaTemplateRenderer) Render(content string, context map[string]any) (string, error) {
	template, err := gonja.FromString(content)
	if err != nil {
		return "", fmt.Errorf("parse template: %w", err)
	}

	execContext := exec.NewContext(map[string]any(context))
	var buffer bytes.Buffer
	if err := template.Execute(&buffer, execContext); err != nil {
		return "", fmt.Errorf("execute template: %w", err)
	}
	return buffer.String(), nil
}
